"""
generate_recommendations.py 
================================================================
PulseFi — AI Recommendation Batch Generator
---------------------------------------------
SETUP & RUN:
  1. pip install google-genai pandas openpyxl
  2. export GEMINI_API_KEY="AIza..." in your terminal
  3. python generate_recommendations.py

OUTPUT:
    - Recommendations JSON containing 3 reccomendations per user 
    - Reccs are based on the given excel synthetic data
    - Reccs are also based on the derived 'user goal'
    - Output of recommendations is in strict format adhering to UX prototype

"""

import os
import json
import time
import math
import re
import pandas as pd
from google import genai
from google.genai import types

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────

EXCEL_PATH     = "genz_fhi_master_dataset.xlsx"  
OUTPUT_PATH  = "recommendations.json"           # output for the frontend

MODEL_NAME   = "gemini-2.5-flash-lite"          # free model, fast

BASE_DELAY   = 0.5    # seconds between requests 
MAX_RETRIES  = 4      # retries per user before skipping

# Set True to regenerate ALL 2000 users from scratch (wipes existing output)
# Set False to resume from where you left off (skips already-done users)
RERUN_ALL    = True

# To selectively redo specific users only, add their IDs here (overrides RERUN_ALL)
# Leave as empty set for a full run
RERUN_USERS  = set()


# ─────────────────────────────────────────────
# GOAL INFERENCE
# ─────────────────────────────────────────────

def infer_user_goals(row):
    """
    Derives what this user should prioritise based on their 5 financial scores.
    Returns plain-English goal strings embedded in the prompt so the AI's
    recommendations are aligned to what actually matters for this person.
    """
    goals = []

    if row["E_emerg"] < 30:
        goals.append("urgently build emergency fund (critically low coverage)")
    if row["R_D2I"] < 40:
        goals.append("reduce short-term debt (debt-to-income ratio is strained)")
    if row["S_rate"] < 40:
        goals.append("improve monthly savings rate")
    if row["I_invest"] == 0 and row["N_worth"] > 60:
        goals.append("start investing — has financial capacity but no investments yet")
    if row["I_invest"] > 50:
        goals.append("optimise existing investment portfolio")
    if row["N_worth"] > 80:
        goals.append("grow long-term wealth")
    if row["neg_event_30d"] == 1:
        goals.append("recover from a recent negative financial event")
    if not goals:
        goals.append("maintain stability and build healthy financial habits")

    return goals


# ─────────────────────────────────────────────
# SCORE → PLAIN ENGLISH HELPERS
# Prevents raw scores leaking into descriptions
# ─────────────────────────────────────────────

def score_to_level(score):
    """Converts a 0–100 score to a plain-English level string."""
    if score < 20:   return "critically low"
    if score < 40:   return "low"
    if score < 60:   return "moderate"
    if score < 80:   return "good"
    return "strong"

def fmt(val):
    """Formats a number as GBP, handles NaN gracefully."""
    if isinstance(val, float) and math.isnan(val):
        return "N/A"
    return f"£{val:,.0f}"


# ─────────────────────────────────────────────
# PROMPT BUILDER
# ─────────────────────────────────────────────

def build_prompt(row):
    """
    Builds the prompt for a single user. All quality fixes applied:
      - Scores translated to plain English (no raw numbers in output)
      - Tone guardrails: friendly but grounded, no hype words
      - Status must match the score of the SPECIFIC issue in each card
      - Action buttons must be specific to this user's actual amounts
    """
    savings = row["monthly_income"] - row["monthly_spending"]
    goals   = infer_user_goals(row)

    # Pre-translate scores so the model can reference them naturally
    emerg_level  = score_to_level(row["E_emerg"])
    debt_level   = score_to_level(row["R_D2I"])
    savings_level= score_to_level(row["S_rate"])
    invest_level = score_to_level(row["I_invest"])
    worth_level  = score_to_level(row["N_worth"])

    has_portfolio = not (isinstance(row.get("portfolio_ann_return"), float)
                         and math.isnan(row.get("portfolio_ann_return", float("nan"))))

    return f"""You are Pulse, a financial wellness AI for a Gen Z banking app called PulseFi.
Generate exactly 3 personalised financial recommendations for this user.

=== USER PROFILE ===
Age: {int(row['age'])} | Employment: {row['employment_type'].replace('_', ' ')}
Monthly income:   {fmt(row['monthly_income'])}
Monthly spending: {fmt(row['monthly_spending'])}
Monthly saved:    {fmt(savings)}
Credit card debt: {fmt(row['credit_card_debt'])}
BNPL debt:        {fmt(row['bnpl_debt'])}
Has investments:  {"Yes" if has_portfolio else "No"}
Negative financial event last 30 days: {"Yes" if row['neg_event_30d'] else "No"}

Financial health levels (use these words, never the raw numbers):
  Emergency fund:  {emerg_level}
  Debt load:       {debt_level}
  Savings rate:    {savings_level}
  Investment:      {invest_level}
  Net worth:       {worth_level}

=== GOALS TO ADDRESS ===
{chr(10).join(f"  - {g}" for g in goals)}

=== STRICT RULES — follow every one ===
1. Each of the 3 cards must address one of the goals above
2. Use the user's ACTUAL £ amounts in descriptions (e.g. "your £{int(row['credit_card_debt'])} credit card debt")
3. NEVER mention raw score numbers — use the plain-English levels above instead
4. Status must match the health level of the issue addressed IN THAT CARD:
     critically low or low  → URGENT
     moderate               → READY
     good or strong         → ON TRACK
5. Tone: friendly and direct, like a financially-savvy friend texting you.
   - NO hype words: king, queen, boss, fire, slay, fam, vibe, crush it
   - NO exclamation marks in titles
   - Warm and encouraging but grounded — no toxic positivity
6. Action buttons must be SPECIFIC to this user's numbers:
   - Good: "Pay £{int(row['credit_card_debt'])} card" / "Save £50 more"
   - Bad: "Pay Off Debt" / "Save More"
7. Descriptions: max 2 sentences. Mention real amounts. No padding.

=== OUTPUT FORMAT ===
Return ONLY a valid JSON array — no markdown fences, no explanation, nothing else.
[
  {{
    "title": "Short title, max 8 words, sentence case, no exclamation mark",
    "status": "URGENT | READY | ON TRACK",
    "description": "2 sentences max. Real amounts. Friendly tone.",
    "action1_label": "Specific CTA, 3 words max",
    "action1_sub": "2 words max",
    "action2_label": "Alt option, 3 words max",
    "action2_sub": "2 words max"
  }},
  {{...}},
  {{...}}
]""".strip()


