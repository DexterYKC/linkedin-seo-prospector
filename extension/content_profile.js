// ==================================================
// SEO LinkedIn Prospector
// content_profile.js â€” V10.1 STABLE (Apollo-first + stable buffer + single send)
// GOAL: Name + Headline + Current Position (company + optional /company/ URL)
// - Apollo-first (window.__APOLLO_STATE__) with heuristics (no fragile selectors)
// - Stabilization buffer: waits for "best payload" then sends ONCE
// - No regression: never overwrites a better payload with a worse one
// - SPA-safe: detects LinkedIn navigation and re-captures
// ==================================================

(() => {
  "use strict";

  const RUNTIME_ID = chrome?.runtime?.id || "no-runtime";

  // ====== HARD STOP: prevent double injection (crucial) ======
  const FLAG = `__SEO_PROFILE_V10_1_STABLE__${RUNTIME_ID}`;
  const DOM_FLAG_ATTR = "data-seo-profile-v10-1-loaded";
  if (window[FLAG]) return;

  const INSTANCE_ID = `${RUNTIME_ID}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  window[FLAG] = INSTANCE_ID;
  if (document.documentElement) {
    document.documentElement.setAttribute(DOM_FLAG_ATTR, INSTANCE_ID);
  }
  window.__SEO_PROFILE_LOADED__ = true;
  window.__SEO_PROFILE_RUNTIME_ID__ = RUNTIME_ID;
  window.__SEO_PROFILE_INSTANCE_ID__ = INSTANCE_ID;

  const LOG = "[SEO-PROFILE-V10.1]";
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  const PROFILE_BASE_REGEX = /^\/in\/([^\/?#]+)/i;

  // ====== TUNING ======
  const INITIAL_DELAY_MS = 900;      // first attempt after nav
  const DEBOUNCE_MS = 650;           // DOM mutation debounce
  const STABILIZE_TIMEOUT_MS = 9000; // max wait for Apollo to fill
  const MIN_SCORE_TO_SEND = 55;      // "good enough" threshold to send early
  const MAX_ATTEMPTS = 18;           // prevent infinite loops

  // ====== RUNTIME STATE ======
  let lastPath = location.pathname;
  let lastCaptureKey = null; // profilePath
  let debounceTimer = null;
  let stabilizeTimer = null;
  let attemptCount = 0;
  let captureStartedAt = Date.now();
  let lastScheduleAt = 0;

  // Best payload buffer (prevents regression)
  let bestPayload = null;
  let bestScore = -1;
  let sentForKey = null; // profilePath that was sent

  const injectedAt = Date.now();
  const sessionId = `${Math.random().toString(16).slice(2)}-${Date.now()}`;

  // ==========================================================
  // Helpers
  // ==========================================================

  const nowISO = () => new Date().toISOString();

  const clean = (s) => {
    if (!s || typeof s !== "string") return null;
    let t = s.replace(/\s+/g, " ").trim();
    if (!t) return null;
    return t;
  };

  const textOf = (v) => {
    if (typeof v === "string") return clean(v);
    if (typeof v === "number") return clean(String(v));
    if (!v || typeof v !== "object") return null;

    const candidates = [
      v.text,
      v.value,
      v.name,
      v.title,
      v.localizedName,
      v.localizedTitle,
      v.displayName,
      v.primaryText,
    ];
    for (const c of candidates) {
      const t = textOf(c);
      if (t) return t;
    }

    if (Array.isArray(v)) {
      for (const item of v) {
        const t = textOf(item);
        if (t) return t;
      }
    }

    return null;
  };

  const isProbablyJunkText = (t) => {
    if (!t) return true;
    const s = t.toLowerCase();

    // Common junk / UI strings we NEVER want as headline
    const bad = [
      "passer au contenu principal",
      "skip to main content",
      "fil d'actualite",
      "fil d’actualite",
      "fil d'actualité",
      "fil d’actualité",
      "feed",
      "home",
      "message",
      "suivre",
      "se connecter",
      "connexion",
      "coordonnÃ©es",
      "coordonnees",
      "coordonnées",
      "plus",
      "premium",
      "options de publicitÃ©s",
      "publicitÃ©",
      "notifications",
      "accueil",
      "mon rÃ©seau",
      "reseau",
      "réseau",
      "messagerie",
      "vous",
      "public profile",
      "premium",
    ];

    if (bad.some((b) => s === b || s.includes(b))) return true;

    // Too short or suspiciously long
    if (t.length < 6) return true;
    if (t.length > 180) return true;

    return false;
  };

  const isLikelyPersonName = (name) => {
    const n = clean(name);
    if (!n) return false;
    if (isProbablyJunkText(n)) return false;

    const low = n.toLowerCase();
    const hardBad = [
      "fil d'actualite",
      "fil d’actualite",
      "fil d'actualité",
      "fil d’actualité",
      "linkedin",
      "coordonnees",
      "coordonnées",
      "network",
      "notifications",
      "accueil",
    ];
    if (hardBad.some((x) => low.includes(x))) return false;

    // Names are usually 2-5 tokens on LinkedIn
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;

    const alphaWords = words.filter((w) => /[a-zA-ZÀ-ÿ]/.test(w));
    if (alphaWords.length < 2) return false;

    if (/[|]/.test(n)) return false;
    return true;
  };

  const profileBasePath = () => {
    const m = location.pathname.match(PROFILE_BASE_REGEX);
    if (!m?.[1]) return null;
    return `/in/${m[1]}`;
  };

  const isProfilePage = () => Boolean(profileBasePath());

  const profileKey = () => profileBasePath();

  const isRuntimeOwner = () =>
    document.documentElement?.getAttribute(DOM_FLAG_ATTR) === INSTANCE_ID;

  const safeSend = (payload) => {
    try {
      if (!isRuntimeOwner()) {
        log("stale runtime owner, skip send");
        return false;
      }
      if (!chrome?.runtime || typeof chrome.runtime.sendMessage !== "function") {
        log("runtime.sendMessage unavailable, cannot send payload");
        return false;
      }
      chrome.runtime.sendMessage({ type: "PROFILE_CAPTURED", payload }, () => {
        const e = chrome?.runtime?.lastError;
        if (e) warn("sendMessage lastError:", e.message || String(e));
      });
      return true;
    } catch (e) {
      warn("sendMessage failed:", e);
      return false;
    }
  };

  const scorePayload = (p) => {
    if (!p) return -1;

    let score = 0;
    if (p.name) score += 25;
    if (p.headline && !isProbablyJunkText(p.headline)) score += 15;

    const pos = Array.isArray(p.currentPositions) ? p.currentPositions : [];
    if (pos.length > 0) score += 25;

    // If we got a company name out of position
    const hasCompany = pos.some((x) => !!x?.companyName);
    if (hasCompany) score += 10;

    // Bonus if we have a /company/ URL or a company URN-ish reference
    const hasCompanyUrl = pos.some((x) => !!x?.companyLinkedinUrl);
    if (hasCompanyUrl) score += 10;

    // Minor bonus: location / education etc (optional)
    if (p.location) score += 3;

    return score;
  };

  const betterThanBest = (candidate) => {
    const s = scorePayload(candidate);
    if (s > bestScore) return true;
    if (s < bestScore) return false;

    // tie-breakers: more positions, longer headline (but not junk)
    const cp = candidate?.currentPositions?.length || 0;
    const bp = bestPayload?.currentPositions?.length || 0;
    if (cp !== bp) return cp > bp;

    const ch = candidate?.headline?.length || 0;
    const bh = bestPayload?.headline?.length || 0;
    if (ch !== bh) return ch > bh;

    return false;
  };

  // ==========================================================
  // Apollo extraction (heuristic, robust to markup changes)
  // ==========================================================

  const getApollo = () => {
    try {
      const ap = window.__APOLLO_STATE__;
      if (ap && typeof ap === "object") return ap;
      return null;
    } catch {
      return null;
    }
  };

  const extractNameHeadlineFromApollo = (apollo) => {
    // Heuristic: find any entity with firstName/lastName and occupation/headline-ish fields
    let best = null;

    for (const [k, v] of Object.entries(apollo)) {
      if (!v || typeof v !== "object") continue;

      const first = textOf(v.firstName);
      const last = textOf(v.lastName);
      const full = textOf(v.name) || textOf(v.publicIdentifier); // fallback-ish

      const occupation =
        textOf(v.occupation) ||
        textOf(v.headline) ||
        textOf(v.tagline) ||
        textOf(v.primaryTitle);

      // Look for a likely profile entity
      const looksLikePerson =
        (first && last) ||
        (full && full.split(" ").length >= 2) ||
        (occupation && (first || last));

      if (!looksLikePerson) continue;

      // Bonus: keys/urns sometimes contain "fsd_profile" or "MiniProfile"
      const keyBonus =
        (k.includes("MiniProfile") ? 2 : 0) +
        (k.includes("fsd_profile") ? 3 : 0) +
        (k.includes("Profile") ? 1 : 0);

      const candidate = {
        name: clean(`${first || ""} ${last || ""}`) || full,
        headline: occupation && !isProbablyJunkText(occupation) ? occupation : null,
        _keyBonus: keyBonus,
      };

      // choose best by: has name + has headline + keyBonus
      const candScore =
        (candidate.name ? 10 : 0) +
        (candidate.headline ? 8 : 0) +
        candidate._keyBonus;

      const bestScore =
        (best?.name ? 10 : 0) +
        (best?.headline ? 8 : 0) +
        (best?._keyBonus || 0);

      if (!best || candScore > bestScore) best = candidate;
    }

    if (!best) return { name: null, headline: null };
    return { name: best.name || null, headline: best.headline || null };
  };

  const normalizeCompanyUrl = (u) => {
    const raw = clean(u);
    if (!raw) return null;
    try {
      const parsed = new URL(raw, location.origin);
      if (!parsed.hostname.endsWith("linkedin.com")) return null;
      if (!parsed.pathname.startsWith("/company/")) return null;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;

      parsed.pathname = `/company/${parts[1]}/`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const normalizeWebsiteUrl = (u) => {
    const raw = clean(u);
    if (!raw) return null;

    const unwrapLinkedinRedirect = (value) => {
      try {
        const parsed = new URL(value, location.origin);
        if (!parsed.hostname.toLowerCase().endsWith("linkedin.com")) return value;
        const encoded =
          parsed.searchParams.get("url") ||
          parsed.searchParams.get("redirect") ||
          parsed.searchParams.get("dest");
        if (!encoded) return null;
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded;
        }
      } catch {
        return value;
      }
    };

    const unwrapped = unwrapLinkedinRedirect(raw);
    if (!unwrapped) return null;

    try {
      const parsed = new URL(unwrapped, location.origin);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      const host = parsed.hostname.toLowerCase();
      const hostMatchesBlocked = (h, token) => {
        const t = String(token || "").toLowerCase();
        if (!h || !t) return false;
        if (t.endsWith(".")) {
          const base = t.slice(0, -1);
          if (!base) return false;
          return h === base || h.includes(`${base}.`);
        }
        return h === t || h.endsWith(`.${t}`);
      };
      const blocked = [
        "linkedin.com",
        "facebook.com",
        "instagram.com",
        "x.com",
        "twitter.com",
        "youtube.com",
        "tiktok.com",
        "bing.com",
        "google.com",
      ];
      if (blocked.some((b) => hostMatchesBlocked(host, b))) return null;
      parsed.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((p) =>
        parsed.searchParams.delete(p)
      );
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const companyUrlFromUrn = (urn) => {
    const raw = clean(urn);
    if (!raw) return null;
    const m = raw.match(/:(?:fs_miniCompany|company|fs_salesCompany):(\d+)/i);
    if (!m?.[1]) return null;
    return `https://www.linkedin.com/company/${m[1]}/`;
  };

  const sanitizeCompanyName = (value) => {
    let t = clean(textOf(value));
    if (!t) return null;

    t = t.split(" · ")[0] || t;
    t = t.split(" • ")[0] || t;
    t = t.split("|")[0] || t;
    t = t.replace(/\b(coordonnées|contact info|universit[eé]|university)\b.*$/i, "").trim();
    t = t.replace(/\s+\((?:remote|hybrid|onsite)\)$/i, "").trim();
    t = t.replace(/\s+(?:paris|tunisie|france|hybride)\b.*$/i, "").trim();
    if (t.includes(",")) {
      const first = clean(t.split(",")[0]);
      if (first && first.length >= 2) t = first;
    }
    if (/\b(\d[\d\s.,]*\s*(abonn[eé]s?|followers?)|abonn[eé]s?|followers?)\b/i.test(t)) {
      return null;
    }
    if (/\b(personnes|relations|connections)\b/i.test(t)) return null;
    return clean(t);
  };

  const sanitizeJobTitle = (value, personName = null) => {
    let t = clean(textOf(value));
    if (!t) return null;

    if (personName) {
      const n = clean(personName);
      if (n && t.toLowerCase().startsWith(`${n.toLowerCase()} · `)) {
        t = t.slice(n.length + 3);
      }
    }

    t = t.split(" · ")[0] || t;
    t = t.split(" • ")[0] || t;
    t = t.split("|")[0] || t;
    t = t.replace(/\s{2,}/g, " ").trim();
    return clean(t);
  };

  const NON_WORK_ENTRY_REGEX =
    /\b(certif(?:ication)?|certificate|licen[cs]e|dipl[oô]me|formation|education|course|cours|comp[ée]tence|skill|badge|exam|test|ef\s*set|toeic|toefl|ielts)\b/i;
  const PRESENT_MARKER_REGEX = /\b(present|current|aujourd['’]hui|a ce jour|à ce jour)\b/i;

  const looksLikeNonWorkEntry = (title, companyName = null) => {
    const t = clean(title) || "";
    const c = clean(companyName) || "";
    const merged = `${t} ${c}`.trim();
    if (!merged) return false;
    return NON_WORK_ENTRY_REGEX.test(merged);
  };

  const firstRelevantLine = (text, personName = null) => {
    const lines = String(text || "")
      .split("\n")
      .map((x) => clean(x))
      .filter(Boolean);

    for (const line of lines) {
      if (personName && clean(personName) === line) continue;
      if (isProbablyJunkText(line)) continue;
      return line;
    }
    return null;
  };

  const dedupeAndRankPositions = (items, limit = 3) => {
    const seen = new Set();
    const normalized = [];
    const looksLikeLocation = (s) =>
      /\b(paris|france|tunisie|hybride|remote|on[- ]site|ville|gouvernorat)\b/i.test(String(s || ""));
    const looksLikeDateLine = (s) =>
      /\b(20\d{2}|19\d{2}|present|current|aujourd['’]hui|janv|fév|mars|avr|mai|juin|juil|ao[uû]t|sept|oct|nov|d[eé]c)\b/i.test(
        String(s || "")
      );
    const isLikelyBadTitle = (title) => {
      const t = clean(title);
      if (!t) return false;
      if (looksLikeDateLine(t)) return true;
      if (looksLikeLocation(t)) return true;
      if (isProbablyJunkText(t)) return true;
      return false;
    };
    const isLikelyBadCompany = (company) => {
      const c = clean(company);
      if (!c) return false;
      if (isProbablyJunkText(c)) return true;
      if (looksLikeDateLine(c)) return true;
      if (/\b(\d[\d\s.,]*\s*(abonn[eé]s?|followers?)|abonn[eé]s?|followers?)\b/i.test(c)) return true;
      if (/\b(coordonn[eé]es|relations|connections|contact)\b/i.test(c)) return true;
      if (c.length < 2) return true;
      return false;
    };

    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || typeof raw !== "object") continue;

      const p = {
        title: sanitizeJobTitle(raw.title) || null,
        companyName: sanitizeCompanyName(raw.companyName) || null,
        companyLinkedinUrl:
          normalizeCompanyUrl(raw.companyLinkedinUrl) ||
          companyUrlFromUrn(raw.companyUrn) ||
          null,
        website:
          normalizeWebsiteUrl(raw.website) ||
          normalizeWebsiteUrl(raw.companyWebsite) ||
          normalizeWebsiteUrl(raw.websiteHint) ||
          null,
        companyUrn: clean(raw.companyUrn) || null,
        isCurrent:
          raw.isCurrent === true || String(raw.isCurrent).toLowerCase() === "true"
            ? true
            : null,
      };

      if (isLikelyBadTitle(p.title)) p.title = null;
      if (isLikelyBadCompany(p.companyName)) p.companyName = null;
      if (looksLikeNonWorkEntry(p.title, p.companyName)) continue;

      if (!p.title && !p.companyName && !p.companyLinkedinUrl && !p.website) continue;

      const key = `${p.title || ""}__${p.companyName || ""}__${p.companyLinkedinUrl || ""}__${p.website || ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(p);
    }

    const score = (p) => {
      let s = 0;
      if (p.isCurrent === true) s += 45;
      if (p.title) s += 20;
      if (p.companyName) s += 20;
      if (p.companyLinkedinUrl) s += 15;
      if (p.website) s += 10;
      return s;
    };

    const sorted = normalized.sort((a, b) => score(b) - score(a));

    // Enrich current positions with URL/URN discovered from any duplicate company entry.
    const companyKey = (name) =>
      String(name || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "")
        .trim();

    for (const p of sorted) {
      if (p.companyLinkedinUrl) continue;
      const k = companyKey(p.companyName);
      if (!k) continue;

      const donor = sorted.find((x) =>
        x !== p &&
        x.companyLinkedinUrl &&
        companyKey(x.companyName) === k
      );

      if (donor) {
        p.companyLinkedinUrl = donor.companyLinkedinUrl;
        p.companyUrn = p.companyUrn || donor.companyUrn || null;
        p.website = p.website || donor.website || null;
      }
    }

    const current = sorted.filter((p) => p.isCurrent === true);
    if (current.length) {
      // Keep explicit current roles first, then fill with strong unknown-current roles.
      const extra = sorted.filter((p) => p.isCurrent !== false && p.isCurrent !== true);
      return [...current, ...extra].slice(0, limit);
    }

    const urlRich = sorted.filter((p) => p.companyLinkedinUrl);
    if (urlRich.length) return urlRich.slice(0, limit);
    return sorted.slice(0, limit);
  };

  const parseHeadlineAsPosition = (headline, personName = null) => {
    const h = clean(headline);
    if (!h) return null;

    let normalizedHeadline = h;
    const pn = clean(personName);
    if (pn && normalizedHeadline.toLowerCase().startsWith(`${pn.toLowerCase()} · `)) {
      normalizedHeadline = normalizedHeadline.slice(pn.length + 3);
    }

    let m = normalizedHeadline.match(/^(.+?)\s+at\s+(.+)$/i);
    if (!m) m = normalizedHeadline.match(/^(.+?)\s+chez\s+(.+)$/i);
    if (!m) m = normalizedHeadline.match(/^(.+?)\s*@\s*(.+)$/i);
    if (!m) return null;

    const title = sanitizeJobTitle(m[1], personName);
    const companyName = sanitizeCompanyName(m[2]);
    if (!title || !companyName) return null;

    return {
      title,
      companyName,
      companyLinkedinUrl: null,
      companyUrn: null,
      website: null,
      isCurrent: true,
    };
  };

  const splitHeadlineCompanies = (companyPart) => {
    const raw = clean(companyPart);
    if (!raw) return [];
    const parts = raw
      .split(/\s+-\s+|\s+\|\s+|\s+\/\s+|\s+&\s+/)
      .map((x) => sanitizeCompanyName(x))
      .filter(Boolean);
    if (!parts.length) return [sanitizeCompanyName(raw)].filter(Boolean);
    const unique = [];
    const seen = new Set();
    for (const p of parts) {
      const k = p.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(p);
    }
    return unique.slice(0, 3);
  };

  const parseHeadlineAsPositions = (headline, personName = null) => {
    const h = clean(headline);
    if (!h) return [];

    let normalizedHeadline = h;
    const pn = clean(personName);
    if (pn && normalizedHeadline.toLowerCase().startsWith(`${pn.toLowerCase()} · `)) {
      normalizedHeadline = normalizedHeadline.slice(pn.length + 3);
    }

    const out = [];
    const seen = new Set();

    const isLikelyEducation = (company) =>
      /\b(universit|university|école|ecole|school|institut|faculty|lycee|lycée)\b/i.test(
        String(company || "")
      );

    const hasStrongRoleSignal = (title) =>
      /\b(founder|co-founder|ceo|cto|cmo|coo|owner|president|président|director|directeur|head|manager|lead|responsable|chef)\b/i.test(
        String(title || "")
      );

    const pushOne = (titleRaw, companyRaw, opts = {}) => {
      const title = sanitizeJobTitle(titleRaw, personName);
      const companyName = sanitizeCompanyName(companyRaw);
      if (!title || !companyName) return;
      if (isLikelyEducation(companyName)) return;
      if (opts.requireStrongRole && !hasStrongRoleSignal(title)) return;
      const key = `${title}__${companyName}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        title,
        companyName,
        companyLinkedinUrl: null,
        companyUrn: null,
        website: null,
        isCurrent: true,
      });
    };

    // Pattern 1: "Title at Company" / "Title chez Company" / "Title @ Company" (reliable)
    let m = normalizedHeadline.match(/^(.+?)\s+at\s+(.+)$/i);
    if (!m) m = normalizedHeadline.match(/^(.+?)\s+chez\s+(.+)$/i);
    if (!m) m = normalizedHeadline.match(/^(.+?)\s*@\s*(.+)$/i);
    if (m) {
      const title = sanitizeJobTitle(m[1], personName);
      const companies = splitHeadlineCompanies(m[2]);
      if (title && companies.length) {
        companies.forEach((c) => pushOne(title, c));
      }
    }

    // Pattern 2: pipe segments "Role - Company | Role - Company"
    const segments = normalizedHeadline
      .split("|")
      .map((x) => clean(x))
      .filter(Boolean)
      .slice(0, 6);

    for (const seg of segments) {
      const md = seg.match(/^(.+?)\s+\-\s+(.+)$/);
      if (!md) continue;
      const title = sanitizeJobTitle(md[1], personName);
      const companies = splitHeadlineCompanies(md[2]);
      if (!title || !companies.length) continue;
      companies.forEach((c) => pushOne(title, c));
    }

    // Pattern 3 (strict fallback): single dash and NO pipe
    if (!out.length && normalizedHeadline.includes(" - ") && !normalizedHeadline.includes("|")) {
      const md = normalizedHeadline.match(/^(.+?)\s+\-\s+(.+)$/);
      if (md) {
        const title = sanitizeJobTitle(md[1], personName);
        const companies = splitHeadlineCompanies(md[2]);
        if (title && companies.length) {
          companies.forEach((c) => pushOne(title, c, { requireStrongRole: true }));
        }
      }
    }

    return out.slice(0, 3);
  };

  const extractPositionsFromApollo = (apollo) => {
    const positions = [];

    const looksLikePosition = (obj) => {
      if (!obj || typeof obj !== "object") return false;
      const title =
        sanitizeJobTitle(obj.title) ||
        sanitizeJobTitle(obj.positionTitle) ||
        sanitizeJobTitle(obj.roleTitle) ||
        sanitizeJobTitle(obj.localizedTitle) ||
        sanitizeJobTitle(obj.jobTitle);
      const companyName =
        sanitizeCompanyName(obj.companyName) ||
        sanitizeCompanyName(obj.company) ||
        sanitizeCompanyName(obj.companyText) ||
        sanitizeCompanyName(obj.organizationName) ||
        sanitizeCompanyName(obj.employerName) ||
        sanitizeCompanyName(obj.companyResolutionResult?.name) ||
        sanitizeCompanyName(obj.companyDetails?.name) ||
        sanitizeCompanyName(obj.company?.name);
      if (!title && !companyName) return false;
      if (title && isProbablyJunkText(title)) return false;
      if (looksLikeNonWorkEntry(title, companyName)) return false;
      return true;
    };

    const getIsCurrent = (obj) => {
      if (typeof obj.isCurrent === "boolean") return obj.isCurrent;
      if (typeof obj.current === "boolean") return obj.current;
      if (typeof obj.isActive === "boolean") return obj.isActive;
      if (typeof obj.active === "boolean") return obj.active;

      const tp = obj.timePeriod || obj.dateRange || obj.duration || obj.period || null;
      if (tp && typeof tp === "object") {
        const end = tp.endDate || tp.end || tp.endOn || tp.endMonthYear || null;
        if (end === null || end === undefined) return true;
      }

      const dateText = textOf(obj.dateRangeText) || textOf(obj.timePeriodText) || "";
      if (PRESENT_MARKER_REGEX.test(dateText)) return true;
      return null;
    };

    const extractOne = (obj) => {
      const title =
        sanitizeJobTitle(obj.title) ||
        sanitizeJobTitle(obj.positionTitle) ||
        sanitizeJobTitle(obj.roleTitle) ||
        sanitizeJobTitle(obj.localizedTitle) ||
        sanitizeJobTitle(obj.jobTitle) ||
        null;

      let companyName =
        sanitizeCompanyName(obj.companyName) ||
        sanitizeCompanyName(obj.company) ||
        sanitizeCompanyName(obj.companyText) ||
        sanitizeCompanyName(obj.organizationName) ||
        sanitizeCompanyName(obj.employerName) ||
        sanitizeCompanyName(obj.companyResolutionResult?.name) ||
        sanitizeCompanyName(obj.companyDetails?.name) ||
        sanitizeCompanyName(obj.organization?.name) ||
        null;

      if (!companyName && obj.company && typeof obj.company === "object") {
        companyName =
          sanitizeCompanyName(obj.company.name) ||
          sanitizeCompanyName(obj.company.companyName) ||
          sanitizeCompanyName(obj.company.title) ||
          null;
      }

      let companyLinkedinUrl =
        normalizeCompanyUrl(obj.companyUrl) ||
        normalizeCompanyUrl(obj.companyLinkedinUrl) ||
        normalizeCompanyUrl(obj.companyNavigationUrl) ||
        normalizeCompanyUrl(obj.companyLink) ||
        normalizeCompanyUrl(obj.navigationUrl) ||
        null;

      if (!companyLinkedinUrl && obj.company && typeof obj.company === "object") {
        companyLinkedinUrl =
          normalizeCompanyUrl(obj.company.url) ||
          normalizeCompanyUrl(obj.company.link) ||
          normalizeCompanyUrl(obj.company.navigationUrl) ||
          normalizeCompanyUrl(obj.company.companyUrl) ||
          null;
      }

      const companyUrn =
        clean(obj.companyUrn) ||
        clean(obj.companyEntityUrn) ||
        clean(obj.organizationUrn) ||
        clean(obj.company?.entityUrn) ||
        clean(obj.company?.companyUrn) ||
        null;

      if (!companyLinkedinUrl && companyUrn) {
        companyLinkedinUrl = companyUrlFromUrn(companyUrn);
      }

      const website =
        normalizeWebsiteUrl(obj.website) ||
        normalizeWebsiteUrl(obj.companyWebsite) ||
        normalizeWebsiteUrl(obj.company?.website) ||
        normalizeWebsiteUrl(obj.companyDetails?.websiteUrl) ||
        normalizeWebsiteUrl(obj.companyResolutionResult?.websiteUrl) ||
        null;

      return {
        title: sanitizeJobTitle(title),
        companyName: sanitizeCompanyName(companyName),
        companyLinkedinUrl,
        companyUrn,
        website,
        isCurrent: getIsCurrent(obj),
      };
    };

    const shouldKeepApolloPosition = (p) => {
      if (!p) return false;
      if (!p.title && !p.companyName && !p.companyLinkedinUrl && !p.website) return false;
      if (looksLikeNonWorkEntry(p.title, p.companyName)) return false;
      if (p.isCurrent === false) return false;
      const hasStrongCompanyRef = Boolean(p.companyLinkedinUrl || p.companyUrn);
      if (!hasStrongCompanyRef) return false;
      if (p.companyName && /\b(paris|france|tunisie|hybride|gouvernorat)\b/i.test(p.companyName)) {
        return false;
      }
      return true;
    };

    for (const [, v] of Object.entries(apollo)) {
      if (!v || typeof v !== "object") continue;

      if (looksLikePosition(v)) {
        const p = extractOne(v);
        if (shouldKeepApolloPosition(p)) positions.push(p);
      }

      const arraysToCheck = [
        "positions",
        "position",
        "profilePositions",
        "positionView",
        "positionCards",
        "experience",
        "experiences",
        "profilePositionGroups",
        "positionGroups",
        "experienceItems",
        "groupPositions",
      ];
      for (const key of arraysToCheck) {
        const arr = v[key];
        if (!Array.isArray(arr)) continue;
        for (const it of arr) {
          if (!it || typeof it !== "object") continue;
          if (!looksLikePosition(it)) continue;
          const p = extractOne(it);
          if (shouldKeepApolloPosition(p)) positions.push(p);
        }
      }
    }

    return dedupeAndRankPositions(positions, 5);
  };

  // ==========================================================
  // Structured Data fallback (LD+JSON)
  // ==========================================================

  const extractFromLDJSON = () => {
    const out = {
      name: null,
      headline: null,
      currentPositions: [],
    };

    const pushLDPosition = (title, companyName, companyUrl) => {
      const t = sanitizeJobTitle(title);
      const c = sanitizeCompanyName(companyName);
      const u = normalizeCompanyUrl(companyUrl);
      if (!t && !c && !u) return;
      out.currentPositions.push({
        title: t || null,
        companyName: c || null,
        companyLinkedinUrl: u || null,
        companyUrn: null,
        website: null,
        isCurrent: true,
      });
    };

    try {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        const txt = s.textContent || "";
        if (!txt.trim()) continue;
        let data = null;
        try {
          data = JSON.parse(txt);
        } catch {
          continue;
        }

        const arr = Array.isArray(data) ? data : [data];
        for (const obj of arr) {
          if (!obj || typeof obj !== "object") continue;

          const name = clean(obj.name);
          const headline = clean(obj.description) || clean(obj.headline);
          if (!out.name && name) out.name = name;
          if (!out.headline && headline && !isProbablyJunkText(headline)) {
            out.headline = headline;
          }

          const worksForItems = Array.isArray(obj.worksFor) ? obj.worksFor : [obj.worksFor];
          for (const wf of worksForItems) {
            if (!wf || typeof wf !== "object") continue;
            pushLDPosition(obj.jobTitle || obj.hasOccupation?.name, wf.name, wf.url);
          }

          pushLDPosition(
            obj.jobTitle || obj.hasOccupation?.name,
            obj.affiliation?.name || obj.memberOf?.name,
            obj.affiliation?.url || obj.memberOf?.url
          );
        }
      }
    } catch {}

    out.currentPositions = dedupeAndRankPositions(out.currentPositions, 3);
    return out;
  };

  // ==========================================================
  // DOM fallback (last resort)
  // ==========================================================

  const extractFromDOM = () => {
    const splitLines = (txt) =>
      String(txt || "")
        .split("\n")
        .map((x) => clean(x))
        .filter(Boolean);

    const looksLikeDateOrMetaLine = (line) => {
      const t = String(line || "").toLowerCase();
      if (!t) return true;
      if (PRESENT_MARKER_REGEX.test(t)) return true;
      if (/\b(full[- ]time|part[- ]time|temps plein|stage|contrat|cdi|cdd)\b/i.test(t)) return true;
      if (/\b\d+\s*(yr|yrs|year|years|mois|month|months|ans)\b/i.test(t)) return true;
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|fev|avr|mai|juin|juil|aout|sept|oct|nov|dec)\b/i.test(t)) return true;
      if (/\b(coordonnees|coordonnées|contact info)\b/i.test(t)) return true;
      if (/\b(plus de profils|people also viewed|premium)\b/i.test(t)) return true;
      return false;
    };

    const hasPresentMarker = (text) => PRESENT_MARKER_REGEX.test(String(text || ""));

    const hasEndedDateMarker = (text) =>
      /\-\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|f[eé]v|avr|mai|juin|juil|ao[uû]t|sept|oct|nov|d[eé]c)\.?\s+)?(?:19|20)\d{2}\b/i.test(
        String(text || "")
      );

    const inferCurrentFromLines = (lines) => {
      let presentHits = 0;
      let endedHits = 0;
      for (const line of lines) {
        if (hasPresentMarker(line)) presentHits++;
        if (hasEndedDateMarker(line) && !hasPresentMarker(line)) endedHits++;
      }

      if (presentHits > 0 && endedHits === 0) return true;
      if (endedHits > 0 && presentHits === 0) return false;
      if (presentHits > 0 && endedHits > 0) return null;
      return null;
    };

    const findExternalWebsiteNear = (node, companyName = null, boundaryRoot = null) => {
      const toTokens = (value) =>
        String(value || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter((x) => x.length >= 3);

      const companyTokens = toTokens(companyName);
      if (!companyTokens.length) return null;

      const roots = [node, node?.parentElement, node?.parentElement?.parentElement]
        .filter(Boolean)
        .filter((r) => !boundaryRoot || boundaryRoot.contains(r));

      for (const root of roots) {
        const rootText = String(root?.innerText || "").toLowerCase();
        if (/\b(licence|license|certification|dipl[oô]me|formation|education|comp[ée]tence|skill)\b/i.test(rootText)) {
          continue;
        }

        const anchors = Array.from(root.querySelectorAll('a[href]')).slice(0, 30);
        for (const a of anchors) {
          const href = a.href || a.getAttribute("href");
          const site = normalizeWebsiteUrl(href);
          if (!site) continue;

          let host = "";
          try {
            host = new URL(site).hostname.toLowerCase().replace(/^www\./, "");
          } catch {
            continue;
          }
          const hostTokens = toTokens(host);
          const overlap = companyTokens.some((t) => hostTokens.includes(t));
          if (!overlap) continue;

          return site;
        }
      }
      return null;
    };

    const extractPositionFromBlock = (block, experienceSection = null) => {
      if (!block) return null;
      if ((block.innerText || "").length > 550) return null;

      const lines = splitLines(block.innerText);
      if (!lines.length) return null;

      let companyAnchor = block.querySelector('a[href*="/company/"]');
      if (!companyAnchor) {
        let parent = block.parentElement;
        let hops = 0;
        while (parent && hops < 4) {
          const candidate = parent.querySelector('a[href*="/company/"]');
          if (candidate) {
            companyAnchor = candidate;
            break;
          }
          parent = parent.parentElement;
          hops++;
        }
      }
      let companyName = clean(companyAnchor?.innerText);
      const companyLinkedinUrl = normalizeCompanyUrl(companyAnchor?.href || companyAnchor?.getAttribute("href"));

      if (companyName && companyName.includes("·")) {
        companyName = clean(companyName.split("·")[0]);
      }

      let title = null;
      for (const line of lines) {
        if (companyName && line === companyName) continue;
        if (/^(experience|expérience)$/i.test(line)) continue;
        if (looksLikeDateOrMetaLine(line)) continue;
        if (isProbablyJunkText(line)) continue;

        if (!title) {
          title = line;
          continue;
        }

        if (!companyName) {
          companyName = clean(line.split("·")[0]);
        }
      }

      const normalizedCompanyName = sanitizeCompanyName(companyName) || null;
      const website = findExternalWebsiteNear(block, normalizedCompanyName, experienceSection);

      let isCurrent = inferCurrentFromLines(lines);
      if (isCurrent === null) {
        // Some LinkedIn layouts split date/current markers into ancestor nodes.
        let parent = block.parentElement;
        let hops = 0;
        while (parent && hops < 3 && isCurrent === null) {
          const parentText = String(parent.innerText || "");
          if (parentText.length > 3200) break;
          const scopeToken =
            sanitizeCompanyName(companyName) ||
            sanitizeJobTitle(title) ||
            null;
          const scopeMatches = scopeToken
            ? parentText.toLowerCase().includes(String(scopeToken).toLowerCase())
            : true;
          if (!scopeMatches) break;
          const parentLines = splitLines(parentText).slice(0, 24);
          isCurrent = inferCurrentFromLines(parentLines);
          parent = parent.parentElement;
          hops++;
        }
      }
      if (!title && !companyName && !companyLinkedinUrl) return null;
      if (!companyName && !companyLinkedinUrl) return null;

      return {
        title: sanitizeJobTitle(title) || null,
        companyName: normalizedCompanyName,
        companyLinkedinUrl,
        companyUrn: null,
        website,
        isCurrent,
      };
    };

    const fromTitle = () => {
      const t = clean(document.title);
      if (!t) return null;
      // "Name | LinkedIn"
      const name = clean(t.split("|")[0]);
      return name;
    };

    const main = document.querySelector("main") || document.body;
    const h1 = main.querySelector("h1");
    const topCardCandidates = [
      h1?.closest("section"),
      h1?.closest("article"),
      h1?.closest("div"),
      main.querySelector("section"),
      main,
    ].filter(Boolean);
    const topCardRoot =
      topCardCandidates.find((el) => el.querySelector?.('a[href*="/company/"]')) ||
      topCardCandidates[0] ||
      main;

    const findName = () => {
      // Try common heading nodes in top card
      const candidates = [
        h1,
        topCardRoot?.querySelector('[data-testid="profile-top-card-verified-badge"] h2'),
        topCardRoot?.querySelector("h2"),
      ].filter(Boolean);

      for (const el of candidates) {
        const t = firstRelevantLine(el.innerText);
        if (t && isLikelyPersonName(t)) return t;
      }
      const fromPageTitle = fromTitle();
      return isLikelyPersonName(fromPageTitle) ? fromPageTitle : null;
    };

    const findHeadline = (name) => {
      const top = topCardRoot || main;

      const direct = [
        top.querySelector(".text-body-medium.break-words"),
        top.querySelector(".pv-text-details__left-panel .text-body-medium"),
        top.querySelector('[data-generated-suggestion-target]'),
      ].filter(Boolean);

      for (const el of direct) {
        const t = firstRelevantLine(el.innerText, name);
        if (t && !isProbablyJunkText(t)) return t;
      }

      const texts = Array.from(top.querySelectorAll("p, span, div"))
        .map((el) => clean(el.innerText))
        .filter((t) => t && t.length >= 6 && t.length <= 180)
        .slice(0, 120);

      // Try: first line that looks like a headline (contains " at " / " chez " / " CEO " etc)
      const patterns = [
        " at ",
        " chez ",
        "co-founder",
        "founder",
        "ceo",
        "cto",
        "consultant",
        "engineer",
        "manager",
        "analyste",
      ];
      for (const t of texts) {
        const low = t.toLowerCase();
        if (isProbablyJunkText(t)) continue;
        if (name && t === name) continue;
        if (patterns.some((p) => low.includes(p))) return t;
      }

      // Fallback: second best non-junk text
      for (const t of texts) {
        if (isProbablyJunkText(t)) continue;
        if (name && t === name) continue;
        return t;
      }

      return null;
    };

    const getExperienceSection = () => {
      const top = main;
      const sections = Array.from(top.querySelectorAll("section, div"));
      return (
        sections.find((section) => {
          const title = clean(section.querySelector("h2, h3")?.innerText);
          return title && /\b(experience|expérience)\b/i.test(title);
        }) || null
      );
    };

    const collectExperiencePositions = (experienceSection) => {
      if (!experienceSection) return [];

      const rawBlocks = Array.from(
        experienceSection.querySelectorAll(
          "li, article, .pvs-list__item--line-separated, .pvs-list__paged-list-item"
        )
      ).slice(0, 40);

      const blocks = rawBlocks.filter((block) => {
        const hasDeeperBlock = rawBlocks.some(
          (other) =>
            other !== block &&
            block.contains(other) &&
            (other.innerText || "").length > 60
        );
        return !hasDeeperBlock;
      });

      const found = [];
      for (const block of blocks) {
        const p = extractPositionFromBlock(block, experienceSection);
        if (p) found.push(p);
      }
      return found;
    };

    const collectExperienceCompanyLinkPositions = (experienceSection, headline, personName) => {
      if (!experienceSection) return [];
      const links = Array.from(experienceSection.querySelectorAll('a[href*="/company/"]')).slice(0, 12);
      const found = [];
      const headlinePositions = parseHeadlineAsPositions(headline, personName);
      const fallbackTitle = headlinePositions[0]?.title || sanitizeJobTitle(headline, personName) || null;

      for (const a of links) {
        const url = normalizeCompanyUrl(a.href || a.getAttribute("href"));
        const companyName = sanitizeCompanyName(a.innerText);
        if (!url && !companyName) continue;

        const container = a.closest("li, article, div, section");
        const ctx = String(container?.innerText || "");
        const ctxLines = splitLines(ctx).slice(0, 14);
        const inferred = inferCurrentFromLines(ctxLines);

        if (inferred !== true) continue;

        found.push({
          title: fallbackTitle,
          companyName: companyName || null,
          companyLinkedinUrl: url || null,
          companyUrn: null,
          website: findExternalWebsiteNear(container || a, companyName || null, experienceSection),
          isCurrent: inferred,
        });
      }

      return found;
    };

    const name = findName();
    const headline = findHeadline(name);
    const experienceSection = getExperienceSection();
    const experiencePositions = collectExperiencePositions(experienceSection);
    const experienceCompanyLinks = collectExperienceCompanyLinkPositions(
      experienceSection,
      headline,
      name
    );
    const positions = [...experiencePositions, ...experienceCompanyLinks];

    // Headline is only a controlled fallback when no experience position was extracted.
    if (!positions.length) {
      const fromHeadline = parseHeadlineAsPositions(headline, name);
      if (fromHeadline.length) positions.push(...fromHeadline);
    }

    return {
      name,
      headline: headline && !isProbablyJunkText(headline) ? headline : null,
      currentPositions: dedupeAndRankPositions(positions, 5),
    };
  };

  // ==========================================================
  // Avatar extraction
  // ==========================================================

  const extractAvatarFromApollo = (apollo) => {
    const pickArtifact = (rootUrl, artifacts) => {
      if (!rootUrl || !Array.isArray(artifacts) || !artifacts.length) return null;
      const valid = artifacts
        .filter((a) => a && a.fileIdentifyingUrlPathSegment)
        .sort((a, b) => (b.width || 0) - (a.width || 0));
      // prefer ≤400px to avoid oversized images
      const pick = valid.find((a) => (a.width || 0) <= 400) || valid[0];
      if (!pick) return null;
      return rootUrl + pick.fileIdentifyingUrlPathSegment;
    };

    try {
      for (const [, v] of Object.entries(apollo)) {
        if (!v || typeof v !== "object") continue;

        // Pattern A: { picture: { rootUrl, artifacts } }
        const pic = v.picture || v.profilePicture;
        if (pic && typeof pic === "object") {
          const url = pickArtifact(pic.rootUrl, pic.artifacts);
          if (url) return url;

          // Pattern B: nested vectorImage
          const vec =
            pic.displayImageReference?.vectorImage ||
            pic.displayImage?.vectorImage;
          if (vec) {
            const url2 = pickArtifact(vec.rootUrl, vec.artifacts);
            if (url2) return url2;
          }
        }
      }
    } catch {}
    return null;
  };

  const isProfilePhotoUrl = (src) => {
    if (!src || !src.includes("media.licdn.com")) return false;
    // Exclude banner/background images
    if (/backgroundimage|background-image|profile-cover|coverimage/i.test(src)) return false;
    // Prefer known profile photo patterns
    return true;
  };

  const extractAvatarFromDOM = () => {
    // Specific selectors first (most reliable)
    const specificSelectors = [
      "img.pv-top-card-profile-picture__image--show",
      "img.profile-photo-edit__preview",
      ".pv-top-card-profile-picture img",
      ".profile-photo-edit img",
      ".pv-top-card__photo img",
    ];
    for (const sel of specificSelectors) {
      try {
        const img = document.querySelector(sel);
        if (isProfilePhotoUrl(img?.src)) return img.src;
      } catch {}
    }

    // Broad fallback: find all linkedin CDN images, pick the one that looks like a profile photo
    try {
      const imgs = Array.from(
        document.querySelectorAll('main img[src*="media.licdn.com/dms/image"], section img[src*="media.licdn.com/dms/image"]')
      );
      // Prefer displayphoto URLs, skip banners
      const profilePhoto = imgs.find((img) =>
        isProfilePhotoUrl(img.src) && /displayphoto|shrink_\d+_\d+/i.test(img.src)
      );
      if (profilePhoto) return profilePhoto.src;
      // Last resort: any non-banner image
      const any = imgs.find((img) => isProfilePhotoUrl(img.src));
      if (any) return any.src;
    } catch {}

    return null;
  };

  // ==========================================================
  // Capture pipeline (stabilized + single send)
  // ==========================================================

  const buildPayload = () => {
    const key = profileKey();
    if (!key) return null;

    const profileUrl = `${location.origin}${key}/`;
    const apollo = getApollo();

    let name = null;
    let headline = null;
    let positions = [];

    let source = "none";
    let apolloPositions = [];

    const companyKey = (name) =>
      String(name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();

    const enrichWithLinkedinUrls = (basePositions, donors) => {
      const out = Array.isArray(basePositions) ? [...basePositions] : [];
      const donorList = Array.isArray(donors) ? donors : [];
      for (const p of out) {
        const key = companyKey(p.companyName);
        if (!key) continue;
        const donor = donorList.find((d) => companyKey(d.companyName) === key);
        if (donor) {
          p.companyLinkedinUrl = p.companyLinkedinUrl || donor.companyLinkedinUrl || null;
          p.companyUrn = p.companyUrn || donor.companyUrn || null;
          p.website = p.website || donor.website || null;
        }
      }
      return out;
    };

    if (apollo) {
      const a = extractNameHeadlineFromApollo(apollo);
      name = a.name || name;
      headline = a.headline || headline;
      apolloPositions = extractPositionsFromApollo(apollo) || [];
      source = "apollo";
    }

    // DOM extraction is now the primary source for positions (stable and profile-scoped)
    const dom = extractFromDOM();
    if (!name && dom.name) name = dom.name;
    if (!headline && dom.headline) headline = dom.headline;
    if (Array.isArray(dom.currentPositions) && dom.currentPositions.length) {
      positions = [...dom.currentPositions];
    }
    source = source === "none" ? "dom" : `${source}+dom`;

    // LD+JSON fallback to fill missing pieces only
    if (!name || !headline || !positions.length) {
      const ld = extractFromLDJSON();
      if (!name && ld.name) name = ld.name;
      if (!headline && ld.headline) headline = ld.headline;
      if (!positions.length && Array.isArray(ld.currentPositions) && ld.currentPositions.length) {
        positions = [...ld.currentPositions];
      }
      source = source === "none" ? "ldjson" : `${source}+ldjson`;
    }

    // Apollo positions are only used as URL enrichers unless nothing else exists
    const apolloCurrentPositions = apolloPositions.filter(
      (pos) => pos && (pos.isCurrent === true || String(pos.isCurrent).toLowerCase() === "true")
    );

    if (!positions.length && apolloCurrentPositions.length) {
      positions = [...apolloCurrentPositions];
      source = source === "none" ? "apollo-pos" : `${source}+apollo-pos`;
    } else if (positions.length && apolloPositions.length) {
      positions = enrichWithLinkedinUrls(positions, apolloPositions);
    }

    // Headline cleanup: remove obvious CTA junk appended
    if (headline) {
      const cleaned = clean(
        headline
          .replace(/\b(Message|Suivre|Se connecter|Connecter)\b/gi, "")
          .replace(/\s+Â·\s+\d+(er|e)\b/gi, "") // remove "Â· 3e" patterns
          .trim()
      );
      headline = cleaned && !isProbablyJunkText(cleaned) ? cleaned : null;
    }

    let normalizedName = clean(name);
    if (!isLikelyPersonName(normalizedName)) {
      normalizedName = null;
    }

    // Parse "Title at Company" headline pattern when available
    const fromHeadline = parseHeadlineAsPositions(headline, normalizedName);
    if (!positions.length && fromHeadline.length) positions.push(...fromHeadline);

    // Positions cleanup: prefer current and richest entries
    const normalizedPositions = dedupeAndRankPositions(positions, 3);

    const avatarUrl =
      (apollo ? extractAvatarFromApollo(apollo) : null) ||
      extractAvatarFromDOM() ||
      null;

    const payload = {
      version: "10.1-stable",
      sessionId,
      injectedAt,
      capturedAt: nowISO(),
      source,
      profileUrl,
      profilePath: key,
      name: normalizedName,
      headline: headline ? clean(headline) : null,
      currentPositions: normalizedPositions,
      avatarUrl,
    };

    // compute score (stored for debugging)
    payload._score = scorePayload(payload);
    payload._attempt = attemptCount;

    return payload;
  };

  const finalizeAndSendIfReady = (reason) => {
    if (!isRuntimeOwner()) return;
    const key = profileKey();
    if (!key) return;

    // Stop if already sent for this profilePath
    if (sentForKey === key) return;

    // Build candidate
    const candidate = buildPayload();
    const hasSignal = Boolean(
      candidate?.currentPositions?.length ||
        (candidate?.name && candidate?.headline && !isProbablyJunkText(candidate.headline))
    );
    if (!candidate || !hasSignal) return;

    if (!bestPayload || betterThanBest(candidate)) {
      bestPayload = candidate;
      bestScore = candidate._score;
      log("Buffered best payload:", { score: bestScore, reason, name: candidate.name, positions: candidate.currentPositions?.length || 0 });
    }

    // Decide if we can send now
    const elapsed = Date.now() - captureStartedAt;
    const bestHasSignal = Boolean(
      bestPayload?.currentPositions?.length ||
        (bestPayload?.name &&
          bestPayload?.headline &&
          !isProbablyJunkText(bestPayload.headline))
    );

    const ready =
      (bestScore >= MIN_SCORE_TO_SEND && bestHasSignal) ||
      (attemptCount >= MAX_ATTEMPTS && bestHasSignal) ||
      (elapsed >= STABILIZE_TIMEOUT_MS && bestHasSignal);

    if (!ready) return;

    // Hard rule: never send total garbage headline
    if (bestPayload.headline && isProbablyJunkText(bestPayload.headline)) {
      bestPayload.headline = null;
    }

    // SINGLE SEND
    if (safeSend(bestPayload)) {
      sentForKey = key;
      log("âœ… SENT (single) payload:", {
        profilePath: key,
        score: bestScore,
        positions: bestPayload.currentPositions?.length || 0,
        source: bestPayload.source,
      });
      teardownStabilizer();
    }
  };

  const teardownStabilizer = () => {
    if (stabilizeTimer) {
      clearInterval(stabilizeTimer);
      stabilizeTimer = null;
    }
    attemptCount = 0;
    bestPayload = null;
    bestScore = -1;
  };

  const startStabilizer = (reason) => {
    if (!isRuntimeOwner()) return;
    const key = profileKey();
    if (!key) return;

    if (attemptCount === 0) {
      captureStartedAt = Date.now();
    }

    // New profile: reset buffer and allow send
    if (lastCaptureKey !== key) {
      lastCaptureKey = key;
      sentForKey = null;
      teardownStabilizer();
      captureStartedAt = Date.now();
    }

    attemptCount++;

    finalizeAndSendIfReady(reason);

    // keep ticking until timeout or sent
    if (!stabilizeTimer) {
      const startedAt = Date.now();
      stabilizeTimer = setInterval(() => {
        // Stop if not on profile anymore
        if (!isProfilePage()) {
          teardownStabilizer();
          return;
        }

        // Stop if already sent
        if (sentForKey === profileKey()) {
          teardownStabilizer();
          return;
        }

        attemptCount++;
        finalizeAndSendIfReady("stabilizer-tick");

        // Hard timeout
        if (Date.now() - startedAt > STABILIZE_TIMEOUT_MS) {
          finalizeAndSendIfReady("timeout");
          teardownStabilizer();
        }

        if (attemptCount >= MAX_ATTEMPTS) {
          finalizeAndSendIfReady("max-attempts");
          teardownStabilizer();
        }
      }, 500);
    }
  };

  const scheduleCapture = (reason) => {
    if (!isRuntimeOwner()) return;
    const key = profileKey();
    if (!key) return;
    if (sentForKey === key) return;
    const now = Date.now();
    if (now - lastScheduleAt < 350) return;
    lastScheduleAt = now;

    // Avoid rescheduling endlessly for same key within short window
    const newKey = `${key}`;
    if (newKey === lastCaptureKey && debounceTimer) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      log("Capture scheduled:", reason, { path: key });
      startStabilizer(reason);
    }, DEBOUNCE_MS);
  };

  // ==========================================================
  // SPA navigation hooks
  // ==========================================================

  const onNav = () => {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    if (!isProfilePage()) return;

    const key = profileKey();
    log("ðŸ”„ Navigation detected:", { path, key });
    scheduleCapture("nav");
  };

  const hookHistory = () => {
    const _push = history.pushState;
    const _replace = history.replaceState;

    history.pushState = function () {
      _push.apply(this, arguments);
      setTimeout(onNav, 50);
    };

    history.replaceState = function () {
      _replace.apply(this, arguments);
      setTimeout(onNav, 50);
    };

    window.addEventListener("popstate", () => setTimeout(onNav, 50));
  };

  // ==========================================================
  // DOM mutation observer (only to trigger stabilize, not spam send)
  // ==========================================================

  const startObserver = () => {
    const root = document.querySelector("#root") || document.body;
    if (!root) return;

    const mo = new MutationObserver(() => {
      if (!isRuntimeOwner()) return;
      if (!isProfilePage()) return;
      scheduleCapture("dom-mutation");
    });

    mo.observe(root, { childList: true, subtree: true });
  };

  // ==========================================================
  // Init
  // ==========================================================

  log("Injected / init V10.1", { href: location.href });

  hookHistory();
  startObserver();

  // Initial capture if already on profile
  if (isProfilePage()) {
    setTimeout(() => scheduleCapture("init"), INITIAL_DELAY_MS);
  }
})();
