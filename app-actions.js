/**
 * PulseFi — AppState, Modals & Action Buttons
 * Makes all buttons interactive and connects everything to the FHI engine.
 * Does NOT change any existing layout or UI elements — only adds interactivity.
 */

/* =============================================
   APP STATE — single mutable financial snapshot
   ============================================= */
const AppState = {
  balance: 0,
  monthlyIncome: 0,
  monthlySpending: 0,
  monthlySavings: 0,
  totalDebt: 0,
  age: 24,
  netWorth: 0,
  emergency:    { current: 0, target: 3000, monthsCovered: 0, targetMonths: 3 },
  first1k:      { current: 1000, target: 1000 },
  safeToInvest: { current: 0, target: 2000 },
  holiday:      { current: 0, target: 800 },
  portfolio:    { value: 0, returnPct: 0, holdings: [] },
  monthlyInvestment: 0,
  spendingVolatility: 0.19,
  panicSell: 0,
  investmentReturn: 0,
  firstName: 'User',
  notifications: [
    { id: 1, icon: '💰', title: 'Savings goal on track',   body: 'Your Emergency Pot auto-contribution ran successfully.',       time: '2 hours ago', unread: true  },
    { id: 2, icon: '⚠️', title: 'Emergency buffer low',    body: 'You\'re below 50% of your emergency target. Add more soon.',  time: 'Yesterday',   unread: true  },
    { id: 3, icon: '📈', title: 'Portfolio up this month', body: 'Your portfolio gained since last check-in. Keep investing.',   time: '3 days ago',  unread: false },
    { id: 4, icon: '🤖', title: 'Pulse AI updated',        body: 'New personalised recommendations are ready for you.',          time: '1 week ago',  unread: false },
  ],
  transactions: [],
};

function initAppState(user) {
  AppState.firstName       = user.first_name || 'User';
  AppState.balance         = Number(user.total_balance   || 0);
  AppState.monthlyIncome   = Number(user.monthly_income  || 0);
  AppState.monthlySpending = Number(user.monthly_spending || 0);
  AppState.monthlySavings  = Number(user.monthly_saved   || Math.max(0, AppState.monthlyIncome - AppState.monthlySpending));
  AppState.totalDebt       = Number(user.credit_card_debt || 0) + Number(user.bnpl_debt || 0);
  AppState.age             = Number(user.age || 24);
  AppState.netWorth        = Number(user.net_worth || AppState.balance - AppState.totalDebt);

  const em = user.emergency || {};
  AppState.emergency = {
    current:       Number(em.current_amount || 0),
    target:        Number(em.target_amount  || 3000),
    monthsCovered: Number(em.months_covered || 0),
    targetMonths:  Number(em.target_months  || 3),
  };

  const f1k = user.first_1k || {};
  AppState.first1k = {
    current: Number(f1k.current_amount || 1000),
    target:  Number(f1k.target_amount  || 1000),
  };

  const sti = user.safe_to_invest || user.invest_goal || {};
  AppState.safeToInvest = {
    current: Number(sti.current_amount || 0),
    target:  Number(sti.target_amount  || 2000),
  };

  const hol = user.holiday_fund || {};
  AppState.holiday = {
    current: Number(hol.current_amount || 0),
    target:  Number(hol.target_amount  || 800),
  };

  const port = user.portfolio || {};
  AppState.portfolio = {
    value:     Number(port.value      || 0),
    returnPct: Number(port.return_pct || 0),
    holdings:  Array.isArray(port.holdings) ? port.holdings : [],
  };

  AppState.monthlyInvestment  = Number(user.monthly_investment || user.monthly_invest || Math.round(AppState.monthlySavings * 0.3));
  AppState.spendingVolatility = Number(user.spending_volatility || 0.19);
  AppState.panicSell          = Number(user.panic_sell_12m || 0);
  AppState.investmentReturn   = Number(port.return_pct || 0);
}

/* =============================================
   HELPERS
   ============================================= */
