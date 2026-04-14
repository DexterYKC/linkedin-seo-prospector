// ==================================================
// SEO LinkedIn Prospector
// background.js â€” ORCHESTRATION (MV3, PROD-READY, SPA-safe)
// - No tabs.onUpdated waiting for LinkedIn SPA company pages
// - Persistent pipeline status (MV3 restarts)
// - Persistent Activity logs + export
// - Persistent Leads store + UI realtime sync (ports)
// ==================================================
"use strict";

console.log("[SEO-BG] Service worker loaded");

const LOG = "[SEO-BG]";
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);
const errlog = (...a) => console.error(LOG, ...a);

// ================= CONFIG =================
const DAILY_LIMIT = 40; // legacy name, now interpreted as monthly fallback limit

const STORAGE_KEY = "seo_prospector_state_v6";
const PIPELINE_KEY = "seo_pipeline_status_v1";

// NEW (persisted stores)
const LOGS_KEY = "seo_activity_logs_v1";
const LEADS_KEY = "seo_leads_v1"; // legacy/global base; scoped keys are derived from this
const ACCOUNT_KEY = "seo_account_v1";
const OVERRIDE_FEEDBACK_KEY = "seo_override_feedback_v1";

const MAX_LOGS = 500;
const MAX_LEADS = 500;
const MAX_OVERRIDE_FEEDBACK = 1500;

// Preferred SaaS gateway (Render API) -> forwards to n8n server-side.
const BACKEND_SCAN_URL = "https://api.example.com/v1/scan";
const BACKEND_AUTH_REGISTER_URL = "https://api.example.com/v1/auth/register";
const BACKEND_AUTH_LOGIN_URL = "https://api.example.com/v1/auth/login";
const BACKEND_AUTH_LOGOUT_URL = "https://api.example.com/v1/auth/logout";
const BACKEND_AUTH_SESSION_URL = "https://api.example.com/v1/auth/session";
const BACKEND_ME_URL = "https://api.example.com/v1/me";
const BACKEND_ENTITLEMENTS_URL = "https://api.example.com/v1/entitlements";
const BACKEND_USAGE_CONSUME_URL = "https://api.example.com/v1/usage/consume";
const BACKEND_LEADS_UPSERT_URL = "https://api.example.com/v1/leads/upsert";
const BACKEND_LEADS_LIST_URL = "https://api.example.com/v1/leads";
const BACKEND_DASHBOARD_URL = "https://api.example.com/v1/dashboard";
const BACKEND_ASSISTANT_QUERY_URL = "https://api.example.com/v1/assistant/query";
const BACKEND_MESSAGE_GENERATE_URL = "https://api.example.com/v1/messages/generate";
const BACKEND_MSG_LOG_URL = "https://api.example.com/v1/messages/log";
const BACKEND_SEO_EXPORT_SINGLE_URL = "https://api.example.com/v1/seo/export-single";
const SAAS_APP_URL = "https://app.example.com"; // TODO: replace with production URL at deploy
const BACKEND_ADMIN_RESET_URL = "https://api.example.com/v1/admin/reset-user-data";
const BACKEND_BILLING_CHECKOUT_URL = "https://api.example.com/v1/billing/checkout-link";
const BACKEND_TEAM_SEATS_ADD_URL = "https://api.example.com/v1/team/seats/add";
const BACKEND_TEAM_STATS_URL = "https://api.example.com/v1/team/stats";
const BACKEND_SUPPORT_URL = "https://api.example.com/v1/support/tickets";
const BACKEND_SUPPORT_CHAT_URL = "https://api.example.com/v1/support/chat";
// Set this to the same value as Render env EXT_API_KEY.
const BACKEND_EXT_API_KEY = "9f531f7247c7c4c6e7fbd80efb1036c810793164";
const SAAS_SYNC_MIN_INTERVAL_MS = 60 * 1000;

const N8N_WEBHOOK_URL =
  "https://n8n.example.com/webhook/seo-prospector/scan";
const N8N_ASSISTANT_PROMPT_URL =
  "https://n8n.example.com/webhook/assistant-scan-v2";
const LINKEDIN_PROFILE_CANONICAL_ORIGIN = "https://www.linkedin.com";
const ENABLE_WEBSITE_SEARCH_FALLBACK = false;
const ENABLE_PROFILE_WEBSITE_HINTS = true;

// Pipeline state (persisted because MV3 restarts)
let PIPELINE_STATUS = "PAUSED"; // RUNNING | PAUSED

// Pending rescans: normalizedProfileUrl → { freeRetry: bool }
const rescanPendingMap = new Map();

// Company enrichment
const COMPANY_TAB_ACTIVE = false;
const COMPANY_SCRAPE_TIMEOUT_MS = 26000;
const MAX_OPPORTUNITIES_PER_PROFILE = 3;

const COMPANY_INJECT_DELAY_MS = 900;
const TAB_CLOSE_AFTER = true;
const MESSAGE_TAB_ACTIVE = false;
const MESSAGE_TAB_LOAD_TIMEOUT_MS = 20000;

// Injection control
const INJECTED_TABS = new Set();
const lastInjectAt = new Map();
const INJECT_COOLDOWN_MS = 8000;
let LEADS_TABLE_WARNING_EMITTED = false;

// Realtime connections (Side Panel)
const PANEL_PORT_NAME = "seo_panel";
const panelPorts = new Set();
const SUPPRESS_CAPTURE_UNTIL = new Map(); // normalizedProfileUrl -> epoch ms


const COMPANY_CACHE_KEY = "seo_company_cache_v1";
async function loadCompanyCache() {
  return await getLocal(COMPANY_CACHE_KEY, {});
}

async function saveCompanyCache(cache) {
  await setLocal(COMPANY_CACHE_KEY, cache);
}

async function loadAccount() {
  return await getLocal(ACCOUNT_KEY, {
    plan: "FREE",
    authMethod: "GUEST", // GUEST | EMAIL
    identity: null,
    linkedinProfileUrl: null,
    avatarUrl: null,
    email: null,
    role: null,
    isAdmin: false,
    connectedAt: null,
    userId: null,
    userToken: null,
    tokenExpiresAt: null,
    subscriptionStatus: null,
    trialEndsAt: null,
    limits: null,
    usage: null,
    remaining: null,
    features: null,
    team: null,
    seatUsers: [],
    cloudDashboard: null,
    lastCloudSyncAt: null,
    lastEntitlementsAt: null,
    updatedAt: null,
  });
}

async function saveAccount(account) {
  const current = await loadAccount();
  const merged = {
    ...current,
    ...(account || {}),
    updatedAt: nowIso(),
  };
  await setLocal(ACCOUNT_KEY, merged);
  return merged;
}


// ================= UTIL =================
function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeSlice(s, n) {
  return typeof s === "string" ? s.slice(0, n) : s;
}

