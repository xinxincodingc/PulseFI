/**
 * PulseFi — Dashboard Interactivity
 * Sidebar Navigation, Charts, Animations
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initInternalLinks();
  initMobileMenu();
  animateProgressBars();
  // Charts are drawn when Invest tab shows
});

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

const screenGreetings = {
  home: 'Good morning, Mia 👋',
  health: 'Your health score and breakdown',
  pulse: 'Personalised recommendations based on your data',
  goals: 'Track and grow your savings goals',
  invest: 'Your investment overview'
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
  if (greetingEl) greetingEl.textContent = screenGreetings[target] || '';

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

  const data = [3200, 3400, 3800, 3600, 4100, 4280];
  const min = Math.min(...data) - 200;
  const max = Math.max(...data) + 200;

  const points = data.map((v, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - ((v - min) / (max - min)) * chartH
  }));

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.2)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.01)');

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(points[0].x, h);
  drawSmoothLine(ctx, points);
  ctx.lineTo(points[points.length - 1].x, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw line
  ctx.beginPath();
  drawSmoothLine(ctx, points);
  ctx.strokeStyle = '#6C5CE7';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // End dot
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

  const segments = [
    { value: 60, color: '#4A90D9' },
    { value: 25, color: '#6C5CE7' },
    { value: 15, color: '#00B894' },
  ];

  const total = segments.reduce((s, seg) => s + seg.value, 0);
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