function actionFmt(value, decimals) {
  decimals = decimals === undefined ? 0 : decimals;
  if (typeof fmtGBP === 'function') return fmtGBP(value, decimals);
  return 'S$' + Number(value).toLocaleString('en-SG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pctOf(current, target) {
  return target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
}

/* =============================================
   MODAL SYSTEM
   ============================================= */
function showModal(opts) {
  var title        = opts.title        || '';
  var body         = opts.body         || '';
  var onConfirm    = opts.onConfirm    || null;
  var confirmLabel = opts.confirmLabel || 'Confirm';
  var cancelLabel  = opts.cancelLabel  || 'Cancel';
  var confirmClass = opts.confirmClass || 'btn--primary';
  var hideFooter   = opts.hideCancelFooter || false;

  closeModal();

  var overlay = document.createElement('div');
  overlay.id = 'pulsefi-modal-overlay';
  overlay.innerHTML = '<div class="pulsefi-modal" role="dialog" aria-modal="true">' +
    '<div class="pulsefi-modal__header">' +
      '<h3 class="pulsefi-modal__title">' + title + '</h3>' +
      '<button class="pulsefi-modal__close" id="modal-close-btn" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="pulsefi-modal__body">' + body + '</div>' +
    (!hideFooter ? '<div class="pulsefi-modal__footer">' +
      '<button class="btn btn--ghost" id="modal-cancel-btn">' + cancelLabel + '</button>' +
      (onConfirm ? '<button class="btn ' + confirmClass + '" id="modal-confirm-btn">' + confirmLabel + '</button>' : '') +
    '</div>' : '') +
  '</div>';

  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  var cancelBtn  = document.getElementById('modal-cancel-btn');
  if (cancelBtn)  cancelBtn.addEventListener('click', closeModal);
  var confirmBtn = document.getElementById('modal-confirm-btn');
  if (confirmBtn && onConfirm) confirmBtn.addEventListener('click', onConfirm);

  requestAnimationFrame(function() { overlay.classList.add('active'); });

  setTimeout(function() {
    var firstInput = overlay.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
  }, 120);
}

function closeModal() {
  var el = document.getElementById('pulsefi-modal-overlay');
  if (el) el.remove();
}

/* =============================================
   TOAST NOTIFICATIONS
   ============================================= */
function showToast(message, type) {
  type = type || 'success';
  document.querySelectorAll('.pulsefi-toast').forEach(function(t) { t.remove(); });
  var icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  var toast = document.createElement('div');
  toast.className = 'pulsefi-toast pulsefi-toast--' + type;
  toast.textContent = icon + ' ' + message;
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.classList.add('visible'); });
  setTimeout(function() {
    toast.classList.remove('visible');
    setTimeout(function() { toast.remove(); }, 350);
  }, 3500);
}

/* =============================================
   DOM UPDATER — syncs AppState → all visible UI
   ============================================= */
