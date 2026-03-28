"""
generate_users_json_for_frontend.py 
================================================================
PulseFi — Creating frontend user json
---------------------------------------------
RUN:
  1. python generate_recommendations.py

OUTPUT:
    - Users JSON ( same data from excel, converted into minimal json structure for readability within UI dashboard )

"""
import json
import math
import pandas as pd

EXCEL_PATH = "genz_fhi_master_dataset.xlsx"
OUTPUT_PATH = "users.json"

def safe_num(x, default=0):
    if pd.isna(x):
        return default
    return float(x)

def score_status(score):
    if score < 45:
        return "Needs attention"
    if score < 70:
        return "Fair"
    return "Strong"

def overall_fhi(row):
    scores = [
        safe_num(row.get("E_emerg")),
        safe_num(row.get("R_D2I")),
        safe_num(row.get("S_rate")),
        safe_num(row.get("I_invest")),
        safe_num(row.get("N_worth")),
    ]
    return round(sum(scores) / len(scores))

def first_name_for_demo(user_id):
    # Temporary until you have real names in the dataset
    demo_names = {
        "GZ00001": "Mia",
        "GZ00002": "Alex",
        "GZ00003": "Jordan",
        "GZ00004": "Sam",
    }
    return demo_names.get(user_id, "User")

def build_user_payload(row):
    user_id = row["user_id"]

    monthly_income = safe_num(row.get("monthly_income"))
    monthly_spending = safe_num(row.get("monthly_spending"))
    monthly_saved = max(0, monthly_income - monthly_spending)

    # Example emergency derivation
    emergency_current = safe_num(row.get("emergency_fund_amount", monthly_saved * 2))
    target_months = 3
    monthly_baseline = monthly_spending if monthly_spending > 0 else monthly_income
    emergency_target = monthly_baseline * target_months if monthly_baseline > 0 else 0
    emergency_progress = round((emergency_current / emergency_target) * 100) if emergency_target > 0 else 0
    emergency_progress = min(emergency_progress, 100)
    months_covered = round(emergency_current / monthly_baseline, 1) if monthly_baseline > 0 else 0

    fhi = overall_fhi(row)

    has_investments = not pd.isna(row.get("portfolio_ann_return"))
    portfolio_value = safe_num(row.get("portfolio_value", 0))
    portfolio_return = safe_num(row.get("portfolio_ann_return", 0))

    return {
        "user_id": user_id,
        "first_name": first_name_for_demo(user_id),
        "email": f"{first_name_for_demo(user_id).lower()}@pulsefi.com",

        "monthly_income": round(monthly_income, 2),
        "monthly_spending": round(monthly_spending, 2),
        "monthly_saved": round(monthly_saved, 2),
        "total_balance": round(safe_num(row.get("cash_balance", monthly_saved + emergency_current)), 2),

        "fhi_score": fhi,
        "fhi_status": score_status(fhi),
        "fhi_subtitle": "Your plan is working." if fhi >= 60 else "A few areas need attention.",
        "fhi_description": "Biggest opportunity is improving your emergency buffer." if safe_num(row.get("E_emerg")) < 60 else "You’re building stable financial habits.",

        "metrics": {
            "savings_score": round(safe_num(row.get("S_rate"))),
            "emergency_score": round(safe_num(row.get("E_emerg"))),
            "debt_score": round(safe_num(row.get("R_D2I"))),
            "investment_score": round(safe_num(row.get("I_invest"))),
            "networth_score": round(safe_num(row.get("N_worth")))
        },

        "emergency": {
            "months_covered": months_covered,
            "target_months": target_months,
            "current_amount": round(emergency_current, 2),
            "target_amount": round(emergency_target, 2),
            "progress_pct": emergency_progress
        },

        "portfolio": {
            "has_investments": has_investments,
            "value": round(portfolio_value, 2),
            "return_pct": round(portfolio_return, 2),
            "risk_label": "Low risk" if has_investments else "Not started"
        }
    }

def main():
    if EXCEL_PATH.endswith(".xlsx"):
        df = pd.read_excel(EXCEL_PATH)
    else:
        df = pd.read_csv(EXCEL_PATH)

    users = {}
    for _, row in df.iterrows():
        payload = build_user_payload(row)
        users[payload["user_id"]] = payload

    with open(OUTPUT_PATH, "w") as f:
        json.dump(users, f, indent=2)

    print(f"Saved {len(users)} users to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()