function uuid() {
  // good enough for local IDs
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function getLocal(key, fallback) {
  try {
    const obj = await chrome.storage.local.get(key);
    return obj?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

function accountForUi(account) {
  const a = account || {};
  const token = String(a.userToken || "");
  return {
    ...a,
    userToken: null,
    tokenPreview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : null,
  };
}

function hasBackendExtensionKey() {
  return Boolean(BACKEND_EXT_API_KEY && String(BACKEND_EXT_API_KEY).trim());
}

function parseIsoMs(v) {
  if (!v) return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function asFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getAccountScanLimit(account = {}) {
  const n = asFiniteNumber(account?.limits?.profiles_scanned);
  if (n != null && n > 0) return n;
  const remaining = asFiniteNumber(account?.remaining?.profiles_scanned);
  const used = asFiniteNumber(account?.usage?.profiles_scanned);
  if (remaining != null && used != null && remaining + used > 0) {
    return remaining + used;
  }
  return null;
}

function getAccountScanUsage(account = {}) {
  const n = asFiniteNumber(account?.usage?.profiles_scanned);
  return n != null && n >= 0 ? n : null;
}

function normalizedPlanForSeats(rawPlan) {
  const p = String(rawPlan || "FREE").trim().toUpperCase();
  if (p === "TRIAL") return "FREE";
  if (p === "SCALE") return "AGENCY";
  if (["FREE", "STARTER", "PRO", "AGENCY"].includes(p)) return p;
  return "FREE";
}

function isBillingActiveForSeats(rawStatus) {
  const blocked = new Set(["EXPIRED", "CANCELED", "PAST_DUE"]);
  const s = String(rawStatus || "").trim().toUpperCase();
  return !blocked.has(s);
}

function getAccountTeamPolicy(account = {}) {
  const plan = normalizedPlanForSeats(account?.plan);
  const defaultsByPlan = {
    FREE: { includedUsers: 1, additionalSeatUsd: 0, seatAddOnEnabled: false },
    STARTER: { includedUsers: 1, additionalSeatUsd: 0, seatAddOnEnabled: false },
    PRO: { includedUsers: 1, additionalSeatUsd: 0, seatAddOnEnabled: false },
    AGENCY: { includedUsers: 5, additionalSeatUsd: 19, seatAddOnEnabled: true },
  };
  const defaults = defaultsByPlan[plan] || defaultsByPlan.FREE;
  const team = account?.team && typeof account.team === "object" ? account.team : {};
  const includedRaw = Number(team.includedUsers);
  const additionalRaw = Number(team.additionalSeatUsd);
  const billingActive = isBillingActiveForSeats(account?.subscriptionStatus || account?.status);
  const isAgency = plan === "AGENCY";
  const includedUsers = isAgency
    ? (
      Number.isFinite(includedRaw) && includedRaw > 0
        ? Math.max(1, Math.round(includedRaw))
        : defaults.includedUsers
    )
    : 1;
  const additionalSeatUsd = isAgency
    ? (Number.isFinite(additionalRaw) ? additionalRaw : defaults.additionalSeatUsd)
    : 0;
  const seatAddOnEnabled = billingActive && isAgency && (
    team.seatAddOnEnabled === true ||
    defaults.seatAddOnEnabled === true ||
    additionalSeatUsd > 0
  );
  return {
    includedUsers,
    additionalSeatUsd,
    seatAddOnEnabled,
    billingActive,
    plan,
  };
}

function normalizeSeatUserEntry(raw = {}) {
  const email = String(raw.email || "").trim().toLowerCase();
  const firstNameRaw = String(raw.firstName || "").trim();
  const lastNameRaw = String(raw.lastName || "").trim();
  const fullNameRaw = String(raw.fullName || `${firstNameRaw} ${lastNameRaw}`).trim();
  const parts = fullNameRaw.split(/\s+/).filter(Boolean);
  const firstName = firstNameRaw || parts[0] || "";
  const lastName = lastNameRaw || parts.slice(1).join(" ");
  // Fallback to email prefix if no name available (e.g. owner with null full_name)
  const fullName = String(fullNameRaw || `${firstName} ${lastName}`).trim() || email.split("@")[0] || "";
  if (!email) return null;
  return {
    email,
    firstName: firstName || fullName,
    lastName,
    fullName,
    teamRole: raw.teamRole || null,
    createdAt: raw.createdAt || nowIso(),
  };
}

function getEffectiveScanCounters({ account = {}, localTodayCount = 0 } = {}) {
  const accountLimit = getAccountScanLimit(account);
  const accountUsage = getAccountScanUsage(account);
  const dailyLimit = accountLimit ?? DAILY_LIMIT;
  const todayCount = accountUsage ?? Number(localTodayCount || 0);
  return { dailyLimit, todayCount };
}

function accountIdentityPayload(account = {}) {
  const email = String(account.email || "").trim().toLowerCase() || null;
  const linkedinProfileUrl =
    normalizeLinkedInProfileUrl(account.linkedinProfileUrl) || null;
  const fullName =
    account.authMethod === "LINKEDIN_SESSION"
      ? String(account.identity || "").trim() || null
      : null;
  // Email auth must not auto-recreate tokens silently once expired.
  if (account.authMethod === "EMAIL") {
    return { email: null, linkedinProfileUrl: null, fullName: null };
  }
  return { email, linkedinProfileUrl, fullName };
}

async function fetchBackendJson(url, { method = "GET", headers = {}, body = null, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const txt = await res.text().catch(() => "");
    let data = {};
    if (txt) {
      try {
        data = JSON.parse(txt);
      } catch {
        data = { raw: txt };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: data?.error || `HTTP_${res.status}`,
        data,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `FETCH_FAILED: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

function mergeAccountWithEntitlements(account, payload) {
  const next = { ...(account || {}) };
  const user = payload?.user || {};
  next.userId = user.id || next.userId || null;
  next.plan = user.plan || next.plan || "FREE";
  next.subscriptionStatus = user.status || next.subscriptionStatus || null;
  if (Object.prototype.hasOwnProperty.call(user, "role")) {
    next.role = user.role || null;
  }
  // Always reset isAdmin — stale true from a previous admin session must not carry over
  // Use strict === true to avoid "false" (string) being truthy
  next.isAdmin = user.isAdmin === true;
  next.trialEndsAt = user.trialEndsAt || next.trialEndsAt || null;
  next.periodEnd = user.periodEnd || next.periodEnd || null;
  next.teamRole = user.teamRole || next.teamRole || null;
  next.email = user.email || next.email || null;
  next.linkedinProfileUrl = user.linkedinProfileUrl || next.linkedinProfileUrl || null;
  next.avatarUrl = Object.prototype.hasOwnProperty.call(user, "avatarUrl") ? (user.avatarUrl || null) : (next.avatarUrl || null);
  next.identity = user.fullName || next.identity || null;
  next.limits = payload?.limits || next.limits || null;
  next.usage = payload?.usage || next.usage || null;
  next.remaining = payload?.remaining || next.remaining || null;
  next.features = payload?.features || next.features || null;
  next.team = payload?.team || next.team || null;
  if (Array.isArray(payload?.seatUsers)) {
    next.seatUsers = payload.seatUsers
      .map((x) => normalizeSeatUserEntry(x))
      .filter(Boolean);
  } else if (!Array.isArray(next.seatUsers)) {
    next.seatUsers = [];
  }
  if (payload?.dashboard && typeof payload.dashboard === "object") {
    next.cloudDashboard = payload.dashboard;
    next.lastCloudSyncAt = nowIso();
  }
  next.lastEntitlementsAt = nowIso();
  return next;
}

function mergeAccountWithAuthPayload(account, payload, authMethod = "EMAIL") {
  const next = mergeAccountWithEntitlements(account, payload || {});
  next.authMethod = authMethod;
  if (payload?.token) next.userToken = payload.token;
  if (payload?.expiresAt) next.tokenExpiresAt = payload.expiresAt;
  if (payload?.user?.email) next.email = payload.user.email;
  if (payload?.user?.fullName) next.identity = payload.user.fullName;
  if (payload?.user?.linkedinProfileUrl) next.linkedinProfileUrl = payload.user.linkedinProfileUrl;
  next.connectedAt = nowIso();
  return next;
}

async function syncEntitlements({ force = false } = {}) {
  if (!hasBackendExtensionKey()) return { ok: false, skipped: true, reason: "BACKEND_KEY_MISSING" };

  const account = await loadAccount();
  if (!account?.userToken) return { ok: false, skipped: true, reason: "NO_USER_TOKEN" };

  const lastSyncMs = parseIsoMs(account.lastEntitlementsAt);
  if (!force && lastSyncMs && Date.now() - lastSyncMs < SAAS_SYNC_MIN_INTERVAL_MS) {
    return { ok: true, cached: true, account };
  }

  const out = await fetchBackendJson(BACKEND_ME_URL || BACKEND_ENTITLEMENTS_URL, {
    method: "GET",
    headers: {
      "x-ext-key": BACKEND_EXT_API_KEY,
      "x-user-token": account.userToken,
    },
  });

  if (!out.ok) {
    return out;
  }

  const merged = mergeAccountWithEntitlements(account, out.data);
  // If userId changed (account deleted + re-registered), clear stale leads from old account
  if (account.userId && merged.userId && account.userId !== merged.userId) {
    await clearLeadsStore(account);
  }
  const saved = await saveAccount(merged);
  broadcastSnapshot("SAAS_ENTITLEMENTS_UPDATED");
  return { ok: true, account: saved, entitlements: out.data };
}

async function ensureSaasSession(reason = "AUTO") {
  if (!hasBackendExtensionKey()) {
    return { ok: false, skipped: true, reason: "BACKEND_KEY_MISSING" };
  }

  let account = await loadAccount();
  const idPayload = accountIdentityPayload(account);
  if (!idPayload.email && !idPayload.linkedinProfileUrl) {
    return { ok: false, skipped: true, reason: "NO_ACCOUNT_IDENTITY" };
  }

  const tokenExpiryMs = parseIsoMs(account.tokenExpiresAt);
  const tokenStillValid = Boolean(account.userToken && tokenExpiryMs > Date.now() + 5 * 60 * 1000);

  if (tokenStillValid) {
    const sync = await syncEntitlements({ force: false });
    if (sync.ok) return { ok: true, account: sync.account || account, reusedToken: true };
  }

  if (account.authMethod === "EMAIL") {
    return { ok: false, skipped: true, reason: "LOGIN_REQUIRED" };
  }

  const out = await fetchBackendJson(BACKEND_AUTH_SESSION_URL, {
    method: "POST",
    headers: { "x-ext-key": BACKEND_EXT_API_KEY },
    body: {
      email: idPayload.email,
      linkedinProfileUrl: idPayload.linkedinProfileUrl,
      fullName: idPayload.fullName,
      label: `extension-${reason}`,
    },
  });

  if (!out.ok || !out.data?.token) {
    return { ok: false, error: out.error || "AUTH_SESSION_FAILED", data: out.data };
  }

  account = await saveAccount({
    ...account,
    userToken: out.data.token,
    tokenExpiresAt: out.data.expiresAt || null,
    userId: out.data?.user?.id || account.userId || null,
    plan: out.data?.user?.plan || account.plan || "FREE",
    trialEndsAt: out.data?.user?.trialEndsAt || account.trialEndsAt || null,
    identity: out.data?.user?.fullName || account.identity || null,
    linkedinProfileUrl:
      out.data?.user?.linkedinProfileUrl || account.linkedinProfileUrl || null,
    email: out.data?.user?.email || account.email || null,
  });

  const sync = await syncEntitlements({ force: true });
  if (sync.ok) {
    await pushLog(`SaaS session synced (${reason})`);
    return { ok: true, account: sync.account || account, freshToken: true };
  }

  await pushLog("SaaS session created (entitlements sync pending)", "WARN", {
    reason,
    syncError: sync.error || sync.reason || null,
  });
  return { ok: true, account, freshToken: true };
}

async function consumeSaasMetric(metric, amount = 1) {
  if (!hasBackendExtensionKey()) return { ok: true, bypassed: true, reason: "BACKEND_KEY_MISSING" };

  let account = await loadAccount();
  if (!account?.userToken) {
    const ensured = await ensureSaasSession(`CONSUME_${metric}`);
    if (!ensured.ok) {
      if (ensured.reason === "BACKEND_KEY_MISSING") {
        return { ok: true, bypassed: true, reason: "BACKEND_KEY_MISSING" };
      }
      return {
        ok: false,
        authRequired: true,
        reason: ensured.reason || ensured.error || "SESSION_NOT_READY",
      };
    }
    account = ensured.account || (await loadAccount());
  }

  const callConsume = async (token) =>
    fetchBackendJson(BACKEND_USAGE_CONSUME_URL, {
      method: "POST",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      body: { metric, amount },
    });

  let out = await callConsume(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession(`REFRESH_${metric}`);
    if (refreshed.ok) {
      const refreshedAccount = refreshed.account || (await loadAccount());
      out = await callConsume(refreshedAccount.userToken);
      account = refreshedAccount;
    }
  }

  if (!out.ok) {
    if (out.httpStatus === 429 || out.error === "LIMIT_REACHED") {
      await syncEntitlements({ force: true });
      return {
        ok: false,
        limitReached: true,
        metric,
        detail: out.data || {},
      };
    }
    if (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN") {
      return { ok: false, authRequired: true, error: out.error || "AUTH_REQUIRED", detail: out.data || {} };
    }
    return { ok: false, error: out.error || "USAGE_CONSUME_FAILED", detail: out.data || {} };
  }

  const remaining = account.remaining && typeof account.remaining === "object"
    ? { ...account.remaining }
    : {};
  remaining[metric] = Number(out.data?.remaining ?? remaining[metric] ?? 0);

  const usage = account.usage && typeof account.usage === "object"
    ? { ...account.usage }
    : {};
  usage[metric] = Number(out.data?.used ?? usage[metric] ?? 0);
  usage.day = out.data?.day || usage.day || null;

  await saveAccount({
    ...account,
    remaining,
    usage,
    lastEntitlementsAt: nowIso(),
  });
  broadcastSnapshot("SAAS_USAGE_UPDATED");
  return { ok: true, metric, detail: out.data || {} };
}

function leadSortTs(lead) {
  const t =
    Date.parse(String(lead?.updatedAt || "")) ||
    Date.parse(String(lead?.createdAt || "")) ||
    0;
  return Number.isFinite(t) ? t : 0;
}

function mergeLeadsByProfileUrl(localLeads = [], cloudLeads = []) {
  const byUrl = new Map();

  for (const l of cloudLeads) {
    const u = normalizeLinkedInProfileUrl(l?.profileUrl);
    if (!u) continue;
    byUrl.set(u, l);
  }

  for (const l of localLeads) {
    const u = normalizeLinkedInProfileUrl(l?.profileUrl);
    if (!u) continue;
    if (!byUrl.has(u)) {
      byUrl.set(u, l);
      continue;
    }
    const existing = byUrl.get(u);
    if (leadSortTs(l) > leadSortTs(existing)) {
      byUrl.set(u, l);
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => leadSortTs(b) - leadSortTs(a))
    .slice(0, MAX_LEADS);
}

async function upsertCloudLead(lead, reason = "LEAD_UPSERT") {
  if (!hasBackendExtensionKey()) {
    return { ok: false, skipped: true, reason: "BACKEND_KEY_MISSING" };
  }

  let account = await loadAccount();
  if (!account?.userToken) {
    return { ok: false, skipped: true, reason: "AUTH_REQUIRED" };
  }

  const callUpsert = async (token) =>
    fetchBackendJson(BACKEND_LEADS_UPSERT_URL, {
      method: "POST",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      body: { lead },
      timeoutMs: 15000,
    });

  let out = await callUpsert(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession(`LEADS_${reason}`);
    if (refreshed.ok) {
      account = refreshed.account || (await loadAccount());
      out = await callUpsert(account.userToken);
    }
  }

  if (!out.ok) {
    return { ok: false, error: out.error || "LEAD_CLOUD_UPSERT_FAILED", detail: out.data || null };
  }
  return { ok: true };
}

async function syncCloudLeads({ force = false } = {}) {
  if (!hasBackendExtensionKey()) {
    return { ok: false, skipped: true, reason: "BACKEND_KEY_MISSING" };
  }

  const account = await loadAccount();
  if (!account?.userToken) {
    return { ok: false, skipped: true, reason: "AUTH_REQUIRED" };
  }

  const lastSyncMs = parseIsoMs(account.lastCloudSyncAt);
  if (!force && lastSyncMs && Date.now() - lastSyncMs < SAAS_SYNC_MIN_INTERVAL_MS) {
    return { ok: true, cached: true };
  }

  const callList = async (token) =>
    fetchBackendJson(`${BACKEND_LEADS_LIST_URL}?limit=${MAX_LEADS}`, {
      method: "GET",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      timeoutMs: 20000,
    });

  let out = await callList(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession("LEADS_PULL");
    if (refreshed.ok) {
      const next = refreshed.account || (await loadAccount());
      out = await callList(next.userToken);
    }
  }
  if (!out.ok) {
    await saveAccount({ lastCloudSyncAt: nowIso() });
    return { ok: false, error: out.error || "LEADS_PULL_FAILED", detail: out.data || null };
  }

  const cloudLeads = Array.isArray(out.data?.leads) ? out.data.leads : [];
  const localLeads = await loadLeads();
  const merged = mergeLeadsByProfileUrl(localLeads, cloudLeads);
  await saveLeads(merged);

  const callDashboard = async (token) =>
    fetchBackendJson(BACKEND_DASHBOARD_URL, {
      method: "GET",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      timeoutMs: 15000,
    });
  let dashboardToken = (await loadAccount()).userToken;
  let dashboardOut = await callDashboard(dashboardToken);
  if (!dashboardOut.ok && (dashboardOut.httpStatus === 401 || dashboardOut.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession("DASHBOARD_PULL");
    if (refreshed.ok) {
      dashboardToken = (refreshed.account || (await loadAccount())).userToken;
      dashboardOut = await callDashboard(dashboardToken);
    }
  }

  if (dashboardOut.ok) {
    await saveAccount(mergeAccountWithEntitlements(await loadAccount(), dashboardOut.data));
  } else {
    await saveAccount({ lastCloudSyncAt: nowIso() });
  }

  return { ok: true, leads: merged };
}

function assistantSplitTerms(input) {
  return String(input || "")
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function assistantQuoteTerm(term) {
  const t = String(term || "").trim().replace(/\s+/g, " ").slice(0, 64);
  if (!t) return "";
  return /\s/.test(t) ? `"${t}"` : t;
}

function assistantOrClause(terms) {
  if (!terms.length) return "";
  if (terms.length === 1) return assistantQuoteTerm(terms[0]);
  return `(${terms.map(assistantQuoteTerm).filter(Boolean).join(" OR ")})`;
}

function assistantNotClause(terms) {
  if (!terms.length) return "";
  return terms.map((t) => `NOT ${assistantQuoteTerm(t)}`).filter(Boolean).join(" ");
}

function buildAssistantQueries(state = {}) {
  const roles = assistantSplitTerms(state.roles);
  const offerTerms = assistantSplitTerms(state.offer);
  const geoTerms = assistantSplitTerms(state.geo);
  const excludeTerms = assistantSplitTerms(state.exclude);

  const peopleParts = [];
  peopleParts.push(assistantOrClause(roles.length ? roles : ["CEO", "Founder", "Co-Founder"]));
  if (offerTerms.length) peopleParts.push(assistantOrClause(offerTerms));
  if (geoTerms.length) peopleParts.push(assistantOrClause(geoTerms));

  const companyParts = [];
  companyParts.push(assistantOrClause(offerTerms.length ? offerTerms : ["SEO", "marketing"]));
  if (geoTerms.length) companyParts.push(assistantOrClause(geoTerms));

  let people = peopleParts.filter(Boolean).join(" AND ").trim();
  let company = companyParts.filter(Boolean).join(" AND ").trim();

  const notPart = assistantNotClause(excludeTerms);
  if (notPart) {
    people = `${people} ${notPart}`.trim();
    company = `${company} ${notPart}`.trim();
  }
  return { people, company };
}

async function requestAssistantQuery(state = {}, { checkOnly = false } = {}) {
  if (!hasBackendExtensionKey()) {
    return { ok: false, error: "BACKEND_KEY_MISSING" };
  }
  const account = await loadAccount();
  if (!account?.userToken) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  const callAssistant = async (token) =>
    fetchBackendJson(BACKEND_ASSISTANT_QUERY_URL, {
      method: "POST",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      body: {
        state: state && typeof state === "object" ? state : {},
        checkOnly: Boolean(checkOnly),
      },
      timeoutMs: 15000,
    });

  let out = await callAssistant(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession(checkOnly ? "ASSISTANT_ACCESS" : "ASSISTANT_QUERY");
    if (refreshed.ok) {
      const next = refreshed.account || (await loadAccount());
      out = await callAssistant(next.userToken);
    }
  }

  const endpointMissing = !out.ok && (out.httpStatus === 404 || out.error === "HTTP_404");
  if (endpointMissing) {
    const refreshed = await syncEntitlements({ force: false });
    const effectiveAccount = refreshed.ok ? (refreshed.account || (await loadAccount())) : (await loadAccount());
    if (effectiveAccount?.features?.icpAssistant === false) {
      return { ok: false, error: "FEATURE_DISABLED_ICP_ASSISTANT" };
    }
    return {
      ok: true,
      data: {
        ok: true,
        plan: effectiveAccount?.plan || null,
        queries: checkOnly ? undefined : buildAssistantQueries(state || {}),
      },
    };
  }

  if (!out.ok) {
    return { ok: false, error: out.error || "ASSISTANT_QUERY_FAILED", detail: out.data || null };
  }
  return { ok: true, data: out.data || {} };
}

async function requestLeadMessageGeneration({
  lead = null,
  opportunityId = null,
  language = "fr",
  tone = "pro",
  context = null,
} = {}) {
  if (!hasBackendExtensionKey()) {
    return { ok: false, error: "BACKEND_KEY_MISSING" };
  }
  const account = await loadAccount();
  if (!account?.userToken) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  if (!lead || typeof lead !== "object") {
    return { ok: false, error: "INVALID_LEAD_PAYLOAD" };
  }

  const callGen = async (token) =>
    fetchBackendJson(BACKEND_MESSAGE_GENERATE_URL, {
      method: "POST",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      body: {
        lead,
        opportunityId,
        language,
        tone,
        context: context || undefined,
      },
      timeoutMs: 20000,
    });

  let out = await callGen(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession("MESSAGE_GENERATE");
    if (refreshed.ok) {
      const next = refreshed.account || (await loadAccount());
      out = await callGen(next.userToken);
    }
  }

  if (!out.ok) {
    return { ok: false, error: out.error || "MESSAGE_GENERATE_FAILED", detail: out.data || null };
  }
  return { ok: true, data: out.data || {} };
}

async function requestSeoSingleExport({ lead = null, opportunityId = null, language = "fr" } = {}) {
  if (!hasBackendExtensionKey()) {
    return { ok: false, error: "BACKEND_KEY_MISSING" };
  }
  const account = await loadAccount();
  if (!account?.userToken) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  if (!lead || typeof lead !== "object") {
    return { ok: false, error: "INVALID_LEAD_PAYLOAD" };
  }

  const callExport = async (token) =>
    fetchBackendJson(BACKEND_SEO_EXPORT_SINGLE_URL, {
      method: "POST",
      headers: {
        "x-ext-key": BACKEND_EXT_API_KEY,
        "x-user-token": token,
      },
      body: {
        lead,
        opportunityId,
        language,
        format: "csv",
      },
      timeoutMs: 20000,
    });

  let out = await callExport(account.userToken);
  if (!out.ok && (out.httpStatus === 401 || out.error === "UNAUTHORIZED_USER_TOKEN")) {
    const refreshed = await ensureSaasSession("SEO_EXPORT_SINGLE");
    if (refreshed.ok) {
      const next = refreshed.account || (await loadAccount());
      out = await callExport(next.userToken);
    }
  }

  if (!out.ok) {
    return { ok: false, error: out.error || "SEO_EXPORT_SINGLE_FAILED", detail: out.data || null };
  }
  return { ok: true, data: out.data || {} };
}

function hasActionableSignal(lead = {}) {
  const topAction = String(lead?.ui?.actionLabel || lead?.decision?.final || "").toUpperCase();
  if (
    topAction.includes("CONTACT NOW") ||
    topAction.includes("CONTACT_SOFT") ||
    topAction.includes("FIND_DECISION_MAKER")
  ) {
    return true;
  }
  const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
  return opps.some((o) => {
    const a = String(o?.action || o?.ui?.actionLabel || "").toUpperCase();
    return a.includes("CONTACT_NOW") || a.includes("CONTACT_SOFT") || a.includes("FIND_DECISION_MAKER");
  });
}

function hasDeciderSignal(lead = {}) {
  const normalizeRole = (raw) =>
    String(raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  const roleLooksDecider = (raw) => {
    const r = normalizeRole(raw);
    return (
      r.includes("DECISION") ||
      r.includes("DECIDEUR") ||
      r.includes("CEO") ||
      r.includes("FOUNDER") ||
      r.includes("OWNER") ||
      r.includes("DIRECTOR")
    );
  };

  if (roleLooksDecider(lead?.ui?.role || lead?.decision?.signals?.role)) return true;
  const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
  return opps.some((o) => roleLooksDecider(o?.role || o?.ui?.role));
}

function buildLocalDashboard(leads = []) {
  const leadStats = computeLeadStats(leads);
  const actionable = leads.filter((x) => hasActionableSignal(x)).length;
  const deciders = leads.filter((x) => hasDeciderSignal(x)).length;
  const ignored = leads.filter((x) => {
    const action = String(x?.ui?.actionLabel || x?.decision?.final || "").toUpperCase();
    return action.includes("IGNORE");
  }).length;
  let lastCaptureAt = null;
  for (const lead of leads) {
    const t = leadSortTs(lead);
    if (!t) continue;
    if (!lastCaptureAt || t > Date.parse(lastCaptureAt)) {
      lastCaptureAt = new Date(t).toISOString();
    }
  }
  return {
    leadStats,
    leadsCount: leadStats.TOTAL,
    actionable,
    deciders,
    ignored,
    conversionPct: leadStats.TOTAL ? Math.round((actionable / leadStats.TOTAL) * 100) : 0,
    lastCaptureAt,
  };
}

// ================= PERSISTENT ACTIVITY LOGS =================
async function loadLogs() {
  return await getLocal(LOGS_KEY, []);
}

// userMsg: string shown to regular users. null = show raw message to all. false = admin-only.
async function pushLog(message, level = "INFO", meta = null, userMsg = null) {
  const entry = {
    id: uuid(),
    at: nowIso(),
    level, // INFO | WARN | ERROR
    message: String(message),
    meta: meta ? JSON.parse(JSON.stringify(meta)) : null,
    userMsg: userMsg === false ? false : (userMsg != null ? String(userMsg) : null),
  };

  const logs = await loadLogs();
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  await setLocal(LOGS_KEY, logs);

  broadcastToPanels({ type: "LOG_APPENDED", entry });
  return entry;
}

async function loadOverrideFeedbackEvents() {
  const rows = await getLocal(OVERRIDE_FEEDBACK_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

async function pushOverrideFeedbackEvent(payload = {}) {
  const account = await loadAccount();
  const entry = {
    id: uuid(),
    at: nowIso(),
    type: "OVERRIDE_DECISION",
    source: String(payload?.source || "LEADS_INLINE_OVERRIDE"),
    route: String(payload?.route || "leads"),
    userId: String(account?.userId || "").trim() || null,
    email: String(account?.email || "").trim().toLowerCase() || null,
    authMethod: String(account?.authMethod || "GUEST"),
    profileUrl:
      normalizeLinkedInProfileUrl(payload?.profileUrl) ||
      String(payload?.profileUrl || "").trim() ||
      null,
    leadId: String(payload?.leadId || "").trim() || null,
    fromFinal: String(payload?.fromFinal || "").trim().toUpperCase() || null,
    toFinal: String(payload?.toFinal || "").trim().toUpperCase() || null,
    fromLeadType: String(payload?.fromLeadType || "").trim().toUpperCase() || null,
    toLeadType: String(payload?.toLeadType || "").trim().toUpperCase() || null,
  };

  const rows = await loadOverrideFeedbackEvents();
  rows.push(entry);
  if (rows.length > MAX_OVERRIDE_FEEDBACK) {
    rows.splice(0, rows.length - MAX_OVERRIDE_FEEDBACK);
  }
  await setLocal(OVERRIDE_FEEDBACK_KEY, rows);
  return entry;
}

function broadcastToPanels(msg) {
  for (const p of panelPorts) {
    try {
      p.postMessage(msg);
    } catch {}
  }
}

async function broadcastSnapshot(reason = "SNAPSHOT") {
  const snapshot = await buildSnapshot();
  broadcastToPanels({ type: "SNAPSHOT", reason, snapshot });
}

// ================= LEADS STORE =================
function leadsScopeIdFromAccount(account = {}) {
  const email = String(account?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;

  const linkedinProfileUrl = normalizeLinkedInProfileUrl(account?.linkedinProfileUrl);
  if (linkedinProfileUrl) return `linkedin:${linkedinProfileUrl}`;

  const userId = String(account?.userId || "").trim();
  if (userId) return `uid:${userId}`;

  return "guest";
}

function leadsStorageKeyForAccount(account = {}) {
  const scopeId = leadsScopeIdFromAccount(account);
  return `${LEADS_KEY}::${encodeURIComponent(scopeId)}`;
}

async function getCurrentLeadsStorageKey(account = null) {
  const activeAccount = account || (await loadAccount());
  return leadsStorageKeyForAccount(activeAccount);
}

async function loadLeads(account = null) {
  const key = await getCurrentLeadsStorageKey(account);
  const leads = await getLocal(key, []);
  return Array.isArray(leads) ? leads : [];
}

async function saveLeads(leads, account = null) {
  const key = await getCurrentLeadsStorageKey(account);
  await setLocal(key, Array.isArray(leads) ? leads : []);
}

async function clearLeadsStore(account = null) {
  const key = await getCurrentLeadsStorageKey(account);
  await setLocal(key, []);
  // Keep legacy key empty to avoid stale mixed-account data from old versions.
  await setLocal(LEADS_KEY, []);
}

function normalizeLeadType(x) {
  const v = String(x || "").toUpperCase();
  if (v.includes("HOT")) return "HOT_LEAD";
  if (v.includes("WARM")) return "WARM_LEAD";
  if (v.includes("COLD")) return "COLD_LEAD";
  return "UNKNOWN";
}

function decisionActionToLeadType(action) {
  const a = String(action || "").toUpperCase();
  if (a === "CONTACT_NOW") return "HOT_LEAD";
  if (a === "CONTACT_SOFT") return "WARM_LEAD";
  if (a === "FIND_DECISION_MAKER") return "WARM_LEAD";
  if (a === "IGNORE") return "COLD_LEAD";
  return "UNKNOWN";
}

function computeLeadStats(leads) {
  const stats = { HOT: 0, WARM: 0, COLD: 0, UNKNOWN: 0, TOTAL: 0 };
  for (const l of leads) {
    stats.TOTAL++;
    if (l.leadType === "HOT_LEAD") stats.HOT++;
    else if (l.leadType === "WARM_LEAD") stats.WARM++;
    else if (l.leadType === "COLD_LEAD") stats.COLD++;
    else stats.UNKNOWN++;
  }
  return stats;
}




async function addLead(lead) {
  if (!lead || !lead.profileUrl) {
    warn("addLead called with invalid lead");
    return;
  }

  const normalizedProfileUrl = profileDedupKey(lead.profileUrl);
  if (normalizedProfileUrl) {
    lead.profileUrl = normalizedProfileUrl;
  }

  const leads = await loadLeads();
  const targetProfileUrl = normalizedProfileUrl || String(lead.profileUrl || "").trim();
  const existingIndex = leads.findIndex(
    (l) => {
      const existingKey = profileDedupKey(l?.profileUrl) || String(l?.profileUrl || "").trim();
      return Boolean(targetProfileUrl && existingKey && existingKey === targetProfileUrl);
    }
  );

  // ================= SANITIZE =================
  lead.opportunities = Array.isArray(lead.opportunities)
    ? lead.opportunities
    : [];

  // ================= PRIMARY OPPORTUNITY =================
  let primaryOpp =
    lead.opportunities.find(o => o.opportunityStatus === "PRIMARY") ||
    lead.opportunities.find(o => o.leadType === "HOT_LEAD" && o.role === "DECISION_MAKER") ||
    lead.opportunities.find(o => o.leadType === "HOT_LEAD") ||
    lead.opportunities.find(o => o.leadType === "WARM_LEAD" && o.role === "DECISION_MAKER") ||
    lead.opportunities.find(o => o.leadType === "WARM_LEAD") ||
    lead.opportunities.find(o => o.role === "DECISION_MAKER") ||
    lead.opportunities[0] ||
    null;

  if (!primaryOpp) {
    warn("Lead without opportunities â€” ignored", lead.profileUrl);
    return;
  }

  // ================= OPPORTUNITY STATUS =================
  for (const o of lead.opportunities) {
    o.opportunityStatus =
      o === primaryOpp
        ? "PRIMARY"
        : (o.leadType === "WARM_LEAD" ? "SECONDARY" : "IGNORED");
  }

  // ================= PROMOTE TO LEAD =================
  lead.ui = primaryOpp.ui || null;

  lead.decision = {
    leadType: primaryOpp.leadType,
    final: primaryOpp.action,
    confidence: primaryOpp.ui?.confidence || "LOW",
    reason: primaryOpp.reason,
    signals: {
      role: primaryOpp.role || "UNKNOWN",
      seoLevel: primaryOpp.seoLevel || null,
      siteType: primaryOpp.siteType || null,
      websiteStatus: primaryOpp.websiteStatus || null,
      rawScore:
        typeof primaryOpp.rawScore === "number"
          ? primaryOpp.rawScore
          : null,
      seoSource: primaryOpp.seoSource || null,
      seoIssues: Array.isArray(primaryOpp.seoIssues) ? primaryOpp.seoIssues : null,
      seoPassed: Array.isArray(primaryOpp.seoPassed) ? primaryOpp.seoPassed : null,
      bestPractices: typeof primaryOpp.bestPractices === "number" ? primaryOpp.bestPractices : null,
      gatheredAt: primaryOpp.gatheredAt || null,
    },
  };

  lead.company = primaryOpp.company ?? null;
  lead.jobTitle = primaryOpp.jobTitle ?? null;
  lead.website = primaryOpp.website || null;
  lead.websiteStatus = primaryOpp.websiteStatus || null;
  lead.seoLevel = primaryOpp.seoLevel || null;
  lead.siteType = primaryOpp.siteType || null;
  lead.leadType = primaryOpp.leadType || "COLD_LEAD";

  // ================= UPSERT =================
  if (existingIndex !== -1) {
    leads[existingIndex] = lead;
  } else {
    leads.unshift(lead);
  }

  if (leads.length > MAX_LEADS) leads.splice(MAX_LEADS);

  await saveLeads(leads);
  const cloud = await upsertCloudLead(lead, "ADD_OR_UPDATE");
  if (!cloud.ok && !cloud.skipped) {
    if (cloud.error === "LEADS_TABLE_MISSING") {
      if (!LEADS_TABLE_WARNING_EMITTED) {
        LEADS_TABLE_WARNING_EMITTED = true;
        await pushLog("Cloud leads table missing (`leads_cloud`)", "WARN");
      }
    } else {
      await pushLog("Cloud lead sync failed", "WARN", {
        error: cloud.error || "unknown",
        profileUrl: lead.profileUrl,
      });
    }
  }

  const stats = computeLeadStats(leads);
  broadcastToPanels({ type: "LEAD_ADDED", lead, stats });

  log("Lead stored:", lead.profileUrl, lead.leadType);
  return { leads, stats };
}




function pickDecisionFields(decision) {
  const d = decision?.decision || decision || {};
  const signals = d?.signals || {};

  // âœ… PRIORITÃ‰ ABSOLUE AU leadType DU MOTEUR
  let leadType = d.leadType;

  // ðŸ” fallback legacy si absent
  if (!leadType) {
    if (d.final === "CONTACT_NOW") leadType = "HOT_LEAD";
    else if (d.final === "CONTACT_SOFT") leadType = "WARM_LEAD";
    else if (d.final === "FIND_DECISION_MAKER") leadType = "WARM_LEAD";
    else if (d.final === "IGNORE") leadType = "COLD_LEAD";
    else leadType = "UNKNOWN";
  }

  return {
    leadType,
    action: d.final || null,
    role: signals?.role || null,
    seoLevel: signals?.seoLevel || null,
    siteType: signals?.siteType || null,
    websiteStatus: signals?.websiteStatus || d?.websiteStatus || null,
    rawScore:
      typeof signals?.rawScore === "number"
        ? signals.rawScore
        : (typeof d?.rawScore === "number" ? d.rawScore : null),
    seoSource: signals?.seoSource || null,
    seoIssues: Array.isArray(signals?.seoIssues) ? signals.seoIssues : null,
    seoPassed: Array.isArray(signals?.seoPassed) ? signals.seoPassed : null,
    bestPractices: signals?.cwv?.scores?.bestPractices ?? null,
    gatheredAt: signals?.cwv?.gatheredAt ?? null,
    reason: d.reason || null,
    detectedHeadline: d.detectedHeadline || null,
    painBusiness: d.painBusiness || null,
    decidedAt: d.engine?.decidedAt || null,
  };
}



function buildUiFromDecision(d, decisionRaw = {}, payload = {}) {
  const rawAction = d?.action || decisionRaw?.action || "UNDECIDED";

  return {
    seoBadge: "â“ SEO UNKNOWN",
    seoColor: "gray",
    seoEmoji: "â“",
    seoLabel: "SEO non Ã©valuÃ©",

    actionLabel: rawAction.replaceAll("_", " "),
    actionEmoji: rawAction.includes("CONTACT") ? "ðŸ“©" : "â¸ï¸",

    role: d?.role || "UNKNOWN",
    detectedHeadline:
      d?.detectedHeadline || payload?.headline || "",

    confidence: decisionRaw?.confidence || "LOW",
    painBusiness: d?.painBusiness || "UNKNOWN",
    reason: d?.reason || "Fallback UI",
  };
}

// ================= INIT =================
async function restorePipelineStatus() {
  try {
    const v = await getLocal(PIPELINE_KEY, "PAUSED");
    if (v === "RUNNING" || v === "PAUSED") PIPELINE_STATUS = v;
    log("Pipeline restored:", PIPELINE_STATUS);
    await pushLog(`Pipeline restored: ${PIPELINE_STATUS}`);
    if (!hasBackendExtensionKey()) {
      await pushLog(
        "Render backend key not set in extension (direct n8n fallback active)",
        "WARN", null, "Service starting up…"
      );
    } else {
      await pushLog("Render backend gateway active", "INFO", null, "Service ready");
      const sync = await ensureSaasSession("BOOT");
      if (!sync.ok && !sync.skipped) {
        await pushLog("SaaS bootstrap failed", "WARN", { error: sync.error || sync.reason || "unknown" }, "Service sync warning");
      } else {
        const cloud = await syncCloudLeads({ force: true });
        if (!cloud.ok && !cloud.skipped) {
          await pushLog("Cloud leads bootstrap sync failed", "WARN", {
            error: cloud.error || "unknown",
          }, "Lead sync warning");
        }
      }
    }
  } catch (e) {
    warn("Pipeline restore failed", e);
    await pushLog("Pipeline restore failed", "WARN", { error: String(e) }, "Startup warning");
  }
}
restorePipelineStatus();

// ================= URL HELPERS =================
function isHttpUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  );
}

function isLinkedInUrl(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    return u.hostname.endsWith("linkedin.com");
  } catch {
    return false;
  }
}

function isLinkedInCompanyUrl(u) {
  if (!isHttpUrl(u)) return false;
  try {
    const url = new URL(u);
    return url.hostname.endsWith("linkedin.com") && url.pathname.startsWith("/company/");
  } catch {
    return false;
  }
}

function toCompanyAboutUrl(u) {
  try {
    const url = new URL(u);
    if (!url.pathname.startsWith("/company/")) return u;

    const parts = url.pathname.split("/").filter(Boolean); // ["company","slug",...]
    if (parts.length < 2) return u;

    url.pathname = `/${parts[0]}/${parts[1]}/about/`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

function normalizeCompanyLinkedinUrl(u) {
  if (!isHttpUrl(u)) return null;
  try {
    const url = new URL(u);
    if (!url.hostname.endsWith("linkedin.com")) return null;
    if (!url.pathname.startsWith("/company/")) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    url.pathname = `/company/${parts[1]}/`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeCompanyForLookup(name) {
  let t = String(name || "").trim();
  if (!t) return null;
  t = t.split("·")[0].trim();
  t = t.split("•")[0].trim();
  t = t.split("|")[0].trim();
  t = t.split("(")[0].trim();
  t = t.split(",")[0].trim();
  t = t.replace(/\s+(paris|france|tunisie|hybride)\b.*$/i, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  return t || null;
}

function buildCompanyLookupQueries(companyName) {
  const base = sanitizeCompanyForLookup(companyName);
  if (!base) return [];

  const out = [];
  const seen = new Set();
  const push = (v) => {
    const clean = sanitizeCompanyForLookup(v);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  push(base);

  String(base)
    .split(/\s+\-\s+|\s+\|\s+|\s+\/\s+|\s+&\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach(push);

  const words = base.split(/\s+/).filter(Boolean);
  if (words.length >= 2) push(words.slice(0, 2).join(" "));
  if (words.length >= 1 && words[0].length >= 4) push(words[0]);

  return out.slice(0, 5);
}

function normalizeLinkedInProfileUrl(u) {
  if (!isHttpUrl(u)) return null;
  try {
    const url = new URL(u);
    if (!url.hostname.endsWith("linkedin.com")) return null;
    if (!url.pathname.startsWith("/in/")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${LINKEDIN_PROFILE_CANONICAL_ORIGIN}/in/${parts[1]}/`;
  } catch {
    return null;
  }
}

function profileDedupKey(profileUrl) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (normalized) return normalized;

  const raw = String(profileUrl || "").trim();
  if (!raw) return null;
  return raw
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "/")
    .toLowerCase();
}

function isCaptureSuppressed(profileUrl) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalized) return false;
  const until = SUPPRESS_CAPTURE_UNTIL.get(normalized) || 0;
  const active = until > Date.now();
  if (!active && SUPPRESS_CAPTURE_UNTIL.has(normalized)) {
    SUPPRESS_CAPTURE_UNTIL.delete(normalized);
  }
  return active;
}

function isBadProspectWebsiteHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  const hostMatchesBlocked = (host, token) => {
    const t = String(token || "").toLowerCase();
    if (!t) return false;
    if (t.endsWith(".")) {
      const base = t.slice(0, -1);
      if (!base) return false;
      return host === base || host.includes(`${base}.`);
    }
    return host === t || host.endsWith(`.${t}`);
  };
  const blocked = [
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "tiktok.com",
    "wikipedia.org",
    "glassdoor.",
    "indeed.",
    "welcometothejungle.",
    "bing.com",
    "google.com",
  ];
  return blocked.some((b) => hostMatchesBlocked(h, b));
}

function normalizeProspectWebsite(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return null;

  const unwrapLinkedinRedirect = (value) => {
    try {
      const u = new URL(value, LINKEDIN_PROFILE_CANONICAL_ORIGIN);
      if (!u.hostname.toLowerCase().endsWith("linkedin.com")) return value;
      const encoded =
        u.searchParams.get("url") ||
        u.searchParams.get("redirect") ||
        u.searchParams.get("dest");
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

  const candidate = unwrapLinkedinRedirect(raw);
  if (!candidate) return null;

  try {
    const u = new URL(candidate, LINKEDIN_PROFILE_CANONICAL_ORIGIN);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (isBadProspectWebsiteHost(u.hostname)) return null;
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((p) => {
      u.searchParams.delete(p);
    });
    return u.toString();
  } catch {
    return null;
  }
}

function tokenizeDomainLike(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function getCompanySlugTokens(companyLinkedinUrl) {
  try {
    const u = new URL(String(companyLinkedinUrl || ""));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] !== "company" || !parts[1]) return [];
    return tokenizeDomainLike(parts[1]);
  } catch {
    return [];
  }
}

function isWebsiteLikelyForCompany(websiteUrl, companyName, companyLinkedinUrl = null) {
  let host = "";
  try {
    host = new URL(String(websiteUrl || "")).hostname.toLowerCase();
  } catch {
    return false;
  }

  const hostTokens = tokenizeDomainLike(host.replace(/^www\./, ""));
  if (!hostTokens.length) return false;

  const nameTokens = tokenizeDomainLike(companyName);
  const slugTokens = getCompanySlugTokens(companyLinkedinUrl);
  const reference = slugTokens.length ? slugTokens : nameTokens;
  if (!reference.length) return false;

  const matches = reference.filter((t) => hostTokens.includes(t)).length;
  if (reference.length === 1) return matches >= 1;
  return matches >= 2;
}

async function isWebsiteReachable(url) {
  const target = String(url || "").trim();
  if (!target) return false;

  const attempt = async (method) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(target, {
        method,
        redirect: "follow",
        signal: ctl.signal,
      });
      if (res.status >= 200 && res.status < 500) return true;
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const headOk = await attempt("HEAD");
  if (headOk) return true;
  return await attempt("GET");
}

function waitForTabComplete(tabId, timeoutMs = MESSAGE_TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(ok);
    };

    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "complete") finish(true);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(() => finish(false), timeoutMs);

    chrome.tabs.get(tabId).then((t) => {
      if (t?.status === "complete") finish(true);
    }).catch(() => finish(false));
  });
}

async function extractLinkedinSessionIdentityFromActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id || !isLinkedInUrl(tab.url)) {
    throw new Error("ACTIVE_TAB_NOT_LINKEDIN");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: () => {
      const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const toProfile = (href) => {
        try {
          const u = new URL(href, location.origin);
          if (!u.hostname.endsWith("linkedin.com")) return null;
          if (!u.pathname.startsWith("/in/")) return null;
          const parts = u.pathname.split("/").filter(Boolean);
          if (parts.length < 2) return null;
          return `${u.origin}/in/${parts[1]}/`;
        } catch {
          return null;
        }
      };

      const anchors = Array.from(document.querySelectorAll('a[href*="/in/"]'));
      let best = null;
      let bestScore = -1;

      for (const a of anchors) {
        const profileUrl = toProfile(a.href || a.getAttribute("href"));
        if (!profileUrl) continue;

        const aria = clean(a.getAttribute("aria-label"));
        const txt = clean(a.innerText);
        const cls = clean(a.className);
        const inHeader = Boolean(a.closest("header"));

        let score = 1;
        if (a.hasAttribute("data-test-global-nav-me")) score += 120;
        if (/global-nav__me/i.test(cls)) score += 80;
        if (/view profile|voir le profil|profil/i.test(aria)) score += 45;
        if (inHeader) score += 20;
        if (/^\/in\/me\/?/i.test(a.getAttribute("href") || "")) score += 20;

        if (score > bestScore) {
          bestScore = score;
          best = {
            profileUrl,
            name: txt || null,
            ariaLabel: aria || null,
          };
        }
      }

      return best || null;
    },
  });

  if (!result?.profileUrl) {
    throw new Error("LINKEDIN_IDENTITY_NOT_FOUND");
  }

  return {
    authMethod: "LINKEDIN_SESSION",
    identity: result.name || result.ariaLabel || "LinkedIn user",
    linkedinProfileUrl: result.profileUrl,
    connectedAt: nowIso(),
  };
}