function updateDOMFromState() {
  // Balance hero
  var totalBal = AppState.balance;
  var balMain  = Math.floor(totalBal);
  var balDec   = Math.round((totalBal - balMain) * 100).toString();
  while (balDec.length < 2) balDec = '0' + balDec;
  var balMainEl = document.querySelector('.balance-hero__amount-main');
  var balDecEl  = document.querySelector('.balance-hero__amount-decimal');
  if (balMainEl) balMainEl.textContent = actionFmt(balMain, 0);
  if (balDecEl)  balDecEl.textContent  = '.' + balDec;

  // Savings badge
  var pctSaved = AppState.monthlyIncome > 0
    ? ((AppState.monthlySavings / AppState.monthlyIncome) * 100).toFixed(1)
    : '0.0';
  var badge = document.querySelector('.badge.badge--success');
  if (badge) badge.textContent = '\u2197 ' + pctSaved + '% saved this month';

  // Monthly income / spending
  var monthlyVals = document.querySelectorAll('.monthly-row__value');
  if (monthlyVals[0]) monthlyVals[0].textContent = actionFmt(AppState.monthlyIncome, 0);
  if (monthlyVals[1]) monthlyVals[1].textContent = actionFmt(AppState.monthlySpending, 0);
  var savedEl = document.querySelector('.saved-badge');
  if (savedEl) savedEl.textContent = actionFmt(AppState.monthlySavings, 0) + ' saved this month';

  // Emergency alert subtitle
  var emMonths = AppState.monthlyIncome > 0
    ? (AppState.emergency.current / AppState.monthlyIncome).toFixed(1)
    : AppState.emergency.monthsCovered.toFixed(1);
  var alertSub = document.querySelector('.alert-banner--warning .alert-banner__subtitle');
  if (alertSub) alertSub.textContent = 'Covers ' + emMonths + ' months \u00B7 target is ' + AppState.emergency.targetMonths;

  // Pots on home screen
  var emPct  = pctOf(AppState.emergency.current,    AppState.emergency.target);
  var stiPct = pctOf(AppState.safeToInvest.current, AppState.safeToInvest.target);

  var potStatuses = document.querySelectorAll('.pot-item__status');
  if (potStatuses[0] && !potStatuses[0].classList.contains('pot-item__status--done')) potStatuses[0].textContent = emPct + '%';
  if (potStatuses[2]) potStatuses[2].textContent = stiPct + '%';

  var potFooters = document.querySelectorAll('.pot-item__footer');
  if (potFooters[0]) potFooters[0].textContent = actionFmt(AppState.emergency.current, 0) + ' / ' + actionFmt(AppState.emergency.target, 0);
  if (potFooters[1]) potFooters[1].textContent = actionFmt(AppState.safeToInvest.current, 0) + ' / ' + actionFmt(AppState.safeToInvest.target, 0);

  var homeBars = document.querySelectorAll('.pot-item .progress-bar__fill');
  if (homeBars[0]) homeBars[0].style.width = emPct + '%';
  if (homeBars[2]) homeBars[2].style.width = stiPct + '%';

  // Portfolio card (home)
  var portAmtEl = document.querySelector('.portfolio-card__amount');
  if (portAmtEl) portAmtEl.textContent = actionFmt(AppState.portfolio.value, 0);

  // Invest screen
  var portTopEl = document.querySelector('.portfolio-top__value');
  if (portTopEl) portTopEl.textContent = actionFmt(AppState.portfolio.value, 2);

  // Goals screen
  var goalPercents = document.querySelectorAll('.goal-card__percent');
  var goalCurrents = document.querySelectorAll('.goal-card__current');
  var goalBars     = document.querySelectorAll('.goal-card .progress-bar__fill');

  if (goalPercents[0]) goalPercents[0].textContent = emPct + '%';
  if (goalCurrents[0]) goalCurrents[0].textContent = actionFmt(AppState.emergency.current, 0) + ' / ' + actionFmt(AppState.emergency.target, 0);
  if (goalBars[0])     goalBars[0].style.width = emPct + '%';

  if (goalPercents[2]) goalPercents[2].textContent = stiPct + '%';
  if (goalCurrents[1]) goalCurrents[1].textContent = actionFmt(AppState.safeToInvest.current, 0) + ' / ' + actionFmt(AppState.safeToInvest.target, 0);
  if (goalBars[2])     goalBars[2].style.width = stiPct + '%';

  var holPct = pctOf(AppState.holiday.current, AppState.holiday.target);
  if (goalPercents[3]) goalPercents[3].textContent = holPct + '%';
  if (goalCurrents[2]) goalCurrents[2].textContent = actionFmt(AppState.holiday.current, 0) + ' / ' + actionFmt(AppState.holiday.target, 0);
  if (goalBars[3])     goalBars[3].style.width = holPct + '%';

  updateNotificationBadge();
}

/* =============================================
   AUTO FHI RECALCULATION
   ============================================= */
function autoRecalculateFHI() {
  if (typeof runFHIPipeline !== 'function') return;

  var annualIncome  = AppState.monthlyIncome * 12;
  var netWorth      = AppState.balance + AppState.portfolio.value - AppState.totalDebt;
  var monthlyDebt   = AppState.totalDebt > 0 ? AppState.totalDebt * 0.05 : 0;
  var emergencyMonths = AppState.monthlyIncome > 0
    ? AppState.emergency.current / AppState.monthlyIncome
    : AppState.emergency.monthsCovered;

  var raw = {
    age:                   AppState.age,
    annual_income:         annualIncome,
    net_worth:             netWorth,
    monthly_debt:          monthlyDebt,
    monthly_savings:       AppState.monthlySavings,
    emergency_fund_months: emergencyMonths,
    monthly_spending:      AppState.monthlySpending,
    spending_volatility:   AppState.spendingVolatility,
    panic_sell_12m:        AppState.panicSell,
    total_investment:      AppState.portfolio.value,
    investment_return:     AppState.investmentReturn,
  };

  var result = runFHIPipeline(raw);
  if (result.success && typeof syncAllScreens === 'function') {
    syncAllScreens(result.results);
  }
}

