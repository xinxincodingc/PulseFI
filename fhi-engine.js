/**
 * fhi-engine.js
 * =============
 * PulseFi — Gen Z Financial Health Index (FHI) Algorithm Engine
 *
 * Pipeline (6 Tasks):
 *   1. Data Preprocessing & Validation
 *   2. Feature Standardisation (0-100 scale)
 *   3. FHI Score Calculation (LR-L1 weights from dataset)
 *   4. ML Validation Display (pre-computed XGBoost metrics)
 *   5. K-Means Cluster Assignment
 *   6. Results Persistence (localStorage + window.fhiResults)
 *
 * Pre-computed constants derived from:
 *   genz_fhi_master_dataset.xlsx  (n=1312 after outlier removal)
 *   genz_fhi_ml_input.xlsx
 *   via scripts/extract_fhi_weights.py
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   PRE-COMPUTED CONSTANTS (from dataset)
   ═══════════════════════════════════════════════════════════ */

const FHI_CONSTANTS = {
  ALPHA: 0.75,   // net-worth target multiplier (midpoint 0.5–1.0)
  BETA:  0.55,   // investment target multiplier (midpoint 0.3–0.8)

  // Spending volatility distribution stats (from dataset CV column)
  VOL_STATS: { mean: 0.19224, std: 0.08191 },

  // LR-L1 normalised absolute weights (sum = 1)
  WEIGHTS_BASELINE: {
    net_worth_score:  0.077495,
    dti_score:        0.015707,
    savings_score:    0.161940,
    investment_score: 0.725909,
    emergency_score:  0.018950,
  },

  WEIGHTS_ENHANCED: {
    net_worth_score:            0.115357,
    dti_score:                  0.010889,
    savings_score:              0.126242,
    investment_score:           0.589110,
    emergency_score:            0.015080,
    spending_ratio_score:       0.060669,
    spending_volatility_score:  0.050576,
    panic_sell_score:           0.032078,
  },

  // StandardScaler params for K-Means cluster assignment
  // Order: [net_worth, dti, savings, investment, emergency,
  //         spending_ratio, spending_volatility, panic_sell]
  SCALER: {
    mean:  [12.004, 97.048, 12.617, 0.806, 23.436, 12.617, 50.120, 6.364],
    scale: [13.708,  4.361,  7.149, 1.355, 19.233,  7.149, 24.718, 16.665],
  },

  // K-Means centroids (scaled space, k=4)
  CENTROIDS: [
    [-0.447, -0.076, -0.610, -0.232, -0.450, -0.610,  0.070, -0.382], // cluster 0
    [-0.333,  0.052,  1.233, -0.205, -0.191,  1.233,  0.044, -0.325], // cluster 1
    [ 1.442,  0.144, -0.125,  0.020,  1.314, -0.125, -0.314, -0.371], // cluster 2
    [-0.183, -0.078, -0.076,  1.192, -0.238, -0.076,  0.192,  2.618], // cluster 3
  ],

  // Cluster profiles (keyed by centroid index)
  CLUSTER_PROFILES: {
    0: {
      label: 'Financially Vulnerable',
      icon:  '🔴',
      color: '#E74C3C',
      desc:  'High debt load, low savings and minimal emergency buffer. Focus on building a cash safety net and reducing short-term debt before investing.',
      traits: ['Low net worth', 'Minimal savings', 'No emergency buffer'],
    },
    1: {
      label: 'Developing',
      icon:  '🟡',
      color: '#E8A838',
      desc:  'Building financial foundations with improving savings habits. Limited investment and emergency fund coverage — the next step is to automate savings.',
      traits: ['Improving savings rate', 'Low investment', 'Growing stability'],
    },
    2: {
      label: 'Stable',
      icon:  '🟢',
      color: '#00B894',
      desc:  'Strong net worth and solid emergency fund coverage. Ready to shift focus toward systematic investment growth to maximise long-term returns.',
      traits: ['High net worth ratio', 'Good emergency fund', 'Investment opportunity ahead'],
    },
    3: {
      label: 'Active Investor',
      icon:  '🔵',
      color: '#4A90D9',
      desc:  'High investment activity drives your FHI, but behavioural risk from panic selling may erode gains. Automate contributions and stay the course during dips.',
      traits: ['High investment score', 'Behavioural risk flag', 'Strong market participation'],
    },
  },

  // Pre-computed XGBoost model metrics (AUC, Recall, Precision, F1)
  XGB_METRICS: {
    model_a: { name: '5 Raw Features',    auc: 0.6709, recall: 0.0408, precision: 0.1818, f1: 0.0667 },
    model_b: { name: 'Baseline FHI',      auc: 0.5239, recall: 0.0196, precision: 0.1000, f1: 0.0328 },
    model_c: { name: 'Enhanced FHI',      auc: 0.5496, recall: 0.0588, precision: 0.4286, f1: 0.1034 },
  },

  // Elbow & silhouette (optimal k=4)
  ELBOW:      { 2: 8732, 3: 7362, 4: 6220, 5: 5643, 6: 5163 },
  SILHOUETTE: { 2: 0.180, 3: 0.213, 4: 0.225, 5: 0.215, 6: 0.227 },

  // Score thresholds calibrated to actual dataset distribution (most Gen Z score 7–35)
  THRESHOLDS: { good: 25, fair: 12 },
};

/* ═══════════════════════════════════════════════════════════
   STATISTICS HELPERS (for ROC curve drawing)
   ═══════════════════════════════════════════════════════════ */

// Approximation of the normal CDF (Abramowitz & Stegun 26.2.17)
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-(x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}

// Rational approximation of the probit (inverse normal CDF)
function normPPF(p) {
  if (p <= 0) return -8;
  if (p >= 1) return  8;
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  function core(t) {
    return (c[0] + c[1] * t + c[2] * t * t) /
           (1 + d[0] * t + d[1] * t * t + d[2] * t * t * t);
  }
  if (p < 0.5) {
    const t = Math.sqrt(-2 * Math.log(p));
    return -(t - core(t));
  }
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - core(t);
}

// Binormal ROC curve points for a given AUC value
function rocPoints(auc, n = 80) {
  const d = Math.sqrt(2) * normPPF(auc);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const fpr = i / n;
    const tpr = fpr === 0 ? 0 : (fpr === 1 ? 1 : normCDF(d + normPPF(fpr)));
    pts.push([fpr, tpr]);
  }
  return pts;
}