async function sendMessageToLinkedInProfile({ profileUrl, message, autoSend = true }) {
  const normalizedProfile = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalizedProfile) throw new Error("INVALID_PROFILE_URL");
  if (!String(message || "").trim()) throw new Error("EMPTY_MESSAGE");

  const tab = await chrome.tabs.create({
    url: normalizedProfile,
    active: MESSAGE_TAB_ACTIVE,
  });

  await waitForTabComplete(tab.id, MESSAGE_TAB_LOAD_TIMEOUT_MS);
  await sleep(900);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: async (messageText, shouldAutoSend) => {
      try {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const hasWord = (v, rx) => rx.test(clean(v));

        if (
          !location.pathname.startsWith("/in/") &&
          !location.pathname.startsWith("/messaging/")
        ) {
          return {
            ok: false,
            status: "NOT_SUPPORTED_PAGE",
            page: location.href,
          };
        }

        const isProfileActionButton = (el) => {
          if (!el) return false;
          if (!el.closest("main")) return false;
          if (el.closest("header")) return false;
          if (el.closest("nav")) return false;
          if (el.closest(".msg-conversations-container")) return false;
          return true;
        };

        const isVisible = (el) => {
          if (!el) return false;
          const win = el.ownerDocument?.defaultView || window;
          const style = win.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };

        const getAccessibleDocuments = () => {
          const docs = [document];
          const frames = Array.from(document.querySelectorAll("iframe"));
          for (const f of frames) {
            try {
              const fd = f.contentDocument;
              if (fd && !docs.includes(fd)) docs.push(fd);
            } catch {}
          }
          return docs;
        };

        const getOpenShadowRoots = (rootNode) => {
          const roots = [];
          const stack = [rootNode];
          while (stack.length) {
            const root = stack.pop();
            if (!root || !root.querySelectorAll) continue;
            const all = Array.from(root.querySelectorAll("*"));
            for (const el of all) {
              if (el?.shadowRoot) {
                roots.push(el.shadowRoot);
                stack.push(el.shadowRoot);
              }
            }
          }
          return roots;
        };

        const queryAllInDocs = (selectors) => {
          const docs = getAccessibleDocuments();
          const out = [];
          for (const doc of docs) {
            const roots = [doc, ...getOpenShadowRoots(doc)];
            for (const root of roots) {
              for (const sel of selectors) {
                for (const node of Array.from(root.querySelectorAll(sel))) {
                  if (!node || out.includes(node)) continue;
                  out.push(node);
                }
              }
            }
          }
          return out;
        };

        const findMessageButton = () => {
          const strongSelectors = [
            'main button[aria-label*="message" i]',
            'main a[aria-label*="message" i]',
            'main button[aria-label*="envoyer un message" i]',
            'main a[aria-label*="envoyer un message" i]',
            'main .pv-top-card-v2-ctas button',
            'main .pvs-profile-actions button',
            'main .pv-top-card a',
          ];

          for (const sel of strongSelectors) {
            const nodes = Array.from(document.querySelectorAll(sel));
            for (const el of nodes) {
              if (!isProfileActionButton(el)) continue;
              const txt = clean(el.innerText);
              const aria = clean(el.getAttribute("aria-label"));
              const isMsg =
                hasWord(txt, /^(message|envoyer un message|send message)$/i) ||
                hasWord(aria, /(envoyer un message|send message|message)/i);
              if (isMsg) return el;
            }
          }

          // fallback wide scan in main only
          const all = Array.from(document.querySelectorAll("main button, main a"));
          return (
            all.find((el) => {
              if (!isProfileActionButton(el)) return false;
              const txt = clean(el.innerText);
              const aria = clean(el.getAttribute("aria-label"));
              const isMsgTxt = /^(message|envoyer un message|send message)$/i.test(txt);
              const isMsgAria = /(envoyer un message|send message)/i.test(aria);
              return isMsgTxt || isMsgAria;
            }) || null
          );
        };

        const getComposerCandidates = () => {
          const selectors = [
            "textarea.msg-form__contenteditable",
            ".msg-form textarea",
            ".msg-overlay textarea",
            ".msg-s-message-list__composer textarea",
            "textarea[aria-label*='message' i]",
            "textarea[aria-label*='rédigez' i]",
            "textarea[placeholder*='message' i]",
            "textarea[placeholder*='rédigez' i]",
            ".msg-form__contenteditable[contenteditable='true']",
            ".msg-form__contenteditable",
            ".msg-form div[contenteditable='true']",
            ".msg-form div[role='textbox']",
            ".msg-form [data-placeholder*='message' i]",
            ".msg-form [data-placeholder*='rédigez' i]",
            ".msg-overlay .msg-form__contenteditable[contenteditable='true']",
            ".msg-overlay [role='textbox']",
            ".artdeco-modal div[role='textbox'][contenteditable='true']",
            ".artdeco-modal div[role='textbox']",
            "div[role='textbox'][contenteditable='true']",
            "div[role='textbox']",
            "[contenteditable='true'][aria-label*='message' i]",
            "[contenteditable='true'][aria-label*='rédigez' i]",
          ];
          const nodes = queryAllInDocs(selectors);
          return nodes.filter((n) => isVisible(n));
        };

        const fillComposer = (text) => {
          const candidates = getComposerCandidates();
          for (const node of candidates) {
            if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
              node.focus();
              node.click?.();
              node.value = text;
              node.dispatchEvent(new Event("input", { bubbles: true }));
              node.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }

            const isEditable =
              node.getAttribute("contenteditable") === "true" ||
              node.getAttribute("role") === "textbox" ||
              node.classList?.contains("msg-form__contenteditable");
            if (!isEditable) continue;

            node.focus();
            node.click?.();
            try {
              const ownerDoc = node.ownerDocument || document;
              const ownerWin = ownerDoc.defaultView || window;
              const selection = ownerWin.getSelection?.();
              if (selection) {
                selection.removeAllRanges();
                const range = ownerDoc.createRange();
                range.selectNodeContents(node);
                selection.addRange(range);
              }
              ownerDoc.execCommand?.("insertText", false, text);
            } catch {}

            // Fallback for UIs ignoring execCommand
            if (!node.textContent || !node.textContent.trim()) {
              node.textContent = text;
            }
            node.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                data: text,
                inputType: "insertText",
              })
            );
            node.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          return false;
        };

        const activateComposerByPlaceholder = () => {
          const selectors = [
            ".msg-form__placeholder",
            ".msg-form__placeholder--new-message",
            "[data-placeholder*='rédigez' i]",
            "[data-placeholder*='message' i]",
            "[aria-label*='rédigez un message' i]",
            "[aria-label*='write a message' i]",
            ".msg-form__contenteditable",
            ".msg-overlay [role='textbox']",
          ];
          const nodes = queryAllInDocs(selectors);
          for (const n of nodes) {
            if (!isVisible(n)) continue;
            try {
              n.click?.();
              n.focus?.();
            } catch {}
          }
        };

        const findSendBtn = () => {
          const docs = getAccessibleDocuments();
          for (const doc of docs) {
            const contexts = [
              doc.querySelector(".msg-overlay"),
              doc.querySelector(".msg-form"),
              doc.querySelector(".msg-s-message-list__composer"),
              doc.querySelector(".artdeco-modal"),
              doc,
            ].filter(Boolean);
            for (const ctx of contexts) {
              const buttons = Array.from(ctx.querySelectorAll("button"));
            const btn =
              buttons.find((b) => {
                if (b.disabled) return false;
                if (!isVisible(b)) return false;
                const txt = clean(b.innerText);
                const aria = clean(b.getAttribute("aria-label"));
                return (
                  txt === "send" ||
                  txt === "envoyer" ||
                  /send message|envoyer le message|envoyer/i.test(aria)
                );
              }) ||
              ctx.querySelector(
                "button.msg-form__send-button:not([disabled]), button[data-control-name*='send' i]:not([disabled]), button[type='submit']:not([disabled])"
              );
              if (btn) return btn;
            }
          }
          return null;
        };

        let clicked = getComposerCandidates().length > 0;
        for (let i = 0; i < 20 && !clicked; i++) {
          const btn = findMessageButton();
          if (btn) {
            btn.click();
            clicked = true;
            break;
          }
          await sleep(300);
        }
        if (!clicked) {
          return {
            ok: false,
            status: "MESSAGE_BUTTON_NOT_FOUND",
            hint: "Maybe not 1st-degree connection or messaging disabled",
          };
        }

        let composed = false;
        for (let i = 0; i < 40; i++) {
          if (i === 8 || i === 16) {
            try {
              window.scrollTo(0, document.body.scrollHeight);
            } catch {}
          }
          activateComposerByPlaceholder();
          if (fillComposer(messageText)) {
            composed = true;
            break;
          }
          await sleep(250);
        }
        if (!composed) {
          const candidatesCount = getComposerCandidates().length;
          return {
            ok: false,
            status: "COMPOSER_NOT_FOUND",
            hint: "LinkedIn dialog did not open or selector changed",
            candidatesCount,
            docsScanned: getAccessibleDocuments().length,
            page: location.href,
          };
        }

        if (!shouldAutoSend) {
          return { ok: true, status: "DRAFT_FILLED" };
        }

        let sendClicked = false;
        for (let i = 0; i < 14; i++) {
          const sendBtn = findSendBtn();
          if (sendBtn) {
            sendBtn.click();
            sendClicked = true;
            break;
          }
          await sleep(220);
        }

        if (!sendClicked) {
          return { ok: false, status: "SEND_BUTTON_NOT_FOUND" };
        }
        return { ok: true, status: "SENT" };
      } catch (e) {
        return { ok: false, status: "SCRIPT_ERROR", error: String(e) };
      }
    },
    args: [String(message || ""), Boolean(autoSend)],
  });

  return {
    tabId: tab.id,
    profileUrl: normalizedProfile,
    result: result || { ok: false, status: "EXECUTE_NO_RESULT" },
  };
}