/* =============================================
   COMMIT — update DOM then recalculate FHI
   ============================================= */
function commitStateChange(fhiRelevant) {
  updateDOMFromState();
  if (fhiRelevant !== false) {
    setTimeout(autoRecalculateFHI, 0);
  }
}

/* =============================================
   ACTION: SEND MONEY
   ============================================= */
function openSendModal() {
  showModal({
    title: '\u2191 Send Money',
    body: '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Amount (S$)</label>' +
        '<input class="pulsefi-form-input" id="send-amount" type="number" min="1" step="0.01" placeholder="0.00">' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Recipient name</label>' +
        '<input class="pulsefi-form-input" id="send-recipient" type="text" placeholder="e.g. Alex Tan">' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Note (optional)</label>' +
        '<input class="pulsefi-form-input" id="send-note" type="text" placeholder="e.g. Dinner split">' +
      '</div>' +
      '<div class="pulsefi-balance-note">Available: <strong>' + actionFmt(AppState.balance, 2) + '</strong></div>',
    confirmLabel: 'Send',
    onConfirm: function() {
      var amount    = parseFloat(document.getElementById('send-amount').value);
      var recipient = (document.getElementById('send-recipient').value.trim()) || 'recipient';
      if (isNaN(amount) || amount <= 0)    return showToast('Enter a valid amount', 'error');
      if (amount > AppState.balance)        return showToast('Insufficient balance', 'error');
      AppState.balance         -= amount;
      AppState.monthlySpending += amount;
      AppState.monthlySavings   = Math.max(0, AppState.monthlySavings - amount);
      AppState.transactions.unshift({ type: 'send', amount: amount, to: recipient, time: new Date() });
      closeModal();
      commitStateChange(true);
      showToast('Sent ' + actionFmt(amount, 2) + ' to ' + recipient);
    }
  });
}

/* =============================================
   ACTION: RECEIVE MONEY
   ============================================= */
function openReceiveModal() {
  showModal({
    title: '\u2193 Receive Money',
    body: '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Amount (S$)</label>' +
        '<input class="pulsefi-form-input" id="recv-amount" type="number" min="1" step="0.01" placeholder="0.00">' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">From</label>' +
        '<input class="pulsefi-form-input" id="recv-from" type="text" placeholder="e.g. Employer / Friend">' +
      '</div>' +
      '<div class="pulsefi-balance-note">Current balance: <strong>' + actionFmt(AppState.balance, 2) + '</strong></div>',
    confirmLabel: 'Confirm',
    onConfirm: function() {
      var amount = parseFloat(document.getElementById('recv-amount').value);
      var from   = (document.getElementById('recv-from').value.trim()) || 'sender';
      if (isNaN(amount) || amount <= 0) return showToast('Enter a valid amount', 'error');
      AppState.balance         += amount;
      AppState.monthlySavings  += amount;
      AppState.transactions.unshift({ type: 'receive', amount: amount, from: from, time: new Date() });
      closeModal();
      commitStateChange(true);
      showToast('Received ' + actionFmt(amount, 2) + ' from ' + from);
    }
  });
}

/* =============================================
   ACTION: PAY BILL
   ============================================= */
function openPayModal() {
  showModal({
    title: '\u2299 Pay a Bill',
    body: '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Bill type</label>' +
        '<select class="pulsefi-form-input" id="pay-type">' +
          '<option>Rent</option>' +
          '<option>Utilities</option>' +
          '<option>Transport / EZ-Link</option>' +
          '<option>Food &amp; Groceries</option>' +
          '<option>Entertainment</option>' +
          '<option>Insurance</option>' +
          '<option>Other</option>' +
        '</select>' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Amount (S$)</label>' +
        '<input class="pulsefi-form-input" id="pay-amount" type="number" min="1" step="0.01" placeholder="0.00">' +
      '</div>' +
      '<div class="pulsefi-balance-note">Available: <strong>' + actionFmt(AppState.balance, 2) + '</strong></div>',
    confirmLabel: 'Pay Now',
    confirmClass: 'btn--orange',
    onConfirm: function() {
      var amount   = parseFloat(document.getElementById('pay-amount').value);
      var billType = document.getElementById('pay-type').value;
      if (isNaN(amount) || amount <= 0) return showToast('Enter a valid amount', 'error');
      if (amount > AppState.balance)     return showToast('Insufficient balance', 'error');
      AppState.balance         -= amount;
      AppState.monthlySpending += amount;
      AppState.monthlySavings   = Math.max(0, AppState.monthlySavings - amount);
      AppState.transactions.unshift({ type: 'pay', amount: amount, for: billType, time: new Date() });
      closeModal();
      commitStateChange(true);
      showToast('Paid ' + actionFmt(amount, 2) + ' for ' + billType);
    }
  });
}

