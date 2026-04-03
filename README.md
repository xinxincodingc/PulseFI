# PulseFi — Gen Z Banking AI Advisor

A smart financial health dashboard built for 18–30 year olds in Singapore. Combines a banking dashboard, AI-powered recommendations, and a machine-learning Financial Health Index (FHI) engine — all running in the browser with no backend required.

---

## What it does

### Dashboard
A full banking dashboard showing balance, savings pots, investment portfolio, monthly cash flow, and savings goals — personalised per user from a dataset of 2,000 Gen Z profiles.

### Pulse AI
Pre-generated personalised financial recommendations powered by **Gemini Flash Lite**, surfaced as actionable cards (Urgent / Ready / On Track).

### FHI Engine
A complete Financial Health Index algorithm that:
- Takes 11 financial inputs from the user
- Runs a 6-step ML pipeline entirely in the browser
- Produces a score out of 100, a money personality profile, and 3 ranked action opportunities
- Updates all other screens (Health, Home, Goals, Investments, Pulse AI) with live results

---

## FHI Score Guide

| Score | Meaning |
|---|---|
| 25+ | Financially Strong |
| 12–24 | On the Right Track |
| Below 12 | Building Foundations |

Scores appear lower than traditional indexes because **investments carry 59% of the weight** — consistent with research showing investment habits are the strongest predictor of long-term financial resilience in 18–30 year olds.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| AI Recommendations | Google Gemini Flash Lite (pre-generated) |
| FHI Algorithm | Logistic Regression (L1), K-Means Clustering |
| ML Validation | XGBoost (pre-computed, weights hardcoded) |
| Data | 2,000 synthetic Gen Z profiles (Singapore) |
| Hosting | Vercel (static) |

---

## Project Structure

```
├── index.html                        # Single-page app shell (6 screens)
├── app.js                            # Navigation, user data rendering, Canvas charts
├── pulse-ai.js                       # AI recommendations loader
├── fhi-engine.js                     # FHI algorithm engine (all 6 tasks)
├── styles.css                        # Full design system
├── users.json                        # 2,000 user profiles
├── recommendations.json              # Pre-generated AI recommendations
├── fhi_engine_data.json              # Pre-computed ML weights & cluster centroids
├── genz_fhi_master_dataset.xlsx      # Source dataset (2,000 Gen Z users, 33 columns)
├── genz_fhi_ml_input.xlsx            # ML-ready features + label
└── scripts/
    ├── extract_fhi_weights.py        # Derives weights/centroids from datasets
    ├── generate_recommendations.py   # Batch generates AI recs via Gemini
    └── generate_users_json_for_frontend.py  # Converts Excel → users.json
```

---

## FHI Algorithm Pipeline

### Task 1 — Preprocessing
Validates user inputs (age 18–30), handles missing values via median imputation, removes outliers using IQR × 1.5.

### Task 2 — Feature Standardisation (0–100 scale)
Computes 8 scores from raw inputs:
- Net Worth Ratio, Debt-to-Income, Savings Rate, Investment Ratio, Emergency Fund
- Spending Ratio, Spending Volatility (Z-normalised), Behavioural Discipline (panic sell flag)

### Task 3 — FHI Score
Weighted sum using Logistic Regression (L1) coefficients trained on `negative_event_30d` label.
- **Baseline FHI** — 5 core features
- **Enhanced FHI** — all 8 features including behaviour

### Task 4 — Validation
XGBoost models (pre-computed) comparing raw features vs Baseline FHI vs Enhanced FHI.
- Model A (5 raw features): AUC = 0.671
- Model C (Enhanced FHI): Precision = 42.9%

### Task 5 — K-Means Clustering
Groups user into 1 of 4 money personalities:
- Financially Vulnerable · Developing · Stable · Active Investor

Optimal K=4 selected via silhouette score (0.225).

### Task 6 — Persistence
Results saved to `localStorage` and `window.fhiResults`. Syncs live to all 5 dashboard screens.

---

## Running Locally

```bash
# Clone the repo
git clone https://github.com/om-gorakhia/Banking-AI-advisor.git
cd Banking-AI-advisor

# Start a local server (Python built-in)
python -m http.server 8080

# Open in browser
# http://localhost:8080
```

No npm, no build step, no configuration needed.

---

## Regenerating Data (optional)

To retrain the FHI model weights from the raw datasets:

```bash
cd scripts
pip install pandas scikit-learn xgboost openpyxl
python extract_fhi_weights.py
```

This overwrites `fhi_engine_data.json` with freshly computed weights, centroids and model metrics.

To regenerate AI recommendations (requires Gemini API key):

```bash
# Add your key to scripts/.env
echo "GEMINI_API_KEY=your_key_here" > .env
python generate_users_json_for_frontend.py
python generate_recommendations.py
```

---

## Live Demo

[banking-mu-murex.vercel.app](https://banking-mu-murex.vercel.app)