function isLikelyCurrentPosition(pos) {
  if (!pos) return false;
  if (pos.isCurrent === true || String(pos.isCurrent).toLowerCase() === "true") {
    return true;
  }

  const txt = `${pos.title || ""} ${pos.companyName || ""}`.toLowerCase();
  if (/\b(aujourd['’]hui|present|current|a ce jour|à ce jour|now|actuel)\b/i.test(txt)) return true;
  if (/\b(former|ancien|retired|ex-)\b/i.test(txt)) return false;
  return false;
}

function isLikelyPastPosition(pos) {
  if (!pos) return false;
  if (pos.isCurrent === false || String(pos.isCurrent).toLowerCase() === "false") {
    return true;
  }
  const txt = `${pos.title || ""} ${pos.companyName || ""}`.toLowerCase();
  if (/\b(former|ancien|retired|ex-)\b/i.test(txt)) return true;
  if (
    /\-\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|f[eé]v|avr|mai|juin|juil|ao[uû]t|sept|oct|nov|d[eé]c)\.?\s+)?(?:19|20)\d{2}\b/i.test(
      txt
    ) &&
    !/\b(present|current|aujourd['’]hui|a ce jour|à ce jour)\b/i.test(txt)
  ) {
    return true;
  }
  return false;
}

function sanitizePositionText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeCompanyNameFromPosition(v) {
  let t = sanitizePositionText(v);
  if (!t) return null;
  t = t.split("·")[0].trim();
  t = t.split("•")[0].trim();
  t = t.split("|")[0].trim();
  t = t.split(",")[0].trim();
  t = t.replace(/^(ceo|co-?founder|founder|owner|director|directeur|manager|head)\s*[-:/]\s*/i, "").trim();
  t = t.replace(/^(ceo|co-?founder|founder|owner|director|directeur|manager|head)\s+/i, "").trim();
  t = t.replace(/\b(ceo|co-?founder|founder|owner|director|directeur|manager|head)\b/gi, "").trim();
  t = t.replace(/\s{2,}/g, " ").trim();
  t = t.replace(/\s+(paris|france|tunisie|hybride)\b.*$/i, "").trim();
  if (/\b(\d[\d\s.,]*\s*(abonn[eé]s?|followers?)|abonn[eé]s?|followers?)\b/i.test(t)) {
    return null;
  }
  if (/\b(coordonn[eé]es|relations|connections|contact)\b/i.test(t)) return null;
  if (/\b(universit|university|école|ecole|school|institut|faculty|lycee|lycée)\b/i.test(t)) {
    return null;
  }
  if (!/[a-zA-ZÀ-ÿ]/.test(t)) return null;
  return t || null;
}

function sanitizeTitleFromPosition(v, personName = "") {
  let t = sanitizePositionText(v);
  if (!t) return null;
  const n = sanitizePositionText(personName);
  if (n && t.toLowerCase().startsWith(`${n.toLowerCase()} · `)) {
    t = t.slice(n.length + 3);
  }
  t = t.split("·")[0].trim();
  t = t.split("•")[0].trim();
  t = t.split("|")[0].trim();
  return t || null;
}

function isNoisePosition(pos) {
  const title = String(pos?.title || "").toLowerCase();
  const company = String(pos?.companyName || "").toLowerCase();
  if (!title && !company && !pos?.companyLinkedinUrl) return true;
  if (/(fil d['’]actualité|feed|home|premium|coordonnées|coordonnees)/i.test(title)) return true;
  if (/(fil d['’]actualité|feed|home|premium|coordonnées|coordonnees)/i.test(company)) return true;
  if (/(abonn[eé]s?|followers?|relations|connections)/i.test(company)) return true;
  if (/\b(universit|university|école|ecole|school|institut|faculty|lycee|lycée)\b/i.test(company)) return true;
  if (/\b(certif(?:ication)?|certificate|licen[cs]e|dipl[oô]me|formation|education|comp[ée]tence|skill|badge|exam|test)\b/i.test(title)) return true;
  if (/\b(certif(?:ication)?|certificate|licen[cs]e|dipl[oô]me|formation|education|comp[ée]tence|skill|badge|exam|test)\b/i.test(company)) return true;
  if (/\b(m1|m2|master|student|étudiant|etudiant)\b/i.test(title) && !pos?.companyLinkedinUrl) return true;
  return false;
}

function expandCompositeCompanyPositions(positions = []) {
  const out = [];
  const badParts = [
    "paris",
    "france",
    "tunisie",
    "hybride",
    "temps plein",
    "coordonnees",
    "coordonnées",
    "university",
    "universite",
    "université",
    "coordonnees",
    "coordonnées",
    "contact",
  ];

  for (const pos of Array.isArray(positions) ? positions : []) {
    if (!pos || typeof pos !== "object") continue;
    const cleanPos = {
      ...pos,
      title: sanitizeTitleFromPosition(pos.title),
      companyName: sanitizeCompanyNameFromPosition(pos.companyName),
    };
    if (isNoisePosition(cleanPos)) continue;
    out.push(cleanPos);

    if (cleanPos.companyLinkedinUrl) continue;
    const raw = String(cleanPos.companyName || "").trim();
    if (!raw) continue;

    const chunks = raw
      .split(/\s+\-\s+|\s+\|\s+|\s+\/\s+|\s+&\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (chunks.length < 2 || chunks.length > 4) continue;

    for (const c of chunks) {
      const low = c.toLowerCase();
      if (low.length < 2) continue;
      if (badParts.some((b) => low.includes(b))) continue;
      if (low === raw.toLowerCase()) continue;
      out.push({
        ...cleanPos,
        companyName: c,
      });
    }
  }

  return out;
}

function companyUrlFromUrn(urn) {
  const raw = String(urn || "");
  const m = raw.match(/:(?:fs_miniCompany|company|fs_salesCompany):(\d+)/i);
  if (!m?.[1]) return null;
  return `https://www.linkedin.com/company/${m[1]}/`;
}

function normalizeCompanyKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function resolveCompanyLinkedinUrlForPosition(pos, allPositions = []) {
  const direct = normalizeCompanyLinkedinUrl(
    pos?.companyLinkedinUrl ||
    companyUrlFromUrn(pos?.companyUrn)
  );
  if (direct) return direct;

  const key = normalizeCompanyKey(pos?.companyName);
  if (!key) return null;

  for (const p of allPositions) {
    const sameCompany = normalizeCompanyKey(p?.companyName) === key;
    if (!sameCompany) continue;
    const url = normalizeCompanyLinkedinUrl(
      p?.companyLinkedinUrl || companyUrlFromUrn(p?.companyUrn)
    );
    if (url) return url;
  }

  return null;
}

// ================= PROFILE INJECTION =================
async function isProfileScriptAlive(tabId) {
  try {
    const expectedRuntimeId = chrome.runtime.id;
    const domFlagAttr = "data-seo-profile-v10-1-loaded";
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (attr, expectedId) => {
        const runtimeFromDom = document.documentElement?.getAttribute(attr) || null;
        return {
          loaded:
            typeof runtimeFromDom === "string" &&
            runtimeFromDom.startsWith(`${expectedId}:`),
          runtimeId: runtimeFromDom,
        };
      },
      args: [domFlagAttr, expectedRuntimeId],
    });
    if (!result?.loaded) return false;
    if (!result?.runtimeId) return false;
    return result.runtimeId === chrome.runtime.id;
  } catch {
    return false;
  }
}

async function injectProfile(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["content_profile.js"],
  });
}

async function ensureProfileInjected(tabId, url, reason) {
  if (!tabId || tabId < 0) return;
  if (!isLinkedInUrl(url)) return;

  const last = lastInjectAt.get(tabId) || 0;
  if (Date.now() - last < INJECT_COOLDOWN_MS) return;

  if (INJECTED_TABS.has(tabId)) {
    const alive = await isProfileScriptAlive(tabId);
    if (alive) return;
  }

  try {
    lastInjectAt.set(tabId, Date.now());
    await injectProfile(tabId);
    INJECTED_TABS.add(tabId);
    log("Injected content_profile.js", tabId, reason);
    pushLog(`Injected content_profile.js (tab ${tabId})`, "INFO", null, false);
  } catch (e) {
    warn("Inject profile failed", e);
    pushLog("Inject profile failed", "WARN", { error: String(e) });
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") {
    ensureProfileInjected(tabId, tab?.url, "tabs.onUpdated");
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    ensureProfileInjected(tabId, tab?.url, "tabs.onActivated");
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  INJECTED_TABS.delete(tabId);
  lastInjectAt.delete(tabId);
});

// ================= STATE =================
function currentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

async function loadState() {
  const state = await getLocal(STORAGE_KEY, null);
  const base = state || {
    lastReset: currentPeriodKey(),
    todayCount: 0,
    processedProfiles: {},
    lastCapture: null,
  };

  if (base.lastReset !== currentPeriodKey()) {
    base.lastReset = currentPeriodKey();
    base.todayCount = 0;
    base.processedProfiles = {};
  }

  base.processedProfiles = base.processedProfiles || {};
  return base;
}

async function saveState(state) {
  await setLocal(STORAGE_KEY, state);
}

function isDuplicate(state, profileUrl) {
  const key = profileDedupKey(profileUrl);
  if (key && state.processedProfiles?.[key]) return true;
  // Backward compatibility with older raw keys already stored in local state.
  const legacyRaw = String(profileUrl || "").trim();
  if (legacyRaw && state.processedProfiles?.[legacyRaw]) return true;
  return false;
}

async function markProcessed(state, profileUrl, decisionLeadType) {
  const key = profileDedupKey(profileUrl);
  if (!key) return;

  state.processedProfiles[key] = {
    at: nowIso(),
    decision: decisionLeadType,
  };
  state.todayCount += 1;
  state.lastCapture = {
    profileUrl: key,
    decision: decisionLeadType || null,
    at: nowIso(),
  };
  await saveState(state);
  broadcastSnapshot("STATE_UPDATED");
}

// ================= COMPANY SCRAPE =================
async function scrapeCompanyWebsite(tabId) {
  return new Promise(async (resolve) => {
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ website: null, scrapeStatus: "TIMEOUT" });
    }, COMPANY_SCRAPE_TIMEOUT_MS);

    function finish(payload) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(payload || { website: null, scrapeStatus: "EMPTY" });
    }

    function listener(msg, sender) {
      if (done) return;
      if (sender?.tab?.id !== tabId) return;
      if (msg?.type !== "COMPANY_DATA") return;

      log("COMPANY SCRAPE RESULT:", msg.payload);
      finish(msg.payload);
    }

    chrome.runtime.onMessage.addListener(listener);

    try {
      await sleep(COMPANY_INJECT_DELAY_MS);

      chrome.scripting.executeScript(
        { target: { tabId }, world: "ISOLATED", files: ["content_company.js"] },
        () => {
          if (chrome.runtime.lastError && !done) {
            finish({
              website: null,
              scrapeStatus: "INJECT_ERROR",
              error: chrome.runtime.lastError.message,
            });
          }
        }
      );
    } catch (e) {
      finish({ website: null, scrapeStatus: "INJECT_THROW", error: String(e) });
    }
  });
}

async function resolveCompanyUrlBySearch(companyName) {
  const queries = buildCompanyLookupQueries(companyName);
  if (!queries.length) return null;

  for (const q of queries) {
    let tab = null;
    try {
      const searchUrl =
        `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(q)}`;

      tab = await chrome.tabs.create({
        url: searchUrl,
        active: COMPANY_TAB_ACTIVE,
      });

      await waitForTabComplete(tab.id, 12000);

      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await sleep(850);
        if (attempt === 2) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => window.scrollTo(0, document.body.scrollHeight || 0),
            });
          } catch {}
        }

        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (query) => {
            const normalizeText = (v) =>
              String(v || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, " ")
                .trim();

            const toCanonical = (href) => {
              try {
                const u = new URL(href, location.origin);
                if (!u.hostname.endsWith("linkedin.com")) return null;
                if (!u.pathname.startsWith("/company/")) return null;
                const parts = u.pathname.split("/").filter(Boolean);
                if (parts.length < 2) return null;
                return `${u.origin}/company/${parts[1]}/`;
              } catch {
                return null;
              }
            };

            const q = normalizeText(query);
            const qTokens = q.split(/\s+/).filter((x) => x.length >= 3);
            const qCompact = q.replace(/\s+/g, "");
            const anchors = Array.from(document.querySelectorAll('a[href*="/company/"]'));
            let best = null;
            let bestScore = -1;

            for (const a of anchors) {
              const href = a.href || a.getAttribute("href");
              const c = toCanonical(href);
              if (!c) continue;

              const txt = normalizeText(a.innerText || a.getAttribute("aria-label") || "");
              const compactTxt = txt.replace(/\s+/g, "");
              const slug = normalizeText(c.split("/company/")[1] || "").replace(/\s+/g, "");

              let score = 0;
              if (!txt && !slug) continue;
              if (txt === q) score += 80;
              if (compactTxt === qCompact) score += 70;
              if (txt.includes(q)) score += 35;
              if (slug.includes(qCompact) && qCompact.length >= 4) score += 30;
              for (const t of qTokens) {
                if (txt.includes(t)) score += 8;
                if (slug.includes(t)) score += 6;
              }

              if (score < 18) continue;
              if (score > bestScore) {
                bestScore = score;
                best = c;
              }
            }

            return best;
          },
          args: [q],
        });

        const normalized = normalizeCompanyLinkedinUrl(result);
        if (normalized) return normalized;
      }
    } catch (e) {
      await pushLog("Company search resolve failed", "WARN", { error: String(e), query: q });
    } finally {
      if (tab?.id && TAB_CLOSE_AFTER) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }

  return null;
}