/* =============================================
   ACTION: TOP UP
   ============================================= */
function openTopUpModal() {
  showModal({
    title: '+ Top Up Account',
    body: '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Amount (S$)</label>' +
        '<input class="pulsefi-form-input" id="topup-amount" type="number" min="1" step="0.01" placeholder="0.00">' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Source</label>' +
        '<select class="pulsefi-form-input" id="topup-source">' +
          '<option>Bank Transfer</option>' +
          '<option>PayNow / FAST</option>' +
          '<option>Cash Deposit</option>' +
        '</select>' +
      '</div>',
    confirmLabel: 'Top Up',
    onConfirm: function() {
      var amount = parseFloat(document.getElementById('topup-amount').value);
      if (isNaN(amount) || amount <= 0) return showToast('Enter a valid amount', 'error');
      AppState.balance        += amount;
      AppState.monthlySavings += amount;
      closeModal();
      commitStateChange(true);
      showToast('Account topped up by ' + actionFmt(amount, 2));
    }
  });
}

/* =============================================
   ACTION: ADD MONEY TO GOAL
   ============================================= */
function openAddToGoalModal(goalKey) {
  var cfgMap = {
    emergency: {
      name:    '\uD83D\uDEE1 Emergency Pot',
      current: AppState.emergency.current,
      target:  AppState.emergency.target,
      btnClass:'btn--orange',
      apply:   function(amt) {
        AppState.emergency.current += amt;
        AppState.emergency.monthsCovered = AppState.monthlyIncome > 0
          ? AppState.emergency.current / AppState.monthlyIncome
          : AppState.emergency.monthsCovered;
      }
    },
    invest: {
      name:    '\uD83D\uDCC8 Safe to Invest',
      current: AppState.safeToInvest.current,
      target:  AppState.safeToInvest.target,
      btnClass:'btn--primary',
      apply:   function(amt) { AppState.safeToInvest.current += amt; }
    },
    holiday: {
      name:    '\u2708\uFE0F Holiday Fund',
      current: AppState.holiday.current,
      target:  AppState.holiday.target,
      btnClass:'btn--purple',
      apply:   function(amt) { AppState.holiday.current += amt; }
    },
  };

  var cfg = cfgMap[goalKey];
  if (!cfg) return;

  var pctNow = pctOf(cfg.current, cfg.target);

  showModal({
    title: '+ Add Money \u2014 ' + cfg.name,
    body: '<div class="pulsefi-goal-progress">' +
        '<div class="pulsefi-goal-progress__labels">' +
          '<span>' + actionFmt(cfg.current, 0) + '</span>' +
          '<span>' + actionFmt(cfg.target, 0)  + '</span>' +
        '</div>' +
        '<div class="progress-bar" style="margin:6px 0 4px;">' +
          '<div class="progress-bar__fill" style="width:' + pctNow + '%;background:var(--color-accent-teal);"></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:16px;">' + pctNow + '% complete</div>' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">How much to add? (S$)</label>' +
        '<input class="pulsefi-form-input" id="goal-amount" type="number" min="1" step="0.01" placeholder="0.00">' +
      '</div>' +
      '<div class="pulsefi-balance-note">Available balance: <strong>' + actionFmt(AppState.balance, 2) + '</strong></div>',
    confirmLabel: 'Add Money',
    confirmClass: cfg.btnClass,
    onConfirm: function() {
      var amount = parseFloat(document.getElementById('goal-amount').value);
      if (isNaN(amount) || amount <= 0)  return showToast('Enter a valid amount', 'error');
      if (amount > AppState.balance)      return showToast('Insufficient balance', 'error');
      AppState.balance        -= amount;
      AppState.monthlySavings  = Math.max(0, AppState.monthlySavings - amount);
      cfg.apply(amount);
      closeModal();
      commitStateChange(true);
      showToast('Added ' + actionFmt(amount, 2) + ' to ' + cfg.name);
    }
  });
}

