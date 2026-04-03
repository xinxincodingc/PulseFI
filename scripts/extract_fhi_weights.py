"""
extract_fhi_weights.py
======================
Reads genz_fhi_master_dataset.xlsx, computes all 8 standardised feature
scores, trains LR-L1 and XGBoost models, runs K-Means clustering, and
writes fhi_engine_data.json ready to be imported by fhi-engine.js.
"""

import json, sys, warnings
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import roc_auc_score, recall_score, precision_score, f1_score
from sklearn.model_selection import train_test_split

warnings.filterwarnings("ignore")

# ── 1. Load master dataset ───────────────────────────────────────────────────
print("Loading master dataset...")
df = pd.read_excel("../genz_fhi_master_dataset.xlsx", sheet_name="master")
print(f"  Rows: {len(df)}, Columns: {list(df.columns)}")

# Keep only Gen-Z age range 18-30
df = df[(df["age"] >= 18) & (df["age"] <= 30)].copy()
print(f"  After age filter (18-30): {len(df)} rows")

# ── 2. Handle missing values (median imputation) ─────────────────────────────
numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
for col in numeric_cols:
    median_val = df[col].median()
    df[col] = df[col].fillna(median_val)

# ── 3. Outlier removal (IQR × 1.5) on key financial columns ─────────────────
financial_cols = [
    "monthly_income", "net_worth", "total_short_term_debt",
    "savings_balance", "monthly_investment_amount", "emergency_fund_months",
    "monthly_spending", "spending_volatility_cv"
]
for col in [c for c in financial_cols if c in df.columns]:
    Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)
    IQR = Q3 - Q1
    df = df[(df[col] >= Q1 - 1.5 * IQR) & (df[col] <= Q3 + 1.5 * IQR)]

print(f"  After outlier removal: {len(df)} rows")

# ── 4. Compute 8 standardised feature scores (0-100) ─────────────────────────
ALPHA = 0.75   # net-worth target multiplier
BETA  = 0.55   # investment target multiplier

annual_income = df["monthly_income"] * 12

# 4a  net_worth_score
df["net_worth_score"] = (df["net_worth"] / (ALPHA * annual_income) * 100).clip(0, 100)

# 4b  dti_score  (monthly_debt / annual_income — matches source formula)
monthly_debt = df["total_short_term_debt"] if "total_short_term_debt" in df.columns else df.get("credit_card_debt", 0) + df.get("bnpl_debt", 0)
df["dti_score"] = (100 - (monthly_debt / annual_income * 100).clip(0, 100))

# 4c  savings_score
monthly_savings = df["monthly_income"] - df["monthly_spending"]
df["savings_score"] = (monthly_savings / (df["monthly_income"]) * 100).clip(0, 100)

# 4d  investment_score
df["investment_score"] = (df["monthly_investment_amount"] / (BETA * annual_income) * 100).clip(0, 100)

# 4e  emergency_score
df["emergency_score"] = (df["emergency_fund_months"] / 6 * 100).clip(0, 100)

# 4f  spending_ratio_score
df["spending_ratio_score"] = (100 - (df["monthly_spending"] / df["monthly_income"] * 100).clip(0, 100))

# 4g  spending_volatility_score  (Z-score → 0-100)
vol_col = "spending_volatility_cv"
vol_mean = df[vol_col].mean()
vol_std  = df[vol_col].std()
z_scores = (df[vol_col] - vol_mean) / (vol_std if vol_std > 0 else 1)
df["spending_volatility_score"] = ((2 - z_scores) / 4 * 100).clip(0, 100)

# Store volatility stats for frontend use
vol_stats = {"mean": float(vol_mean), "std": float(vol_std if vol_std > 0 else 1)}

# 4h  panic_sell_score
df["panic_sell_score"] = df["panic_sell_12m"].apply(lambda x: 0 if x == 0 else 50)

FEATURE_COLS_BASE     = ["net_worth_score", "dti_score", "savings_score", "investment_score", "emergency_score"]
FEATURE_COLS_ENHANCED = FEATURE_COLS_BASE + ["spending_ratio_score", "spending_volatility_score", "panic_sell_score"]