async function resolveWebsiteBySearch(companyName) {
  const queries = buildCompanyLookupQueries(companyName);
  if (!queries.length) return null;

  for (const q of queries) {
    let tab = null;
    try {
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(`${q} official website`)}`;
      tab = await chrome.tabs.create({
        url: searchUrl,
        active: COMPANY_TAB_ACTIVE,
      });

      await waitForTabComplete(tab.id, 12000);

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (query) => {
          const normalizeText = (v) =>
            String(v || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, " ")
              .trim();

          const cleanUrl = (href) => {
            try {
              const u = new URL(href, location.origin);
              if (!["http:", "https:"].includes(u.protocol)) return null;
              const h = u.hostname.toLowerCase();
              const hostMatchesBlocked = (host, token) => {
                const t = String(token || "").toLowerCase();
                if (!t) return false;
                if (t.endsWith(".")) {
                  const base = t.slice(0, -1);
                  if (!base) return false;
                  return host === base || host.includes(`${base}.`);
                }
                return host === t || host.endsWith(`.${t}`);
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
              if (blocked.some((b) => hostMatchesBlocked(h, b))) return null;
              u.hash = "";
              return u.toString();
            } catch {
              return null;
            }
          };

          const qn = normalizeText(query);
          const qTokens = qn.split(/\s+/).filter((x) => x.length >= 3);
          const anchors = Array.from(document.querySelectorAll("li.b_algo h2 a, .b_algo h2 a, h2 a"));
          let best = null;
          let bestScore = -1;

          for (const a of anchors) {
            const href = a.href || a.getAttribute("href");
            const c = cleanUrl(href);
            if (!c) continue;

            const host = (() => {
              try {
                return new URL(c).hostname.toLowerCase();
              } catch {
                return "";
              }
            })();
            const txt = normalizeText(a.innerText || a.getAttribute("aria-label") || "");
            const merged = `${txt} ${host}`;

            let score = 0;
            for (const t of qTokens) {
              if (merged.includes(t)) score += 8;
            }
            if (score <= 0 && qTokens.length) continue;

            if (score > bestScore) {
              bestScore = score;
              best = c;
            }
          }

          if (best) return best;
          for (const a of anchors) {
            const href = a.href || a.getAttribute("href");
            const c = cleanUrl(href);
            if (c) return c;
          }
          return null;
        },
        args: [q],
      });

      const normalized = normalizeProspectWebsite(result);
      if (normalized) return normalized;
    } catch (e) {
      await pushLog("Website search resolve failed", "WARN", { error: String(e), companyName: q });
    } finally {
      if (tab?.id && TAB_CLOSE_AFTER) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }

  return null;
}

// ================= N8N =================
async function sendToN8N(payload) {
  let body;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    throw new Error("PAYLOAD_STRINGIFY_FAILED: " + String(e));
  }

  const account = await loadAccount();
  const userToken = account?.userToken || null;

  const tryEndpoint = async (url, extraHeaders = {}, label = "ENDPOINT") => {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body,
      });
    } catch (e) {
      throw new Error(`${label}_FETCH_FAILED: ${String(e)}`);
    }

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`${label}_HTTP_${res.status}: ${safeSlice(text, 300) || "no-body"}`);
    }

    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  // 1) Backend gateway (Render API) — always used when user is logged in
  try {
    if (userToken) {
      const headers = { "x-ext-key": BACKEND_EXT_API_KEY, "x-user-token": userToken };

      try {
        return await tryEndpoint(BACKEND_SCAN_URL, headers, "BACKEND");
      } catch (backendErr) {
        const errMsg = String(backendErr || "");
        const tokenUnauthorized =
          /HTTP_401/i.test(errMsg) && /UNAUTHORIZED_USER_TOKEN|UNAUTHORIZED/i.test(errMsg);
        if (!tokenUnauthorized) throw backendErr;

        const refreshed = await ensureSaasSession("SCAN_RETRY");
        if (!refreshed.ok) throw backendErr;

        const latest = await loadAccount();
        const retryHeaders = {
          "x-ext-key": BACKEND_EXT_API_KEY,
          "x-user-token": latest?.userToken || "",
        };
        return await tryEndpoint(BACKEND_SCAN_URL, retryHeaders, "BACKEND");
      }
    }
  } catch (e) {
    await pushLog("Backend scan failed", "WARN", { error: String(e) }, "Scan warning, retrying…");
    throw e;
  }
}

// ================= PIPELINE =================
async function setPipelineStatus(v) {
  PIPELINE_STATUS = v === "RUNNING" ? "RUNNING" : "PAUSED";
  await setLocal(PIPELINE_KEY, PIPELINE_STATUS);
  log("Pipeline set:", PIPELINE_STATUS);
  await pushLog(`Pipeline set: ${PIPELINE_STATUS}`);
  broadcastSnapshot("PIPELINE_CHANGED");
  return PIPELINE_STATUS;
}

// ================= SNAPSHOT =================
async function buildSnapshot() {
  await syncCloudLeads({ force: false }).catch(() => {});
  const state = await loadState();
  const logs = await loadLogs();
  const leads = await loadLeads();
  const rawAccount = await loadAccount();
  const scanCounters = getEffectiveScanCounters({
    account: rawAccount,
    localTodayCount: state.todayCount,
  });
  const account = accountForUi(rawAccount);
  const localDash = buildLocalDashboard(leads);
  const cloudDash = rawAccount?.cloudDashboard && typeof rawAccount.cloudDashboard === "object"
    ? rawAccount.cloudDashboard
    : null;
  const leadStats = cloudDash?.leadStats || localDash.leadStats;
  const leadsCount = Number.isFinite(Number(cloudDash?.leadsCount))
    ? Number(cloudDash.leadsCount)
    : leads.length;

  return {
    pipelineStatus: PIPELINE_STATUS,
    dailyLimit: scanCounters.dailyLimit,
    todayCount: scanCounters.todayCount,
    lastCapture: state.lastCapture,
    leadStats,
    leadsCount,
    dashboard: cloudDash || localDash,
    logsCount: logs.length,
    account,
    // send latest chunks only to keep payload small
    leads: leads.slice(0, 150),
    logs: logs.slice(Math.max(0, logs.length - 200)),
  };
}

// ================= MESSAGE API =================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  // ================= GET STATE =================
  if (msg.type === "GET_STATE") {
    loadState().then(async (state) => {
      const leads = await loadLeads();
      const rawAccount = await loadAccount();
      const account = accountForUi(rawAccount);
      const scanCounters = getEffectiveScanCounters({
        account: rawAccount,
        localTodayCount: state.todayCount,
      });
      const leadStats = computeLeadStats(leads);

      sendResponse({
        ok: true,
        pipelineStatus: PIPELINE_STATUS,
        todayCount: scanCounters.todayCount,
        dailyLimit: scanCounters.dailyLimit,
        lastCapture: state.lastCapture,
        leadStats,
        leadsCount: leads.length,
        account,
      });
    }).catch(e => {
      sendResponse({ ok: false, error: String(e) });
    });
    return true;
  }

  // ================= GET SNAPSHOT =================
  if (msg.type === "GET_SNAPSHOT") {
    buildSnapshot()
      .then(snapshot => sendResponse({ ok: true, snapshot }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "REFRESH_ENTITLEMENTS") {
    (async () => {
      const current = await loadAccount();
      if (!current?.userToken) {
        return { ok: false, error: "AUTH_REQUIRED" };
      }
      const ensured = await ensureSaasSession("MANUAL_REFRESH");
      if (!ensured.ok && !ensured.skipped) {
        return { ok: false, error: ensured.error || ensured.reason || "SESSION_FAILED" };
      }
      const synced = await syncEntitlements({ force: true });
      if (!synced.ok && !synced.skipped) {
        return { ok: false, error: synced.error || synced.reason || "SYNC_FAILED" };
      }
      const cloud = await syncCloudLeads({ force: true });
      if (!cloud.ok && !cloud.skipped) {
        await pushLog("Cloud leads refresh failed", "WARN", {
          error: cloud.error || "unknown",
        });
      }
      await broadcastSnapshot("ENTITLEMENTS_REFRESHED");
      return { ok: true, account: accountForUi(await loadAccount()) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= ASSISTANT SCAN (PRO-GATED) =================
  if (msg.type === "ASSISTANT_ASSERT_ACCESS") {
    (async () => {
      const out = await requestAssistantQuery({}, { checkOnly: true });
      if (!out.ok) {
        return { ok: false, error: out.error || "FEATURE_DISABLED_ICP_ASSISTANT", detail: out.detail || null };
      }
      return { ok: true, allowed: true, plan: out.data?.plan || null };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "ASSISTANT_GENERATE_QUERIES") {
    (async () => {
      const out = await requestAssistantQuery(msg.state || {}, { checkOnly: false });
      if (!out.ok) {
        return { ok: false, error: out.error || "FEATURE_DISABLED_ICP_ASSISTANT", detail: out.detail || null };
      }
      const queries = out.data?.queries && typeof out.data.queries === "object"
        ? out.data.queries
        : { people: "", company: "" };
      return { ok: true, queries, plan: out.data?.plan || null };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "ASSISTANT_GENERATE_FROM_PROMPT") {
    (async () => {
      const prompt = String(msg.prompt || "").trim();
      if (!prompt) {
        return { ok: false, error: "PROMPT_EMPTY" };
      }
      const account = await loadAccount();
      if (!account?.userToken) {
        return { ok: false, error: "AUTH_REQUIRED" };
      }
      try {
        const res = await fetch(N8N_ASSISTANT_PROMPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-token": account.userToken },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          return { ok: false, error: `N8N_HTTP_${res.status}` };
        }
        const data = await res.json();
        const people = String(data?.queries?.people || data?.people || data?.query || "");
        const company = String(data?.queries?.company || data?.company || "");
        return { ok: true, queries: { people, company } };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "ASSISTANT_OPEN_LINKEDIN") {
    (async () => {
      const kind = String(msg.kind || "people").toLowerCase() === "company" ? "company" : "people";
      const out = await requestAssistantQuery(msg.state || {}, { checkOnly: false });
      if (!out.ok) {
        return { ok: false, error: out.error || "FEATURE_DISABLED_ICP_ASSISTANT", detail: out.detail || null };
      }

      const queries = out.data?.queries && typeof out.data.queries === "object"
        ? out.data.queries
        : { people: "", company: "" };
      const query = kind === "company" ? String(queries.company || "") : String(queries.people || "");
      if (!query.trim()) {
        return { ok: false, error: "ASSISTANT_QUERY_EMPTY" };
      }

      const base = kind === "company"
        ? "https://www.linkedin.com/search/results/companies/?keywords="
        : "https://www.linkedin.com/search/results/people/?keywords=";
      const url = `${base}${encodeURIComponent(query)}`;
      await chrome.tabs.create({ url, active: true });
      await pushLog(`Assistant open LinkedIn (${kind})`);
      return { ok: true, url, queries };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= MESSAGE GENERATION (AUDIT-AWARE) =================
  if (msg.type === "GENERATE_LEAD_MESSAGE") {
    (async () => {
      const quota = await consumeSaasMetric("messages_generated", 1);
      if (!quota.ok && quota.authRequired) {
        return { ok: false, error: "AUTH_REQUIRED" };
      }
      if (!quota.ok && quota.limitReached) {
        return { ok: false, error: "LIMIT_REACHED", limitReached: true };
      }
      const out = await requestLeadMessageGeneration({
        lead: msg.lead || null,
        opportunityId: msg.opportunityId || null,
        language: msg.language || "fr",
        tone: msg.tone || "pro",
        context: msg.context || null,
      });
      if (!out.ok) {
        return { ok: false, error: out.error || "MESSAGE_GENERATE_FAILED", detail: out.detail || null };
      }
      const data = out.data || {};
      if (!String(data.message || "").trim()) {
        return { ok: false, error: "MESSAGE_EMPTY" };
      }
      await pushLog("Message generated from backend");
      return {
        ok: true,
        message: String(data.message || ""),
        variants: Array.isArray(data.variants) ? data.variants : [String(data.message || "")],
        source: data.source || "backend",
      };
    })()
      .then(r => sendResponse(r))
      .catch(async (e) => {
        await pushLog("Message generation failed", "WARN", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  // ================= MESSAGE TRACKING LOG =================
  if (msg.type === "MSG_LOG_GENERATION" || msg.type === "MSG_LOG_SENT") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return { ok: false, error: "NO_AUTH" };
      const body = msg.type === "MSG_LOG_GENERATION"
        ? { profileUrl: msg.profileUrl, leadName: msg.leadName || "", opportunityName: msg.opportunityName || "", action: "generation", messagePreview: msg.messagePreview || "" }
        : { profileUrl: msg.profileUrl, leadName: msg.leadName || "", action: "sent", wasEdited: msg.wasEdited, sentStatus: msg.sentStatus || "SENT", messagePreview: msg.messagePreview || "" };
      try {
        await fetch(BACKEND_MSG_LOG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-token": token },
          body: JSON.stringify(body),
        });
      } catch (e) { console.error("[SEO-BG] MSG_LOG fetch error:", e); }
      return { ok: true };
    })()
      .then(r => sendResponse(r))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // ================= SINGLE SEO EXPORT (BACKEND/N8N) =================
  if (msg.type === "EXPORT_SEO_SINGLE") {
    (async () => {
      const out = await requestSeoSingleExport({
        lead: msg.lead || null,
        opportunityId: msg.opportunityId || null,
        language: msg.language || "fr",
      });
      if (!out.ok) {
        return { ok: false, error: out.error || "SEO_EXPORT_SINGLE_FAILED", detail: out.detail || null };
      }
      const data = out.data || {};
      if (!String(data.csv || "").trim()) {
        return { ok: false, error: "SEO_EXPORT_SINGLE_EMPTY" };
      }
      return {
        ok: true,
        format: data.format || "csv",
        mimeType: data.mimeType || "text/csv",
        filename: data.filename || `seo-audit-${new Date().toISOString().slice(0, 10)}.csv`,
        csv: String(data.csv || ""),
        source: data.source || "backend",
      };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= PIPELINE CONTROL =================
  if (msg.type === "SET_PIPELINE") {
    setPipelineStatus(msg.value)
      .then(v => sendResponse({ ok: true, pipelineStatus: v }))
      .catch(e => {
        errlog("SET_PIPELINE failed", e);
        pushLog("SET_PIPELINE failed", "ERROR", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  // ================= PROFILE CAPTURE =================
  if (msg.type === "PROFILE_CAPTURED") {
    handleProfileCaptured(msg.payload)
      .then(res => sendResponse(res))
      .catch(e => {
        errlog("PROFILE_CAPTURED failed", e);
        pushLog("PROFILE_CAPTURED failed", "ERROR", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  // ================= LIST PROFILE (PASSIVE LIST SCAN) =================
  if (msg.type === "LIST_PROFILE_FOUND") {
    (async () => {
      const p = msg.payload || {};
      const profileUrl = p.profileUrl || "unknown";
      await pushLog(`List profile detected: ${profileUrl}`);
      return { ok: true, queued: false };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= ACCOUNT / AUTH =================
  if (msg.type === "AUTH_REGISTER") {
    (async () => {
      const firstName = String(msg.firstName || "").trim();
      const lastName = String(msg.lastName || "").trim();
      const email = String(msg.email || "").trim().toLowerCase();
      const password = String(msg.password || "");
      const fullNameFromParts = `${firstName} ${lastName}`.trim();
      const fullName = String(msg.fullName || fullNameFromParts).trim() || null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "INVALID_EMAIL" };
      }
      if (password.length < 8) {
        return { ok: false, error: "PASSWORD_TOO_SHORT" };
      }
      const out = await fetchBackendJson(BACKEND_AUTH_REGISTER_URL, {
        method: "POST",
        headers: { "x-ext-key": BACKEND_EXT_API_KEY },
        body: { email, password, fullName },
      });
      if (!out.ok) {
        return { ok: false, error: out.error || "REGISTER_FAILED", detail: out.data || null };
      }
      const account = await saveAccount(
        mergeAccountWithAuthPayload(await loadAccount(), out.data, "EMAIL")
      );
      await syncCloudLeads({ force: true });
      await pushLog(`Account registered: ${email}`);
      await broadcastSnapshot("ACCOUNT_REGISTERED");
      return { ok: true, account: accountForUi(account) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "SEAT_ADD_USER") {
    (async () => {
      const owner = await loadAccount();
      const loggedInOwner = Boolean(owner?.userId && owner?.authMethod === "EMAIL" && owner?.userToken);
      if (!loggedInOwner) {
        return { ok: false, error: "AUTH_REQUIRED" };
      }

      const teamPolicy = getAccountTeamPolicy(owner);
      const canAddSeatByPlan = teamPolicy.billingActive && (
        teamPolicy.seatAddOnEnabled ||
        teamPolicy.includedUsers > 1
      );
      if (!canAddSeatByPlan) {
        return { ok: false, error: "SEAT_ADD_LOCKED" };
      }

      const firstName = String(msg.firstName || "").trim();
      const lastName = String(msg.lastName || "").trim();
      const email = String(msg.email || "").trim().toLowerCase();
      const password = String(msg.password || "");
      const fullName = String(msg.fullName || `${firstName} ${lastName}`).trim();

      if (!firstName || !lastName || !fullName) {
        return { ok: false, error: "NAME_REQUIRED" };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "INVALID_EMAIL" };
      }
      if (password.length < 8) {
        return { ok: false, error: "PASSWORD_TOO_SHORT" };
      }

      const out = await fetchBackendJson(BACKEND_TEAM_SEATS_ADD_URL, {
        method: "POST",
        headers: {
          "x-ext-key": BACKEND_EXT_API_KEY,
          "x-user-token": owner.userToken,
        },
        body: { email, password, fullName, firstName, lastName },
      });
      if (!out.ok) {
        return { ok: false, error: out.error || "SEAT_ADD_FAILED", detail: out.data || null };
      }
      const saved = await saveAccount(
        mergeAccountWithEntitlements(owner, out.data || {})
      );
      const seatUser = normalizeSeatUserEntry(out.data?.seatUser || {
        email,
        firstName,
        lastName,
        fullName,
        createdAt: nowIso(),
      });
      await pushLog(`Seat user added: ${email}`);
      await broadcastSnapshot("SEAT_USER_ADDED");
      return {
        ok: true,
        seatUser,
        account: accountForUi(saved),
      };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "AUTH_LOGIN") {
    (async () => {
      const email = String(msg.email || "").trim().toLowerCase();
      const password = String(msg.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "INVALID_EMAIL" };
      }
      if (!password) {
        return { ok: false, error: "PASSWORD_REQUIRED" };
      }
      const out = await fetchBackendJson(BACKEND_AUTH_LOGIN_URL, {
        method: "POST",
        headers: { "x-ext-key": BACKEND_EXT_API_KEY },
        body: { email, password },
      });
      if (!out.ok) {
        return { ok: false, error: out.error || "LOGIN_FAILED", detail: out.data || null };
      }
      const account = await saveAccount(
        mergeAccountWithAuthPayload(await loadAccount(), out.data, "EMAIL")
      );
      await syncCloudLeads({ force: true });
      await pushLog(`Account login: ${email}`);
      await broadcastSnapshot("ACCOUNT_LOGIN");
      return { ok: true, account: accountForUi(account) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "AUTH_LOGOUT") {
    (async () => {
      const account = await loadAccount();
      if (account?.userToken) {
        await fetchBackendJson(BACKEND_AUTH_LOGOUT_URL, {
          method: "POST",
          headers: {
            "x-ext-key": BACKEND_EXT_API_KEY,
            "x-user-token": account.userToken,
          },
          body: {},
        });
      }

      const cleared = await saveAccount({
        authMethod: "GUEST",
        identity: null,
        linkedinProfileUrl: null,
        email: null,
        role: null,
        isAdmin: false,
        connectedAt: null,
        userId: null,
        userToken: null,
        tokenExpiresAt: null,
        subscriptionStatus: null,
        trialEndsAt: null,
        limits: null,
        usage: null,
        remaining: null,
        features: null,
        team: null,
        seatUsers: [],
        cloudDashboard: null,
        lastCloudSyncAt: null,
        lastEntitlementsAt: null,
        plan: "FREE",
      });
      await clearLeadsStore(cleared);
      await pushLog("Account logged out");
      await broadcastSnapshot("ACCOUNT_LOGOUT");
      return { ok: true, account: accountForUi(cleared) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "OPEN_UPGRADE_CHECKOUT") {
    (async () => {
      const account = await loadAccount();
      if (!account?.userToken) return { ok: false, error: "AUTH_REQUIRED" };

      const provider = String(msg.provider || "lemonsqueezy").trim().toLowerCase();
      const plan = String(msg.plan || "STARTER").trim().toUpperCase();
      const out = await fetchBackendJson(BACKEND_BILLING_CHECKOUT_URL, {
        method: "POST",
        headers: {
          "x-ext-key": BACKEND_EXT_API_KEY,
          "x-user-token": account.userToken,
        },
        body: {
          provider,
          plan,
          source: "extension",
        },
        timeoutMs: 20000,
      });

      if (!out.ok) {
        return {
          ok: false,
          error: out.error || "BILLING_CHECKOUT_FAILED",
          detail: out.data || null,
        };
      }

      const checkoutUrl = String(out.data?.checkoutUrl || "");
      if (!checkoutUrl) {
        return { ok: false, error: "CHECKOUT_URL_MISSING" };
      }

      await chrome.tabs.create({ url: checkoutUrl, active: true });
      await pushLog(`Opening checkout: ${(out.data?.provider || provider).toUpperCase()} (${plan})`);
      return {
        ok: true,
        provider: out.data?.provider || provider,
        plan,
        checkoutUrl,
      };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "ADMIN_RESET_CLOUD_AND_LOCAL") {
    (async () => {
      const account = await loadAccount();
      if (!account?.userToken) return { ok: false, error: "AUTH_REQUIRED" };
      if (!account?.isAdmin) return { ok: false, error: "ADMIN_REQUIRED" };

      const cloudReset = await fetchBackendJson(BACKEND_ADMIN_RESET_URL, {
        method: "POST",
        headers: {
          "x-ext-key": BACKEND_EXT_API_KEY,
          "x-user-token": account.userToken,
        },
        body: {},
      });
      if (!cloudReset.ok) {
        return { ok: false, error: cloudReset.error || "ADMIN_RESET_FAILED", detail: cloudReset.data || null };
      }

      await setLocal(STORAGE_KEY, {
        lastReset: currentPeriodKey(),
        todayCount: 0,
        processedProfiles: {},
        lastCapture: null,
      });
      await setLocal(LOGS_KEY, []);
      await clearLeadsStore(account);
      await setLocal(COMPANY_CACHE_KEY, {});
      await saveAccount({
        cloudDashboard: null,
        lastCloudSyncAt: nowIso(),
      });
      await pushLog("Admin reset done: cloud + local");
      await broadcastSnapshot("ADMIN_RESET_CLOUD_LOCAL");
      return { ok: true };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "DETECT_SITE_SESSION") {
    (async () => {
      // Find an open app.example.com tab and read the JWT from localStorage
      const tabs = await chrome.tabs.query({});
      const siteTabs = tabs.filter(t =>
        t.url && t.url.includes("app.example.com")
      );
      if (!siteTabs.length) {
        return { ok: false, error: "NO_SITE_TAB" };
      }
      let token = null;
      for (const tab of siteTabs) {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "ISOLATED",
            func: () => localStorage.getItem("seoprospector_user_token"),
          });
          if (result) { token = result; break; }
        } catch { /* tab not injectable — skip */ }
      }
      if (!token) {
        return { ok: false, error: "NO_SESSION_FOUND" };
      }
      // Decode JWT to get email / userId (payload is base64url middle segment)
      let email = null;
      let userId = null;
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        email = payload.email || payload.sub || null;
        userId = payload.userId || payload.sub || null;
      } catch { /* ignore decode errors */ }
      const account = await saveAccount({
        userToken: token,
        authMethod: "EMAIL",
        email: email || undefined,
        userId: userId || undefined,
        connectedAt: new Date().toISOString(),
      });
      const synced = await syncEntitlements({ force: true });
      await pushLog(`Site session detected and connected: ${email || "unknown"}`);
      await broadcastSnapshot("SITE_SESSION_DETECTED");
      return { ok: true, account: accountForUi(synced.account || account) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "CONNECT_LINKEDIN_SESSION") {
    (async () => {
      const identity = await extractLinkedinSessionIdentityFromActiveTab();
      const account = await saveAccount({
        authMethod: "LINKEDIN_SESSION",
        identity: identity.identity,
        linkedinProfileUrl: identity.linkedinProfileUrl,
        connectedAt: identity.connectedAt,
      });
      const saas = await ensureSaasSession("LINKEDIN_CONNECT");
      if (!saas.ok && !saas.skipped) {
        await pushLog("SaaS session setup failed after LinkedIn connect", "WARN", {
          error: saas.error || saas.reason || "unknown",
        });
      }
      await pushLog(`LinkedIn account connected: ${account.linkedinProfileUrl}`);
      await broadcastSnapshot("ACCOUNT_CONNECTED");
      return { ok: true, account: accountForUi(saas.account || account), saas };
    })()
      .then(r => sendResponse(r))
      .catch(async (e) => {
        await pushLog("LinkedIn account connect failed", "WARN", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  if (msg.type === "SET_ACCOUNT_EMAIL") {
    (async () => {
      const email = String(msg.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "INVALID_EMAIL" };
      }
      const account = await saveAccount({
        email,
        authMethod: email ? "EMAIL" : "GUEST",
        identity: email || null,
      });
      const saas = await ensureSaasSession("EMAIL_CONNECT");
      if (!saas.ok && !saas.skipped) {
        await pushLog("SaaS session setup failed after email set", "WARN", {
          error: saas.error || saas.reason || "unknown",
        });
      }
      await pushLog(`Account email saved: ${email}`);
      await broadcastSnapshot("ACCOUNT_EMAIL_UPDATED");
      return { ok: true, account: accountForUi(saas.account || account), saas };
    })()
      .then(r => sendResponse(r))
      .catch(async (e) => {
        await pushLog("Account email save failed", "WARN", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  if (msg.type === "CLEAR_ACCOUNT") {
    (async () => {
      const account = await saveAccount({
        authMethod: "GUEST",
        identity: null,
        linkedinProfileUrl: null,
        email: null,
        role: null,
        isAdmin: false,
        connectedAt: null,
        userId: null,
        userToken: null,
        tokenExpiresAt: null,
        subscriptionStatus: null,
        trialEndsAt: null,
        limits: null,
        usage: null,
        remaining: null,
        features: null,
        team: null,
        seatUsers: [],
        cloudDashboard: null,
        lastCloudSyncAt: null,
        lastEntitlementsAt: null,
      });
      await clearLeadsStore(account);
      await pushLog("Account auth cleared");
      await broadcastSnapshot("ACCOUNT_CLEARED");
      return { ok: true, account: accountForUi(account) };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= SEND LINKEDIN MESSAGE =================
  if (msg.type === "SEND_LINKEDIN_MESSAGE") {
    (async () => {
      const profileUrl = String(msg.profileUrl || "");
      const message = String(msg.message || "");
      const autoSend = msg.autoSend !== false;

      if (!profileUrl || !message.trim()) {
        return { ok: false, error: "INVALID_SEND_PAYLOAD" };
      }

      const account = await loadAccount();
      if (account?.features && account.features.sendNow === false) {
        await pushLog("Message blocked: Send Now is disabled for current plan", "WARN");
        return { ok: false, error: "FEATURE_DISABLED_SEND_NOW" };
      }

      await pushLog(`Sending LinkedIn message: ${profileUrl}`);
      const normalizedProfile = normalizeLinkedInProfileUrl(profileUrl);
      if (normalizedProfile) {
        SUPPRESS_CAPTURE_UNTIL.set(normalizedProfile, Date.now() + 2 * 60 * 1000);
      }
      const sendResult = await sendMessageToLinkedInProfile({
        profileUrl,
        message,
        autoSend,
      });

      const status = sendResult?.result?.status || "UNKNOWN";
      await pushLog(`LinkedIn message status: ${status}`);
      return { ok: true, ...sendResult };
    })()
      .then(r => sendResponse(r))
      .catch(async (e) => {
        await pushLog("LinkedIn send failed", "ERROR", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  // ================= RESCAN =================
  if (msg.type === "TRIGGER_RESCAN") {
    (async () => {
      const rawUrl = String(msg.profileUrl || "").trim();
      const normalized = normalizeLinkedInProfileUrl(rawUrl) || rawUrl;
      const dedupKey = profileDedupKey(normalized) || normalized;
      if (!dedupKey) return { ok: false, error: "NO_PROFILE_URL" };
      const freeRetry = Boolean(msg.freeRetry);
      rescanPendingMap.set(dedupKey, { freeRetry });
      const targetUrl = normalizeLinkedInProfileUrl(rawUrl) || rawUrl;
      const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
      const liTab = tabs.find(t => t.active) || tabs[0];
      if (liTab) {
        await chrome.tabs.update(liTab.id, { url: targetUrl, active: true });
      } else {
        await chrome.tabs.create({ url: targetUrl, active: true });
      }
      await pushLog(`Rescan triggered: ${dedupKey} (freeRetry=${freeRetry})`);
      return { ok: true };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= MANUAL OVERRIDE =================
  if (msg.type === "OVERRIDE_DECISION") {
    (async () => {
      const profileUrl = String(msg.profileUrl || "");
      const final = String(msg?.decision?.final || "").toUpperCase();
      const allowed = ["CONTACT_NOW", "CONTACT_SOFT", "FIND_DECISION_MAKER", "IGNORE"];

      if (!profileUrl || !allowed.includes(final)) {
        return { ok: false, error: "INVALID_OVERRIDE_PAYLOAD" };
      }

      const leads = await loadLeads();
      const lead = leads.find(l => l.profileUrl === profileUrl);
      if (!lead) {
        return { ok: false, error: "LEAD_NOT_FOUND" };
      }

      lead.opportunities = Array.isArray(lead.opportunities) ? lead.opportunities : [];
      if (!lead.opportunities.length) {
        lead.opportunities.push({
          id: uuid(),
          company: lead.company || null,
          jobTitle: lead.jobTitle || lead.headline || "Unknown",
          companyLinkedinUrl: null,
          website: lead.website || null,
          role: lead.decision?.signals?.role || "UNKNOWN",
          leadType: "COLD_LEAD",
          action: "IGNORE",
          reason: "Rebuilt for manual override",
          ui: null,
          opportunityStatus: "PRIMARY",
        });
      }

      const primary =
        lead.opportunities.find(o => o.opportunityStatus === "PRIMARY") ||
        lead.opportunities[0];

      const previousFinal =
        String(lead?.decision?.final || primary?.action || "UNKNOWN").toUpperCase();
      const previousLeadType =
        String(lead?.leadType || primary?.leadType || "UNKNOWN").toUpperCase();

      const leadType = decisionActionToLeadType(final);
      const reason = `Manual override: ${final}`;

      const d = {
        leadType,
        action: final,
        role: primary?.role || "UNKNOWN",
        reason,
        detectedHeadline: lead.headline || null,
        painBusiness: primary?.ui?.painBusiness || "UNKNOWN",
      };

      // Preserve existing SEO data from the primary opportunity or lead ui
      const oldUi = (primary?.ui && typeof primary.ui === "object") ? primary.ui
        : (lead?.ui && typeof lead.ui === "object") ? lead.ui : {};

      const ui = buildUiFromDecision(
        d,
        { action: final, confidence: "MANUAL" },
        { headline: lead.headline || "" }
      );
      // Keep SEO fields intact so the card doesn't fall back to UNKNOWN
      if (oldUi.seoBadge) ui.seoBadge = oldUi.seoBadge;
      if (oldUi.seoColor) ui.seoColor = oldUi.seoColor;
      if (oldUi.seoEmoji) ui.seoEmoji = oldUi.seoEmoji;
      if (oldUi.seoLabel) ui.seoLabel = oldUi.seoLabel;
      if (oldUi.score !== undefined) ui.score = oldUi.score;
      if (oldUi.issuesCount !== undefined) ui.issuesCount = oldUi.issuesCount;
      if (oldUi.websiteStatus) ui.websiteStatus = oldUi.websiteStatus;
      ui.reason = reason;
      ui.confidence = "MANUAL";

      primary.action = final;
      primary.leadType = leadType;
      primary.reason = reason;
      primary.ui = ui;

      for (const o of lead.opportunities) {
        o.opportunityStatus =
          o === primary
            ? "PRIMARY"
            : (o.leadType === "WARM_LEAD" ? "SECONDARY" : "IGNORED");
      }

      lead.ui = ui;
      lead.company = primary.company || null;
      lead.jobTitle = primary.jobTitle || lead.jobTitle || null;
      lead.website = primary.website || lead.website || null;
      lead.decision = {
        leadType,
        final,
        confidence: "MANUAL",
        reason,
        signals: {
          role: primary.role || "UNKNOWN",
        },
      };
      lead.leadType = leadType;

      await saveLeads(leads);
      await upsertCloudLead(lead, "MANUAL_OVERRIDE");
      await pushOverrideFeedbackEvent({
        profileUrl,
        leadId: lead.id,
        source: msg?.decision?.source || "MANUAL_OVERRIDE",
        route: msg?.decision?.route || "leads",
        fromFinal: previousFinal,
        toFinal: final,
        fromLeadType: previousLeadType,
        toLeadType: leadType,
      }).catch((e) => {
        warn("Override feedback capture failed", e);
      });
      const stats = computeLeadStats(leads);
      broadcastToPanels({ type: "LEAD_ADDED", lead, stats });
      await pushLog(`Manual override applied: ${final} (${profileUrl})`);
      await broadcastSnapshot("MANUAL_OVERRIDE");

      return { ok: true, leadType };
    })()
      .then(r => sendResponse(r))
      .catch(e => {
        errlog("OVERRIDE_DECISION failed", e);
        pushLog("OVERRIDE_DECISION failed", "ERROR", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });

    return true;
  }

  // ================= SET PRIMARY OPPORTUNITY =================
  if (msg.type === "SET_PRIMARY_OPPORTUNITY") {
    (async () => {
      const { leadId, opportunityId } = msg;
      if (!leadId || !opportunityId) {
        return { ok: false, error: "MISSING_PARAMS" };
      }

      const leads = await loadLeads();
      const lead = leads.find(l => l.id === leadId);
      if (!lead) {
        return { ok: false, error: "LEAD_NOT_FOUND" };
      }

      const opp = lead.opportunities?.find(o => o.id === opportunityId);
      if (!opp) {
        return { ok: false, error: "OPPORTUNITY_NOT_FOUND" };
      }

      // ðŸ”¥ PROMOTION LOGIQUE
      for (const o of lead.opportunities) {
        o.opportunityStatus =
          o.id === opportunityId
            ? "PRIMARY"
            : o.leadType === "WARM_LEAD"
              ? "SECONDARY"
              : "IGNORED";
      }

      // ðŸ” SYNC LEAD LEVEL
      lead.ui = opp.ui;
      lead.company = opp.company || null;
      lead.website = opp.website || null;

      lead.decision = {
        leadType: opp.leadType,
        final: opp.action,
        confidence: opp.ui?.confidence || "LOW",
        reason: opp.reason,
        signals: {
          role: opp.role || "UNKNOWN",
        },
      };

      lead.leadType = opp.leadType;

      await saveLeads(leads);
      await upsertCloudLead(lead, "PRIMARY_SWITCH");
      await pushLog(`Primary opportunity set: ${opp.company}`);
      await broadcastSnapshot("PRIMARY_OPPORTUNITY_CHANGED");

      return { ok: true };
    })()
      .then(r => sendResponse(r))
      .catch(e => {
        errlog("SET_PRIMARY_OPPORTUNITY failed", e);
        pushLog("SET_PRIMARY_OPPORTUNITY failed", "ERROR", { error: String(e) });
        sendResponse({ ok: false, error: String(e) });
      });

    return true;
  }

  // ================= RESET ALL =================
  if (msg.type === "RESET_ALL") {
    (async () => {
      await setLocal(STORAGE_KEY, {
        lastReset: currentPeriodKey(),
        todayCount: 0,
        processedProfiles: {},
        lastCapture: null,
      });
      await setLocal(LOGS_KEY, []);
      await clearLeadsStore();
      await setLocal(COMPANY_CACHE_KEY, {});
      await pushLog("Local data reset");
      await broadcastSnapshot("RESET_ALL");
      return { ok: true };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= EXPORT LOGS =================
  if (msg.type === "CONSUME_SEO_EXPORT") {
    (async () => {
      const account = await loadAccount();
      if (account?.features?.exportCsv === false) {
        return { ok: false, error: "FEATURE_DISABLED_EXPORT_CSV" };
      }

      const out = await consumeSaasMetric("seo_exports", 1);
      if (!out.ok) {
        return {
          ok: false,
          error: out.error || "SEO_EXPORT_CONSUME_FAILED",
          authRequired: Boolean(out.authRequired),
          limitReached: Boolean(out.limitReached),
          detail: out.detail || null,
        };
      }

      return { ok: true, detail: out.detail || null };
    })()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= EXPORT LOGS =================
  if (msg.type === "EXPORT_LOGS") {
    loadLogs()
      .then(logs => sendResponse({ ok: true, logs }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= EXPORT LEADS =================
  if (msg.type === "EXPORT_LEADS") {
    (async () => {
      const leads = await loadLeads();
      return sendResponse({ ok: true, leads });
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= EXPORT OVERRIDE FEEDBACK =================
  if (msg.type === "EXPORT_OVERRIDE_FEEDBACK") {
    (async () => {
      const events = await loadOverrideFeedbackEvents();
      return sendResponse({ ok: true, events });
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ================= TEAM CHAT =================
  if (msg.type === "CHAT_FETCH") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(`${SAAS_APP_URL}/api/team/chat`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "CHAT_SEND") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(`${SAAS_APP_URL}/api/team/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg.content }),
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "CHAT_UNREAD") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, count: 0 });
      const res = await fetch(`${SAAS_APP_URL}/api/team/chat/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return sendResponse({ ok: false, count: 0 });
      sendResponse(await res.json());
    })().catch(() => sendResponse({ ok: false, count: 0 }));
    return true;
  }

  // ================= NOTIFICATIONS =================
  if (msg.type === "NOTIF_FETCH") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(`${SAAS_APP_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "NOTIF_READ") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false });
      await fetch(`${SAAS_APP_URL}/api/notifications`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  // ================= SUPPORT TICKETS =================
  if (msg.type === "TEAM_STATS_FETCH") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(BACKEND_TEAM_STATS_URL, {
        headers: { Authorization: `Bearer ${token}`, "x-ext-key": BACKEND_EXT_API_KEY },
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "SUPPORT_FETCH") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(BACKEND_SUPPORT_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "SUPPORT_CREATE") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(BACKEND_SUPPORT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subject: msg.subject, message: msg.message }),
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "SUPPORT_CHAT") {
    (async () => {
      const account = await loadAccount();
      const token = account?.userToken;
      if (!token) return sendResponse({ ok: false, error: "NO_TOKEN" });
      const res = await fetch(BACKEND_SUPPORT_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msg.messages, userContext: msg.userContext }),
      });
      if (!res.ok) return sendResponse({ ok: false, error: res.status });
      sendResponse(await res.json());
    })().catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

