/**
 * pulse-ai.js
 * ============
 * PulseFi — Pulse AI Recommendations Loader
 * ------------------------------------------
 * This file replaces any hardcoded recommendation data in your existing
 * pulse-ai page. It fetches recommendations.json (pre-generated offline)
 * and renders the 3 recommendation cards that match the UI in your screenshots.
 *
 * HOW TO USE:
 *   1. Place recommendations.json in your project root (next to index.html)
 *   2. Add this script to your pulse-ai.html:
 *        <script src="pulse-ai.js"></script>
 *   3. Make sure your recommendation cards have the container id:
 *        <div id="recommendations-container"></div>
 *
 * USER SWITCHING:
 *   The active user is read from localStorage key "pulsefi_user_id".
 *   Set it on login with: localStorage.setItem("pulsefi_user_id", "GZ00001")
 *   Falls back to "GZ00001" for demo purposes.
 */

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const RECS_JSON_PATH = "./recommendations.json";   // relative to index.html
const DEFAULT_USER   = "GZ00001";                  // fallback for demo/testing


// ─────────────────────────────────────────────
// STATUS BADGE CONFIG
// Maps status string → colour class + emoji
// These class names should match what you already have in your CSS
// ─────────────────────────────────────────────

const STATUS_CONFIG = {
  "URGENT":   { className: "status-urgent",   emoji: "⚡" },
  "READY":    { className: "status-ready",    emoji: "📈" },
  "ON TRACK": { className: "status-on-track", emoji: "✅" },
};


// ─────────────────────────────────────────────
// RENDER — build HTML for a single rec card
// Matches the card layout shown in your Pulse AI screenshot
// ─────────────────────────────────────────────

/**
 * Renders one recommendation card as an HTML string.
 * @param {Object} rec - Single recommendation object from JSON
 * @param {number} index - Card index (0, 1, 2) for animation delay
 * @returns {string} HTML string for the card
 */
function renderRecCard(rec, index) {
  const statusConfig = {
    "URGENT":   { cls: "reco-card__badge--urgent", label: "⚡ URGENT",   iconCls: "reco-card__icon--shield" },
    "READY":    { cls: "reco-card__badge--ready",  label: "READY",       iconCls: "reco-card__icon--chart" },
    "ON TRACK": { cls: "reco-card__badge--track",  label: "ON TRACK",    iconCls: "reco-card__icon--check" },
  };
  const s = statusConfig[rec.status] || statusConfig["READY"];

  return `
    <div class="reco-card">
      <div class="reco-card__icon ${s.iconCls}"></div>
      <div class="reco-card__badge ${s.cls}">${s.label}</div>
      <h3 class="reco-card__title">${rec.title}</h3>
      <p class="reco-card__text">${rec.description}</p>
      <div class="reco-card__actions">
        <button class="btn btn--primary">
          <span class="btn-label">${rec.action1_label}</span>
          <span class="btn-sublabel">${rec.action1_sub}</span>
        </button>
        <button class="btn btn--outline">
          <span class="btn-label">${rec.action2_label}</span>
          <span class="btn-sublabel">${rec.action2_sub}</span>
        </button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// RENDER — inject all 3 cards into the DOM
// ─────────────────────────────────────────────

/**
 * Renders all recommendation cards for a user into #recommendations-container.
 * @param {Array} recs - Array of 3 recommendation objects
 */
function renderRecommendations(recs) {
  const container = document.getElementById("recommendations-container");

  if (!container) {
    console.error("PulseFi: Could not find #recommendations-container in DOM.");
    return;
  }

  // Build all 3 cards and inject
  container.innerHTML = recs.map((rec, i) => renderRecCard(rec, i)).join("");
}


// ─────────────────────────────────────────────
// RENDER — loading state while fetch is in flight
// ─────────────────────────────────────────────

function showLoadingState() {
  const container = document.getElementById("recommendations-container");
  if (!container) return;

  // 3 skeleton cards to match the layout
  container.innerHTML = `
    <div class="rec-card skeleton"></div>
    <div class="rec-card skeleton"></div>
    <div class="rec-card skeleton"></div>
  `;
}


// ─────────────────────────────────────────────
// RENDER — error state if fetch or parse fails
// ─────────────────────────────────────────────

function showErrorState(message) {
  const container = document.getElementById("recommendations-container");
  if (!container) return;

  container.innerHTML = `
    <div class="rec-error">
      <p>⚠️ Could not load recommendations.</p>
      <small>${message}</small>
    </div>
  `;
}


// ─────────────────────────────────────────────
// ACTION HANDLER
// Called when user taps a CTA button on a rec card
// Wire this up to your actual navigation / modals
// ─────────────────────────────────────────────

/**
 * Handles button clicks on recommendation cards.
 * Replace the console.log calls with your actual navigation logic.
 * @param {string} label - Button label e.g. "Add £50/month"
 * @param {string} sub   - Button sub-label e.g. "Auto-save"
 */
function handleAction(label, sub) {
  console.log(`PulseFi action: ${label} — ${sub}`);

  // ── Example: route to different pages based on action ──
  // Uncomment and adapt these to match your actual page structure

  // if (label.toLowerCase().includes("save") || sub.toLowerCase().includes("auto-save")) {
  //   window.location.href = "./savings-goals.html";
  // } else if (label.toLowerCase().includes("invest") || sub.toLowerCase().includes("isa")) {
  //   window.location.href = "./investments.html";
  // } else if (label.toLowerCase().includes("specialist")) {
  //   window.location.href = "./specialist.html";
  // }
}


// ─────────────────────────────────────────────
// MAIN — fetch JSON and render
// ─────────────────────────────────────────────

/**
 * Entry point. Reads the active user ID from localStorage,
 * fetches recommendations.json, extracts that user's 3 recs,
 * and renders them into the page.
 */
async function loadPulseRecommendations() {

  // Get the active user — set this on login via localStorage
  function getUserIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || localStorage.getItem("pulsefi_user_id") || DEFAULT_USER;
}
const userId = getUserIdFromURL();
localStorage.setItem("pulsefi_user_id", userId);
  console.log(`PulseFi: Loading recommendations for user ${userId}`);

  // Show skeleton cards while loading
  showLoadingState();

  try {
    // Fetch the pre-generated recommendations file
    // This is a plain static file — works on GitHub Pages / Vercel with no backend
    const response = await fetch(RECS_JSON_PATH);

    if (!response.ok) {
      throw new Error(`Could not fetch ${RECS_JSON_PATH} (HTTP ${response.status}). 
        Make sure recommendations.json is in your project root.`);
    }

    const allRecs = await response.json();

    // Look up this specific user's recommendations
    const userRecs = allRecs[userId];

    if (!userRecs) {
      throw new Error(`No recommendations found for user ${userId}. 
        Check that the batch script ran for this user ID.`);
    }

    // Render the 3 cards
    renderRecommendations(userRecs);
    console.log(`PulseFi: ✅ Loaded ${userRecs.length} recommendations for ${userId}`);

  } catch (err) {
    console.error("PulseFi recommendations error:", err);
    showErrorState(err.message);
  }
}


// ─────────────────────────────────────────────
// INIT — run when DOM is ready
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", loadPulseRecommendations);


// ─────────────────────────────────────────────
// HELPER — call this from your login flow
// Sets the active user and reloads recommendations
// ─────────────────────────────────────────────

/**
 * Sets the active user and refreshes the recommendations display.
 * Call this after login or when switching demo users.
 * @param {string} userId - e.g. "GZ00001"
 */
function setActiveUser(userId) {
  localStorage.setItem("pulsefi_user_id", userId);
  loadPulseRecommendations();
}
