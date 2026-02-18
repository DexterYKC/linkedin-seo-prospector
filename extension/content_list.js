// ==================================================
// SEO LinkedIn Prospector
// content_list.js — PASSIVE LIST SCANNER (PROD-READY)
// - Scans visible LinkedIn profile cards (no click, no scroll)
// - Works on /mynetwork, /search, lists
// - SPA-safe, throttled, deduplicated
// ==================================================
(() => {
  "use strict";

  if (window.__SEO_LIST_LOADED__) return;
  window.__SEO_LIST_LOADED__ = true;

  const LOG = "[SEO-LIST]";
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  // ===== CONFIG =====
  const SCAN_INTERVAL_MS = 1200;
  const MAX_PER_PAGE = 40;
  const MUTATION_DEBOUNCE_MS = 400;

  // ===== STATE =====
  const seenProfiles = new Set();
  let sentCount = 0;
  let lastPath = location.pathname;

  // ===== HELPERS =====
  const qs = (sel, root = document) => {
    try {
      return root.querySelector(sel);
    } catch {
      return null;
    }
  };

  const qsa = (sel, root = document) => {
    try {
      return Array.from(root.querySelectorAll(sel));
    } catch {
      return [];
    }
  };

  const text = (el) =>
    el ? (el.innerText || el.textContent || "").trim() : null;

  const normalizeProfileUrl = (href) => {
    if (!href) return null;
    try {
      const u = new URL(href, "https://www.linkedin.com");
      if (!u.pathname.startsWith("/in/")) return null;

      // ❗ FIX SYNTAX (otherwise script crashes)
      return `https://www.linkedin.com${u.pathname.replace(/\/$/, "")}`;
    } catch {
      return null;
    }
  };

  const canSend = () =>
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    typeof chrome.runtime.sendMessage === "function";

  // ===== CARD EXTRACTION =====
  function extractFromCard(card) {
    const a =
      qs('a[href^="/in/"]', card) ||
      qs('a[href*="/in/"]', card);

    const profileUrl = normalizeProfileUrl(a?.getAttribute("href"));
    if (!profileUrl) return null;

    // Name — try multiple selectors for old + new LinkedIn UI
    const name =
      text(qs("span[aria-hidden='true']", card)) ||
      text(qs(".entity-result__title-line span[aria-hidden='true']", card)) ||
      text(qs("span.entity-result__title-text", card)) ||
      text(qs(".artdeco-entity-lockup__title span[aria-hidden='true']", card)) ||
      text(qs(".search-results__result-item span[aria-hidden='true']", card)) ||
      text(a);

    // Headline
    const headline =
      text(qs(".entity-result__primary-subtitle", card)) ||
      text(qs(".entity-result__summary", card)) ||
      text(qs(".artdeco-entity-lockup__subtitle span", card)) ||
      null;

    // Company
    const company =
      text(qs(".entity-result__secondary-subtitle", card)) ||
      text(qs(".artdeco-entity-lockup__metadata span", card)) ||
      null;

    // Avatar — grab from card img if available
    const avatarImg =
      qs('img[src*="media.licdn.com/dms/image"]', card) ||
      qs("img.presence-entity__image", card) ||
      qs("img.entity-result__universal-image", card) ||
      null;
    const avatarUrl = avatarImg?.src || null;

    return {
      profileUrl,
      name,
      headline,
      company,
      avatarUrl,
      source: "linkedin_list",
      capturedAt: new Date().toISOString(),
    };
  }

  // ===== SEND =====
  function send(payload) {
    if (!canSend()) return;

    chrome.runtime.sendMessage(
      { type: "LIST_PROFILE_FOUND", payload },
      () => {
        const err = chrome.runtime.lastError;
        if (err) warn("sendMessage error:", err.message);
      }
    );
  }

  // ===== SCAN =====
  function scanOnce() {
    if (sentCount >= MAX_PER_PAGE) return;

    const cards = qsa([
      ".entity-result",
      ".reusable-search__result-container",
      ".search-results__result-item",
      ".artdeco-list__item",
      ".mn-connection-card",
      ".discover-entity-card",
    ].join(", "));

    for (const card of cards) {
      if (sentCount >= MAX_PER_PAGE) break;

      const data = extractFromCard(card);
      if (!data?.profileUrl) continue;
      if (seenProfiles.has(data.profileUrl)) continue;

      seenProfiles.add(data.profileUrl);
      sentCount++;

      log("Profile found:", data.profileUrl);
      send(data);
    }
  }

  // ===== SPA WATCHERS =====
  function startScanner() {
    setInterval(scanOnce, SCAN_INTERVAL_MS);
  }

  function hookPathWatcher() {
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        seenProfiles.clear();
        sentCount = 0;
        log("Path changed → reset scan");
      }
    }, 500);
  }

  function hookDomObserver() {
    let debounceTimer = null;
    const obs = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanOnce, MUTATION_DEBOUNCE_MS);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ===== BOOT =====
  log("injected");

  hookPathWatcher();
  hookDomObserver();
  startScanner();
})();