function scoreDecisionPower(title = "", headline = "") {
  const t = `${title || ""} ${headline || ""}`.toLowerCase();
  let score = 0;

  // ðŸ”¥ RÃ´les dÃ©cisionnaires forts
  if (/(founder|co-founder|ceo|chief executive|owner|président|president|managing director|gérant|gerant)/i.test(t)) {
    score += 50;
  }

  // ðŸŸ  DÃ©cideurs intermÃ©diaires
  if (/(head of|vp|vice president|director|directeur)/i.test(t)) {
    score += 30;
  }

  if (/(manager|lead|responsable)/i.test(t)) {
    score += 15;
  }

  // âŒ RÃ´les faibles (killers)
  if (/(assistant|intern|stagiaire|junior|student|trainee|apprentice)/i.test(t)) {
    score -= 50;
  }

  if (/(freelance|consultant|independent)/i.test(t)) {
    score -= 20;
  }

  // âŒ Faux positifs LinkedIn
  if (/(ex-|former|retired)/i.test(t)) {
    score -= 30;
  }

  return score;
}

// ================= HANDLER =================
function analyzePositions(currentPositions = [], profileHeadline = "") {
  return currentPositions.map((pos) => {
    const decisionScore = scoreDecisionPower(pos.title || "", profileHeadline || "");

    const role = decisionScore >= 40
      ? "DECISION_MAKER"
      : "EMPLOYEE";

    return {
      ...pos,
      role,
      roleScore: decisionScore,
      companyConfidence: pos.companyLinkedinUrl ? "HIGH" : "LOW",
    };
  });
}


// function selectPrimaryPosition(positions = []) {
//   if (!positions.length) return null;

//   // âš ï¸ blacklist enterprise
//   const ENTERPRISE_KILL = /(chanel|loreal|google|meta|oracle|amazon)/i;

//   let best = null;
//   let bestScore = -Infinity;

//   for (const p of positions) {
//     let score = p.roleScore || 0;

//     if (ENTERPRISE_KILL.test(p.companyName || "")) {
//       score -= 100;
//     }

//     if (score > bestScore) {
//       bestScore = score;
//       best = p;
//     }
//   }

//   return best;
// }




async function processSingleOpportunity(payload, p, state) {
  // ================= RESET PAYLOAD =================
  delete payload.website;
  delete payload.websiteSource;
  delete payload.websiteConfidence;
  delete payload.scrapeStatus;
  delete payload.companyUrl;
  delete payload.scrapeError;

  // Use website hints captured directly on profile experience rows when available.
  const hintedWebsite = normalizeProspectWebsite(
    payload.websiteHint || payload.companyWebsite || payload.websiteCandidate || null
  );
  if (hintedWebsite && ENABLE_PROFILE_WEBSITE_HINTS) {
    const likelyHint = isWebsiteLikelyForCompany(
      hintedWebsite,
      payload.companyName,
      payload.companyLinkedinUrl
    );
    if (likelyHint) {
      payload.website = hintedWebsite;
      payload.websiteSource = "PROFILE_HINT";
      payload.websiteConfidence = "MEDIUM";
      payload.scrapeStatus = "PROFILE_HINT";
      await pushLog(`Website hint from profile: ${hintedWebsite}`);
    } else {
      await pushLog(`Website hint rejected (name mismatch): ${hintedWebsite}`, "WARN", {
        companyName: payload.companyName || null,
      });
    }
  }

  // ================= COMPANY URL RESOLVE FALLBACK =================
  if (!payload.website && !payload.companyLinkedinUrl && payload.companyName) {
    const resolved = await resolveCompanyUrlBySearch(payload.companyName);

    if (resolved) {
      payload.companyLinkedinUrl = resolved;
      await pushLog(`Company URL resolved by search: ${resolved}`);
    } else {
      await pushLog(`Company URL not resolved by search: ${payload.companyName}`, "WARN");
    }
  }

  // ================= COMPANY SCRAPE =================
  if (
    !payload.website &&
    payload.companyLinkedinUrl &&
    isLinkedInCompanyUrl(payload.companyLinkedinUrl)
  ) {
    const companyCache = await loadCompanyCache();
    const cacheKey = payload.companyLinkedinUrl;
    const cached = companyCache[cacheKey];
    const canUseCache = Boolean(cached?.website);

    // âš¡ CACHE HIT (PERSISTANT)
    if (canUseCache) {
      Object.assign(payload, cached);
      payload.websiteSource = payload.websiteSource || "LINKEDIN_COMPANY_CACHE";
      payload.websiteConfidence = payload.websiteConfidence || "HIGH";
      await pushLog(`Company cache hit: ${cacheKey}`);
    } else {
      const companyUrl = toCompanyAboutUrl(payload.companyLinkedinUrl);
      let tab;

      try {
        await pushLog(`Opening company tab: ${companyUrl}`);

        tab = await chrome.tabs.create({
          url: companyUrl,
          active: COMPANY_TAB_ACTIVE,
        });

        const companyData = await scrapeCompanyWebsite(tab.id);

        Object.assign(payload, companyData || {});
        payload.companyUrl = companyUrl;
        if (payload.website) {
          payload.websiteSource = "LINKEDIN_COMPANY";
          payload.websiteConfidence = "HIGH";
        }

        await pushLog(`Company scrape: ${companyData?.scrapeStatus || "OK"}`);

        // âœ… CACHE WRITE (success only)
        if (payload.website) {
          companyCache[cacheKey] = {
            website: payload.website,
            scrapeStatus: "OK",
          };
          await saveCompanyCache(companyCache);
        }
      } catch (e) {
        warn("Company scrape failed", e);
        payload.scrapeStatus = "FAILED";
        payload.scrapeError = String(e);
        await pushLog("Company scrape failed", "WARN", { error: String(e) });
      } finally {
        if (tab?.id && TAB_CLOSE_AFTER) {
          try {
            await chrome.tabs.remove(tab.id);
          } catch {}
        }
      }
    }
  }

  // ================= WEBSITE SEARCH FALLBACK =================
  if (!payload.website && payload.companyName) {
    if (!ENABLE_WEBSITE_SEARCH_FALLBACK) {
      await pushLog(
        `Website fallback disabled (search): ${payload.companyName}`,
        "WARN"
      );
    } else {
      const websiteFallback = await resolveWebsiteBySearch(payload.companyName);
      if (websiteFallback) {
        const normalized = normalizeProspectWebsite(websiteFallback) || websiteFallback;
        const likelyMatch = isWebsiteLikelyForCompany(
          normalized,
          payload.companyName,
          payload.companyLinkedinUrl
        );
        if (!likelyMatch) {
          await pushLog(`Website fallback rejected (name mismatch): ${normalized}`, "WARN", {
            companyName: payload.companyName,
            companyLinkedinUrl: payload.companyLinkedinUrl || null,
          });
        } else {
          const reachable = await isWebsiteReachable(normalized);
          if (!reachable) {
            await pushLog(`Website fallback rejected (unreachable): ${normalized}`, "WARN");
          } else {
            payload.website = normalized;
            payload.websiteSource = "SEARCH_FALLBACK";
            payload.websiteConfidence = "LOW";
            payload.scrapeStatus = payload.scrapeStatus || "SEARCH_FALLBACK_OK";
            await pushLog(`Website resolved by search (validated): ${payload.website}`);
          }
        }
      }
      if (!payload.website) {
        await pushLog(`Website unresolved after all fallbacks: ${payload.companyName}`, "WARN");
      }
    }
  }

  // ================= N8N =================
  log("Sending to N8N payload:", payload);
  await pushLog("Sending to n8n…", "INFO", null, "Analyzing profile…");

  let decision;
  try {
    decision = await sendToN8N(payload);
  } catch (e) {
    warn("N8N failed", e);
    await pushLog("n8n failed", "ERROR", { error: String(e) }, "Analysis failed");
    return { ok: false };
  }

  // ================= DECISION NORMALIZATION =================
  const d = pickDecisionFields(decision);

  let ui = decision?.ui;
  if (!ui || typeof ui !== "object") {
    ui = buildUiFromDecision(d, decision, payload);
  }

  // ================= FINAL OPPORTUNITY =================
  return {
    decision,
    opportunity: {
      id: uuid(),
      company:
  payload.companyName ||
  payload.company ||
  null,

jobTitle: payload.jobTitle || null,

      companyLinkedinUrl: payload.companyLinkedinUrl || null,
      website: payload.website || null,
      websiteSource: payload.websiteSource || null,
      websiteConfidence: payload.websiteConfidence || null,
      websiteStatus: d.websiteStatus || payload.websiteStatus || null,
      role: d.role,
      leadType: d.leadType,
      action: d.action,
      seoLevel: d.seoLevel || null,
      siteType: d.siteType || null,
      rawScore: d.rawScore,
      seoSource: d.seoSource || null,
      seoIssues: d.seoIssues || null,
      seoPassed: d.seoPassed || null,
      bestPractices: d.bestPractices ?? null,
      gatheredAt: d.gatheredAt || null,
      reason: d.reason,
      ui,
    },
  };
}



