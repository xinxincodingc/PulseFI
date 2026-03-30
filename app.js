/**
 * PulseFi — Dashboard Interactivity + Real User Data
 * Uses users.json + URL param ?user=GZ00001
 */

let currentUser = null;

function ensureUserInURL(defaultUser = 'GZ00001') {
  const url = new URL(window.location.href);

  if (!url.searchParams.get('user')) {
    url.searchParams.set('user', defaultUser);
    window.history.replaceState({}, '', url);
  }
}

/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    
    ensureUserInURL(); 
    await loadDashboardData();
  } catch (err) {
    console.error('PulseFi dashboard data error:', err);
  }

  initNavigation();
  initInternalLinks();
  initMobileMenu();
  animateProgressBars();
  // Charts are drawn when Invest tab shows
});

/* =============================================
   USER / DATA HELPERS
   ============================================= */
function getUserIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('user') || 'GZ00001';
  
}

function fmtGBP(value, decimals = 0) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

function fmtPercent(value, decimals = 1) {
  const num = Number(value || 0);
  return `${num > 0 ? '+' : ''}${num.toFixed(decimals)}%`;
}

function safeText(value, fallback = '') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function clampPct(value) {
  const num = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(num)));
}

function getInitial(name) {
  return safeText(name, 'U').trim().charAt(0).toUpperCase() || 'U';
}

function getGreetingForUser(name) {
  return `Good morning, ${name} 👋`;
}

function getScreenGreeting(screen) {
  if (!currentUser) {
    return screen === 'home' ? 'Good morning 👋' : '';
  }

  const name = currentUser.first_name || 'there';

  const greetings = {
    home: getGreetingForUser(name),
    health: 'Your health score and breakdown',
    pulse: 'Personalised recommendations based on your data',
    goals: 'Track and grow your savings goals',
    invest: 'Your investment overview'
  };

  return greetings[screen] || '';
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function setAllText(selector, values = []) {
  const els = document.querySelectorAll(selector);
  els.forEach((el, i) => {
    if (values[i] !== undefined) el.textContent = values[i];
  });
}

function setWidth(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.style.width = `${clampPct(value)}%`;
}

function setWidths(selector, values = []) {
  const els = document.querySelectorAll(selector);
  els.forEach((el, i) => {
    if (values[i] !== undefined) {
      el.style.width = `${clampPct(values[i])}%`;
    }
  });
}

function setGaugeArc(selector, score, totalArcLength) {
  const el = document.querySelector(selector);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, Number(score || 0))) / 100;
  const dashoffset = totalArcLength * (1 - pct);
  el.setAttribute('stroke-dashoffset', dashoffset.toFixed(2));
}

function getUserStatusLabel(score) {
  const s = Number(score || 0);
  if (s < 45) return 'Needs attention';
  if (s < 70) return 'Fair';
  return 'Strong';
}

function getEmergencySubtitle(user) {
  const covered = Number(user?.emergency?.months_covered || 0).toFixed(1);
  const target = Number(user?.emergency?.target_months || 3);
  return `Covers ${covered} months · target is ${target}`;
}

function getHomeMonthlyChange(user) {
  const income = Number(user?.monthly_income || 0);
  const saved = Number(user?.monthly_saved || 0);
  if (income <= 0) return '↗ On track this month';
  const pct = (saved / income) * 100;
  return `↗ ${pct.toFixed(1)}% saved this month`;
}

function getImpactText(user) {
  const emergencyScore = Number(user?.metrics?.emergency_score || 0);
  const savingsScore = Number(user?.metrics?.savings_score || 0);
  const debtScore = Number(user?.metrics?.debt_score || 0);
  const weakest = Math.min(emergencyScore, savingsScore, debtScore);

  if (weakest === emergencyScore) {
    return 'Building your emergency buffer to 3 months would lift your financial resilience the fastest.';
  }
  if (weakest === savingsScore) {
    return 'Improving your monthly savings rate is likely the fastest way to strengthen your financial health.';
  }
  return 'Reducing short-term debt further would give you the biggest improvement in overall financial health.';
}

function getFallbackArray(base, len) {
  return Array.from({ length: len }, (_, i) => base[i] ?? 0);
}