X_base     = df[FEATURE_COLS_BASE].values
X_enhanced = df[FEATURE_COLS_ENHANCED].values
y          = df["neg_event_30d"].values

print(f"  Class balance: {y.mean():.3f} positive rate")

# ── 5. Logistic Regression (L1) — derive weights ─────────────────────────────
def compute_lr_weights(X, y, feature_names):
    lr = LogisticRegression(penalty="l1", solver="liblinear", C=1.0, max_iter=1000, random_state=42)
    lr.fit(X, y)
    coefs = np.abs(lr.coef_[0])
    total = coefs.sum()
    weights = (coefs / total if total > 0 else np.ones(len(coefs)) / len(coefs)).tolist()
    return {name: round(w, 6) for name, w in zip(feature_names, weights)}

print("Training Logistic Regression (baseline)...")
lr_weights_base = compute_lr_weights(X_base, y, FEATURE_COLS_BASE)
print("  Baseline weights:", lr_weights_base)

print("Training Logistic Regression (enhanced)...")
lr_weights_enhanced = compute_lr_weights(X_enhanced, y, FEATURE_COLS_ENHANCED)
print("  Enhanced weights:", lr_weights_enhanced)

# ── 6. XGBoost model metrics ──────────────────────────────────────────────────
try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False
    print("  XGBoost not installed — using sklearn GBM as fallback")

X_train_b, X_test_b, y_train, y_test = train_test_split(X_base, y, test_size=0.2, random_state=42, stratify=y)
X_train_e, X_test_e, _, _            = train_test_split(X_enhanced, y, test_size=0.2, random_state=42, stratify=y)

# Also compute baseline FHI score for Model B
w_b = list(lr_weights_base.values())
fhi_base_all = (X_base * w_b).sum(axis=1)
fhi_enh_all  = (X_enhanced[:, :5] * w_b).sum(axis=1) + sum(
    X_enhanced[:, 5+i] * list(lr_weights_enhanced.values())[5+i]
    for i in range(3)
)

def eval_model(clf, X_tr, X_te, y_tr, y_te):
    clf.fit(X_tr, y_tr)
    y_prob = clf.predict_proba(X_te)[:, 1]
    y_pred = clf.predict(X_te)
    return {
        "auc":       round(float(roc_auc_score(y_te, y_prob)), 4),
        "recall":    round(float(recall_score(y_te, y_pred, zero_division=0)), 4),
        "precision": round(float(precision_score(y_te, y_pred, zero_division=0)), 4),
        "f1":        round(float(f1_score(y_te, y_pred, zero_division=0)), 4),
    }

if HAS_XGB:
    clf_cls = lambda: XGBClassifier(n_estimators=100, max_depth=4, learning_rate=0.1,
                                    eval_metric="logloss", random_state=42, verbosity=0)
else:
    from sklearn.ensemble import GradientBoostingClassifier
    clf_cls = lambda: GradientBoostingClassifier(n_estimators=100, max_depth=4,
                                                  learning_rate=0.1, random_state=42)

print("Training Model A (5 baseline features)...")
metrics_a = eval_model(clf_cls(), X_train_b, X_test_b, y_train, y_test)
print("  Model A:", metrics_a)

# Model B: single FHI baseline score
fhi_idx = np.arange(len(y))
X_train_fhi_b = fhi_base_all[fhi_idx[:int(0.8*len(y))]].reshape(-1, 1)
X_test_fhi_b  = fhi_base_all[fhi_idx[int(0.8*len(y)):]].reshape(-1, 1)
y_tr_s, y_te_s = y[:int(0.8*len(y))], y[int(0.8*len(y)):]
print("Training Model B (Baseline FHI score)...")
metrics_b = eval_model(clf_cls(), X_train_fhi_b, X_test_fhi_b, y_tr_s, y_te_s)
print("  Model B:", metrics_b)