function aggregateLeadType(opps = []) {
  if (!Array.isArray(opps) || opps.length === 0) return "COLD_LEAD";

  if (opps.some(o => o.leadType === "HOT_LEAD")) return "HOT_LEAD";
  if (opps.some(o => o.leadType === "WARM_LEAD")) return "WARM_LEAD";

  return "COLD_LEAD";
}
function scorePosition(pos) {
  let score = 0;

  if (pos.role === "DECISION_MAKER") score += 50;
  if (/founder|co-founder|ceo|owner|gérant|gerant|président|president|directeur/i.test(pos.title || "")) {
    score += 30;
  }

  if (pos.companyName) score += 10;
  if (pos.companyLinkedinUrl) score += 10;

  // blacklist enterprise
  if (/(google|meta|amazon|oracle|loreal|chanel)/i.test(pos.companyName || "")) {
    score -= 100;
  }

  return score;
}


async function handleProfileCaptured(p) {
  log("ðŸŽ¯ PROFILE_CAPTURED RECEIVED:");
  log("   profileUrl:", p?.profileUrl || "âŒ MISSING");
  log("   name:", p?.name || "âŒ null/missing");
  log("   headline:", p?.headline || "âŒ null/missing");
  log("   currentPositions:", (Array.isArray(p?.currentPositions) ? p.currentPositions.length + " items" : "âŒ not array or missing"));
  
  // Show position details
  if (Array.isArray(p?.currentPositions) && p.currentPositions.length > 0) {
    for (let i = 0; i < Math.min(3, p.currentPositions.length); i++) {
      const pos = p.currentPositions[i];
      log("      [" + i + "] title=" + pos.title + ", company=" + pos.companyName + ", isCurrent=" + pos.isCurrent);
    }
  }
  
  await pushLog(`Profile captured: ${p?.profileUrl || "unknown"}`);

  // ================= PIPELINE GUARDS =================
  if (PIPELINE_STATUS !== "RUNNING") {
    const msg = "Skipped (pipeline paused) â€” Start the pipeline to process profiles";
    log("âš ï¸", msg);
    await pushLog(msg, "WARN");
    return { ok: false, skipped: true, reason: "PIPELINE_PAUSED" };
  }

  const state = await loadState();
  const account = await loadAccount();
  const scanCounters = getEffectiveScanCounters({
    account,
    localTodayCount: state.todayCount,
  });

  const skipQuota = p?._skipQuota === true;
  if (!skipQuota && scanCounters.todayCount >= scanCounters.dailyLimit) {
    const msg = `Skipped (monthly limit ${scanCounters.dailyLimit} reached)`;
    log("âš ï¸", msg);
    await pushLog(msg, "WARN");
    return { ok: false, skipped: true, reason: "MONTHLY_LIMIT" };
  }

  const rawProfileUrl = p?.profileUrl;
  const profileUrl = profileDedupKey(rawProfileUrl);
  if (!profileUrl) {
    const msg = "Skipped (no profileUrl)";
    log("âŒ", msg);
    await pushLog(msg, "WARN");
    return { ok: false, skipped: true, reason: "NO_PROFILE_URL" };
  }
  if (p && typeof p === "object") {
    p.profileUrl = profileUrl;
  }

  if (isCaptureSuppressed(profileUrl)) {
    const msg = `Skipped (capture suppressed during message flow): ${profileUrl}`;
    log("âš ï¸", msg);
    await pushLog(msg, "WARN");
    return { ok: true, skipped: true, reason: "CAPTURE_SUPPRESSED" };
  }

  // Check for pending rescan (set by TRIGGER_RESCAN handler)
  const rescanEntry = rescanPendingMap.get(profileUrl);
  if (rescanEntry) {
    rescanPendingMap.delete(profileUrl);
    p.forceRecapture = true;
    if (rescanEntry.freeRetry) p._skipQuota = true;
    await pushLog(`Rescan active for ${profileUrl} (freeRetry=${rescanEntry.freeRetry})`);
  }

  const allowForcedRecapture = p?.forceRecapture === true;
  if (isDuplicate(state, profileUrl) && !allowForcedRecapture) {
    const msg = `Skipped (duplicate): ${profileUrl}`;
    log("âš ï¸", msg);
    await pushLog(msg);
    return { ok: true, skipped: true, reason: "DUPLICATE" };
  }
  if (allowForcedRecapture) {
    await pushLog(`Forced recapture enabled: ${profileUrl}`, "WARN");
  }

  if (!skipQuota) {
    const scanQuota = await consumeSaasMetric("profiles_scanned", 1);
    if (!scanQuota.ok && scanQuota.authRequired) {
      const msg = "Skipped (login required)";
      log("⚠️", msg);
      await pushLog(msg, "WARN");
      return { ok: false, skipped: true, reason: "AUTH_REQUIRED" };
    }
    if (!scanQuota.ok && scanQuota.limitReached) {
      const msg = "Skipped (SaaS monthly scan quota reached)";
      log("âš ï¸", msg);
      await pushLog(msg, "WARN", scanQuota.detail || null);
      return { ok: false, skipped: true, reason: "SAAS_SCAN_LIMIT" };
    }
    if (!scanQuota.ok && !scanQuota.bypassed) {
      await pushLog("Scan quota check failed (continuing)", "WARN", {
        error: scanQuota.error || "unknown",
      });
    }
  }

  log("✅ Profile validation passed");
  await pushLog("✅ Profile validation passed", "INFO", null, false);

  const opportunityResults = [];

  // ================= 1ï¸âƒ£ POSITIONS ACTIVES =================
  const rawPositions = Array.isArray(p.currentPositions) ? p.currentPositions : [];
  const expanded = expandCompositeCompanyPositions(rawPositions);
  const positions = [];
  const seenPos = new Set();
  for (const pos of expanded) {
    if (!pos || isNoisePosition(pos)) continue;
    const cleanPos = {
      ...pos,
      title: sanitizeTitleFromPosition(pos.title, p.name || ""),
      companyName: sanitizeCompanyNameFromPosition(pos.companyName),
    };
    if (isNoisePosition(cleanPos)) continue;
    const key = `${cleanPos.title || ""}::${cleanPos.companyName || ""}::${cleanPos.companyLinkedinUrl || ""}`
      .toLowerCase()
      .trim();
    if (seenPos.has(key)) continue;
    seenPos.add(key);
    positions.push(cleanPos);
  }

  const activePool = positions.filter((pos) => {
    if (!pos) return false;
    const cleanCompany = sanitizeCompanyNameFromPosition(pos.companyName);
    const hasCompanySignal = Boolean(
      cleanCompany || resolveCompanyLinkedinUrlForPosition(pos, positions)
    );
    if (!hasCompanySignal) return false;
    if (isLikelyPastPosition(pos)) return false;
    return Boolean(pos.title || cleanCompany || pos.companyLinkedinUrl);
  });

  const likelyCurrent = activePool.filter((pos) => isLikelyCurrentPosition(pos));

  const buildUniqueByCompany = (list) => {
    const out = [];
    const seenCompanyKeys = new Set();
    const addIfUnique = (pos) => {
      if (!pos || out.length >= MAX_OPPORTUNITIES_PER_PROFILE) return;
      const key = normalizeCompanyKey(
        sanitizeCompanyNameFromPosition(pos.companyName) ||
          resolveCompanyLinkedinUrlForPosition(pos, positions) ||
          ""
      );
      if (!key) return;
      if (seenCompanyKeys.has(key)) return;
      seenCompanyKeys.add(key);
      out.push(pos);
    };
    list.forEach(addIfUnique);
    return out;
  };

  // Keep explicit current positions only when available.
  // This avoids re-introducing past/ambiguous roles in mixed career blocks.
  const activePositions = (() => {
    if (likelyCurrent.length) return buildUniqueByCompany(likelyCurrent);
    return buildUniqueByCompany(activePool.filter((pos) => pos?.isCurrent !== false));
  })();

  log(
    "Position filtering: input=" +
      positions.length +
      ", likelyCurrent=" +
      likelyCurrent.length +
      ", selected=" +
      activePositions.length
  );
  log(
    "Selected positions:",
    activePositions.map((x) => ({
      title: x?.title || null,
      company: x?.companyName || null,
      isCurrent: x?.isCurrent ?? null,
    }))
  );

  // ================= FALLBACK ABSOLU =================
  // âžœ On NE SKIP PLUS un profil juste parce que LinkedIn est bancal
  if (!activePositions.length) {
    await pushLog("No active position â€” fallback opportunity");

    const fallbackOpportunity = {
      id: uuid(),
      company: null,
      jobTitle: p.headline || "Unknown role",
      companyLinkedinUrl: null,
      website: null,
      role: "UNKNOWN",
      leadType: "COLD_LEAD",
      action: "IGNORE",
      reason: "No active LinkedIn position detected",
      ui: {
        seoBadge: "NO POSITION",
        seoColor: "gray",
        seoEmoji: "â¸ï¸",
        seoLabel: "No active position",
        actionLabel: "IGNORE",
        actionEmoji: "â¸ï¸",
        role: "UNKNOWN",
        confidence: "MEDIUM",
        painBusiness: "UNKNOWN",
        reason: "No current job detected on LinkedIn",
      },
      opportunityStatus: "PRIMARY",
    };

    const lead = {
      id: uuid(),
      createdAt: nowIso(),
      profileUrl,
      name: p.name || null,
      headline: p.headline || null,
      opportunities: [fallbackOpportunity],
      leadType: "COLD_LEAD",
      skippedReason: null,
    };

    await addLead(lead);
    await markProcessed(state, profileUrl, "COLD_LEAD");

    return { ok: true, lead };
  }

  // ================= 2ï¸âƒ£ ANALYSE + SCORING =================
  const analyzed = analyzePositions(activePositions, p.headline || "");

  const scored = analyzed.map(pos => ({
    ...pos,
    score: scorePosition(pos),
  })).sort((a, b) => b.score - a.score);

  const unique = [];
  const seen = new Set();

  for (const pos of scored) {
    const key =
      resolveCompanyLinkedinUrlForPosition(pos, positions) ||
      `${pos.companyName || "unknown"}::${pos.title || ""}`;

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pos);
  }

  const selected = unique.slice(0, MAX_OPPORTUNITIES_PER_PROFILE);

  // ================= 3ï¸âƒ£ OPPORTUNITIES =================
  for (const pos of selected) {
    const normalizedCompany = sanitizeCompanyNameFromPosition(pos.companyName);
    const normalizedTitle = sanitizeTitleFromPosition(pos.title, p.name || "");
    const payload = {
      ...p,
      source: "linkedin_extension_v6",
      companyName: normalizedCompany || null,
      jobTitle: normalizedTitle || null,
      companyLinkedinUrl: resolveCompanyLinkedinUrlForPosition(pos, positions),
      websiteHint: normalizeProspectWebsite(
        pos?.website || pos?.companyWebsite || pos?.websiteHint || null
      ),
      primaryRole: pos.role,
      primaryTitle: normalizedTitle,
      opportunityId: uuid(),
    };

    const res = await processSingleOpportunity(payload, p, state);
    if (res?.opportunity) {
      opportunityResults.push(res.opportunity);
      if (!res.opportunity.website) {
        await pushLog(
          `Opportunity website missing: ${(res.opportunity.company || payload.companyName || "unknown company")}`,
          "WARN",
          {
            profileUrl,
            companyLinkedinUrl: res.opportunity.companyLinkedinUrl || null,
          }
        );
      }
    }
  }

  // ================= 4ï¸âƒ£ FINAL GUARD =================
  if (!opportunityResults.length) {
    await pushLog("All opportunities failed â€” forced cold lead");

    const forcedOpp = {
      id: uuid(),
      company: null,
      jobTitle: p.headline || "Unknown",
      companyLinkedinUrl: null,
      website: null,
      role: "UNKNOWN",
      leadType: "COLD_LEAD",
      action: "IGNORE",
      reason: "No valid opportunity after analysis",
      ui: {
        seoBadge: "LOW SIGNAL",
        seoColor: "gray",
        seoEmoji: "âš ï¸",
        seoLabel: "Weak LinkedIn signal",
        actionLabel: "IGNORE",
        actionEmoji: "â¸ï¸",
        role: "UNKNOWN",
        confidence: "LOW",
        painBusiness: "UNKNOWN",
        reason: "Insufficient data",
      },
      opportunityStatus: "PRIMARY",
    };

    opportunityResults.push(forcedOpp);
  }

  const leadType = aggregateLeadType(opportunityResults);

  const lead = {
    id: uuid(),
    createdAt: nowIso(),
    profileUrl,
    name: p.name || null,
    headline: p.headline || null,
    avatarUrl: p.avatarUrl || null,
    opportunities: opportunityResults,
    leadType,
  };

  await addLead(lead);
  await pushLog(`Lead stored: ${leadType}`);
  await markProcessed(state, profileUrl, leadType);

  return { ok: true, lead };
}






// ================= SIDE PANEL =================
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.sidePanel
    .open({ tabId: tab.id })
    .catch((e) => warn("sidePanel open failed", e));
});

// ================= PANEL REALTIME (PORTS) =================
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== PANEL_PORT_NAME) return;

  panelPorts.add(port);
  pushLog("Panel connected");

  // send cached snapshot immediately so the panel renders without waiting
  buildSnapshot()
    .then((snapshot) => {
      try {
        port.postMessage({ type: "SNAPSHOT", reason: "PANEL_CONNECTED", snapshot });
      } catch {}
    })
    .catch(() => {});

  // then force-sync account data and push a fresh snapshot (picks up avatar/plan changes)
  syncEntitlements({ force: true })
    .then(() => buildSnapshot())
    .then((snapshot) => {
      try {
        port.postMessage({ type: "SNAPSHOT", reason: "ACCOUNT_REFRESH", snapshot });
      } catch {}
    })
    .catch(() => {});

  port.onMessage.addListener(async (msg) => {
    if (!msg?.type) return;

    if (msg.type === "PING") {
      port.postMessage({ type: "PONG", at: nowIso() });
      return;
    }

    if (msg.type === "REQ_SNAPSHOT") {
      const snapshot = await buildSnapshot();
      port.postMessage({ type: "SNAPSHOT", reason: "REQ_SNAPSHOT", snapshot });
      return;
    }
  });

  // Periodic account sync while panel is open — picks up avatar/plan changes live
  const accountSyncInterval = setInterval(async () => {
    if (!panelPorts.has(port)) { clearInterval(accountSyncInterval); return; }
    try {
      await syncEntitlements({ force: true });
      const snapshot = await buildSnapshot();
      port.postMessage({ type: "SNAPSHOT", reason: "ACCOUNT_POLL", snapshot });
    } catch {}
  }, 30000);

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    clearInterval(accountSyncInterval);
    pushLog("Panel disconnected");
  });
});