/* =============================================
   LOAD DASHBOARD DATA
   ============================================= */
async function loadDashboardData() {
  const userId = getUserIdFromURL();
  localStorage.setItem('pulsefi_user_id', userId);

  const response = await fetch('./users.json');
  if (!response.ok) {
    throw new Error(`Could not fetch users.json (HTTP ${response.status})`);
  }

  const allUsers = await response.json();
  const user = allUsers[userId];

  if (!user) {
    throw new Error(`No dashboard data found for user ${userId}`);
  }

  currentUser = user;
  renderUserData(user);
}

function renderUserData(user) {
  const firstName = safeText(user.first_name, 'User');
  const lastName = safeText(user.last_name, 'Johnson');
  const fullName = `${firstName} ${lastName}`;
  const email = safeText(user.email, `${firstName.toLowerCase()}@pulsefi.com`);

  /* ----- Sidebar + topbar ----- */
  setText('.sidebar__avatar', getInitial(firstName));
  setText('.sidebar__user-name', fullName);
  setText('.sidebar__user-email', email);
  setText('#topbar-greeting', getGreetingForUser(firstName));

  /* ----- Home: total balance ----- */
  const totalBalance = Number(user.total_balance || 0);
  const balanceMain = Math.floor(totalBalance);
  const balanceDecimal = Math.round((totalBalance - balanceMain) * 100)
    .toString()
    .padStart(2, '0');

  setText('.balance-hero__amount-main', fmtGBP(balanceMain, 0));
  setText('.balance-hero__amount-decimal', `.${balanceDecimal}`);
  setText('.badge.badge--success', getHomeMonthlyChange(user));

  /* ----- Home: health summary ----- */
  const fhiScore = Number(user.fhi_score || 0);
  const fhiStatus = safeText(user.fhi_status, getUserStatusLabel(fhiScore));

  setText('.health-score-block__value', String(Math.round(fhiScore)));
  setText('.health-score-block__status', fhiStatus);

  // Home mini gauge arc length in HTML is 188.5
  setGaugeArc('#home-gauge .gauge-arc', fhiScore, 188.5);

  /* ----- Home: monthly summary ----- */
  const monthlyIncome = Number(user.monthly_income || 0);
  const monthlySpending = Number(user.monthly_spending || 0);
  const monthlySaved = Number(user.monthly_saved || (monthlyIncome - monthlySpending));

  const monthlyValues = document.querySelectorAll('.monthly-row__value');
  if (monthlyValues[0]) monthlyValues[0].textContent = fmtGBP(monthlyIncome, 0);
  if (monthlyValues[1]) monthlyValues[1].textContent = fmtGBP(monthlySpending, 0);
  setText('.saved-badge', `${fmtGBP(monthlySaved, 0)} saved this month`);

  /* ----- Home: emergency alert ----- */
  setText('.alert-banner--warning .alert-banner__subtitle', getEmergencySubtitle(user));

  /* ----- Home: pots preview ----- */
  const emergency = user.emergency || {};
  const emergencyPct = clampPct(emergency.progress_pct);
  const emergencyCurrent = Number(emergency.current_amount || 0);
  const emergencyTarget = Number(emergency.target_amount || 0);

  const potStatuses = document.querySelectorAll('.pot-item__status');
  if (potStatuses[0]) potStatuses[0].textContent = `${emergencyPct}%`;
  if (potStatuses[2]) {
    const investPct = clampPct(user.safe_to_invest?.progress_pct || user.invest_goal?.progress_pct || 0);
    potStatuses[2].textContent = `${investPct}%`;
  }

  const potFooters = document.querySelectorAll('.pot-item__footer');
  if (potFooters[0]) {
    potFooters[0].textContent = `${fmtGBP(emergencyCurrent, 0)} / ${fmtGBP(emergencyTarget, 0)}`;
  }
  if (potFooters[1]) {
    const investCurrent = Number(user.safe_to_invest?.current_amount || user.invest_goal?.current_amount || 0);
    const investTarget = Number(user.safe_to_invest?.target_amount || user.invest_goal?.target_amount || 0);
    potFooters[1].textContent = `${fmtGBP(investCurrent, 0)} / ${fmtGBP(investTarget, 0)}`;
  }

  const homeProgressBars = document.querySelectorAll('.pot-item .progress-bar__fill');
  if (homeProgressBars[0]) homeProgressBars[0].style.width = `${emergencyPct}%`;
  if (homeProgressBars[1]) homeProgressBars[1].style.width = '100%';
  if (homeProgressBars[2]) {
    const investPct = clampPct(user.safe_to_invest?.progress_pct || user.invest_goal?.progress_pct || 0);
    homeProgressBars[2].style.width = `${investPct}%`;
  }

  /* ----- Home: portfolio card ----- */
  const portfolio = user.portfolio || {};
  const hasInvestments = !!portfolio.has_investments;
  const portfolioValue = Number(portfolio.value || 0);
  const portfolioReturn = Number(portfolio.return_pct || 0);
  const holdingsCount = Number(portfolio.holdings_count || 0);

  setText('.portfolio-card__amount', fmtGBP(portfolioValue, 0));
  setText(
    '.portfolio-card__badge',
    hasInvestments ? `📈 ${fmtPercent(portfolioReturn, 1)}` : 'No investments yet'
  );
  setText(
    '.portfolio-card__meta',
    hasInvestments ? `${holdingsCount || 0} holdings · Mar 2026` : 'Start building your portfolio'
  );

  /* ----- Health screen: gauge ----- */
  setText('.gauge-score', String(Math.round(fhiScore)));
  setText('.gauge-status', fhiStatus);
  setText('.gauge-subtitle', safeText(user.fhi_subtitle, 'Your plan is working.'));
  setText(
    '.gauge-description',
    safeText(user.fhi_description, 'One key area needs attention — your emergency buffer.')
  );

  // Health large gauge arc length in HTML is 235.5
  setGaugeArc('#health-gauge .health-gauge-arc', fhiScore, 235.5);

  /* ----- Health screen: metric chips ----- */
  const metrics = user.metrics || {};
  const savingsScore = Number(metrics.savings_score || 0);
  const emergencyScore = Number(metrics.emergency_score || 0);
  const debtScore = Number(metrics.debt_score || 0);
  const spendingScore = Number(metrics.spending_score || metrics.investment_score || 0);

// Returns a CSS colour variable based on score value — fixes Rahul's colour bug
function scoreColour(score) {
  const s = Number(score || 0);
  if (s >= 70) return 'var(--color-accent-green)';
  if (s >= 40) return 'var(--color-accent-orange)';
  return '#E74C3C'; // red for critical scores below 40
}

const metricChipScores = document.querySelectorAll('.metric-chip__score');
[[metricChipScores[0], savingsScore],
 [metricChipScores[1], emergencyScore],
 [metricChipScores[2], debtScore],
 [metricChipScores[3], spendingScore]].forEach(([el, score]) => {
  if (!el) return;
  el.textContent = String(Math.round(score));
  // Remove all hardcoded colour classes and apply dynamic colour
  el.className = 'metric-chip__score'; // strips --teal, --orange, --green
  el.style.color = scoreColour(score);
});
  /* ----- Health screen: breakdown cards ----- */
const breakdownScores = document.querySelectorAll('.breakdown-card__score');
[[breakdownScores[0], savingsScore],
 [breakdownScores[1], emergencyScore],
 [breakdownScores[2], debtScore],
 [breakdownScores[3], spendingScore]].forEach(([el, score]) => {
  if (!el) return;
  el.innerHTML = `${Math.round(score)} <span>/ 100</span>`;
  el.style.color = scoreColour(score); // dynamic colour, not hardcoded
});
  const breakdownFills = document.querySelectorAll('.breakdown-card__fill');
  if (breakdownFills[0]) breakdownFills[0].style.width = `${clampPct(savingsScore)}%`;
  if (breakdownFills[1]) breakdownFills[1].style.width = `${clampPct(emergencyScore)}%`;
  if (breakdownFills[2]) breakdownFills[2].style.width = `${clampPct(debtScore)}%`;
  if (breakdownFills[3]) breakdownFills[3].style.width = `${clampPct(spendingScore)}%`;

  const breakdownDetails = document.querySelectorAll('.breakdown-card__detail');
  if (breakdownDetails[0]) {
    const savingsRatePct = Number(user.savings_rate_pct || user.monthly_savings_rate_pct || 0);
    breakdownDetails[0].textContent = savingsRatePct
      ? `Saving ${savingsRatePct.toFixed(0)}% of income · target is 25%`
      : 'Your monthly savings trend based on current income and spend';
  }
  if (breakdownDetails[1]) {
    breakdownDetails[1].textContent = `${Number(emergency.months_covered || 0).toFixed(1)} months covered · aim for ${Number(emergency.target_months || 3)} months`;
  }
  if (breakdownDetails[2]) {
    const ccDebt = Number(user.credit_card_debt || 0);
    const bnplDebt = Number(user.bnpl_debt || 0);
    const totalDebt = ccDebt + bnplDebt;
    breakdownDetails[2].textContent = totalDebt > 0
      ? `${fmtGBP(totalDebt, 0)} short-term debt across cards/BNPL`
      : 'Low debt relative to income · great';
  }
  if (breakdownDetails[3]) {
    breakdownDetails[3].textContent = safeText(
      user.spending_detail,
      'Your spending consistency based on this month’s behaviour'
    );
  }

  /* ----- Health screen: impact card ----- */
  setText('.impact-card__text', getImpactText(user));

  /* ----- Goals screen ----- */
  const goalPercents = document.querySelectorAll('.goal-card__percent');
  const goalCurrents = document.querySelectorAll('.goal-card__current');
  const goalTargetDates = document.querySelectorAll('.goal-card__target-date');
  const goalAutoLabels = document.querySelectorAll('.goal-card__auto-label');
  const goalProgressBars = document.querySelectorAll('.goal-card .progress-bar__fill');

  // Emergency Pot
  if (goalPercents[0]) goalPercents[0].textContent = `${emergencyPct}%`;
  if (goalCurrents[0]) goalCurrents[0].textContent = `${fmtGBP(emergencyCurrent, 0)} / ${fmtGBP(emergencyTarget, 0)}`;
  if (goalTargetDates[0]) goalTargetDates[0].textContent = safeText(emergency.target_date, 'Target Aug 2026');
  if (goalAutoLabels[0]) goalAutoLabels[0].textContent = safeText(emergency.auto_contribution_label, '+£200/mo');
  if (goalProgressBars[0]) goalProgressBars[0].style.width = `${emergencyPct}%`;

  // First £1K
  const first1k = user.first_1k || {};
  const first1kCurrent = Number(first1k.current_amount || 1000);
  const first1kTarget = Number(first1k.target_amount || 1000);
  const first1kPct = clampPct(first1k.progress_pct || 100);
  const milestoneAmount = document.querySelector('.goal-card__milestone-amount');
  if (goalPercents[1]) goalPercents[1].textContent = `${first1kPct}%`;
  if (milestoneAmount) milestoneAmount.textContent = `${fmtGBP(first1kCurrent, 0)} / ${fmtGBP(first1kTarget, 0)}`;
  if (goalProgressBars[1]) goalProgressBars[1].style.width = `${first1kPct}%`;

  // Safe to Invest
  const safeToInvest = user.safe_to_invest || user.invest_goal || {};
  const stiCurrent = Number(safeToInvest.current_amount || 0);
  const stiTarget = Number(safeToInvest.target_amount || 0);
  const stiPct = clampPct(safeToInvest.progress_pct || 0);
  if (goalPercents[2]) goalPercents[2].textContent = `${stiPct}%`;
  if (goalCurrents[1]) goalCurrents[1].textContent = `${fmtGBP(stiCurrent, 0)} / ${fmtGBP(stiTarget, 0)}`;
  if (goalTargetDates[1]) goalTargetDates[1].textContent = safeText(safeToInvest.target_date, 'Target Oct 2026');
  if (goalAutoLabels[1]) goalAutoLabels[1].textContent = safeText(safeToInvest.auto_contribution_label, '+£150/mo');
  if (goalProgressBars[2]) goalProgressBars[2].style.width = `${stiPct}%`;

  // Holiday Fund - keep UI unchanged, use dataset if present, otherwise keep static fallback
  const holiday = user.holiday_fund || {};
  if (goalPercents[3] && holiday.progress_pct !== undefined) goalPercents[3].textContent = `${clampPct(holiday.progress_pct)}%`;
  if (goalCurrents[2] && holiday.current_amount !== undefined && holiday.target_amount !== undefined) {
    goalCurrents[2].textContent = `${fmtGBP(holiday.current_amount, 0)} / ${fmtGBP(holiday.target_amount, 0)}`;
  }
  if (goalTargetDates[2] && holiday.target_date) goalTargetDates[2].textContent = holiday.target_date;
  if (goalAutoLabels[2] && holiday.auto_contribution_label) goalAutoLabels[2].textContent = holiday.auto_contribution_label;
  if (goalProgressBars[3] && holiday.progress_pct !== undefined) {
    goalProgressBars[3].style.width = `${clampPct(holiday.progress_pct)}%`;
  }

  /* ----- Invest screen ----- */
  setText('.portfolio-top__value', fmtGBP(portfolioValue, 2));
  setText(
    '.portfolio-top__change',
    hasInvestments ? `↗ ${fmtPercent(portfolioReturn, 1)} all time` : 'No investments yet'
  );

  const marketAlertTitle = document.querySelector('#screen-invest .alert-banner--info .alert-banner__title');
  const marketAlertSubtitle = document.querySelector('#screen-invest .alert-banner--info .alert-banner__subtitle');
  if (marketAlertTitle) {
    marketAlertTitle.textContent = safeText(
      user.market_insight?.title,
      'Markets dipped this week'
    );
  }
  if (marketAlertSubtitle) {
    marketAlertSubtitle.textContent = safeText(
      user.market_insight?.subtitle,
      'Your portfolio is built for the long run. Short-term moves rarely matter — check your plan, not the news.'
    );
  }

  const allocationBadge = document.querySelector('.allocation-card__badge');
  if (allocationBadge) {
    allocationBadge.textContent = safeText(portfolio.risk_label, hasInvestments ? 'Low risk' : 'Not started');
  }

  // Holdings
  const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
  const holdingItems = document.querySelectorAll('.holding-item');

  holdingItems.forEach((item, idx) => {
    const holding = holdings[idx];
    if (!holding) return;

    const nameEl = item.querySelector('.holding-item__name');
    const fundEl = item.querySelector('.holding-item__fund');
    const amountEl = item.querySelector('.holding-item__amount');
    const changeEl = item.querySelector('.holding-item__change');

    if (nameEl) nameEl.textContent = safeText(holding.name, nameEl.textContent);
    if (fundEl) fundEl.textContent = safeText(holding.fund, fundEl.textContent);
    if (amountEl) amountEl.textContent = fmtGBP(Number(holding.amount || 0), 0);
    if (changeEl) changeEl.textContent = fmtPercent(Number(holding.change_pct || 0), 1);
  });

  // Allocation legend
  const allocation = Array.isArray(portfolio.allocation) ? portfolio.allocation : [];
  const legendItems = document.querySelectorAll('.allocation-legend .legend-item');
  legendItems.forEach((item, idx) => {
    const seg = allocation[idx];
    if (!seg) return;
    const nameEl = item.querySelector('.legend-item__name');
    const valueEl = item.querySelector('.legend-item__value');
    if (nameEl) nameEl.textContent = safeText(seg.name, nameEl.textContent);
    if (valueEl) valueEl.textContent = `${clampPct(seg.value)}%`;
  });

  /* ----- Refresh greeting based on active screen ----- */
  const activeScreen = document.querySelector('.nav-item.active')?.dataset.screen || 'home';
  setText('#topbar-greeting', getScreenGreeting(activeScreen));
}