/* ═══════════════════════════════════════════════════════════
   TASK 1 — DATA PREPROCESSING & VALIDATION
   ═══════════════════════════════════════════════════════════ */

function preprocessInput(raw) {
  const errors = [];

  const age            = parseFloat(raw.age);
  const annual_income  = parseFloat(raw.annual_income);
  const net_worth      = parseFloat(raw.net_worth);
  const monthly_debt   = parseFloat(raw.monthly_debt);
  const monthly_savings= parseFloat(raw.monthly_savings);
  const emergency_fund = parseFloat(raw.emergency_fund_months);
  const monthly_spending = parseFloat(raw.monthly_spending);
  const spending_vol   = parseFloat(raw.spending_volatility);
  const panic_sell     = parseInt(raw.panic_sell_12m, 10);
  const total_invest   = parseFloat(raw.total_investment);
  const invest_return  = parseFloat(raw.investment_return);

  // Age range validation
  if (isNaN(age) || age < 18 || age > 30) {
    errors.push('Age must be between 18 and 30 (Gen Z FHI model scope).');
  }
  if (isNaN(annual_income) || annual_income <= 0)   errors.push('Annual income must be a positive number.');
  if (isNaN(net_worth))                             errors.push('Net worth is required (can be negative).');
  if (isNaN(monthly_debt) || monthly_debt < 0)      errors.push('Monthly debt must be 0 or positive.');
  if (isNaN(monthly_savings) || monthly_savings < 0) errors.push('Monthly savings must be 0 or positive.');
  if (isNaN(emergency_fund) || emergency_fund < 0)  errors.push('Emergency fund months must be 0 or positive.');
  if (isNaN(monthly_spending) || monthly_spending <= 0) errors.push('Monthly spending must be a positive number.');
  if (isNaN(spending_vol) || spending_vol < 0)      errors.push('Spending volatility must be 0 or positive.');
  if (![0, 1].includes(panic_sell))                 errors.push('Panic sell must be 0 (No) or 1 (Yes).');
  if (isNaN(total_invest) || total_invest < 0)      errors.push('Total investment must be 0 or positive.');
  if (isNaN(invest_return))                         errors.push('Investment return is required (can be negative).');

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    data: {
      age, annual_income, net_worth, monthly_debt, monthly_savings,
      emergency_fund_months: emergency_fund, monthly_spending,
      spending_volatility: spending_vol, panic_sell_12m: panic_sell,
      total_investment: total_invest, investment_return: invest_return,
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   TASK 2 — FEATURE STANDARDISATION (0–100 scale)
   ═══════════════════════════════════════════════════════════ */

function computeFeatureScores(d) {
  const { ALPHA, BETA, VOL_STATS } = FHI_CONSTANTS;
  const monthly_income = d.annual_income / 12;

  const net_worth_score = Math.min(Math.max(d.net_worth / (ALPHA * d.annual_income) * 100, 0), 100);

  // monthly_debt / annual_income (matching source formula — not annualised)
  const dti_score = 100 - Math.min(d.monthly_debt / d.annual_income * 100, 100);

  const savings_score = Math.min(d.monthly_savings / monthly_income * 100, 100);

  const investment_score = Math.min(Math.max(d.total_investment / (BETA * d.annual_income) * 100, 0), 100);

  const emergency_score = Math.min(d.emergency_fund_months / 6 * 100, 100);

  const spending_ratio_score = 100 - Math.min(d.monthly_spending / monthly_income * 100, 100);

  // Z-score spending volatility, then map to 0-100
  const z = (d.spending_volatility - VOL_STATS.mean) / VOL_STATS.std;
  const spending_volatility_score = Math.min(Math.max((2 - z) / 4 * 100, 0), 100);

  const panic_sell_score = d.panic_sell_12m === 0 ? 0 : 50;

  return {
    net_worth_score:            parseFloat(net_worth_score.toFixed(2)),
    dti_score:                  parseFloat(dti_score.toFixed(2)),
    savings_score:              parseFloat(savings_score.toFixed(2)),
    investment_score:           parseFloat(investment_score.toFixed(2)),
    emergency_score:            parseFloat(emergency_score.toFixed(2)),
    spending_ratio_score:       parseFloat(spending_ratio_score.toFixed(2)),
    spending_volatility_score:  parseFloat(spending_volatility_score.toFixed(2)),
    panic_sell_score:           parseFloat(panic_sell_score.toFixed(2)),
  };
}

/* ═══════════════════════════════════════════════════════════
   TASK 3 — FHI SCORE CALCULATION
   ═══════════════════════════════════════════════════════════ */

function computeFHI(scores) {
  const wb = FHI_CONSTANTS.WEIGHTS_BASELINE;
  const we = FHI_CONSTANTS.WEIGHTS_ENHANCED;

  const baseline = (
    wb.net_worth_score  * scores.net_worth_score  +
    wb.dti_score        * scores.dti_score        +
    wb.savings_score    * scores.savings_score    +
    wb.investment_score * scores.investment_score +
    wb.emergency_score  * scores.emergency_score
  );

  const enhanced = (
    we.net_worth_score           * scores.net_worth_score           +
    we.dti_score                 * scores.dti_score                 +
    we.savings_score             * scores.savings_score             +
    we.investment_score          * scores.investment_score          +
    we.emergency_score           * scores.emergency_score           +
    we.spending_ratio_score      * scores.spending_ratio_score      +
    we.spending_volatility_score * scores.spending_volatility_score +
    we.panic_sell_score          * scores.panic_sell_score
  );

  return {
    baseline: parseFloat(baseline.toFixed(2)),
    enhanced: parseFloat(enhanced.toFixed(2)),
  };
}

function scoreLabel(score) {
  if (score >= FHI_CONSTANTS.THRESHOLDS.good) return 'Financially Strong';
  if (score >= FHI_CONSTANTS.THRESHOLDS.fair) return 'On the Right Track';
  return 'Building Foundations';
}

function scoreColor(score) {
  if (score >= FHI_CONSTANTS.THRESHOLDS.good) return '#2ECC71';
  if (score >= FHI_CONSTANTS.THRESHOLDS.fair) return '#E8A838';
  return '#E74C3C';
}

function scorePlainLabel(score) {
  if (score >= 70) return 'Great';
  if (score >= 45) return 'Good';
  if (score >= 20) return 'Room to grow';
  return 'Priority area';
}

/* ═══════════════════════════════════════════════════════════
   TASK 5 — K-MEANS CLUSTER ASSIGNMENT
   ═══════════════════════════════════════════════════════════ */

function assignCluster(scores) {
  const { SCALER, CENTROIDS } = FHI_CONSTANTS;
  const featureVec = [
    scores.net_worth_score, scores.dti_score, scores.savings_score,
    scores.investment_score, scores.emergency_score, scores.spending_ratio_score,
    scores.spending_volatility_score, scores.panic_sell_score,
  ];

  // Scale using dataset scaler params
  const scaled = featureVec.map((v, i) => (v - SCALER.mean[i]) / SCALER.scale[i]);

  // Euclidean distance to each centroid → pick nearest
  let bestCluster = 0;
  let bestDist = Infinity;
  CENTROIDS.forEach((centroid, idx) => {
    const dist = Math.sqrt(centroid.reduce((sum, c, i) => sum + (scaled[i] - c) ** 2, 0));
    if (dist < bestDist) { bestDist = dist; bestCluster = idx; }
  });

  return {
    cluster_id: bestCluster,
    profile:    FHI_CONSTANTS.CLUSTER_PROFILES[bestCluster],
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPUTE PIPELINE
   ═══════════════════════════════════════════════════════════ */

function runFHIPipeline(rawInput) {
  // Task 1: Validate & preprocess
  const preprocessed = preprocessInput(rawInput);
  if (!preprocessed.valid) return { success: false, errors: preprocessed.errors };

  const data = preprocessed.data;

  // Task 2: Feature scores
  const scores = computeFeatureScores(data);

  // Task 3: FHI scores
  const fhi = computeFHI(scores);

  // Task 4: ML metrics (pre-computed, just surface them)
  const mlMetrics = FHI_CONSTANTS.XGB_METRICS;

  // Task 5: Cluster assignment
  const clusterResult = assignCluster(scores);

  const results = {
    input:      data,
    scores,
    fhi,
    fhi_label:  scoreLabel(fhi.enhanced),
    fhi_color:  scoreColor(fhi.enhanced),
    cluster:    clusterResult,
    ml_metrics: mlMetrics,
    timestamp:  new Date().toISOString(),
  };

  // Task 6: Persist results
  try {
    localStorage.setItem('fhi_results', JSON.stringify(results));
  } catch (_) {}
  window.fhiResults = results;

  return { success: true, results };
}

/* ═══════════════════════════════════════════════════════════
   CANVAS CHARTS
   ═══════════════════════════════════════════════════════════ */

function drawROCChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  const W = 340, H = 280;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const PAD = { top: 20, right: 20, bottom: 46, left: 50 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top  - PAD.bottom;

  // Background
  ctx.fillStyle = '#F8FAFC';
  ctx.roundRect(0, 0, W, H, 12);
  ctx.fill();

  // Grid lines
  ctx.strokeStyle = '#E8ECF0';
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(v => {
    const x = PAD.left + v * CW;
    const y = PAD.top  + (1 - v) * CH;
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + CH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + CW, y); ctx.stroke();
  });

  // Diagonal reference
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#CBD5E0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top + CH);
  ctx.lineTo(PAD.left + CW, PAD.top);
  ctx.stroke();
  ctx.setLineDash([]);

  // Models
  const models = [
    { key: 'model_a', color: '#4A90D9', label: 'Model A – 5 Raw Features' },
    { key: 'model_b', color: '#E8A838', label: 'Model B – Baseline FHI' },
    { key: 'model_c', color: '#00B894', label: 'Model C – Enhanced FHI' },
  ];

  models.forEach(({ key, color }) => {
    const auc = FHI_CONSTANTS.XGB_METRICS[key].auc;
    const pts = rocPoints(auc);
    ctx.beginPath();
    pts.forEach(([fpr, tpr], i) => {
      const px = PAD.left + fpr * CW;
      const py = PAD.top  + (1 - tpr) * CH;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // Axes labels
  ctx.fillStyle = '#7B8794';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('False Positive Rate', PAD.left + CW / 2, H - 6);
  ctx.save();
  ctx.translate(14, PAD.top + CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('True Positive Rate', 0, 0);
  ctx.restore();

  // Tick labels
  [0, 0.5, 1].forEach(v => {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#A0AEC0';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(v.toFixed(1), PAD.left + v * CW, PAD.top + CH + 14);
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(1), PAD.left - 6, PAD.top + (1 - v) * CH + 4);
  });

  // Legend
  const legendY = PAD.top + CH + 28;
  models.forEach(({ color, label, key }, i) => {
    const auc = FHI_CONSTANTS.XGB_METRICS[key].auc;
    const lx  = PAD.left + i * (CW / 3);
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY, 16, 3);
    ctx.fillStyle = '#7B8794';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label.split('–')[0].trim()} (${auc})`, lx + 20, legendY + 4);
  });
}

/* ═══════════════════════════════════════════════════════════
   FEATURE LABEL DISPLAY NAMES
   ═══════════════════════════════════════════════════════════ */

const FEATURE_LABELS = {
  net_worth_score:           { label: 'Net Worth Ratio',       icon: '🏦' },
  dti_score:                 { label: 'Debt-to-Income',        icon: '💳' },
  savings_score:             { label: 'Savings Rate',          icon: '💰' },
  investment_score:          { label: 'Investment Ratio',      icon: '📈' },
  emergency_score:           { label: 'Emergency Fund',        icon: '🛡' },
  spending_ratio_score:      { label: 'Spending Ratio',        icon: '🛒' },
  spending_volatility_score: { label: 'Spend Consistency',     icon: '📊' },
  panic_sell_score:          { label: 'Behavioural Discipline',icon: '🧠' },
};

/* ═══════════════════════════════════════════════════════════
   EXPORT CSV
   ═══════════════════════════════════════════════════════════ */

function exportResultsCSV(results) {
  const { input: d, scores: s, fhi, cluster } = results;
  const rows = [
    ['Field', 'Value'],
    ['--- Inputs ---', ''],
    ['Age', d.age],
    ['Annual Income (S$)', d.annual_income],
    ['Net Worth (S$)', d.net_worth],
    ['Monthly Debt (£)', d.monthly_debt],
    ['Monthly Savings (S$)', d.monthly_savings],
    ['Emergency Fund (months)', d.emergency_fund_months],
    ['Monthly Spending (S$)', d.monthly_spending],
    ['Spending Volatility (CV)', d.spending_volatility],
    ['Panic Sold in 12m', d.panic_sell_12m ? 'Yes' : 'No'],
    ['Total Investment (S$)', d.total_investment],
    ['Investment Return (%)', d.investment_return],
    ['--- Feature Scores (0-100) ---', ''],
    ['Net Worth Score', s.net_worth_score],
    ['DTI Score', s.dti_score],
    ['Savings Score', s.savings_score],
    ['Investment Score', s.investment_score],
    ['Emergency Score', s.emergency_score],
    ['Spending Ratio Score', s.spending_ratio_score],
    ['Spending Volatility Score', s.spending_volatility_score],
    ['Panic Sell Score', s.panic_sell_score],
    ['--- FHI Scores ---', ''],
    ['Baseline FHI', fhi.baseline],
    ['Enhanced FHI', fhi.enhanced],
    ['FHI Label', results.fhi_label],
    ['--- Cluster ---', ''],
    ['Cluster ID', cluster.cluster_id],
    ['Profile Label', cluster.profile.label],
    ['Generated At', results.timestamp],
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'fhi_results.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
   UI — FORM RENDERING
   ═══════════════════════════════════════════════════════════ */

function buildFormHTML() {
  return `
<div class="fhi-intro-card card">
  <div class="fhi-intro-icon">⚡</div>
  <div>
    <h2 class="fhi-intro-title">FHI Engine — Financial Health Index</h2>
    <p class="fhi-intro-sub">Enter your financial data to compute your personalised FHI score, cluster profile and ML-validated health index. All calculations run locally in your browser.</p>
  </div>
</div>

<div class="card fhi-form-card" style="margin-top:20px;">
  <div class="card__header">
    <span class="card__title">Your Financial Data</span>
    <span class="fhi-step-badge">Step 1 of 1</span>
  </div>

  <form id="fhi-form" autocomplete="off" novalidate>

    <div class="fhi-field-group">
      <div class="fhi-field-group__title">Profile</div>
      <div class="fhi-grid-2">
        <div class="fhi-field">
          <label class="fhi-label" for="f-age">Age <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Must be 18–30 (Gen Z model scope)</p>
          <input class="fhi-input" id="f-age" name="age" type="number" min="18" max="30" step="1" placeholder="e.g. 24" required>
        </div>
        <div class="fhi-field">
          <label class="fhi-label" for="f-income">Annual Income (S$) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Gross yearly salary / income</p>
          <input class="fhi-input" id="f-income" name="annual_income" type="number" min="1" step="100" placeholder="e.g. 28000" required>
        </div>
      </div>
    </div>

    <div class="fhi-field-group">
      <div class="fhi-field-group__title">Net Worth &amp; Debt</div>
      <div class="fhi-grid-2">
        <div class="fhi-field">
          <label class="fhi-label" for="f-networth">Net Worth (S$) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Total assets minus all liabilities (can be negative)</p>
          <input class="fhi-input" id="f-networth" name="net_worth" type="number" step="100" placeholder="e.g. 5000" required>
        </div>
        <div class="fhi-field">
          <label class="fhi-label" for="f-debt">Monthly Debt Payments (S$) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Credit cards, BNPL, student loans paid monthly</p>
          <input class="fhi-input" id="f-debt" name="monthly_debt" type="number" min="0" step="10" placeholder="e.g. 200" required>
        </div>
      </div>
    </div>

    <div class="fhi-field-group">
      <div class="fhi-field-group__title">Monthly Cash Flow</div>
      <div class="fhi-grid-2">
        <div class="fhi-field">
          <label class="fhi-label" for="f-savings">Monthly Savings (S$) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Amount you save / put away each month</p>
          <input class="fhi-input" id="f-savings" name="monthly_savings" type="number" min="0" step="10" placeholder="e.g. 400" required>
        </div>
        <div class="fhi-field">
          <label class="fhi-label" for="f-spending">Monthly Spending (S$) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Total monthly outgoings (rent, food, subscriptions, etc.)</p>
          <input class="fhi-input" id="f-spending" name="monthly_spending" type="number" min="1" step="10" placeholder="e.g. 1600" required>
        </div>
      </div>
    </div>

    <div class="fhi-field-group">
      <div class="fhi-field-group__title">Emergency Fund &amp; Investments</div>
      <div class="fhi-grid-3">
        <div class="fhi-field">
          <label class="fhi-label" for="f-emergency">Emergency Fund (months) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">How many months of expenses you could cover</p>
          <input class="fhi-input" id="f-emergency" name="emergency_fund_months" type="number" min="0" step="0.1" placeholder="e.g. 2.5" required>
        </div>
        <div class="fhi-field">
          <label class="fhi-label" for="f-invest">Total Investments (£) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">ISA, stocks, crypto, pension (excl. property)</p>
          <input class="fhi-input" id="f-invest" name="total_investment" type="number" min="0" step="100" placeholder="e.g. 3000" required>
        </div>
        <div class="fhi-field">
          <label class="fhi-label" for="f-return">Investment Return (% p.a.)</label>
          <p class="fhi-hint">Approximate annual return on investments</p>
          <input class="fhi-input" id="f-return" name="investment_return" type="number" step="0.1" placeholder="e.g. 7.5" required>
        </div>
      </div>
    </div>

    <div class="fhi-field-group">
      <div class="fhi-field-group__title">Behavioural Signals</div>
      <div class="fhi-grid-2">
        <div class="fhi-field">
          <label class="fhi-label" for="f-vol">Spending Volatility (CV) <span class="fhi-required">*</span></label>
          <p class="fhi-hint">Coefficient of variation of monthly spend (0 = perfectly stable, 0.3 = moderate, 0.5+ = erratic). Use 0.19 if unsure.</p>
          <input class="fhi-input" id="f-vol" name="spending_volatility" type="number" min="0" step="0.01" placeholder="e.g. 0.19" required>
        </div>
        <div class="fhi-field fhi-field--center">
          <label class="fhi-label">Panic Sold Investments in Last 12 Months?</label>
          <p class="fhi-hint">Did you sell holdings during a market dip out of fear?</p>
          <div class="fhi-toggle-group">
            <label class="fhi-toggle-opt">
              <input type="radio" name="panic_sell_12m" value="0" checked>
              <span>No</span>
            </label>
            <label class="fhi-toggle-opt">
              <input type="radio" name="panic_sell_12m" value="1">
              <span>Yes</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div id="fhi-form-errors" class="fhi-errors" style="display:none"></div>

    <button class="fhi-submit-btn" type="submit">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      Calculate My FHI Score
    </button>
  </form>
</div>`;
}

/* ═══════════════════════════════════════════════════════════
   OPPORTUNITY GENERATOR — plain-English personalised advice
   ═══════════════════════════════════════════════════════════ */

function generateOpportunities(scores, input) {
  const mi = input.annual_income / 12;
  const { ALPHA, BETA, WEIGHTS_ENHANCED: W } = FHI_CONSTANTS;
  const fmt = n => Math.round(n).toLocaleString('en-SG');

  const advisors = {
    investment_score: {
      icon: '📈', color: '#4A90D9', title: 'Grow your investments',
      getDesc() {
        const targetAmt = Math.round(input.annual_income * BETA * 0.5);
        const gap = Math.max(targetAmt - input.total_investment, 0);
        const monthly = Math.round(gap / 12);
        return gap > 0
          ? `You have S$${fmt(input.total_investment)} invested. Adding S$${fmt(monthly)}/month for a year would bring your portfolio to S$${fmt(input.total_investment + gap)} — and give your score its biggest single boost.`
          : `Your investment level is solid. Keep making regular contributions to compound further.`;
      },
    },
    savings_score: {
      icon: '💰', color: '#00B894', title: 'Save more each month',
      getDesc() {
        const rate = (input.monthly_savings / mi * 100).toFixed(0);
        const target = Math.round(mi * 0.25);
        const gap = Math.max(target - input.monthly_savings, 0);
        return gap > 0
          ? `You're saving ${rate}% of income (S$${fmt(input.monthly_savings)}/month). Saving S$${fmt(gap)} more per month hits the 25% benchmark — even automating S$${fmt(Math.round(gap/4))} extra is a meaningful start.`
          : `You're already hitting the 25% savings target. Excellent discipline.`;
      },
    },
    emergency_score: {
      icon: '🛡', color: '#E8A838', title: 'Build your emergency buffer',
      getDesc() {
        const gap = Math.max(6 - input.emergency_fund_months, 0);
        const gapAmt = Math.round(gap * input.monthly_spending);
        const monthly = Math.round(gapAmt / 12);
        return gap > 0
          ? `You have ${input.emergency_fund_months} months of cover. You need S$${fmt(gapAmt)} more to reach the 6-month target. Setting aside S$${fmt(monthly)}/month for a year gets you there.`
          : `You have a full 6-month emergency buffer — one of the strongest financial safety nets you can have.`;
      },
    },
    spending_ratio_score: {
      icon: '🛒', color: '#6C5CE7', title: 'Reduce monthly spending',
      getDesc() {
        const ratio = (input.monthly_spending / mi * 100).toFixed(0);
        const target = Math.round(mi * 0.7);
        const saving = Math.max(input.monthly_spending - target, 0);
        return saving > 0
          ? `You're spending ${ratio}% of monthly income (S$${fmt(input.monthly_spending)}). Cutting S$${fmt(saving)}/month — roughly the cost of a few subscriptions or meals out — would free that cash for savings.`
          : `Your spending-to-income ratio is healthy. Keep tracking it monthly to stay on track.`;
      },
    },
    net_worth_score: {
      icon: '🏦', color: '#0D2137', title: 'Grow your net worth',
      getDesc() {
        const target = Math.round(input.annual_income * ALPHA);
        const gap = Math.max(target - input.net_worth, 0);
        return gap > 0
          ? `Your net worth is S$${fmt(input.net_worth)}. The benchmark for your income is S$${fmt(target)}. Every S$1 saved or invested closes this gap — savings and investments do double duty here.`
          : `Your net worth is above the benchmark for your income level. You're building real wealth.`;
      },
    },
    dti_score: {
      icon: '💳', color: '#E74C3C', title: 'Pay down your debts',
      getDesc() {
        const ratio = (input.monthly_debt / input.annual_income * 100).toFixed(1);
        return input.monthly_debt > 0
          ? `Your monthly debt payments are ${ratio}% of your annual income. Clearing high-interest credit cards or BNPL balances first frees cash every month and reduces financial stress.`
          : `No monthly debt payments — a clean slate that gives you full flexibility with your income.`;
      },
    },
    spending_volatility_score: {
      icon: '📊', color: '#00B894', title: 'Stabilise your spending',
      getDesc() {
        return `Your spending varies noticeably from month to month. Setting a simple monthly budget and reviewing it once a week smooths this out — consistency is what compounds into good financial habits.`;
      },
    },
    panic_sell_score: {
      icon: '🧠', color: '#6C5CE7', title: 'Stay calm during market dips',
      getDesc() {
        return input.panic_sell_12m === 1
          ? `You sold investments during a market drop last year. This locks in losses and breaks compounding. Automating contributions and avoiding your portfolio during volatility are the two highest-return behavioural changes you can make.`
          : `You didn't panic sell — this is one of the most valuable investing habits you can build. Most people can't hold through drops. Keep it up.`;
      },
    },
  };

  return Object.entries(scores)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([key, score]) => {
      const a = advisors[key];
      const potentialDelta = ((100 - score) * W[key]).toFixed(1);
      return { key, score, icon: a.icon, color: a.color, title: a.title, desc: a.getDesc(), potentialDelta };
    });
}

/* ═══════════════════════════════════════════════════════════
   UI — RESULTS RENDERING
   ═══════════════════════════════════════════════════════════ */

function buildResultsHTML(results) {
  const { scores, fhi, fhi_label, fhi_color, cluster, input } = results;
  const cp = cluster.profile;

  // Feature bars HTML
  const featureBarsHTML = Object.entries(FEATURE_LABELS).map(([key, { label, icon }]) => {
    const score = scores[key];
    const color = scoreColor(score);
    const w     = Math.min(Math.max(score, 0), 100);
    const plain = scorePlainLabel(score);
    return `
      <div class="fhi-feat-row">
        <div class="fhi-feat-left">
          <span class="fhi-feat-icon">${icon}</span>
          <div>
            <div class="fhi-feat-label">${label}</div>
            <div class="fhi-feat-weight" style="color:${color}">${plain}</div>
          </div>
        </div>
        <div class="fhi-feat-bar-wrap">
          <div class="fhi-feat-bar" style="width:${w}%;background:${color}"></div>
        </div>
        <div class="fhi-feat-score" style="color:${color}">${score.toFixed(0)}</div>
      </div>`;
  }).join('');

  // Gauge arc helper
  const baselineArc = 235.5 * (1 - fhi.baseline / 100);
  const enhancedArc = 235.5 * (1 - fhi.enhanced / 100);

  // Trait tags
  const traits = cp.traits.map(t => `<span class="fhi-trait-tag">${t}</span>`).join('');

  // Score context sentence
  const contextSentence = fhi.enhanced >= FHI_CONSTANTS.THRESHOLDS.good
    ? 'You\'re in the top financial health range for your age group. Keep the habits going.'
    : fhi.enhanced >= FHI_CONSTANTS.THRESHOLDS.fair
    ? 'You\'re making real progress. A few focused changes below can move you to the next level.'
    : 'Everyone starts somewhere. The opportunities below are the fastest ways to improve.';

  // Opportunities
  const opps = generateOpportunities(scores, input);
  const oppsHTML = opps.map((o, i) => `
    <div class="fhi-opp-card" style="border-left:4px solid ${o.color}">
      <div class="fhi-opp-header">
        <div class="fhi-opp-rank">#${i + 1}</div>
        <div class="fhi-opp-icon">${o.icon}</div>
        <div class="fhi-opp-title">${o.title}</div>
        <div class="fhi-opp-impact" style="color:${o.color}">Score: ${o.score.toFixed(0)}/100</div>
      </div>
      <p class="fhi-opp-desc">${o.desc}</p>
    </div>`).join('');

  // Top 3 weight drivers (hardcoded — these don't change per user)
  const driversHTML = [
    { icon: '📈', label: 'How much you invest', pct: '59%', desc: 'Your biggest lever. Investing even a small amount consistently compounds significantly over time.' },
    { icon: '💰', label: 'How much you save', pct: '13%', desc: 'Consistent saving habits matter more than the exact amount. Automate it and it happens invisibly.' },
    { icon: '🏦', label: 'Your net worth', pct: '12%', desc: 'The gap between what you own and what you owe. Every asset you build or debt you clear improves this.' },
  ].map(d => `
    <div class="fhi-driver-item">
      <div class="fhi-driver-pct">${d.pct}</div>
      <div class="fhi-driver-icon">${d.icon}</div>
      <div>
        <div class="fhi-driver-label">${d.label}</div>
        <div class="fhi-driver-desc">${d.desc}</div>
      </div>
    </div>`).join('');

  return `
<div class="fhi-results-header">
  <button class="fhi-back-btn" id="fhi-recalculate">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
    Recalculate
  </button>
  <div class="fhi-results-title">Your FHI Results</div>
  <button class="fhi-export-btn" id="fhi-export">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Save Results
  </button>
</div>

<!-- FHI Score Gauges -->
<div class="fhi-scores-row">
  <div class="card fhi-score-card">
    <div class="fhi-score-card__label">Money Score</div>
    <div class="fhi-score-card__sub">Based on your core finances</div>
    <div class="fhi-gauge-wrap">
      <svg viewBox="0 0 200 120" class="fhi-gauge-svg">
        <path d="M25,100 A75,75 0 0,1 175,100" fill="none" stroke="#E8ECF0" stroke-width="14" stroke-linecap="round"/>
        <path d="M25,100 A75,75 0 0,1 175,100" fill="none" stroke="${scoreColor(fhi.baseline)}" stroke-width="14"
              stroke-linecap="round" stroke-dasharray="235.5" stroke-dashoffset="${baselineArc.toFixed(1)}"/>
      </svg>
      <div class="fhi-gauge-num" style="color:${scoreColor(fhi.baseline)}">${fhi.baseline.toFixed(1)}</div>
      <div class="fhi-gauge-denom">/ 100</div>
    </div>
    <div class="fhi-score-label" style="color:${scoreColor(fhi.baseline)}">${scoreLabel(fhi.baseline)}</div>
  </div>

  <div class="card fhi-score-card fhi-score-card--enhanced">
    <div class="fhi-enhanced-badge">Full Picture</div>
    <div class="fhi-score-card__label">Financial Health Score</div>
    <div class="fhi-score-card__sub">Includes spending habits & behaviour</div>
    <div class="fhi-gauge-wrap">
      <svg viewBox="0 0 200 120" class="fhi-gauge-svg">
        <path d="M25,100 A75,75 0 0,1 175,100" fill="none" stroke="#E8ECF0" stroke-width="14" stroke-linecap="round"/>
        <path d="M25,100 A75,75 0 0,1 175,100" fill="none" stroke="${fhi_color}" stroke-width="14"
              stroke-linecap="round" stroke-dasharray="235.5" stroke-dashoffset="${enhancedArc.toFixed(1)}"/>
      </svg>
      <div class="fhi-gauge-num" style="color:${fhi_color}">${fhi.enhanced.toFixed(1)}</div>
      <div class="fhi-gauge-denom">/ 100</div>
    </div>
    <div class="fhi-score-label" style="color:${fhi_color}">${fhi_label}</div>
  </div>
</div>

<!-- Context sentence -->
<div class="fhi-context-row">
  <span class="fhi-context-icon">💡</span>
  <span>${contextSentence}</span>
</div>

<!-- Score Breakdown -->
<div class="card" style="margin-top:16px;">
  <div class="card__header">
    <span class="card__title">How each area scored</span>
    <span style="font-size:12px;color:var(--color-text-secondary)">Higher is better · out of 100</span>
  </div>
  <div class="fhi-feature-list">
    ${featureBarsHTML}
  </div>
</div>

<!-- Money Profile (Cluster) -->
<div class="card fhi-cluster-card" style="margin-top:16px;border-left:4px solid ${cp.color}">
  <div class="fhi-cluster-header">
    <div>
      <div class="fhi-cluster-icon">${cp.icon}</div>
      <div class="fhi-cluster-meta">
        <div class="fhi-cluster-badge" style="background:${cp.color}20;color:${cp.color}">${cp.label}</div>
        <div class="fhi-cluster-title">Your Money Personality</div>
      </div>
    </div>
  </div>
  <p class="fhi-cluster-desc">${cp.desc}</p>
  <div class="fhi-traits">${traits}</div>
  <div class="fhi-cluster-note">Compared against 1,312 real people aged 18–30 with similar financial profiles.</div>
</div>

<!-- Your 3 Biggest Opportunities -->
<div class="card" style="margin-top:16px;">
  <div class="card__header">
    <span class="card__title">Your 3 biggest opportunities right now</span>
    <span style="font-size:12px;color:var(--color-text-secondary)">Ranked by what'll move your score most</span>
  </div>
  <div class="fhi-opps-list">${oppsHTML}</div>
</div>

<!-- What drives your score -->
<div class="card" style="margin-top:16px;">
  <div class="card__header">
    <span class="card__title">What actually drives your score</span>
    <span style="font-size:12px;color:var(--color-text-secondary)">Learnt from 1,312 real financial journeys</span>
  </div>
  <div class="fhi-drivers-list">${driversHTML}</div>
  <div class="fhi-trust-strip">
    <span>👥 1,312 real profiles</span>
    <span>🔬 8 financial signals</span>
    <span>🤖 Machine learning patterns</span>
    <span>⚡ Runs privately on your device</span>
  </div>
</div>
`;
}

/* ═══════════════════════════════════════════════════════════
   FORM SUBMIT HANDLER
   ═══════════════════════════════════════════════════════════ */

function handleFormSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('fhi-form');
  const fd   = new FormData(form);
  const raw  = Object.fromEntries(fd.entries());

  const errBox = document.getElementById('fhi-form-errors');
  errBox.style.display = 'none';
  errBox.innerHTML = '';

  const pipeline = runFHIPipeline(raw);

  if (!pipeline.success) {
    errBox.innerHTML = pipeline.errors.map(err => `<div class="fhi-error-item">⚠ ${err}</div>`).join('');
    errBox.style.display = 'block';
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Show results
  const screen = document.getElementById('screen-fhi');
  screen.innerHTML = buildResultsHTML(pipeline.results);

  // Bind buttons
  document.getElementById('fhi-recalculate').addEventListener('click', initFHIScreen);
  document.getElementById('fhi-export').addEventListener('click', () => exportResultsCSV(pipeline.results));

  // Animate feature bars
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.fhi-feat-bar').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Sync results to all other screens
  syncAllScreens(pipeline.results);
}

/* ═══════════════════════════════════════════════════════════
   TASK 6 — SYNC RESULTS ACROSS ALL SCREENS
   ═══════════════════════════════════════════════════════════ */

function syncAllScreens(results) {
  syncFHIToHealthScreen(results);
  syncFHIToHomeScreen(results);
  syncFHIToGoalsScreen(results);
  syncFHIToInvestScreen(results);
  syncFHIToPulseScreen(results);
}

// ── Health Screen ─────────────────────────────────────────

function syncFHIToHealthScreen(results) {
  try {
    const { fhi, scores, fhi_label, fhi_color, input } = results;
    const score = fhi.enhanced;

    // Gauges
    const healthArc = document.querySelector('#health-gauge .health-gauge-arc');
    if (healthArc) healthArc.setAttribute('stroke-dashoffset', (235.5 * (1 - score / 100)).toFixed(2));

    document.querySelectorAll('.gauge-score').forEach(el => { el.textContent = score.toFixed(1); });
    document.querySelectorAll('.gauge-status').forEach(el => { el.textContent = fhi_label; });

    const subtitleEl = document.querySelector('.gauge-subtitle');
    if (subtitleEl) subtitleEl.textContent = 'Calculated from your FHI Engine inputs.';

    const descEl = document.querySelector('.gauge-description');
    if (descEl) {
      const worst = Object.entries(scores).sort(([,a],[,b]) => a - b)[0];
      const worstLabel = FEATURE_LABELS[worst[0]]?.label || worst[0];
      descEl.textContent = `Your biggest opportunity: ${worstLabel.toLowerCase()} (${worst[1].toFixed(0)}/100). Improving this moves your score the most.`;
    }

    // Metric chips (Savings · Emergency · Debt · Spending)
    const chipScores = [scores.savings_score, scores.emergency_score, scores.dti_score, scores.spending_ratio_score];
    document.querySelectorAll('.metric-chip__score').forEach((chip, i) => {
      if (chipScores[i] !== undefined) {
        chip.textContent = chipScores[i].toFixed(0);
        chip.style.color = scoreColor(chipScores[i]);
      }
    });

    // Breakdown bars + scores + detail text
    const fills  = document.querySelectorAll('.breakdown-card__fill');
    const bScores= document.querySelectorAll('.breakdown-card__score');
    const bDetails=document.querySelectorAll('.breakdown-card__detail');

    const breakdown = [
      {
        score: scores.savings_score,
        detail: (() => {
          const rate = (input.monthly_savings / (input.annual_income / 12) * 100).toFixed(0);
          return `Saving ${rate}% of income · target is 25%`;
        })(),
      },
      {
        score: scores.emergency_score,
        detail: `${input.emergency_fund_months} months covered · aim for 6 months`,
      },
      {
        score: scores.dti_score,
        detail: (() => {
          const ratio = (input.monthly_debt / input.annual_income * 100).toFixed(1);
          return input.monthly_debt > 0
            ? `Monthly debt is ${ratio}% of annual income`
            : 'No monthly debt payments — great position';
        })(),
      },
      {
        score: scores.spending_ratio_score,
        detail: (() => {
          const ratio = (input.monthly_spending / (input.annual_income / 12) * 100).toFixed(0);
          return `Spending ${ratio}% of monthly income`;
        })(),
      },
    ];

    breakdown.forEach(({ score: s, detail }, i) => {
      if (fills[i])   { fills[i].style.width = `${Math.min(s, 100)}%`; fills[i].style.background = scoreColor(s); }
      if (bScores[i]) { bScores[i].innerHTML = `${s.toFixed(0)} <span>/ 100</span>`; bScores[i].style.color = scoreColor(s); }
      if (bDetails[i]){ bDetails[i].textContent = detail; }
    });

    // Impact card
    const impactEl = document.querySelector('.impact-card__text');
    if (impactEl) {
      const opps = generateOpportunities(scores, input);
      if (opps[0]) {
        impactEl.innerHTML = `${opps[0].title}: ${opps[0].desc}`;
      }
    }

    // FHI updated tag
    const tag = document.getElementById('health-fhi-tag');
    if (tag) { tag.style.display = 'inline-flex'; }
  } catch (_) {}
}

// ── Home Screen ───────────────────────────────────────────

function syncFHIToHomeScreen(results) {
  try {
    const { fhi, scores, fhi_label, fhi_color, input } = results;
    const score = fhi.enhanced;

    // Mini gauge on home
    const homeArc = document.querySelector('#home-gauge .gauge-arc');
    if (homeArc) homeArc.setAttribute('stroke-dashoffset', (188.5 * (1 - score / 100)).toFixed(2));

    const homeScoreEl = document.querySelector('.health-score-block__value');
    if (homeScoreEl) homeScoreEl.textContent = score.toFixed(1);
    const homeStatusEl = document.querySelector('.health-score-block__status');
    if (homeStatusEl) homeStatusEl.textContent = fhi_label;

    // Emergency alert subtitle
    const alertSub = document.querySelector('.alert-banner--warning .alert-banner__subtitle');
    if (alertSub) {
      alertSub.textContent = `Covers ${input.emergency_fund_months} months · target is 6`;
    }

    // Pulse AI banner
    const pulseBannerTitle = document.querySelector('.pulse-banner__title');
    if (pulseBannerTitle) {
      pulseBannerTitle.textContent = `Pulse AI has 3 recommendations · FHI: ${score.toFixed(1)}/100`;
    }

    // Home FHI updated tag
    const tag = document.getElementById('home-fhi-tag');
    if (tag) { tag.style.display = 'inline-flex'; }
  } catch (_) {}
}

// ── Goals Screen ──────────────────────────────────────────

function syncFHIToGoalsScreen(results) {
  try {
    const { scores, input } = results;
    // Clear any existing priority flags
    document.querySelectorAll('.fhi-goal-priority').forEach(el => el.remove());

    // Find worst area and flag the matching goal card
    const ranked = Object.entries(scores).sort(([,a],[,b]) => a - b);
    const worstKey = ranked[0][0];

    const mapping = {
      emergency_score:     'goal-card-emergency',
      savings_score:       'goal-card-savings',
      investment_score:    'goal-card-invest',
      spending_ratio_score:'goal-card-savings',
      net_worth_score:     'goal-card-invest',
    };

    const targetId = mapping[worstKey];
    if (targetId) {
      const card = document.getElementById(targetId);
      if (card) {
        const badge = document.createElement('div');
        badge.className = 'fhi-goal-priority';
        badge.innerHTML = '⚡ FHI Priority';
        badge.style.cssText = 'font-size:11px;font-weight:700;color:#E8A838;background:#FFF8E1;border:1px solid #F6E05E;padding:2px 10px;border-radius:100px;display:inline-block;margin-bottom:8px;';
        card.insertBefore(badge, card.firstChild);
      }
    }
  } catch (_) {}
}

// ── Investments Screen ────────────────────────────────────

function syncFHIToInvestScreen(results) {
  try {
    const { scores, fhi, input } = results;
    const insightEl = document.getElementById('invest-fhi-insight');
    if (!insightEl) return;

    const is = scores.investment_score;
    let msg, color;

    if (is < 20) {
      msg = `Your FHI shows investment is your #1 opportunity right now. Even S$${Math.round(input.annual_income * 0.05 / 12).toLocaleString()}/month (5% of income) would meaningfully lift your score.`;
      color = '#E8A838';
    } else if (is < 50) {
      msg = `You're investing — keep going. Increasing contributions gradually is the fastest way to raise your overall Financial Health Score.`;
      color = '#4A90D9';
    } else {
      msg = `Your investment ratio is strong and driving your FHI score. Stay consistent and review allocations annually.`;
      color = '#2ECC71';
    }

    insightEl.style.display = 'flex';
    insightEl.style.cssText = `display:flex;align-items:flex-start;gap:12px;background:${color}15;border:1px solid ${color}40;border-radius:12px;padding:14px 16px;margin-bottom:16px;`;
    insightEl.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" style="flex-shrink:0;margin-top:1px">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      <div>
        <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:4px">FHI Investment Insight</div>
        <div style="font-size:13px;color:var(--color-text-primary);line-height:1.5">${msg}</div>
      </div>`;
  } catch (_) {}
}

// ── Pulse AI Screen ───────────────────────────────────────

function syncFHIToPulseScreen(results) {
  try {
    const { fhi, fhi_label, fhi_color, cluster } = results;
    const bannerEl = document.getElementById('pulse-fhi-banner');
    if (!bannerEl) return;

    bannerEl.style.display = 'block';
    bannerEl.innerHTML = `
      <div class="fhi-pulse-banner" style="border-left:4px solid ${fhi_color}">
        <div class="fhi-pulse-banner__score" style="color:${fhi_color}">${fhi.enhanced.toFixed(1)}<span>/100</span></div>
        <div class="fhi-pulse-banner__info">
          <div class="fhi-pulse-banner__label">${fhi_label} · ${cluster.profile.label}</div>
          <div class="fhi-pulse-banner__sub">Your recommendations below are personalised to your financial profile.</div>
        </div>
      </div>`;
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   INIT — render form into #screen-fhi
   ═══════════════════════════════════════════════════════════ */

function initFHIScreen() {
  const screen = document.getElementById('screen-fhi');
  if (!screen) return;
  screen.innerHTML = buildFormHTML();
  const form = document.getElementById('fhi-form');
  if (form) form.addEventListener('submit', handleFormSubmit);

  // Pre-fill from saved results if available
  try {
    const saved = JSON.parse(localStorage.getItem('fhi_results') || 'null');
    if (saved && saved.input) {
      const d = saved.input;
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      setVal('f-age',       d.age);
      setVal('f-income',    d.annual_income);
      setVal('f-networth',  d.net_worth);
      setVal('f-debt',      d.monthly_debt);
      setVal('f-savings',   d.monthly_savings);
      setVal('f-emergency', d.emergency_fund_months);
      setVal('f-spending',  d.monthly_spending);
      setVal('f-vol',       d.spending_volatility);
      setVal('f-invest',    d.total_investment);
      setVal('f-return',    d.investment_return);
      const radio = document.querySelector(`input[name="panic_sell_12m"][value="${d.panic_sell_12m}"]`);
      if (radio) radio.checked = true;
    }
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // Inject form on first load (screen starts hidden; shows when nav clicked)
  initFHIScreen();

  // Re-init form whenever the FHI nav item is clicked
  const fhiNavBtn = document.getElementById('nav-fhi');
  if (fhiNavBtn) {
    fhiNavBtn.addEventListener('click', () => {
      // Only re-init if no results are currently showing
      const screen = document.getElementById('screen-fhi');
      if (!screen.querySelector('.fhi-results-header')) {
        initFHIScreen();
      }
    });
  }
});