/* =============================================
   ACTION: MOVE TO INVESTMENT
   ============================================= */
function openMoveToInvestModal() {
  var amount = AppState.first1k.current;
  showModal({
    title: '\u2197 Move to Investment',
    body: '<div style="text-align:center;padding:16px 0;">' +
        '<div style="font-size:36px;margin-bottom:8px;">\uD83C\uDF89</div>' +
        '<div style="font-size:26px;font-weight:700;color:var(--color-text-primary);margin-bottom:4px;">' + actionFmt(amount, 0) + '</div>' +
        '<div style="color:var(--color-text-secondary);font-size:14px;margin-bottom:20px;">Ready to invest</div>' +
        '<p style="font-size:14px;line-height:1.6;color:var(--color-text-secondary);">Moving this into your portfolio increases your investment ratio — the strongest predictor of long-term financial health in the FHI model.</p>' +
      '</div>' +
      '<div class="pulsefi-form-group" style="margin-top:8px;">' +
        '<label class="pulsefi-form-label">Invest in</label>' +
        '<select class="pulsefi-form-input" id="invest-target">' +
          '<option>Global Index (Vanguard FTSE All World)</option>' +
          '<option>S&amp;P 500 ETF (CSPX)</option>' +
          '<option>Singapore Bonds (SGS)</option>' +
          '<option>Cash Reserve (Easy Access ISA)</option>' +
        '</select>' +
      '</div>',
    confirmLabel: 'Confirm Investment',
    confirmClass: 'btn--primary',
    onConfirm: function() {
      var target = document.getElementById('invest-target').value;
      AppState.portfolio.value += amount;
      AppState.first1k.current  = 0;
      AppState.investmentReturn = AppState.portfolio.returnPct;
      closeModal();
      commitStateChange(true);
      showToast(actionFmt(amount, 0) + ' invested in ' + target.split('(')[0].trim());
    }
  });
}

/* =============================================
   ACTION: TALK TO SPECIALIST
   ============================================= */
function openSpecialistModal() {
  showModal({
    title: '\uD83D\uDCBC Talk to a Specialist',
    body: '<div style="text-align:center;margin-bottom:20px;">' +
        '<div style="font-size:40px;">\uD83D\uDC69\u200D\uD83D\uDCBC</div>' +
        '<p style="color:var(--color-text-secondary);font-size:14px;margin-top:10px;line-height:1.6;">Our certified financial planners can help with mortgages, wealth planning, CPF optimisation, insurance reviews, and more.</p>' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">What do you need help with?</label>' +
        '<select class="pulsefi-form-input" id="spec-topic">' +
          '<option>Investment Strategy</option>' +
          '<option>Mortgage Planning</option>' +
          '<option>CPF Optimisation</option>' +
          '<option>Insurance Review</option>' +
          '<option>General Wealth Planning</option>' +
          '<option>Debt Management</option>' +
        '</select>' +
      '</div>' +
      '<div class="pulsefi-form-group">' +
        '<label class="pulsefi-form-label">Preferred time</label>' +
        '<select class="pulsefi-form-input" id="spec-time">' +
          '<option>Morning (9am \u2013 12pm)</option>' +
          '<option>Afternoon (12pm \u2013 5pm)</option>' +
          '<option>Evening (5pm \u2013 8pm)</option>' +
        '</select>' +
      '</div>' +
      '<div class="pulsefi-info-note">\u2713 Free 30-minute session \u00B7 Video or in-branch \u00B7 No obligations</div>',
    confirmLabel: 'Request Callback',
    onConfirm: function() {
      var topic = document.getElementById('spec-topic').value;
      closeModal();
      showToast('Request sent! A specialist will contact you about ' + topic + '.');
    }
  });
}

/* =============================================
   ACTION: NOTIFICATIONS
   ============================================= */