# ─────────────────────────────────────────────
# RETRY DELAY PARSER
# ─────────────────────────────────────────────

def parse_retry_delay(error_str):
    """Extracts Google's requested retry delay from a 429 error message."""
    match = re.search(r'retry_delay\s*\{[^}]*seconds:\s*(\d+)', error_str)
    if match:
        return int(match.group(1)) + 2
    return 30   # safe fallback


# ─────────────────────────────────────────────
# API CALL WITH RETRY
# ─────────────────────────────────────────────

def call_gemini(client, prompt, user_id, attempt=1):
    """
    Calls Gemini and returns a parsed list of 3 recommendation dicts.
    Handles 429s by waiting exactly as long as Google requests.
    Backs off exponentially on other errors.
    Returns None after MAX_RETRIES failures so the script can continue.
    """
    try:
        response = client.models.generate_content(
            model   = MODEL_NAME,
            contents= prompt,
            config  = types.GenerateContentConfig(
                temperature       = 0.7,
                max_output_tokens = 700,
            )
        )
        raw = response.text.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()

        recs = json.loads(raw)

        if not isinstance(recs, list) or len(recs) != 3:
            raise ValueError(f"Expected list of 3, got {type(recs).__name__} len={len(recs)}")

        # Validate required keys are present
        required = {"title","status","description","action1_label","action1_sub","action2_label","action2_sub"}
        for r in recs:
            missing = required - set(r.keys())
            if missing:
                raise ValueError(f"Missing keys: {missing}")

        return recs

    except Exception as e:
        err_str = str(e)
        is_rate_limit = "429" in err_str or "quota" in err_str.lower()

        if is_rate_limit:
            wait = parse_retry_delay(err_str) + (attempt - 1) * 10
            print(f"\n  ⏳ Rate limited — waiting {wait}s (attempt {attempt})...")
            time.sleep(wait)
            return call_gemini(client, prompt, user_id, attempt + 1)

        print(f"\n  ⚠️  Attempt {attempt}/{MAX_RETRIES} failed for {user_id}: {e}")
        if attempt < MAX_RETRIES:
            time.sleep(BASE_DELAY * (2 ** (attempt - 1)))
            return call_gemini(client, prompt, user_id, attempt + 1)

        print(f"  ❌ Skipping {user_id} after {MAX_RETRIES} attempts")
        return None


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():

    # ── Auth ──────────────────────────────────
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GEMINI_API_KEY not set.\n"
            "Run: export GEMINI_API_KEY='AIza...your-key...'"
        )
    client = genai.Client(api_key=api_key)
    print(f"✅ Gemini connected — model: {MODEL_NAME} (paid tier)")

    # ── Load dataset ──────────────────────────
    # Supports both .xlsx and .csv
    if EXCEL_PATH.endswith(".xlsx"):
        df = pd.read_excel(EXCEL_PATH)
    else:
        df = pd.read_csv(EXCEL_PATH)
    print(f"✅ Loaded {len(df)} users from {EXCEL_PATH}")

    # ── Handle output file ────────────────────
    if RERUN_ALL:
        # Wipe existing output — regenerate everything fresh
        results = {}
        print(f"🔄 RERUN_ALL = True — regenerating all {len(df)} users from scratch")
    elif os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, "r") as f:
            results = json.load(f)
        print(f"📂 Resuming — {len(results)} users already done")
    else:
        results = {}

    # ── Process ───────────────────────────────
    processed = 0
    skipped   = 0

    for i, row in df.iterrows():
        user_id = row["user_id"]

        # Selective rerun mode — only process specific users
        if RERUN_USERS:
            if user_id not in RERUN_USERS:
                continue
            # Fall through even if already in results — we want to overwrite

        # Normal mode — skip already-done users
        elif user_id in results:
            continue

        print(f"[{i+1}/{len(df)}] {user_id}...", end=" ", flush=True)

        prompt = build_prompt(row)
        recs   = call_gemini(client, prompt, user_id)

        if recs:
            results[user_id] = recs
            processed += 1
            statuses = " / ".join(r["status"] for r in recs)
            print(f"✓  [{statuses}]")
        else:
            skipped += 1

        # Save after every user — crash-safe
        with open(OUTPUT_PATH, "w") as f:
            json.dump(results, f, indent=2)

        time.sleep(BASE_DELAY)

    # ── Summary ───────────────────────────────
    total_done = len(results)
    total_left = len(df) - total_done

    print(f"\n{'─' * 55}")
    print(f"✅ Done: {processed} processed, {skipped} skipped")
    print(f"📊 {total_done}/{len(df)} users have recommendations")

    if total_left > 0:
        print(f"⚠️  {total_left} users missing — re-run to retry skipped users")
    else:
        print(f"🎉 All {len(df)} users done!")
        print(f"   → Copy {OUTPUT_PATH} to your project root (next to index.html)")


if __name__ == "__main__":
    main()