# Model C: single Enhanced FHI score
X_train_fhi_e = fhi_enh_all[fhi_idx[:int(0.8*len(y))]].reshape(-1, 1)
X_test_fhi_e  = fhi_enh_all[fhi_idx[int(0.8*len(y)):]].reshape(-1, 1)
print("Training Model C (Enhanced FHI score)...")
metrics_c = eval_model(clf_cls(), X_train_fhi_e, X_test_fhi_e, y_tr_s, y_te_s)
print("  Model C:", metrics_c)

# ── 7. K-Means clustering ─────────────────────────────────────────────────────
print("Running K-Means (k=4)...")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_enhanced)

kmeans = KMeans(n_clusters=4, random_state=42, n_init=10)
labels = kmeans.fit_predict(X_scaled)

# Characterise clusters by mean FHI-enhanced score
df["cluster"] = labels
df["fhi_enhanced"] = fhi_enh_all

cluster_profiles = {}
cluster_means = df.groupby("cluster")["fhi_enhanced"].mean().sort_values()
rank_to_label = {
    0: {"label": "Financially Vulnerable", "desc": "High debt, low savings and minimal emergency buffer. Immediate action needed on core habits."},
    1: {"label": "Developing",             "desc": "Building financial foundations. Some savings but limited investment and emergency coverage."},
    2: {"label": "Stable",                 "desc": "Solid savings rate and manageable debt. Ready to grow investments systematically."},
    3: {"label": "Thriving",               "desc": "Strong across all pillars — high net worth ratio, low debt, diversified investments."},
}
for rank, (cluster_id, _) in enumerate(cluster_means.items()):
    feature_avgs = {}
    for col in FEATURE_COLS_ENHANCED:
        feature_avgs[col] = round(float(df[df["cluster"] == cluster_id][col].mean()), 2)
    cluster_profiles[str(cluster_id)] = {
        "rank": rank,
        **rank_to_label[rank],
        "feature_means": feature_avgs,
        "avg_fhi": round(float(cluster_means[cluster_id]), 2),
    }

# Store scaler params for frontend (to transform new user's data before assigning cluster)
scaler_params = {
    "mean": scaler.mean_.tolist(),
    "scale": scaler.scale_.tolist(),
    "features": FEATURE_COLS_ENHANCED,
}

# Store centroids (un-scaled, for reference; scaled centroids for assignment)
centroids_scaled = kmeans.cluster_centers_.tolist()

# Elbow + silhouette pre-computed
from sklearn.metrics import silhouette_score
sil_scores = {}
inertias = {}
for k in range(2, 7):
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    lbl = km.fit_predict(X_scaled)
    inertias[k] = round(float(km.inertia_), 2)
    if k > 1:
        sil_scores[k] = round(float(silhouette_score(X_scaled, lbl)), 4)

print("  Silhouette scores:", sil_scores)
print("  Inertias:", inertias)

# ── 8. Assemble and write JSON ────────────────────────────────────────────────
output = {
    "meta": {
        "source": "genz_fhi_master_dataset.xlsx + genz_fhi_ml_input.xlsx",
        "n_users": int(len(df)),
        "alpha": ALPHA,
        "beta": BETA,
    },
    "lr_weights": {
        "baseline": lr_weights_base,
        "enhanced": lr_weights_enhanced,
    },
    "feature_cols": {
        "baseline": FEATURE_COLS_BASE,
        "enhanced": FEATURE_COLS_ENHANCED,
    },
    "vol_stats": vol_stats,
    "xgb_metrics": {
        "model_a": {"name": "5 Raw Features", "features": "baseline features", **metrics_a},
        "model_b": {"name": "Baseline FHI",   "features": "fhi_baseline score", **metrics_b},
        "model_c": {"name": "Enhanced FHI",   "features": "fhi_enhanced score", **metrics_c},
    },
    "kmeans": {
        "n_clusters": 4,
        "scaler": scaler_params,
        "centroids_scaled": centroids_scaled,
        "cluster_profiles": cluster_profiles,
        "elbow_inertias": {str(k): v for k, v in inertias.items()},
        "silhouette_scores": {str(k): v for k, v in sil_scores.items()},
    },
}

out_path = "../fhi_engine_data.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)

print(f"\nWrote {out_path}")
print("Done.")