/* =============================================
   NAVIGATION
   ============================================= */
const screenTitles = {
  home: 'Dashboard',
  health: 'Financial Health',
  pulse: 'Pulse AI',
  goals: 'Savings Goals',
  invest: 'Investments'
};

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchScreen(item.dataset.screen);
    });
  });
}

function switchScreen(target) {
  const navItems = document.querySelectorAll('.nav-item');
  const screens = document.querySelectorAll('.screen');

  // Update nav
  navItems.forEach(n => n.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-screen="${target}"]`);
  if (activeNav) activeNav.classList.add('active');

  // Update screens
  screens.forEach(s => s.classList.remove('active'));
  const activeScreen = document.getElementById(`screen-${target}`);
  if (activeScreen) activeScreen.classList.add('active');

  // Update topbar
  const titleEl = document.getElementById('topbar-title');
  const greetingEl = document.getElementById('topbar-greeting');
  if (titleEl) titleEl.textContent = screenTitles[target] || 'Dashboard';
  if (greetingEl) greetingEl.textContent = getScreenGreeting(target);

  // Re-animate progress
  animateProgressBars();

  // Draw charts for invest screen
  if (target === 'invest') {
    setTimeout(() => {
      drawPortfolioChart();
      drawDonutChart();
    }, 100);
  }

  // Close mobile sidebar
  closeMobileSidebar();

  // Scroll main to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =============================================
   INTERNAL LINKS
   ============================================= */
function initInternalLinks() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchScreen(el.dataset.nav);
    });
    el.style.cursor = 'pointer';
  });
}

/* =============================================
   MOBILE MENU
   ============================================= */
function initMobileMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const overlay = document.getElementById('sidebarOverlay');

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      overlay.classList.toggle('active');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeMobileSidebar);
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

/* =============================================
   CHARTS
   ============================================= */

/* ----- Portfolio Line Chart ----- */
function drawPortfolioChart() {
  const canvas = document.getElementById('portfolioChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = 160 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '160px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = 160;
  const padding = { top: 20, right: 16, bottom: 10, left: 16 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const data = Array.isArray(currentUser?.portfolio?.history)
    ? currentUser.portfolio.history.map(Number)
    : [3200, 3400, 3800, 3600, 4100, 4280];

  const cleanData = data.length >= 2 ? data : [3200, 3400, 3800, 3600, 4100, 4280];
  const min = Math.min(...cleanData) - 200;
  const max = Math.max(...cleanData) + 200;

  const points = cleanData.map((v, i) => ({
    x: padding.left + (i / (cleanData.length - 1)) * chartW,
    y: padding.top + chartH - ((v - min) / (max - min || 1)) * chartH
  }));

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.2)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.01)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, h);
  drawSmoothLine(ctx, points);
  ctx.lineTo(points[points.length - 1].x, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  drawSmoothLine(ctx, points);
  ctx.strokeStyle = '#6C5CE7';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#6C5CE7';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function drawSmoothLine(ctx, points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cpx = (curr.x + next.x) / 2;
    ctx.quadraticCurveTo(curr.x + (next.x - curr.x) * 0.3, curr.y, cpx, (curr.y + next.y) / 2);
    ctx.quadraticCurveTo(next.x - (next.x - curr.x) * 0.3, next.y, next.x, next.y);
  }
}

/* ----- Donut Chart ----- */
function drawDonutChart() {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 110;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 42;
  const lineWidth = 16;

  const dynamicSegments = Array.isArray(currentUser?.portfolio?.allocation)
    ? currentUser.portfolio.allocation.map(seg => ({
        value: Number(seg.value || 0),
        color: seg.color || '#4A90D9'
      }))
    : null;

  const segments = dynamicSegments && dynamicSegments.length
    ? dynamicSegments
    : [
        { value: 60, color: '#4A90D9' },
        { value: 25, color: '#6C5CE7' },
        { value: 15, color: '#00B894' },
      ];

  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let startAngle = -Math.PI / 2;
  const gap = 0.04;

  segments.forEach(seg => {
    const sweep = (seg.value / total) * Math.PI * 2 - gap;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    startAngle += sweep + gap;
  });
}

/* =============================================
   PROGRESS BAR ANIMATIONS
   ============================================= */
function animateProgressBars() {
  const bars = document.querySelectorAll('.progress-bar__fill, .breakdown-card__fill');
  bars.forEach(bar => {
    const targetWidth = bar.style.width;
    bar.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.width = targetWidth;
      });
    });
  });
}

/* =============================================
   RESIZE HANDLING
   ============================================= */
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const investScreen = document.getElementById('screen-invest');
    if (investScreen && investScreen.classList.contains('active')) {
      drawPortfolioChart();
      drawDonutChart();
    }
  }, 200);
});