function updateNotificationBadge() {
  var unreadCount = AppState.notifications.filter(function(n) { return n.unread; }).length;
  var bellBtn = document.querySelector('.btn-icon--notification');
  if (!bellBtn) return;
  var badge = bellBtn.querySelector('.notif-badge');
  if (unreadCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notif-badge';
      bellBtn.style.position = 'relative';
      bellBtn.appendChild(badge);
    }
    badge.textContent = unreadCount;
  } else {
    if (badge) badge.remove();
  }
}

function openNotificationsModal() {
  AppState.notifications.forEach(function(n) { n.unread = false; });

  var notifHTML = AppState.notifications.map(function(n) {
    return '<div class="pulsefi-notif-item">' +
      '<div class="pulsefi-notif-icon">' + n.icon + '</div>' +
      '<div class="pulsefi-notif-content">' +
        '<div class="pulsefi-notif-title">' + n.title + '</div>' +
        '<div class="pulsefi-notif-body">'  + n.body  + '</div>' +
        '<div class="pulsefi-notif-time">'  + n.time  + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  showModal({
    title: '\uD83D\uDD14 Notifications',
    body: notifHTML || '<p style="text-align:center;color:var(--color-text-secondary);padding:20px 0;">No notifications yet</p>',
    hideCancelFooter: true,
  });

  updateNotificationBadge();
}

/* =============================================
   ACTION: SETTINGS
   ============================================= */
function openSettingsModal() {
  var u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
  var fullName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || AppState.firstName;
  var email    = u.email || (AppState.firstName.toLowerCase() + '@pulsefi.com');

  showModal({
    title: '\u2699\uFE0F Settings',
    body: '<div class="pulsefi-settings-section">' +
        '<div class="pulsefi-settings-title">Profile</div>' +
        '<div class="pulsefi-form-group">' +
          '<label class="pulsefi-form-label">Full name</label>' +
          '<input class="pulsefi-form-input" id="settings-name" type="text" value="' + fullName + '">' +
        '</div>' +
        '<div class="pulsefi-form-group">' +
          '<label class="pulsefi-form-label">Email</label>' +
          '<input class="pulsefi-form-input" id="settings-email" type="email" value="' + email + '">' +
        '</div>' +
      '</div>' +
      '<div class="pulsefi-settings-section" style="margin-top:20px;">' +
        '<div class="pulsefi-settings-title">Preferences</div>' +
        '<div class="pulsefi-toggle-row"><span>Weekly financial summary</span><label class="pulsefi-toggle"><input type="checkbox" checked><span class="pulsefi-toggle-slider"></span></label></div>' +
        '<div class="pulsefi-toggle-row"><span>FHI Engine auto-sync</span><label class="pulsefi-toggle"><input type="checkbox" checked><span class="pulsefi-toggle-slider"></span></label></div>' +
        '<div class="pulsefi-toggle-row"><span>Pulse AI recommendations</span><label class="pulsefi-toggle"><input type="checkbox" checked><span class="pulsefi-toggle-slider"></span></label></div>' +
      '</div>' +
      '<div class="pulsefi-settings-section" style="margin-top:20px;">' +
        '<div class="pulsefi-settings-title">Security</div>' +
        '<button class="btn btn--ghost" style="width:100%;margin-bottom:8px;" onclick="showToast(\'PIN change coming soon\',\'info\')">Change PIN</button>' +
        '<button class="btn btn--ghost" style="width:100%;" onclick="showToast(\'Biometrics coming soon\',\'info\')">Enable Face ID / Biometrics</button>' +
      '</div>',
    confirmLabel: 'Save Changes',
    cancelLabel: 'Close',
    onConfirm: function() {
      closeModal();
      showToast('Settings saved');
    }
  });
}

/* =============================================
   ACTION: MANAGE HOLDINGS
   ============================================= */
function openManageHoldingsModal() {
  var holdings = AppState.portfolio.holdings;
  var holdingsHTML;

  if (holdings.length > 0) {
    holdingsHTML = holdings.map(function(h) {
      var chg = Number(h.change_pct || 0);
      return '<div class="pulsefi-holding-row">' +
        '<div class="pulsefi-holding-name">' +
          '<div style="font-weight:600;font-size:14px;">' + (h.name || 'Fund') + '</div>' +
          '<div style="font-size:12px;color:var(--color-text-secondary);">' + (h.fund || '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-weight:600;">' + actionFmt(Number(h.amount || 0), 0) + '</div>' +
          '<div style="font-size:12px;color:' + (chg >= 0 ? 'var(--color-accent-green)' : '#E74C3C') + ';">' +
            (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    holdingsHTML = '<p style="text-align:center;color:var(--color-text-secondary);padding:20px 0;">No holdings yet. Use \u201CMove to Investment\u201D to start.</p>';
  }

  showModal({
    title: '\uD83D\uDCCA Manage Holdings',
    body: '<div style="margin-bottom:16px;">' +
        '<div style="font-size:13px;color:var(--color-text-secondary);">Total portfolio value</div>' +
        '<div style="font-size:28px;font-weight:700;color:var(--color-text-primary);">' + actionFmt(AppState.portfolio.value, 2) + '</div>' +
        '<div style="font-size:13px;color:var(--color-accent-green);">\u2197 +' + AppState.investmentReturn.toFixed(1) + '% all time</div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--color-border);padding-top:16px;">' + holdingsHTML + '</div>' +
      '<div class="pulsefi-info-note" style="margin-top:16px;">Holdings update daily. Past performance is not indicative of future results.</div>',
    confirmLabel: 'Buy / Sell',
    cancelLabel: 'Close',
    onConfirm: function() {
      closeModal();
      showToast('Trading coming soon \u2014 contact a Specialist for now.', 'info');
    }
  });
}

/* =============================================
   WIRE UP ALL BUTTONS
   ============================================= */
function initActionButtons() {
  // Quick action tiles (Send / Receive / Pay / Top Up)
  document.querySelectorAll('.quick-action').forEach(function(el) {
    var label = (el.querySelector('.quick-action__label') || {}).textContent || '';
    label = label.trim();
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      if      (label === 'Send')    openSendModal();
      else if (label === 'Receive') openReceiveModal();
      else if (label === 'Pay')     openPayModal();
      else if (label === 'Top Up')  openTopUpModal();
    });
  });

  // Goal card buttons
  document.querySelectorAll('.goal-card').forEach(function(card) {
    var btn = card.querySelector('.btn--full');
    if (!btn) return;

    if (btn.textContent.indexOf('Move to Investment') !== -1) {
      btn.addEventListener('click', openMoveToInvestModal);
      return;
    }

    var goalKey = 'emergency';
    if (card.id === 'goal-card-invest' || card.querySelector('.goal-card__icon--invest')) {
      goalKey = 'invest';
    } else if (card.querySelector('.goal-card__icon--holiday')) {
      goalKey = 'holiday';
    }

    btn.addEventListener('click', function() { openAddToGoalModal(goalKey); });
  });

  // "Build Buffer" button inside emergency alert banner on home screen
  var buildBufferBtn = document.querySelector('.alert-banner--warning .btn--orange');
  if (buildBufferBtn) {
    buildBufferBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openAddToGoalModal('emergency');
    });
  }

  // Specialist buttons (pulse + invest screens)
  document.querySelectorAll('.specialist-btn').forEach(function(btn) {
    btn.addEventListener('click', openSpecialistModal);
  });

  // Pulse AI rec card CTAs — event delegation
  var recsContainer = document.getElementById('recommendations-container');
  if (recsContainer) {
    recsContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('[class*="btn"]');
      if (btn && recsContainer.contains(btn)) openSpecialistModal();
    });
  }

  // Notification bell
  var bellBtn = document.querySelector('.btn-icon--notification');
  if (bellBtn) bellBtn.addEventListener('click', openNotificationsModal);

  // Settings gear
  document.querySelectorAll('.topbar__right .btn-icon').forEach(function(btn) {
    if ((btn.getAttribute('aria-label') || '').toLowerCase() === 'settings') {
      btn.addEventListener('click', openSettingsModal);
    }
  });

  // Manage holdings link
  var manageLink = document.querySelector('.holdings-card .card__link');
  if (manageLink) {
    manageLink.style.cursor = 'pointer';
    manageLink.addEventListener('click', openManageHoldingsModal);
  }

  // Initial notification badge
  updateNotificationBadge();
}

/* =============================================
   HOOK — called by app.js after user data loads
   ============================================= */
function onUserDataLoaded(user) {
  initAppState(user);
  initActionButtons();
  // Run initial silent FHI sync so all screens start up-to-date
  setTimeout(autoRecalculateFHI, 300);
}
