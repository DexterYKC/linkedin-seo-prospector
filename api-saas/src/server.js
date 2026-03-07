import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import rawBodyPlugin from 'fastify-raw-body';
import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// Global rate limit: 300 requests/min per IP
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({ ok: false, error: 'RATE_LIMIT_EXCEEDED', retryAfter: 60 }),
});
await app.register(rawBodyPlugin, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

const PORT = process.env.PORT || 3000;
const EXT_API_KEY = process.env.EXT_API_KEY || '';
const N8N_WEBHOOK_SCAN_URL = process.env.N8N_WEBHOOK_SCAN_URL || process.env.N8N_WEBHOOK_URL || '';
const N8N_WEBHOOK_ASSISTANT_URL = process.env.N8N_WEBHOOK_ASSISTANT_URL || '';
const N8N_WEBHOOK_MESSAGE_URL = process.env.N8N_WEBHOOK_MESSAGE_URL || '';
const N8N_WEBHOOK_SEO_EXPORT_URL = process.env.N8N_WEBHOOK_SEO_EXPORT_URL || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TRIAL_DAYS = Number.parseInt(process.env.TRIAL_DAYS || '7', 10);
const API_TOKEN_TTL_DAYS = Number.parseInt(process.env.API_TOKEN_TTL_DAYS || '30', 10);
const LEMON_WEBHOOK_SECRET = process.env.LEMON_WEBHOOK_SECRET || '';
const LEMON_VARIANT_STARTER_ID = Number.parseInt(process.env.LEMON_VARIANT_STARTER_ID || '0', 10);
const LEMON_VARIANT_PRO_ID = Number.parseInt(process.env.LEMON_VARIANT_PRO_ID || '0', 10);
const LEMON_VARIANT_AGENCY_ID = Number.parseInt(
  process.env.LEMON_VARIANT_AGENCY_ID || process.env.LEMON_VARIANT_SCALE_ID || '0',
  10
);
const LEMON_API_KEY = process.env.LEMON_API_KEY || '';
const LEMON_STORE_ID = process.env.LEMON_STORE_ID || '';
const LEMON_CHECKOUT_SUCCESS_URL = process.env.LEMON_CHECKOUT_SUCCESS_URL || '';
const LEMON_CHECKOUT_CANCEL_URL = process.env.LEMON_CHECKOUT_CANCEL_URL || '';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || '';
const NOWPAYMENTS_PRICE_CURRENCY = (process.env.NOWPAYMENTS_PRICE_CURRENCY || 'usd').toLowerCase();
const NOWPAYMENTS_PERIOD_DAYS = Number.parseInt(process.env.NOWPAYMENTS_PERIOD_DAYS || '30', 10);
const BILLING_SUCCESS_URL = process.env.BILLING_SUCCESS_URL || '';
const BILLING_CANCEL_URL = process.env.BILLING_CANCEL_URL || '';
const BILLING_DEFAULT_PROVIDER = String(process.env.BILLING_DEFAULT_PROVIDER || 'lemonsqueezy').toLowerCase();
const ADMIN_EMAILS_RAW = process.env.ADMIN_EMAILS || '';
const APP_BASE_URL = String(process.env.APP_BASE_URL || 'https://app.example.com').replace(/\/+$/, '');
const INVITE_SECRET = SUPABASE_SERVICE_ROLE_KEY || 'invite-fallback-secret-change-me';

const ADMIN_EMAILS = new Set(
  String(ADMIN_EMAILS_RAW)
    .split(',')
    .map((x) => normalizeEmail(x))
    .filter(Boolean)
);

const PLAN_LIMITS = {
  FREE: { profiles_scanned: 40, messages_generated: 10, seo_exports: 15 },
  STARTER: { profiles_scanned: 800, messages_generated: 100, seo_exports: 300 },
  PRO: { profiles_scanned: 3000, messages_generated: 400, seo_exports: 1200 },
  AGENCY: { profiles_scanned: 18000, messages_generated: 2000, seo_exports: 6000 },
};

const MAX_AGENCY_SEATS = 15;
const AGENCY_EXTRA_SEAT_SCANS = 2000; // extra scans per seat beyond the 5 included

const PLAN_FEATURES = {
  FREE: {
    exportCsv: false,
    icpAssistant: false,
    sendNow: false,
    dashboardAdvanced: false,
  },
  STARTER: {
    exportCsv: true,
    icpAssistant: true,
    sendNow: true,
    dashboardAdvanced: true,
  },
  PRO: {
    exportCsv: true,
    icpAssistant: true,
    sendNow: true,
    dashboardAdvanced: true,
  },
  AGENCY: {
    exportCsv: true,
    icpAssistant: true,
    sendNow: true,
    dashboardAdvanced: true,
  },
};

const PLAN_INCLUDED_USERS = {
  FREE: 1,
  STARTER: 1,
  PRO: 1,
  AGENCY: 5,
};

const PLAN_EXTRA_SEAT_USD = {
  FREE: 0,
  STARTER: 0,
  PRO: 0,
  AGENCY: 19,
};

const PLAN_PRICES_USD = {
  STARTER: Number.parseFloat(process.env.PLAN_PRICE_STARTER_USD || '29'),
  PRO: Number.parseFloat(process.env.PLAN_PRICE_PRO_USD || '59'),
  AGENCY: Number.parseFloat(process.env.PLAN_PRICE_AGENCY_USD || process.env.PLAN_PRICE_SCALE_USD || '149'),
};

const METRIC_FIELDS = new Set(['profiles_scanned', 'messages_generated', 'seo_exports']);
const METRIC_PERIODS = {
  profiles_scanned: 'month',
  messages_generated: 'month',
  seo_exports: 'month',
};

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;
let usersHasAuthUserIdColumn = true;
let teamMembersTableAvailable = true;

app.get('/health', async () => ({ ok: true }));

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const v = email.trim().toLowerCase();
  return v || null;
}

function normalizeProfileUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const v = url.trim();
  return v || null;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function utcMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthRangeUtc(monthStr = utcMonth()) {
  const m = String(monthStr || utcMonth());
  const [yStr, mmStr] = m.split('-');
  const y = Number.parseInt(yStr, 10);
  const mm = Number.parseInt(mmStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || mm < 1 || mm > 12) {
    const now = new Date();
    const y0 = now.getUTCFullYear();
    const m0 = now.getUTCMonth() + 1;
    const start = `${y0}-${String(m0).padStart(2, '0')}-01`;
    const endDate = new Date(Date.UTC(y0, m0, 0));
    const end = `${y0}-${String(m0).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
    return { start, end };
  }
  const start = `${y}-${String(mm).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(y, mm, 0));
  const end = `${y}-${String(mm).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
  return { start, end };
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function normalizePlan(input, fallback = 'FREE') {
  const p = String(input || '').trim().toUpperCase();
  if (p === 'TRIAL' || p === 'FREE') return 'FREE';
  if (p === 'STARTER') return 'STARTER';
  if (p === 'PRO') return 'PRO';
  if (p === 'SCALE' || p === 'AGENCY') return 'AGENCY';

  const fb = String(fallback || 'FREE').trim().toUpperCase();
  if (fb === 'TRIAL' || fb === 'FREE') return 'FREE';
  if (fb === 'STARTER') return 'STARTER';
  if (fb === 'PRO') return 'PRO';
  if (fb === 'SCALE' || fb === 'AGENCY') return 'AGENCY';
  return 'FREE';
}

function normalizeProvider(input) {
  const p = String(input || '').trim().toLowerCase();
  if (p === 'lemonsqueezy' || p === 'lemon') return 'lemonsqueezy';
  if (p === 'nowpayments' || p === 'now') return 'nowpayments';
  return BILLING_DEFAULT_PROVIDER === 'nowpayments' ? 'nowpayments' : 'lemonsqueezy';
}

function makeOrderId({ userId, plan }) {
  return `seo:${String(userId)}:${String(plan)}:${Date.now()}:${randomBytes(4).toString('hex')}`;
}

function parseNowOrderId(orderId) {
  const raw = String(orderId || '').trim();
  const parts = raw.split(':');
  if (parts.length < 4 || parts[0] !== 'seo') return null;
  const userId = parts[1] || null;
  const plan = normalizePlan(parts[2] || 'PRO', 'PRO');
  return userId ? { userId, plan } : null;
}

function toJsonText(data) {
  try {
    return JSON.stringify(data || {});
  } catch {
    return '{}';
  }
}

function isNowPaidStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'finished' || s === 'confirmed' || s === 'sending';
}

function isNowPendingStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'waiting' || s === 'confirming' || s === 'partially_paid';
}

function verifyNowPaymentsSignature(rawBody, headerSignature, secret) {
  if (!secret) return false;
  if (!rawBody || !headerSignature) return false;
  const expected = createHmac('sha512', secret).update(String(rawBody)).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(headerSignature || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function getTokenFromHeaders(headers = {}) {
  const raw = headers['x-user-token'];
  if (raw && typeof raw === 'string') return raw.trim();

  const auth = headers.authorization;
  if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function isExtAuthorized(headers = {}) {
  const key = headers['x-ext-key'];
  return Boolean(EXT_API_KEY && key === EXT_API_KEY);
}

function requireSupabase(reply) {
  if (supabase) return true;
  reply.code(500).send({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
  return false;
}

function requireSupabaseAuth(reply) {
  if (supabaseAuth) return true;
  reply.code(500).send({ ok: false, error: 'SUPABASE_ANON_NOT_CONFIGURED' });
  return false;
}

function parseIntSafe(v, fallback = 0) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function splitAssistantTerms(input) {
  return String(input || '')
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function quoteAssistantTerm(term) {
  const t = String(term || '').trim().replace(/\s+/g, ' ').slice(0, 64);
  if (!t) return '';
  return /\s/.test(t) ? `"${t}"` : t;
}

function assistantOrClause(terms) {
  if (!terms.length) return '';
  if (terms.length === 1) return quoteAssistantTerm(terms[0]);
  return `(${terms.map(quoteAssistantTerm).filter(Boolean).join(' OR ')})`;
}

function assistantNotClause(terms) {
  if (!terms.length) return '';
  return terms.map((t) => `NOT ${quoteAssistantTerm(t)}`).filter(Boolean).join(' ');
}

function buildAssistantQueries(state = {}) {
  const roles = splitAssistantTerms(state.roles);
  const offerTerms = splitAssistantTerms(state.offer);
  const geoTerms = splitAssistantTerms(state.geo);
  const excludeTerms = splitAssistantTerms(state.exclude);

  const peopleParts = [];
  peopleParts.push(assistantOrClause(roles.length ? roles : ['CEO', 'Founder', 'Co-Founder']));
  if (offerTerms.length) peopleParts.push(assistantOrClause(offerTerms));
  if (geoTerms.length) peopleParts.push(assistantOrClause(geoTerms));

  const companyParts = [];
  companyParts.push(assistantOrClause(offerTerms.length ? offerTerms : ['SEO', 'marketing']));
  if (geoTerms.length) companyParts.push(assistantOrClause(geoTerms));

  let people = peopleParts.filter(Boolean).join(' AND ').trim();
  let company = companyParts.filter(Boolean).join(' AND ').trim();

  const notPart = assistantNotClause(excludeTerms);
  if (notPart) {
    people = `${people} ${notPart}`.trim();
    company = `${company} ${notPart}`.trim();
  }

  return { people, company };
}

async function callGroqAssistant(prompt) {
  if (!GROQ_API_KEY || !prompt) return null;
  const systemPrompt = `You are an expert LinkedIn lead generation assistant for SEO agencies and consultants. Your users are SEO professionals looking for potential clients — businesses that likely need SEO or digital marketing services. The "need for SEO" is always implicit: the user only describes WHO their target is (role, industry, location, company size), never what service they sell.

Output ONLY a valid JSON object with exactly two keys: "people" and "company". No explanation, no markdown, just the JSON.

=== LINKEDIN BOOLEAN SYNTAX ===
- Operators MUST be UPPERCASE: AND, OR, NOT
- Quote multi-word phrases: "Content Marketing", "Co-Founder"
- Group alternatives: (CEO OR Founder OR PDG)
- Max ~220 chars per query — stay concise and impactful

=== LANGUAGE & MARKET DETECTION ===
- Detect the language from the user's description (FR or EN)
- For French market (France, Paris, Lyon, Bordeaux...): include BOTH French and English professional titles
- For English market: use English titles only
- French title equivalents to always consider:
  * CEO / PDG / Dirigeant
  * Founder / Fondateur / "Co-fondateur"
  * CMO / "Directeur Marketing" / "Responsable Marketing"
  * CTO / "Directeur Technique" / "Directeur Général"
  * "Head of Growth" / "Responsable Croissance"
  * "Business Developer" / "Développeur Commercial"

=== PEOPLE QUERY STRATEGY ===
CRITICAL RULES — violations cause zero results on LinkedIn free search:
1. NEVER start a query with a parenthesized group. Always start with a SINGLE PLAIN KEYWORD first, then add groups.
   CORRECT: "startup AND (CEO OR Founder) AND Paris"
   WRONG:   "(CEO OR Founder) AND startup AND Paris"
2. Max 3 AND groups total
3. Max 4 alternatives per OR group
4. Prefer single unquoted words: ecommerce not "E-commerce Manager", founder not "Co-Founder"
5. Only quote a 2-word phrase if truly inseparable (e.g. "digital marketing")
6. Location goes last as a plain AND word

=== COMPANY QUERY STRATEGY ===
Same rules. Always start with a plain keyword, never with a group.

=== EXAMPLES ===
Input: "fondateurs de startups SaaS à Paris"
{"people":"startup AND (CEO OR Founder OR PDG OR Fondateur) AND Paris","company":"startup AND Paris"}

Input: "SaaS startup founders in Paris"
{"people":"startup AND (CEO OR Founder OR PDG OR Fondateur) AND Paris","company":"startup AND Paris"}

Input: "e-commerce managers in London"
{"people":"ecommerce AND (Manager OR Director OR CMO OR Head) AND London","company":"ecommerce AND London"}

Input: "directeurs e-commerce de PME en France"
{"people":"ecommerce AND (Directeur OR Responsable OR CMO) AND France","company":"ecommerce AND France"}

Input: "directeurs marketing de PME en France"
{"people":"marketing AND (CMO OR Directeur OR Responsable) AND France","company":"marketing AND France"}

Input: "marketing directors at B2B software companies in London"
{"people":"software AND (CMO OR \"Marketing Director\" OR \"VP Marketing\") AND London","company":"software AND (SaaS OR B2B) AND London"}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: String(prompt).slice(0, 500) },
        ],
        temperature: 0.15,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const queries = JSON.parse(content);
    if (queries.people || queries.company) {
      return { people: String(queries.people || '').trim(), company: String(queries.company || '').trim() };
    }
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function callN8nWebhook(url, payload, { timeoutMs = 20000 } = {}) {
  if (!url) {
    return { ok: false, error: 'N8N_URL_MISSING' };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: ctl.signal,
    });
    const txt = await res.text().catch(() => '');
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
        status: res.status,
        error: data?.error || `HTTP_${res.status}`,
        data,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, error: `N8N_FETCH_FAILED: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

function pickPrimaryOpportunityFromLead(lead = {}, opportunityId = null) {
  const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
  if (opportunityId) {
    const byId = opps.find((o) => String(o?.id || '') === String(opportunityId));
    if (byId) return byId;
  }
  return (
    opps.find((o) => String(o?.opportunityStatus || '').toUpperCase() === 'PRIMARY') ||
    opps[0] ||
    null
  );
}

function buildFallbackLeadMessage({ lead = {}, opportunity = null, language = 'fr', tone = 'pro' } = {}) {
  const opp = opportunity || pickPrimaryOpportunityFromLead(lead);
  const ui = opp?.ui && typeof opp.ui === 'object'
    ? opp.ui
    : (lead?.ui && typeof lead.ui === 'object' ? lead.ui : {});

  const firstName = String(lead?.name || '').trim().split(/\s+/)[0] || 'there';
  const company = String(opp?.company || lead?.company || 'your company').trim();
  const website = String(opp?.website || lead?.website || '').trim();
  const reason = String(ui?.reason || '').trim();
  const seoBadge = String(ui?.seoBadge || 'SEO UNKNOWN').trim();

  const fr =
`Bonjour ${firstName},

J'ai regardé ${company}${website ? ` (${website})` : ''} et j'ai identifié une opportunité SEO : ${seoBadge}.
${reason ? `\nContexte : ${reason}.\n` : '\n'}Si tu veux, je peux partager un mini plan d'action en 3 priorités.

Bien à toi,`;

  const en =
`Hi ${firstName},

I reviewed ${company}${website ? ` (${website})` : ''} and identified an SEO opportunity: ${seoBadge}.
${reason ? `\nContext: ${reason}.\n` : '\n'}If useful, I can share a short 3-step action plan.

Best,`;

  const base = String(language || 'fr').toLowerCase().startsWith('fr') ? fr : en;
  const softVariant = `${base}\n\n(No hard pitch, only actionable fixes.)`;
  const directVariant = base.replace('If useful', 'If relevant').replace('Si tu veux', 'Si pertinent');
  const selected = String(tone || 'pro').toLowerCase() === 'soft' ? softVariant : base;

  return {
    ok: true,
    message: selected,
    variants: [base, softVariant, directVariant],
    source: 'backend_fallback',
  };
}

function csvEscape(value, delimiter = ',') {
  const s = String(value ?? '');
  const needsQuote = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter);
  if (needsQuote) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildFallbackSingleSeoCsv({ lead = {}, opportunity = null, language = 'fr' } = {}) {
  const opp = opportunity || pickPrimaryOpportunityFromLead(lead);
  const ui = opp?.ui && typeof opp.ui === 'object'
    ? opp.ui
    : (lead?.ui && typeof lead.ui === 'object' ? lead.ui : {});
  const decision = lead?.decision && typeof lead.decision === 'object' ? lead.decision : {};
  const signals = decision?.signals && typeof decision.signals === 'object' ? decision.signals : {};
  const lang = String(language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const delimiter = lang === 'fr' ? ';' : ',';

  const header = lang === 'fr'
    ? [
      'created_at',
      'nom',
      'entreprise',
      'profil_url',
      'site_web',
      'website_status',
      'seo_level',
      'site_type',
      'lead_type',
      'seo_badge',
      'seo_label',
      'confiance',
      'role',
      'action',
      'raison',
      'source_site',
      'opportunity_status',
      'opportunity_id',
    ]
    : [
      'created_at',
      'name',
      'company',
      'profile_url',
      'website',
      'website_status',
      'seo_level',
      'site_type',
      'lead_type',
      'seo_badge',
      'seo_label',
      'confidence',
      'role',
      'action',
      'reason',
      'website_source',
      'opportunity_status',
      'opportunity_id',
    ];
  const row = [
    lead?.createdAt || '',
    lead?.name || '',
    opp?.company || lead?.company || '',
    lead?.profileUrl || '',
    opp?.website || lead?.website || '',
    opp?.websiteStatus || lead?.websiteStatus || signals?.websiteStatus || '',
    signals?.seoLevel || '',
    signals?.siteType || '',
    lead?.leadType || '',
    ui?.seoBadge || '',
    ui?.seoLabel || '',
    ui?.confidence || decision?.confidence || '',
    ui?.role || signals?.role || '',
    ui?.actionLabel || decision?.final || '',
    ui?.reason || decision?.reason || '',
    opp?.websiteSource || lead?.websiteSource || '',
    opp?.opportunityStatus || '',
    opp?.id || '',
  ];

  const csv = [
    header.map((v) => csvEscape(v, delimiter)).join(delimiter),
    row.map((v) => csvEscape(v, delimiter)).join(delimiter),
  ].join('\n');
  const baseName = String(opp?.company || lead?.company || lead?.name || 'seo-audit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'seo-audit';

  return {
    ok: true,
    format: 'csv',
    mimeType: 'text/csv',
    filename: `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    source: 'backend_fallback',
  };
}

function mapLemonPlanByVariant(variantId) {
  const v = parseIntSafe(variantId, 0);
  if (v && v === LEMON_VARIANT_AGENCY_ID) return 'AGENCY';
  if (v && v === LEMON_VARIANT_PRO_ID) return 'PRO';
  if (v && v === LEMON_VARIANT_STARTER_ID) return 'STARTER';
  return 'FREE';
}

function mapLemonSubStatus(lsStatus) {
  const s = String(lsStatus || '').toLowerCase();
  if (s === 'on_trial' || s === 'trialing') return 'TRIALING';
  if (s === 'active') return 'ACTIVE';
  if (s === 'past_due' || s === 'unpaid' || s === 'paused') return 'PAST_DUE';
  if (s === 'cancelled' || s === 'canceled') return 'CANCELED';
  if (s === 'expired') return 'EXPIRED';
  return 'ACTIVE';
}

function verifyLemonSignature(rawBody, headerSignature, secret) {
  if (!secret) return false;
  if (!rawBody || !headerSignature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(headerSignature || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function findOrCreateUserByEmail(email, fullName = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const q = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (q.data) return q.data;

  const created = await supabase
    .from('users')
    .insert([{
      email: normalizedEmail,
      full_name: fullName || null,
      plan: 'FREE',
      trial_ends_at: addDaysIso(TRIAL_DAYS),
    }])
    .select('*')
    .single();

  if (created.error) return null;
  return created.data;
}

async function issueApiToken(userId, label = 'extension-login') {
  const tokenPlain = randomBytes(32).toString('hex');
  const expiresAt = addDaysIso(API_TOKEN_TTL_DAYS);
  const { error } = await supabase
    .from('api_tokens')
    .insert([{
      user_id: userId,
      token_hash: sha256(tokenPlain),
      label: String(label || 'extension-login').slice(0, 80),
      expires_at: expiresAt,
    }]);

  if (error) return { ok: false, error };
  return { ok: true, token: tokenPlain, expiresAt };
}

async function ensureLocalUserByAuthUser({ authUser, email, fullName = null, linkedinProfileUrl = null }) {
  const authUserId = authUser?.id || null;
  if (!authUserId) return null;
  const normalizedEmail = normalizeEmail(email || authUser?.email);
  const normalizedLinkedin = normalizeProfileUrl(linkedinProfileUrl);

  let user = null;
  if (usersHasAuthUserIdColumn) {
    const byAuth = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (byAuth.error && String(byAuth.error.message || '').toLowerCase().includes('auth_user_id')) {
      usersHasAuthUserIdColumn = false;
    }
    if (byAuth.data) user = byAuth.data;
  }

  if (!user && normalizedEmail) {
    const byEmail = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (byEmail.data) user = byEmail.data;
  }

  if (!user) {
    const baseRow = {
      email: normalizedEmail,
      linkedin_profile_url: normalizedLinkedin,
      full_name: fullName || null,
      plan: 'FREE',
      trial_ends_at: addDaysIso(TRIAL_DAYS),
    };
    const firstRow = usersHasAuthUserIdColumn
      ? { ...baseRow, auth_user_id: authUserId }
      : baseRow;

    let created = await supabase
      .from('users')
      .insert([firstRow])
      .select('*')
      .single();

    if (created.error && usersHasAuthUserIdColumn && String(created.error.message || '').toLowerCase().includes('auth_user_id')) {
      usersHasAuthUserIdColumn = false;
      created = await supabase
        .from('users')
        .insert([baseRow])
        .select('*')
        .single();
    }

    if (created.error) return null;
    return created.data;
  }

  const patch = {};
  if (usersHasAuthUserIdColumn && !user.auth_user_id) patch.auth_user_id = authUserId;
  if (normalizedEmail && user.email !== normalizedEmail) patch.email = normalizedEmail;
  if (normalizedLinkedin && !user.linkedin_profile_url) patch.linkedin_profile_url = normalizedLinkedin;
  if (fullName && !user.full_name) patch.full_name = fullName;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    await supabase.from('users').update(patch).eq('id', user.id);
    return { ...user, ...patch };
  }

  return user;
}

async function upsertSubscriptionFromProvider({
  userId,
  provider = 'lemonsqueezy',
  providerCustomerId,
  providerSubscriptionId,
  plan,
  status,
  periodStart,
  periodEnd,
  cancelAtPeriodEnd = false,
}) {
  const payload = {
    user_id: userId,
    provider: String(provider || 'lemonsqueezy'),
    provider_customer_id: providerCustomerId || null,
    provider_subscription_id: providerSubscriptionId || null,
    plan: normalizePlan(plan || 'FREE', 'FREE'),
    status: status || 'ACTIVE',
    current_period_start: periodStart || null,
    current_period_end: periodEnd || null,
    cancel_at_period_end: Boolean(cancelAtPeriodEnd),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('subscriptions')
    .upsert([payload], {
      onConflict: 'provider_subscription_id',
      ignoreDuplicates: false,
    });

  if (error) return { ok: false, error };

  await supabase
    .from('users')
    .update({
      plan: payload.plan,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  return { ok: true };
}

async function upsertSubscriptionFromLemon(params) {
  return upsertSubscriptionFromProvider({ ...params, provider: 'lemonsqueezy' });
}

async function getSubscriptionByProviderId(providerSubscriptionId) {
  if (!providerSubscriptionId) return null;
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

function getBillingReturnUrl(kind = 'success') {
  if (kind === 'cancel') {
    return BILLING_CANCEL_URL || LEMON_CHECKOUT_CANCEL_URL || BILLING_SUCCESS_URL || LEMON_CHECKOUT_SUCCESS_URL || null;
  }
  return BILLING_SUCCESS_URL || LEMON_CHECKOUT_SUCCESS_URL || BILLING_CANCEL_URL || LEMON_CHECKOUT_CANCEL_URL || null;
}

function buildPlanPriceUsd(plan) {
  const key = normalizePlan(plan, 'PRO');
  const value = Number(PLAN_PRICES_USD[key]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function getLemonVariantIdForPlan(plan) {
  const p = normalizePlan(plan, 'PRO');
  if (p === 'AGENCY') return LEMON_VARIANT_AGENCY_ID;
  if (p === 'PRO') return LEMON_VARIANT_PRO_ID;
  if (p === 'STARTER') return LEMON_VARIANT_STARTER_ID;
  return LEMON_VARIANT_PRO_ID;
}

async function createLemonCheckoutForUser({ user, plan, source = 'extension' }) {
  if (!LEMON_API_KEY || !LEMON_STORE_ID) {
    return { ok: false, code: 500, error: 'LEMON_NOT_CONFIGURED' };
  }

  const variantId = getLemonVariantIdForPlan(plan);
  if (!variantId) {
    return { ok: false, code: 500, error: 'LEMON_VARIANT_NOT_CONFIGURED' };
  }

  const successUrl = getBillingReturnUrl('success');
  const cancelUrl = getBillingReturnUrl('cancel');
  const requestBody = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_options: {
          embed: false,
          media: true,
          logo: true,
        },
        checkout_data: {
          email: user.email || undefined,
          custom: {
            saas_user_id: user.id,
            saas_plan: normalizePlan(plan, 'PRO'),
            source: String(source || 'extension'),
          },
        },
        expires_at: addDaysIso(2),
        product_options: {
          enabled_variants: [variantId],
          redirect_url: successUrl || undefined,
          receipt_button_text: 'Back to SEO LinkedIn Prospector',
          receipt_link_url: successUrl || undefined,
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(LEMON_STORE_ID) } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  };

  const res = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${LEMON_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      code: res.status || 500,
      error: 'LEMON_CREATE_CHECKOUT_FAILED',
      detail: data?.errors || data || text || null,
    };
  }

  const checkoutUrl = data?.data?.attributes?.url || null;
  if (!checkoutUrl) {
    return { ok: false, code: 500, error: 'LEMON_CHECKOUT_URL_MISSING' };
  }

  return {
    ok: true,
    provider: 'lemonsqueezy',
    checkoutUrl,
    meta: {
      plan: normalizePlan(plan, 'PRO'),
      variantId: String(variantId),
      cancelUrl: cancelUrl || null,
      successUrl: successUrl || null,
    },
  };
}

async function createNowPaymentsCheckoutForUser({ user, plan, source = 'extension' }) {
  if (!NOWPAYMENTS_API_KEY) {
    return { ok: false, code: 500, error: 'NOWPAYMENTS_NOT_CONFIGURED' };
  }
  const normalizedPlan = normalizePlan(plan, 'PRO');
  const priceAmount = buildPlanPriceUsd(normalizedPlan);
  if (!priceAmount) {
    return { ok: false, code: 500, error: 'PLAN_PRICE_NOT_CONFIGURED' };
  }

  const orderId = makeOrderId({ userId: user.id, plan: normalizedPlan });
  const successUrl = getBillingReturnUrl('success');
  const cancelUrl = getBillingReturnUrl('cancel');
  const callbackUrl = `${String(reqBaseUrl())}/v1/billing/webhook/nowpayments`;
  const invoicePayload = {
    price_amount: priceAmount,
    price_currency: NOWPAYMENTS_PRICE_CURRENCY,
    order_id: orderId,
    order_description: `SEO LinkedIn Prospector ${normalizedPlan} (${source})`,
    ipn_callback_url: callbackUrl,
    success_url: successUrl || undefined,
    cancel_url: cancelUrl || undefined,
    is_fixed_rate: true,
  };

  const res = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': NOWPAYMENTS_API_KEY,
    },
    body: JSON.stringify(invoicePayload),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      code: res.status || 500,
      error: 'NOWPAYMENTS_CREATE_INVOICE_FAILED',
      detail: data || text || null,
    };
  }

  const checkoutUrl = data?.invoice_url || data?.url || data?.pay_url || null;
  if (!checkoutUrl) {
    return { ok: false, code: 500, error: 'NOWPAYMENTS_URL_MISSING' };
  }

  return {
    ok: true,
    provider: 'nowpayments',
    checkoutUrl,
    meta: {
      plan: normalizedPlan,
      orderId,
      paymentId: data?.payment_id ? String(data.payment_id) : null,
    },
  };
}

function reqBaseUrl() {
  const host = process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || '';
  if (host) return host.replace(/\/+$/, '');
  return `http://localhost:${PORT}`;
}

async function getUserByToken(tokenPlain) {
  if (!tokenPlain || !supabase) return null;
  const tokenHash = sha256(tokenPlain);
  const now = new Date().toISOString();

  const { data: token, error: tokenError } = await supabase
    .from('api_tokens')
    .select('id,user_id,expires_at,revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (tokenError || !token) return null;
  if (token.expires_at && token.expires_at < now) return null;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', token.user_id)
    .maybeSingle();

  if (userError || !user) return null;

  await supabase
    .from('api_tokens')
    .update({ last_used_at: now })
    .eq('id', token.id);

  return user;
}

async function revokeToken(tokenPlain) {
  if (!tokenPlain || !supabase) return false;
  const tokenHash = sha256(tokenPlain);
  const { error } = await supabase
    .from('api_tokens')
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('token_hash', tokenHash)
    .is('revoked_at', null);
  return !error;
}

async function getLatestSubscription(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function getUsageForDay(userId, day) {
  const { data, error } = await supabase
    .from('usage_daily')
    .select('*')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();

  if (error || !data) {
    return {
      user_id: userId,
      day,
      profiles_scanned: 0,
      messages_generated: 0,
      seo_exports: 0,
    };
  }
  return data;
}

async function getUsageForMonth(userId, month = utcMonth()) {
  const range = monthRangeUtc(month);
  const { data, error } = await supabase
    .from('usage_daily')
    .select('profiles_scanned,messages_generated,seo_exports')
    .eq('user_id', userId)
    .gte('day', range.start)
    .lte('day', range.end);

  if (error || !Array.isArray(data)) {
    return {
      month,
      profiles_scanned: 0,
      messages_generated: 0,
      seo_exports: 0,
    };
  }

  let profiles_scanned = 0;
  let messages_generated = 0;
  let seo_exports = 0;
  for (const row of data) {
    profiles_scanned += Number(row?.profiles_scanned || 0);
    messages_generated += Number(row?.messages_generated || 0);
    seo_exports += Number(row?.seo_exports || 0);
  }
  return { month, profiles_scanned, messages_generated, seo_exports };
}

// Aggregate usage for a whole agency team (owner + all active members) in a given month.
// Each member still writes usage to their own row — this just sums them for quota checks.
async function getTeamUsageForMonth(ownerUserId, month = utcMonth()) {
  // Collect all user IDs in the team
  const seatsOut = await listSeatMembersForOwner(ownerUserId);
  const memberIds = (seatsOut.ok && Array.isArray(seatsOut.members))
    ? seatsOut.members.map((m) => String(m.userId || '')).filter(Boolean)
    : [];
  const allIds = [ownerUserId, ...memberIds];

  const range = monthRangeUtc(month);
  const { data, error } = await supabase
    .from('usage_daily')
    .select('profiles_scanned,messages_generated,seo_exports')
    .in('user_id', allIds)
    .gte('day', range.start)
    .lte('day', range.end);

  if (error || !Array.isArray(data)) {
    return { month, profiles_scanned: 0, messages_generated: 0, seo_exports: 0 };
  }

  let profiles_scanned = 0;
  let messages_generated = 0;
  let seo_exports = 0;
  for (const row of data) {
    profiles_scanned  += Number(row?.profiles_scanned  || 0);
    messages_generated += Number(row?.messages_generated || 0);
    seo_exports        += Number(row?.seo_exports        || 0);
  }
  return { month, profiles_scanned, messages_generated, seo_exports };
}

async function ensureUsageRow(userId, day) {
  const { error } = await supabase
    .from('usage_daily')
    .upsert([{ user_id: userId, day }], {
      onConflict: 'user_id,day',
      ignoreDuplicates: true,
    });
  return !error;
}

async function notifyUser(userId, { title, message = null, type = 'info', category = 'ticket', actionUrl = null, sendEmailNotif = false }) {
  if (!supabase || !userId) return;
  try {
    await supabase.from('notifications').insert({
      user_id: userId, title, message, type, category, action_url: actionUrl, read: false,
    });
    if (sendEmailNotif) {
      const { data: userRow } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
      if (userRow?.email) {
        sendNotificationEmail(userRow.email, { title, message, actionUrl }).catch(() => {});
      }
    }
  } catch {}
}

function resolvePlanAndStatus(user, sub) {
  let plan = normalizePlan(user.plan || 'FREE', 'FREE');
  let status = 'ACTIVE';

  if (sub && sub.plan) {
    plan = normalizePlan(sub.plan, plan);
    status = sub.status || 'ACTIVE';
  } else if (plan === 'FREE') {
    const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    if (trialEnd && trialEnd > new Date()) {
      status = 'TRIALING'; // features unlocked, limits stay FREE
    } else {
      status = 'ACTIVE';
    }
  }

  const baseLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
  const blockedStatuses = new Set(['EXPIRED', 'CANCELED', 'PAST_DUE']);
  const extraScans = Number(user?.extra_scans || 0);
  const limits = blockedStatuses.has(status)
    ? { profiles_scanned: 0, messages_generated: 0, seo_exports: 0 }
    : { ...baseLimits, profiles_scanned: baseLimits.profiles_scanned + extraScans };

  return { plan, status, limits };
}

function resolveFeatures(plan, status) {
  const p = normalizePlan(plan || 'FREE', 'FREE');
  const s = String(status || '').toUpperCase();
  const blockedStatuses = new Set(['EXPIRED', 'CANCELED', 'PAST_DUE']);
  if (blockedStatuses.has(s)) {
    return { exportCsv: false, icpAssistant: false, sendNow: false, dashboardAdvanced: false };
  }
  // Trial users get all features unlocked (PRO-level) with FREE-level quotas
  if (s === 'TRIALING' && p === 'FREE') {
    return { ...PLAN_FEATURES.PRO };
  }
  return { ...(PLAN_FEATURES[p] || PLAN_FEATURES.FREE) };
}

function resolveTeamPolicy(plan, status) {
  const p = normalizePlan(plan || 'FREE', 'FREE');
  const blockedStatuses = new Set(['EXPIRED', 'CANCELED', 'PAST_DUE']);
  const billingActive = !blockedStatuses.has(String(status || '').toUpperCase());
  if (!billingActive) {
    return {
      includedUsers: 1,
      additionalSeatUsd: 0,
      seatAddOnEnabled: false,
    };
  }
  // Seats are only available on AGENCY to avoid plan bypass via shared users.
  if (p !== 'AGENCY') {
    return {
      includedUsers: 1,
      additionalSeatUsd: 0,
      seatAddOnEnabled: false,
    };
  }
  const includedUsers = Number(PLAN_INCLUDED_USERS[p] || 1);
  const additionalSeatUsd = Number(PLAN_EXTRA_SEAT_USD[p] || 0);
  return {
    includedUsers,
    additionalSeatUsd,
    seatAddOnEnabled: additionalSeatUsd > 0,
  };
}

function canManageTeamSeats(team = {}) {
  const includedUsers = Number(team?.includedUsers || 0);
  return Boolean(team?.billingActive) && (
    team?.seatAddOnEnabled === true ||
    includedUsers > 1
  );
}

function splitFullName(fullName = '') {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function seatUserFromDb(user = {}, member = {}) {
  const fullName = String(user?.full_name || '').trim();
  const names = splitFullName(fullName);
  return {
    userId: user?.id || null,
    email: user?.email || null,
    fullName: fullName || null,
    firstName: names.firstName || null,
    lastName: names.lastName || null,
    createdAt: member?.created_at || null,
  };
}

function isMissingTableError(error, tableName) {
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  if (code === '42P01') return true;
  return msg.includes('does not exist') && msg.includes(String(tableName || '').toLowerCase());
}

async function listSeatMembersForOwner(ownerUserId) {
  if (!ownerUserId) return { ok: false, code: 400, error: 'OWNER_USER_REQUIRED', members: [], count: 0 };
  if (!teamMembersTableAvailable) return { ok: true, members: [], count: 0 };

  const { data: links, error: linksError } = await supabase
    .from('team_members')
    .select('owner_user_id,member_user_id,status,created_at')
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: true });

  if (linksError) {
    if (isMissingTableError(linksError, 'team_members')) {
      teamMembersTableAvailable = false;
      return { ok: true, members: [], count: 0 };
    }
    return { ok: false, code: 500, error: 'TEAM_MEMBERS_FETCH_FAILED', detail: linksError.message || String(linksError), members: [], count: 0 };
  }

  const list = Array.isArray(links) ? links : [];
  if (!list.length) return { ok: true, members: [], count: 0 };

  const memberIds = list
    .map((x) => String(x?.member_user_id || '').trim())
    .filter(Boolean);
  if (!memberIds.length) return { ok: true, members: [], count: 0 };

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id,email,full_name')
    .in('id', memberIds);

  if (usersError) {
    return { ok: false, code: 500, error: 'TEAM_MEMBER_USERS_FETCH_FAILED', detail: usersError.message || String(usersError), members: [], count: 0 };
  }

  const byId = new Map();
  for (const u of Array.isArray(users) ? users : []) {
    byId.set(String(u?.id || ''), u);
  }

  const members = [];
  for (const link of list) {
    const user = byId.get(String(link.member_user_id || ''));
    if (!user) continue;
    members.push(seatUserFromDb(user, link));
  }
  return {
    ok: true,
    members,
    count: members.length,
  };
}

async function getSeatMembershipByMember(memberUserId) {
  if (!memberUserId) return { ok: true, membership: null };
  if (!teamMembersTableAvailable) return { ok: true, membership: null };

  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('member_user_id', memberUserId)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, 'team_members')) {
      teamMembersTableAvailable = false;
      return { ok: true, membership: null };
    }
    return { ok: false, code: 500, error: 'TEAM_MEMBERSHIP_FETCH_FAILED', detail: error.message || String(error) };
  }
  return { ok: true, membership: data || null };
}

async function upsertSeatMember(ownerUserId, memberUserId) {
  if (!ownerUserId || !memberUserId) {
    return { ok: false, code: 400, error: 'OWNER_MEMBER_REQUIRED' };
  }
  if (!teamMembersTableAvailable) {
    return { ok: false, code: 500, error: 'TEAM_TABLE_MISSING' };
  }

  const payload = {
    owner_user_id: ownerUserId,
    member_user_id: memberUserId,
    role: 'MEMBER',
    status: 'ACTIVE',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('team_members')
    .upsert([payload], {
      onConflict: 'owner_user_id,member_user_id',
      ignoreDuplicates: false,
    });

  if (error) {
    if (isMissingTableError(error, 'team_members')) {
      teamMembersTableAvailable = false;
      return { ok: false, code: 500, error: 'TEAM_TABLE_MISSING' };
    }
    return { ok: false, code: 500, error: 'TEAM_MEMBER_UPSERT_FAILED', detail: error.message || String(error) };
  }
  return { ok: true };
}

function generateInviteToken(email, ownerId) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const payload = Buffer.from(JSON.stringify({ email, ownerId, exp })).toString('base64url');
  const sig = createHmac('sha256', INVITE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyInviteToken(token) {
  try {
    const dot = String(token || '').lastIndexOf('.');
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = createHmac('sha256', INVITE_SECRET).update(payload).digest('base64url');
    if (sig !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data?.email || !data?.ownerId || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function computeRemaining(limits, usage) {
  return {
    profiles_scanned: Math.max(0, Number(limits.profiles_scanned || 0) - Number(usage.profiles_scanned || 0)),
    messages_generated: Math.max(0, Number(limits.messages_generated || 0) - Number(usage.messages_generated || 0)),
    seo_exports: Math.max(0, Number(limits.seo_exports || 0) - Number(usage.seo_exports || 0)),
  };
}

function isAdminUser(user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return true;
  const email = normalizeEmail(user?.email);
  return Boolean(email && ADMIN_EMAILS.has(email));
}

function computeLeadStats(leads = []) {
  const stats = { HOT: 0, WARM: 0, COLD: 0, UNKNOWN: 0, TOTAL: 0 };
  for (const lead of leads) {
    const t = String(lead?.leadType || '').toUpperCase();
    stats.TOTAL += 1;
    if (t.includes('HOT')) stats.HOT += 1;
    else if (t.includes('WARM')) stats.WARM += 1;
    else if (t.includes('COLD')) stats.COLD += 1;
    else stats.UNKNOWN += 1;
  }
  return stats;
}

function hasActionableSignal(lead = {}) {
  const topAction = String(lead?.ui?.actionLabel || lead?.decision?.final || '').toUpperCase();
  if (topAction.includes('CONTACT NOW') || topAction.includes('CONTACT_SOFT') || topAction.includes('FIND_DECISION_MAKER')) {
    return true;
  }
  const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
  return opps.some((o) => {
    const a = String(o?.action || o?.ui?.actionLabel || '').toUpperCase();
    return a.includes('CONTACT_NOW') || a.includes('CONTACT_SOFT') || a.includes('FIND_DECISION_MAKER');
  });
}

function hasDeciderSignal(lead = {}) {
  const normRole = (raw) =>
    String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  const roleLooksDecider = (raw) => {
    const r = normRole(raw);
    return (
      r.includes('DECISION') ||
      r.includes('DECIDEUR') ||
      r.includes('CEO') ||
      r.includes('FOUNDER') ||
      r.includes('OWNER') ||
      r.includes('DIRECTOR')
    );
  };

  if (roleLooksDecider(lead?.ui?.role || lead?.decision?.signals?.role)) return true;
  const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
  return opps.some((o) => roleLooksDecider(o?.role || o?.ui?.role));
}

async function proxyAvatarToStorage(avatarUrl, profileUrl) {
  if (!avatarUrl || !SUPABASE_URL) return null;
  try {
    const res = await fetch(avatarUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    // stable filename based on profileUrl so re-scans overwrite same file
    const safeKey = profileUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const path = `avatars/${safeKey}.${ext}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, buffer, { contentType, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

async function upsertLeadForUser(userId, lead) {
  const profileUrl = normalizeProfileUrl(lead?.profileUrl);
  if (!profileUrl) {
    return { ok: false, code: 400, error: 'PROFILE_URL_REQUIRED' };
  }

  // Proxy avatar to Supabase Storage so browser can load it (LinkedIn CDN blocks non-LinkedIn origins)
  let resolvedAvatarUrl = lead?.avatarUrl || null;
  if (resolvedAvatarUrl && !resolvedAvatarUrl.includes(SUPABASE_URL)) {
    const proxied = await proxyAvatarToStorage(resolvedAvatarUrl, profileUrl);
    if (proxied) resolvedAvatarUrl = proxied;
  }

  const leadWithProxiedAvatar = resolvedAvatarUrl !== (lead?.avatarUrl || null)
    ? { ...lead, avatarUrl: resolvedAvatarUrl }
    : lead;

  const payload = {
    user_id: userId,
    profile_url: profileUrl,
    lead_json: leadWithProxiedAvatar || {},
    lead_type: lead?.leadType || null,
    company: lead?.company || null,
    website: lead?.website || null,
    name: lead?.name || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('leads_cloud')
    .upsert([payload], {
      onConflict: 'user_id,profile_url',
      ignoreDuplicates: false,
    });

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('leads_cloud') && msg.includes('does not exist')) {
      return { ok: false, code: 500, error: 'LEADS_TABLE_MISSING' };
    }
    return { ok: false, code: 500, error: 'LEAD_UPSERT_FAILED', detail: error.message || String(error) };
  }

  return { ok: true };
}

async function listLeadsForUser(userId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(String(limit || 200), 10) || 200));
  const { data, error } = await supabase
    .from('leads_cloud')
    .select('lead_json,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('leads_cloud') && msg.includes('does not exist')) {
      return { ok: false, code: 500, error: 'LEADS_TABLE_MISSING' };
    }
    return { ok: false, code: 500, error: 'LEADS_FETCH_FAILED', detail: error.message || String(error) };
  }

  const leads = Array.isArray(data)
    ? data
      .map((row) => row?.lead_json)
      .filter((x) => x && typeof x === 'object')
    : [];

  return { ok: true, leads };
}

async function buildDashboardForUser(userId) {
  const leadsOut = await listLeadsForUser(userId, 500);
  if (!leadsOut.ok) return leadsOut;

  const leads = leadsOut.leads || [];
  const leadStats = computeLeadStats(leads);
  const actionable = leads.filter((x) => hasActionableSignal(x)).length;
  const deciders = leads.filter((x) => hasDeciderSignal(x)).length;
  const ignored = leads.filter((x) => {
    const action = String(x?.ui?.actionLabel || x?.decision?.final || '').toUpperCase();
    return action.includes('IGNORE');
  }).length;

  let lastCaptureAt = null;
  for (const lead of leads) {
    const ts = Date.parse(String(lead?.createdAt || lead?.updatedAt || ''));
    if (!Number.isFinite(ts)) continue;
    if (!lastCaptureAt || ts > Date.parse(lastCaptureAt)) {
      lastCaptureAt = new Date(ts).toISOString();
    }
  }

  // Build 30-day cumulative lead history using ALL leads
  // Each point = total hot/warm/cold leads captured UP TO that day (inclusive)
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (29 - i));
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  });

  let leadHistory = null;
  const { data: allRows } = await supabase
    .from('leads_cloud')
    .select('lead_json,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (Array.isArray(allRows)) {
    leadHistory = days.map((day) => {
      // Count all leads created on or before this day
      const dayLeads = allRows.filter((row) => {
        const d = String(row?.created_at || '').slice(0, 10);
        return d <= day;
      });
      const hot  = dayLeads.filter((r) => String(r?.lead_json?.leadType || '').toUpperCase().includes('HOT')).length;
      const warm = dayLeads.filter((r) => String(r?.lead_json?.leadType || '').toUpperCase().includes('WARM')).length;
      const cold = dayLeads.filter((r) => String(r?.lead_json?.leadType || '').toUpperCase().includes('COLD')).length;
      return { date: day, hot, warm, cold };
    });
  }

  return {
    ok: true,
    dashboard: {
      leadStats,
      leadsCount: leadStats.TOTAL,
      actionable,
      deciders,
      ignored,
      conversionPct: leadStats.TOTAL ? Math.round((actionable / leadStats.TOTAL) * 100) : 0,
      lastCaptureAt,
      leadHistory,
    },
    leads,
  };
}

async function buildEntitlements(userId, { includeSeats = false } = {}) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (userError || !user) return null;

  // Check if this user is a member of an agency team
  const membershipOut = await getSeatMembershipByMember(user.id);
  const membership = membershipOut?.membership || null;

  let effectivePlan, effectiveStatus, effectiveLimits, effectivePeriodEnd = null;
  if (membership) {
    // Inherit plan from the agency owner
    const { data: ownerUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', membership.owner_user_id)
      .maybeSingle();
    const ownerSub = ownerUser ? await getLatestSubscription(ownerUser.id) : null;
    const ownerResolved = ownerUser ? resolvePlanAndStatus(ownerUser, ownerSub) : null;
    effectivePlan   = ownerResolved?.plan   || 'AGENCY';
    effectiveStatus = ownerResolved?.status || 'ACTIVE';
    effectiveLimits = ownerResolved?.limits || resolvePlanAndStatus(user, null).limits;
  } else {
    const sub = await getLatestSubscription(user.id);
    const resolved = resolvePlanAndStatus(user, sub);
    effectivePlan   = resolved.plan;
    effectiveStatus = resolved.status;
    effectiveLimits = resolved.limits;
    effectivePeriodEnd = sub?.current_period_end || null;
  }

  const features = resolveFeatures(effectivePlan, effectiveStatus);
  const teamBase  = resolveTeamPolicy(effectivePlan, effectiveStatus);
  const day       = utcDay();
  const month     = utcMonth();
  // For AGENCY plans (owner or member), aggregate usage across the whole team so the
  // 18 000 scans/month is a shared pool — each member still writes to their own row.
  const isAgency = effectivePlan === 'AGENCY';
  const agencyOwnerIdForUsage = membership ? membership.owner_user_id : user.id;
  const usageMonth = isAgency
    ? await getTeamUsageForMonth(agencyOwnerIdForUsage, month)
    : await getUsageForMonth(user.id, month);
  const usage = {
    profiles_scanned:   Number(usageMonth.profiles_scanned   || 0),
    messages_generated: Number(usageMonth.messages_generated || 0),
    seo_exports:        Number(usageMonth.seo_exports        || 0),
  };
  let seatUsers = [];
  let seatMembersCount = 0;
  const ownerIdForSeats = membership ? membership.owner_user_id : user.id;
  // Always load seat count for AGENCY owners (needed for dynamic quota), full list when includeSeats=true
  if (includeSeats || (effectivePlan === 'AGENCY' && !membership)) {
    const seatsOut = await listSeatMembersForOwner(ownerIdForSeats);
    if (seatsOut.ok) {
      const members = Array.isArray(seatsOut.members) ? seatsOut.members : [];
      seatMembersCount = Number(seatsOut.count || 0);
      if (includeSeats) {
        // Prepend plan owner so all users (owner + members) see a complete team list
        const { data: ownerRow } = await supabase
          .from('users')
          .select('id, email, full_name')
          .eq('id', ownerIdForSeats)
          .maybeSingle();
        const ownerSeatEntry = ownerRow
          ? { userId: ownerRow.id, email: ownerRow.email, fullName: ownerRow.full_name || null, teamRole: 'OWNER' }
          : null;
        seatUsers = ownerSeatEntry
          ? [ownerSeatEntry, ...members.filter(m => m.userId !== ownerRow.id)]
          : members;
      }
    }
  }

  // Scale scan quota for AGENCY owners: base 12000 + 2000 per extra seat beyond 5 included
  if (effectivePlan === 'AGENCY' && !membership) {
    const extraSeats = Math.max(0, (1 + seatMembersCount) - PLAN_INCLUDED_USERS.AGENCY);
    if (extraSeats > 0) {
      effectiveLimits = {
        ...effectiveLimits,
        profiles_scanned: (effectiveLimits.profiles_scanned || 0) + extraSeats * AGENCY_EXTRA_SEAT_SCANS,
      };
    }
  }

  const remaining = computeRemaining(effectiveLimits, usage);

  const seatsUsed      = 1 + seatMembersCount;
  const seatsLimit     = effectivePlan === 'AGENCY' ? MAX_AGENCY_SEATS : Number(teamBase.includedUsers || 1);
  const seatsRemaining = Math.max(0, seatsLimit - seatsUsed);
  const team = {
    ...teamBase,
    billingActive: !new Set(['EXPIRED', 'CANCELED', 'PAST_DUE']).has(String(effectiveStatus || '').toUpperCase()),
    seatsUsed,
    seatsLimit,
    seatsRemaining,
  };

  const teamRole = membership ? 'MEMBER' : (seatMembersCount > 0 ? 'OWNER' : null);

  return {
    user: {
      id:                user.id,
      email:             user.email,
      linkedinProfileUrl: user.linkedin_profile_url,
      fullName:          user.full_name,
      avatarUrl:         user.avatar_url || null,
      role:              user.role || null,
      isAdmin:           isAdminUser(user),
      plan:              effectivePlan,
      status:            effectiveStatus,
      trialEndsAt:       membership ? null : user.trial_ends_at,
      periodEnd:         effectivePeriodEnd,
      createdAt:         user.created_at || null,
      teamRole,
    },
    limits:   effectiveLimits,
    features,
    team,
    usage: {
      profiles_scanned:   usage.profiles_scanned,
      messages_generated: usage.messages_generated,
      seo_exports:        usage.seo_exports,
      day,
      month,
    },
    remaining,
    ...(includeSeats ? { seatUsers } : {}),
  };
}

async function consumeUsage(userId, metric, amount) {
  if (!METRIC_FIELDS.has(metric)) {
    return { ok: false, code: 400, error: 'INVALID_METRIC' };
  }

  const units = Number.parseInt(String(amount || 1), 10);
  if (!Number.isFinite(units) || units <= 0 || units > 1000) {
    return { ok: false, code: 400, error: 'INVALID_AMOUNT' };
  }

  const ent = await buildEntitlements(userId);
  if (!ent) return { ok: false, code: 404, error: 'USER_NOT_FOUND' };

  // messages_generated quota is for generation (not sending) — no sendNow gate here
  if (metric === 'seo_exports' && !ent.features?.exportCsv) {
    return { ok: false, code: 403, error: 'FEATURE_DISABLED_EXPORT' };
  }

  if (ent.remaining[metric] < units) {
    return {
      ok: false,
      code: 429,
      error: 'LIMIT_REACHED',
      metric,
      limit: ent.limits[metric],
      used: ent.usage[metric],
      remaining: ent.remaining[metric],
    };
  }

  const day = ent.usage.day;
  await ensureUsageRow(userId, day);

  const todayUsage = await getUsageForDay(userId, day);
  const todayCurrent = Number(todayUsage?.[metric] || 0);
  const nextTodayValue = todayCurrent + units;
  const nextUsed = Number(ent.usage[metric] || 0) + units;

  const patch = {};
  patch[metric] = nextTodayValue;
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('usage_daily')
    .update(patch)
    .eq('user_id', userId)
    .eq('day', day);

  if (error) {
    return { ok: false, code: 500, error: 'USAGE_UPDATE_FAILED' };
  }

  return {
    ok: true,
    metric,
    amount: units,
    used: nextUsed,
    limit: ent.limits[metric],
    remaining: Math.max(0, Number(ent.limits[metric] || 0) - nextUsed),
    day,
    period: METRIC_PERIODS[metric] || 'month',
  };
}

app.post('/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
  if (!requireSupabase(reply) || !requireSupabaseAuth(reply)) return;

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
  const linkedinProfileUrl = normalizeProfileUrl(body.linkedinProfileUrl);

  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  if (password.length < 8) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT', hint: 'minimum 8 chars' });
  }

  const inviteToken = String(body.inviteToken || '').trim();
  const inviteData  = inviteToken ? verifyInviteToken(inviteToken) : null;
  const isValidInvite = inviteData && normalizeEmail(inviteData.email) === email;

  // For invited users: auto-confirm so they can join the team immediately
  if (isValidInvite) {
    const createdAuth = await supabase.auth.admin.createUser({
      email, password,
      email_confirm: true,
      user_metadata: { full_name: fullName || null, linkedin_profile_url: linkedinProfileUrl || null },
    });
    if (createdAuth.error || !createdAuth.data?.user) {
      const msg = String(createdAuth.error?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exists')) return reply.code(409).send({ ok: false, error: 'USER_ALREADY_EXISTS' });
      return reply.code(500).send({ ok: false, error: 'AUTH_REGISTER_FAILED' });
    }
    const localUser = await ensureLocalUserByAuthUser({ authUser: createdAuth.data.user, email, fullName, linkedinProfileUrl });
    if (!localUser?.id) return reply.code(500).send({ ok: false, error: 'LOCAL_USER_CREATE_FAILED' });
    await upsertSeatMember(inviteData.ownerId, localUser.id);
    const tokenOut = await issueApiToken(localUser.id, 'register');
    if (!tokenOut.ok) return reply.code(500).send({ ok: false, error: 'TOKEN_CREATE_FAILED' });
    sendWelcomeEmail(email, fullName || '').catch(() => {});
    notifyUser(localUser.id, {
      title: 'Welcome to seoprospector 👋',
      message: "You've been added to your team's Agency workspace. Install the Chrome extension to get started.",
      type: 'success',
      category: 'admin',
      actionUrl: '/dashboard',
    }).catch(() => {});
    const ent = await buildEntitlements(localUser.id, { includeSeats: true });
    return { ok: true, token: tokenOut.token, expiresAt: tokenOut.expiresAt, ...(ent || {}) };
  }

  // Standard registration: require email confirmation
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
    options: {
      data: { full_name: fullName || null, linkedin_profile_url: linkedinProfileUrl || null },
      redirectTo: `${APP_BASE_URL}/login?verified=true`,
    },
  });

  if (linkError || !linkData?.user) {
    const msg = String(linkError?.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('exists')) return reply.code(409).send({ ok: false, error: 'USER_ALREADY_EXISTS' });
    req.log.error({ error: linkError }, 'auth register generateLink failed');
    return reply.code(500).send({ ok: false, error: 'AUTH_REGISTER_FAILED' });
  }

  // Create local user record
  const newLocalUser = await ensureLocalUserByAuthUser({ authUser: linkData.user, email, fullName, linkedinProfileUrl });
  if (newLocalUser?.id) {
    notifyUser(newLocalUser.id, {
      title: 'Welcome to seoprospector 👋',
      message: 'Your free trial is active. Install the Chrome extension and start capturing leads on LinkedIn.',
      type: 'success',
      category: 'admin',
      actionUrl: '/dashboard',
    }).catch(() => {});
  }

  // Send confirmation email via Resend
  const confirmLink = linkData.properties?.action_link;
  if (confirmLink) {
    sendEmailConfirmation(email, fullName || '', confirmLink).catch(() => {});
  }

  return { ok: true, emailSent: true };
});

app.post('/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
  if (!requireSupabase(reply) || !requireSupabaseAuth(reply)) return;

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!email || !password) {
    return reply.code(400).send({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' });
  }

  const authRes = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (authRes.error || !authRes.data?.user) {
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  const authUser = authRes.data.user;
  const localUser = await ensureLocalUserByAuthUser({
    authUser,
    email,
    fullName: authUser.user_metadata?.full_name || null,
    linkedinProfileUrl: authUser.user_metadata?.linkedin_profile_url || null,
  });
  if (!localUser?.id) {
    return reply.code(500).send({ ok: false, error: 'LOCAL_USER_RESOLVE_FAILED' });
  }

  const tokenOut = await issueApiToken(localUser.id, 'login');
  if (!tokenOut.ok) {
    return reply.code(500).send({ ok: false, error: 'TOKEN_CREATE_FAILED' });
  }

  const ent = await buildEntitlements(localUser.id, { includeSeats: true });
  return {
    ok: true,
    token: tokenOut.token,
    expiresAt: tokenOut.expiresAt,
    ...(ent || {}),
  };
});

app.post('/v1/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
  if (!requireSupabaseAuth(reply)) return;
  const { email } = req.body || {};
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return reply.code(400).send({ ok: false, error: 'INVALID_EMAIL' });
  // Always return ok — never reveal whether the email exists
  try {
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: { redirectTo: `${APP_BASE_URL}/reset-password` },
    });
    const resetLink = linkData?.properties?.action_link;
    if (resetLink) await sendPasswordResetEmail(normalizedEmail, resetLink);
  } catch (err) {
    console.error('[FORGOT PASSWORD] Failed to generate/send reset link:', err.message);
  }
  return { ok: true };
});

app.post('/v1/auth/reset-password', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const { accessToken, newPassword } = req.body || {};
  if (!accessToken || !newPassword || String(newPassword).length < 8)
    return reply.code(400).send({ ok: false, error: 'INVALID_INPUT' });
  // Validate the Supabase recovery access token
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(accessToken);
  if (authError || !user) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });
  // Update the password via admin API
  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    password: String(newPassword),
  });
  if (updateError) {
    req.log.error({ error: updateError }, 'reset-password admin update failed');
    return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  }
  return { ok: true };
});

app.post('/v1/auth/logout', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  if (!userToken) return reply.code(400).send({ ok: false, error: 'TOKEN_REQUIRED' });
  await revokeToken(userToken);
  return { ok: true };
});

app.get('/v1/me', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  const ent = await buildEntitlements(user.id, { includeSeats: true });
  if (!ent) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  return { ok: true, ...ent };
});

app.patch('/v1/me', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const body = req.body || {};
  const patch = { updated_at: new Date().toISOString() };

  if (typeof body.fullName === 'string') {
    patch.full_name = body.fullName.trim() || null;
  }
  if (typeof body.linkedinProfileUrl === 'string') {
    patch.linkedin_profile_url = normalizeProfileUrl(body.linkedinProfileUrl) || null;
  }
  if (typeof body.avatarUrl === 'string') {
    const dataUrl = body.avatarUrl.trim();
    if (dataUrl === '') {
      patch.avatar_url = null;
    } else if (dataUrl.startsWith('data:image/')) {
      // Upload base64 image to Supabase Storage
      const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) return reply.code(400).send({ ok: false, error: 'INVALID_IMAGE_FORMAT' });
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buf = Buffer.from(matches[2], 'base64');
      const storagePath = `user-avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(storagePath, buf, { contentType: `image/${matches[1]}`, upsert: true });
      if (upErr) return reply.code(500).send({ ok: false, error: 'AVATAR_UPLOAD_FAILED' });
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(storagePath);
      patch.avatar_url = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
    }
  }

  const { error } = await supabase.from('users').update(patch).eq('id', user.id);
  if (error) return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });

  const ent = await buildEntitlements(user.id, { includeSeats: true });
  return { ok: true, ...ent };
});

app.post('/v1/me/password', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const body = req.body || {};
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  if (!currentPassword || !newPassword) {
    return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS' });
  }
  if (newPassword.length < 8) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT' });
  }

  // Verify current password by re-authenticating
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInErr) return reply.code(400).send({ ok: false, error: 'WRONG_CURRENT_PASSWORD' });

  // Update password via admin API
  const { error: updateErr } = await supabase.auth.admin.updateUserById(user.auth_user_id || user.id, {
    password: newPassword,
  });
  if (updateErr) return reply.code(500).send({ ok: false, error: 'PASSWORD_UPDATE_FAILED' });

  return { ok: true };
});

app.get('/v1/team/seats', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const ent = await buildEntitlements(user.id, { includeSeats: true });
  if (!ent) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  return {
    ok: true,
    allowed: canManageTeamSeats(ent.team || {}),
    team: ent.team || null,
    seatUsers: Array.isArray(ent.seatUsers) ? ent.seatUsers : [],
  };
});

// Team stats — owner or member: leads breakdown + scans this month per member
app.get('/v1/team/stats', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  // Members resolve to their owner's team
  const membershipOut = await getSeatMembershipByMember(user.id);
  const ownerUserId = membershipOut?.membership ? membershipOut.membership.owner_user_id : user.id;

  const seatsOut = await listSeatMembersForOwner(ownerUserId);
  const members = seatsOut.ok && Array.isArray(seatsOut.members) ? seatsOut.members : [];
  const allIds = [ownerUserId, ...members.map((m) => String(m.userId || '')).filter(Boolean)];

  // Leads breakdown per user
  const { data: leadsRows } = await supabase
    .from('leads_cloud')
    .select('user_id,lead_type')
    .in('user_id', allIds);

  const leadsByUser = {};
  for (const id of allIds) leadsByUser[id] = { total: 0, HOT: 0, WARM: 0, COLD: 0 };
  for (const row of Array.isArray(leadsRows) ? leadsRows : []) {
    const uid = String(row.user_id || '');
    if (!leadsByUser[uid]) continue;
    leadsByUser[uid].total++;
    const lt = String(row.lead_type || '').toUpperCase();
    if (lt.includes('HOT'))  leadsByUser[uid].HOT++;
    else if (lt.includes('WARM')) leadsByUser[uid].WARM++;
    else leadsByUser[uid].COLD++;
  }

  // Scans this month per user
  const month = utcMonth();
  const range = monthRangeUtc(month);
  const { data: usageRows } = await supabase
    .from('usage_daily')
    .select('user_id,profiles_scanned')
    .in('user_id', allIds)
    .gte('day', range.start)
    .lte('day', range.end);

  const scansByUser = {};
  for (const id of allIds) scansByUser[id] = 0;
  for (const row of Array.isArray(usageRows) ? usageRows : []) {
    const uid = String(row.user_id || '');
    if (uid in scansByUser) scansByUser[uid] += Number(row.profiles_scanned || 0);
  }

  // Build result — owner first, then members
  const { data: ownerRow } = await supabase.from('users').select('id,email,full_name').eq('id', ownerUserId).maybeSingle();
  const ownerEntry = {
    userId: ownerUserId,
    email: ownerRow?.email || ownerUserId,
    fullName: ownerRow?.full_name || null,
    teamRole: 'OWNER',
    leads: leadsByUser[ownerUserId] || { total: 0, HOT: 0, WARM: 0, COLD: 0 },
    scansThisMonth: scansByUser[ownerUserId] || 0,
  };
  const memberEntries = members.map((m) => ({
    userId: m.userId,
    email: m.email,
    fullName: m.fullName || null,
    teamRole: 'MEMBER',
    leads: leadsByUser[m.userId] || { total: 0, HOT: 0, WARM: 0, COLD: 0 },
    scansThisMonth: scansByUser[m.userId] || 0,
  }));

  return { ok: true, members: [ownerEntry, ...memberEntries], month };
});

// Invite a member by email — adds directly if account exists, returns invite link otherwise
app.post('/v1/team/invite', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const owner = await getUserByToken(userToken);
  if (!owner) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const ent = await buildEntitlements(owner.id, { includeSeats: true });
  if (!ent) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const plan = String(ent.user?.plan || '').toUpperCase();
  if (plan !== 'AGENCY') {
    return reply.code(403).send({ ok: false, error: 'AGENCY_PLAN_REQUIRED' });
  }

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  if (normalizeEmail(owner.email) === email) {
    return reply.code(409).send({ ok: false, error: 'CANNOT_INVITE_YOURSELF' });
  }

  const team = ent.team || {};
  const seatsRemaining = team.seatsRemaining;
  if (seatsRemaining != null && seatsRemaining <= 0) {
    return reply.code(429).send({ ok: false, error: 'SEAT_LIMIT_REACHED', hint: 'Add an extra seat to invite more members.' });
  }

  // Check if user already has an account
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, email, full_name')
    .eq('email', email)
    .maybeSingle();

  if (existingUser?.id) {
    const membership = await getSeatMembershipByMember(existingUser.id);
    if (membership.membership?.owner_user_id === owner.id) {
      return reply.code(409).send({ ok: false, error: 'SEAT_MEMBER_ALREADY_ADDED', hint: 'This user is already in your team.' });
    }
    if (membership.membership?.owner_user_id) {
      return reply.code(409).send({ ok: false, error: 'SEAT_MEMBER_ASSIGNED_TO_ANOTHER_OWNER', hint: 'This user belongs to another team.' });
    }
    const upsertOut = await upsertSeatMember(owner.id, existingUser.id);
    if (!upsertOut.ok) return reply.code(upsertOut.code || 500).send(upsertOut);

    const entAfter = await buildEntitlements(owner.id, { includeSeats: true });
    const seatUsers = Array.isArray(entAfter?.seatUsers) ? entAfter.seatUsers : [];
    const seatUser = seatUsers.find(x => String(x?.userId || '') === String(existingUser.id))
      || { userId: existingUser.id, email: existingUser.email, fullName: existingUser.full_name };
    return { ok: true, type: 'added', seatUser, ...entAfter };
  }

  // User not found — generate signed invite link (valid 7 days)
  const inviteToken = generateInviteToken(email, owner.id);
  const inviteUrl = `${APP_BASE_URL}/invite/${inviteToken}?email=${encodeURIComponent(email)}`;
  return { ok: true, type: 'invite_link', inviteUrl, email };
});

// Remove a team member
app.delete('/v1/team/members/:userId', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const owner = await getUserByToken(userToken);
  if (!owner) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const userId = String(req.params?.userId || '').trim();
  if (!userId) return reply.code(400).send({ ok: false, error: 'USER_ID_REQUIRED' });

  const { data: memberLink } = await supabase
    .from('team_members')
    .select('owner_user_id')
    .eq('member_user_id', userId)
    .eq('owner_user_id', owner.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!memberLink) {
    return reply.code(403).send({ ok: false, error: 'FORBIDDEN_NOT_MEMBER_OWNER' });
  }

  const { error } = await supabase
    .from('team_members')
    .update({ status: 'REMOVED', updated_at: new Date().toISOString() })
    .eq('member_user_id', userId)
    .eq('owner_user_id', owner.id);

  if (error) return reply.code(500).send({ ok: false, error: 'REMOVE_FAILED' });
  return { ok: true };
});

// Add extra seat — placeholder until billing is fully integrated
app.post('/v1/billing/add-seat', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const owner = await getUserByToken(userToken);
  if (!owner) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  // TODO: generate a real Stripe/LemonSqueezy checkout link for the seat add-on
  return { ok: true, url: null };
});

app.post('/v1/team/seats/add', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const owner = await getUserByToken(userToken);
  if (!owner) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const ent = await buildEntitlements(owner.id, { includeSeats: true });
  if (!ent) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  const team = ent.team || {};
  if (!canManageTeamSeats(team)) {
    return reply.code(403).send({ ok: false, error: 'SEAT_ADD_LOCKED' });
  }

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const fullNameInput = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const fullName = String(fullNameInput || `${firstName} ${lastName}`).trim();
  const linkedinProfileUrl = normalizeProfileUrl(body.linkedinProfileUrl);

  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  if (password.length < 8) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT', hint: 'minimum 8 chars' });
  }
  if (!fullName) {
    return reply.code(400).send({ ok: false, error: 'FULL_NAME_REQUIRED' });
  }
  if (normalizeEmail(owner.email) === email) {
    return reply.code(409).send({ ok: false, error: 'OWNER_CANNOT_BE_MEMBER' });
  }

  const includedUsers = Number(team.includedUsers || 1);
  const seatsUsed = Number(team.seatsUsed || (1 + Number(ent?.seatUsers?.length || 0)));
  if (!team.seatAddOnEnabled && seatsUsed >= includedUsers) {
    return reply.code(429).send({
      ok: false,
      error: 'SEAT_LIMIT_REACHED',
      team: { includedUsers, seatsUsed, seatAddOnEnabled: false },
    });
  }
  // Hard cap — cannot exceed MAX_AGENCY_SEATS regardless of add-ons
  if (seatsUsed >= MAX_AGENCY_SEATS) {
    return reply.code(429).send({
      ok: false,
      error: 'MAX_SEAT_LIMIT_REACHED',
      maxSeats: MAX_AGENCY_SEATS,
      seatsUsed,
    });
  }

  const existingLocal = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (existingLocal.error) {
    return reply.code(500).send({ ok: false, error: 'USER_LOOKUP_FAILED' });
  }

  let memberUser = existingLocal.data || null;
  if (!memberUser) {
    const createdAuth = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || null,
        linkedin_profile_url: linkedinProfileUrl || null,
      },
    });

    if (createdAuth.error || !createdAuth.data?.user) {
      const msg = String(createdAuth.error?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
        const fallbackUser = await findOrCreateUserByEmail(email, fullName || null);
        if (!fallbackUser?.id) {
          return reply.code(409).send({ ok: false, error: 'USER_ALREADY_EXISTS' });
        }
        memberUser = fallbackUser;
      } else {
        req.log.error({ error: createdAuth.error }, 'seat auth register failed');
        return reply.code(500).send({ ok: false, error: 'SEAT_AUTH_REGISTER_FAILED' });
      }
    } else {
      memberUser = await ensureLocalUserByAuthUser({
        authUser: createdAuth.data.user,
        email,
        fullName,
        linkedinProfileUrl,
      });
    }
  }

  if (!memberUser?.id) {
    return reply.code(500).send({ ok: false, error: 'SEAT_MEMBER_RESOLVE_FAILED' });
  }
  if (String(memberUser.id) === String(owner.id)) {
    return reply.code(409).send({ ok: false, error: 'OWNER_CANNOT_BE_MEMBER' });
  }

  const existingMembership = await getSeatMembershipByMember(memberUser.id);
  if (!existingMembership.ok) {
    return reply.code(existingMembership.code || 500).send(existingMembership);
  }
  if (existingMembership.membership?.owner_user_id) {
    if (String(existingMembership.membership.owner_user_id) === String(owner.id)) {
      return reply.code(409).send({ ok: false, error: 'SEAT_MEMBER_ALREADY_ADDED' });
    }
    return reply.code(409).send({ ok: false, error: 'SEAT_MEMBER_ASSIGNED_TO_ANOTHER_OWNER' });
  }

  const upsertOut = await upsertSeatMember(owner.id, memberUser.id);
  if (!upsertOut.ok) {
    return reply.code(upsertOut.code || 500).send(upsertOut);
  }

  if (fullName && !memberUser.full_name) {
    await supabase
      .from('users')
      .update({
        full_name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberUser.id);
  }

  const entAfter = await buildEntitlements(owner.id, { includeSeats: true });
  if (!entAfter) return reply.code(500).send({ ok: false, error: 'SEAT_ENTITLEMENTS_REFRESH_FAILED' });

  const seatUsers = Array.isArray(entAfter.seatUsers) ? entAfter.seatUsers : [];
  const seatUser = seatUsers.find((x) => String(x?.userId || '') === String(memberUser.id)) || seatUserFromDb(memberUser);

  return {
    ok: true,
    seatUser,
    ...entAfter,
  };
});

app.post('/v1/leads/upsert', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const body = req.body || {};
  const lead = body?.lead && typeof body.lead === 'object' ? body.lead : body;
  if (!lead || typeof lead !== 'object') {
    return reply.code(400).send({ ok: false, error: 'LEAD_REQUIRED' });
  }

  const out = await upsertLeadForUser(user.id, lead);
  if (!out.ok) return reply.code(out.code || 500).send(out);
  return { ok: true };
});

app.get('/v1/leads', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const limit = parseIntSafe(req.query?.limit, 200);
  const out = await listLeadsForUser(user.id, limit);
  if (!out.ok) return reply.code(out.code || 500).send(out);
  return { ok: true, leads: out.leads || [] };
});

app.delete('/v1/leads', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const body = req.body || {};
  const profileUrls = Array.isArray(body.profileUrls) ? body.profileUrls.map(String).filter(Boolean) : [];
  if (profileUrls.length === 0) return reply.code(400).send({ ok: false, error: 'PROFILE_URLS_REQUIRED' });
  if (profileUrls.length > 200) return reply.code(400).send({ ok: false, error: 'TOO_MANY_LEADS' });

  const { error } = await supabase
    .from('leads_cloud')
    .delete()
    .eq('user_id', user.id)
    .in('profile_url', profileUrls);

  if (error) return reply.code(500).send({ ok: false, error: 'DELETE_FAILED', detail: error.message });
  return { ok: true, deleted: profileUrls.length };
});

app.get('/v1/dashboard', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const ent = await buildEntitlements(user.id, { includeSeats: true });
  if (!ent) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const dashOut = await buildDashboardForUser(user.id);
  if (!dashOut.ok) return reply.code(dashOut.code || 500).send(dashOut);

  const includeLeads = String(req.query?.includeLeads || '').toLowerCase() === 'true';
  return {
    ok: true,
    ...ent,
    dashboard: dashOut.dashboard,
    ...(includeLeads ? { leads: dashOut.leads || [] } : {}),
  };
});

app.get('/v1/team/members/:memberId/dashboard', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const memberId = String(req.params?.memberId || '').trim();
  if (!memberId) return reply.code(400).send({ ok: false, error: 'MEMBER_ID_REQUIRED' });

  // Verify actor is the owner of this member OR a member of the same team
  const actorMembership = await getSeatMembershipByMember(actor.id);
  const ownerIdForActor = actorMembership?.membership?.owner_user_id || null;

  // Check if actor is the direct owner
  const { data: memberLink } = await supabase
    .from('team_members')
    .select('owner_user_id,member_user_id,status')
    .eq('member_user_id', memberId)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  const memberOwner = memberLink?.owner_user_id || null;
  const isDirectOwner = memberOwner === actor.id;
  const isSameTeam = ownerIdForActor && ownerIdForActor === memberOwner;
  // Allow a member to view their plan owner's profile (memberId = the owner)
  const isViewingOwner = ownerIdForActor && ownerIdForActor === memberId;

  if (!isDirectOwner && !isSameTeam && !isViewingOwner) {
    return reply.code(403).send({ ok: false, error: 'FORBIDDEN_NOT_TEAM_MEMBER' });
  }

  const ent = await buildEntitlements(memberId, { includeSeats: false });
  if (!ent) return reply.code(404).send({ ok: false, error: 'MEMBER_NOT_FOUND' });

  const includeLeads = String(req.query?.includeLeads || '').toLowerCase() === 'true';
  const dashOut = await buildDashboardForUser(memberId);

  return {
    ok: true,
    ...ent,
    dashboard: dashOut?.dashboard || null,
    ...(includeLeads ? { leads: dashOut?.leads || [] } : {}),
  };
});

app.post('/v1/admin/reset-user-data', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const body = req.body || {};
  const targetEmail = normalizeEmail(body.targetEmail);
  const targetUserId = String(body.targetUserId || '').trim() || null;

  let target = null;
  if (targetUserId) {
    const byId = await supabase.from('users').select('*').eq('id', targetUserId).maybeSingle();
    if (byId.error) return reply.code(500).send({ ok: false, error: 'TARGET_LOOKUP_FAILED' });
    target = byId.data || null;
  } else if (targetEmail) {
    const byEmail = await supabase.from('users').select('*').eq('email', targetEmail).maybeSingle();
    if (byEmail.error) return reply.code(500).send({ ok: false, error: 'TARGET_LOOKUP_FAILED' });
    target = byEmail.data || null;
  } else {
    target = actor;
  }

  if (!target?.id) return reply.code(404).send({ ok: false, error: 'TARGET_USER_NOT_FOUND' });

  const leadsDelete = await supabase.from('leads_cloud').delete().eq('user_id', target.id);
  const leadsDeleteMessage = String(leadsDelete.error?.message || '').toLowerCase();
  if (leadsDelete.error && !leadsDeleteMessage.includes('does not exist')) {
    return reply.code(500).send({ ok: false, error: 'LEADS_RESET_FAILED' });
  }

  const usageDelete = await supabase.from('usage_daily').delete().eq('user_id', target.id);
  if (usageDelete.error) {
    return reply.code(500).send({ ok: false, error: 'USAGE_RESET_FAILED' });
  }

  return {
    ok: true,
    targetUserId: target.id,
    targetEmail: target.email || null,
    reset: { leads: true, usage: true },
  };
});

// ─── Admin: list users ─────────────────────────────────────────────────────
app.get('/v1/admin/users', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const page          = Math.max(1, parseIntSafe(req.query?.page,  1));
  const limit         = Math.min(200, Math.max(1, parseIntSafe(req.query?.limit, 50)));
  const search        = String(req.query?.search || '').trim().toLowerCase();
  const planFilter    = req.query?.plan ? normalizePlan(String(req.query.plan), null) : null;
  const ownerIdFilter = String(req.query?.ownerId || '').trim();
  const trialingSoon  = req.query?.trialing_soon === '1';
  const exportCsv     = req.query?.export === 'csv';
  const offset        = (page - 1) * limit;

  // If ownerId filter: resolve member IDs from team_members first
  let memberIdsFilter = null;
  if (ownerIdFilter) {
    const { data: memberLinks } = await supabase
      .from('team_members')
      .select('member_user_id')
      .eq('owner_user_id', ownerIdFilter)
      .eq('status', 'ACTIVE');
    memberIdsFilter = (memberLinks || []).map(l => l.member_user_id).filter(Boolean);
    if (memberIdsFilter.length === 0) return { ok: true, users: [], total: 0, page, limit };
  }

  const nowIso  = new Date().toISOString();
  const in7dIso = new Date(Date.now() + 7 * 86400000).toISOString();

  // Build base filter conditions
  const applyFilters = (q) => {
    if (search) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    if (planFilter) q = q.eq('plan', planFilter);
    if (memberIdsFilter) q = q.in('id', memberIdsFilter);
    if (trialingSoon) q = q.gte('trial_ends_at', nowIso).lte('trial_ends_at', in7dIso);
    return q;
  };

  // Separate count query (avoids range+count conflict)
  const { count, error: countError } = await applyFilters(
    supabase.from('users').select('id', { count: 'exact', head: true })
  );
  if (countError) req.log.warn({ error: countError }, 'admin users count failed');

  // Data query — select * to avoid missing-column errors
  const { data, error } = await applyFilters(
    supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
  );
  if (error) return reply.code(500).send({ ok: false, error: 'USERS_FETCH_FAILED', hint: error.message });

  const rows = data || [];
  const userIds = rows.map(u => u.id).filter(Boolean);

  // Fetch active subscriptions for these users
  let subsMap = {};
  if (userIds.length > 0) {
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('user_id, plan, status')
      .in('user_id', userIds)
      .not('status', 'in', '("EXPIRED","CANCELED")');
    for (const s of (subs || [])) {
      if (!subsMap[s.user_id]) subsMap[s.user_id] = s;
    }
  }

  // Fetch team_members relationships (owner and member sides) for displayed users
  let memberOwnerMap   = {}; // memberId -> ownerId
  let ownerMemberCount = {}; // ownerId  -> memberCount
  let ownerEmailMap = {};   // ownerId  -> email
  if (userIds.length > 0) {
    const [ownerRes, memberRes] = await Promise.all([
      supabase.from('team_members').select('owner_user_id, member_user_id').in('owner_user_id', userIds).eq('status', 'ACTIVE'),
      supabase.from('team_members').select('owner_user_id, member_user_id').in('member_user_id', userIds).eq('status', 'ACTIVE'),
    ]);
    for (const lnk of (ownerRes.data || [])) {
      ownerMemberCount[lnk.owner_user_id] = (ownerMemberCount[lnk.owner_user_id] || 0) + 1;
    }
    for (const lnk of (memberRes.data || [])) {
      memberOwnerMap[lnk.member_user_id] = lnk.owner_user_id;
    }

    // Fetch subscriptions + emails for owners not already in the page
    const allOwnerIds = [...new Set(Object.values(memberOwnerMap))];
    const extraOwnerIds = allOwnerIds.filter(id => !subsMap[id]);
    if (extraOwnerIds.length > 0) {
      const { data: ownerSubs } = await supabase
        .from('subscriptions')
        .select('user_id, plan, status')
        .in('user_id', extraOwnerIds)
        .not('status', 'in', '("EXPIRED","CANCELED")');
      for (const s of (ownerSubs || [])) {
        if (!subsMap[s.user_id]) subsMap[s.user_id] = s;
      }
    }
    // Build ownerEmail map so member rows can show who their owner is
    // Owners already in current page rows
    for (const r of rows) { ownerEmailMap[r.id] = r.email; }
    // Owners not on current page — fetch their emails
    const missingOwnerIds = allOwnerIds.filter(id => !ownerEmailMap[id]);
    if (missingOwnerIds.length > 0) {
      const { data: ownerRows } = await supabase
        .from('users').select('id, email').in('id', missingOwnerIds);
      for (const o of (ownerRows || [])) { ownerEmailMap[o.id] = o.email; }
    }
  }

  // Last activity per user (last 30 days window)
  let lastActiveMap = {};
  if (userIds.length > 0) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: actData } = await supabase
      .from('usage_daily')
      .select('user_id, day')
      .in('user_id', userIds)
      .gte('day', thirtyDaysAgo)
      .order('day', { ascending: false });
    for (const row of (actData || [])) {
      if (!lastActiveMap[row.user_id]) lastActiveMap[row.user_id] = row.day;
    }
  }

  const users = rows.map(u => {
    const ownerId = memberOwnerMap[u.id] || null;
    // Members inherit their owner's subscription for plan resolution
    const sub = subsMap[u.id] || (ownerId ? subsMap[ownerId] : null) || null;
    const resolved = resolvePlanAndStatus(u, sub);
    return {
      id:             u.id,
      email:          u.email,
      fullName:       u.full_name || null,
      avatarUrl:      u.avatar_url || null,
      plan:           resolved.plan,
      status:         resolved.status,
      role:           u.role || null,
      isAdmin:        isAdminUser(u),
      trialEndsAt:    u.trial_ends_at || null,
      createdAt:      u.created_at,
      lastActiveDate: lastActiveMap[u.id] || null,
      teamRole:       ownerId ? 'MEMBER' : (ownerMemberCount[u.id] ? 'OWNER' : null),
      ownerId,
      ownerEmail:     ownerId ? (ownerEmailMap[ownerId] || null) : null,
      memberCount:    ownerMemberCount[u.id] || 0,
    };
  });

  // CSV export mode
  if (exportCsv) {
    const header = 'id,email,fullName,plan,status,trialEndsAt,createdAt,lastActiveDate';
    const csvRows = users.map(u =>
      [u.id, u.email, u.fullName || '', u.plan, u.status, u.trialEndsAt || '', u.createdAt, u.lastActiveDate || '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...csvRows].join('\n');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0,10)}.csv"`)
      .send(csv);
  }

  return { ok: true, users, total: count || 0, page, limit };
});

// ─── Admin: get user detail ────────────────────────────────────────────────
app.get('/v1/admin/users/:userId', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const userId = String(req.params?.userId || '').trim();
  if (!userId) return reply.code(400).send({ ok: false, error: 'MISSING_USER_ID' });

  const { data: u, error } = await supabase.from('users').select('*').eq('id', userId).single();
  if (error || !u) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  // Subscription
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('plan, status, ends_at')
    .eq('user_id', userId)
    .not('status', 'in', '("EXPIRED","CANCELED")')
    .order('created_at', { ascending: false })
    .limit(1);
  const sub = subs?.[0] || null;

  // Team membership (member side)
  const { data: memberLink } = await supabase
    .from('team_members')
    .select('owner_user_id')
    .eq('member_user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  const ownerId = memberLink?.owner_user_id || null;

  // If member, get owner's subscription
  let ownerSub = null;
  if (ownerId) {
    const { data: oSubs } = await supabase
      .from('subscriptions')
      .select('plan, status, ends_at')
      .eq('user_id', ownerId)
      .not('status', 'in', '("EXPIRED","CANCELED")')
      .order('created_at', { ascending: false })
      .limit(1);
    ownerSub = oSubs?.[0] || null;
  }

  const effectiveSub = sub || ownerSub;
  const resolved = resolvePlanAndStatus(u, effectiveSub);

  // Usage this month
  const month = utcMonth();
  const usageRaw = await getUsageForMonth(userId, month);
  const usage = {
    profiles_scanned:   Number(usageRaw.profiles_scanned   || 0),
    messages_generated: Number(usageRaw.messages_generated || 0),
    seo_exports:        Number(usageRaw.seo_exports        || 0),
  };
  const limits = PLAN_LIMITS[resolved.plan] || PLAN_LIMITS.FREE;

  // All-time usage + last activity date
  const [allTimeUsageRes, leadsRes, recentDaysRes] = await Promise.all([
    supabase
      .from('usage_daily')
      .select('profiles_scanned,messages_generated,seo_exports,day')
      .eq('user_id', userId)
      .order('day', { ascending: false }),
    supabase
      .from('leads_cloud')
      .select('created_at,updated_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('usage_daily')
      .select('day,profiles_scanned,messages_generated,seo_exports')
      .eq('user_id', userId)
      .order('day', { ascending: false })
      .limit(14),
  ]);

  let allTimeScans = 0, allTimeMsgs = 0, allTimeSeo = 0, lastActivityDate = null;
  if (Array.isArray(allTimeUsageRes.data)) {
    for (const row of allTimeUsageRes.data) {
      allTimeScans += Number(row.profiles_scanned || 0);
      allTimeMsgs  += Number(row.messages_generated || 0);
      allTimeSeo   += Number(row.seo_exports || 0);
    }
    if (allTimeUsageRes.data.length > 0) {
      lastActivityDate = allTimeUsageRes.data[0].day || null;
    }
  }

  const leadsTotal   = leadsRes.count ?? 0;
  const lastLeadAt   = leadsRes.data?.[0]?.updated_at || null;

  const recentDays = (recentDaysRes.data || []).map(r => ({
    day:               String(r.day),
    profiles_scanned:  Number(r.profiles_scanned  || 0),
    messages_generated: Number(r.messages_generated || 0),
    seo_exports:       Number(r.seo_exports        || 0),
  }));

  return reply.send({
    ok: true,
    user: {
      id:          u.id,
      email:       u.email,
      fullName:    u.full_name || null,
      plan:        resolved.plan,
      status:      resolved.status,
      isAdmin:     isAdminUser(u),
      trialEndsAt: u.trial_ends_at || null,
      subEndsAt:   effectiveSub?.ends_at || null,
      createdAt:   u.created_at,
      teamRole:    ownerId ? 'MEMBER' : null,
      ownerId,
    },
    usage,
    limits,
    allTime: {
      profiles_scanned:   allTimeScans,
      messages_generated: allTimeMsgs,
      seo_exports:        allTimeSeo,
      lastActivityDate,
    },
    leads: {
      total:      leadsTotal,
      lastLeadAt,
    },
    recentDays,
  });
});

// ─── Admin: extend user trial ─────────────────────────────────────────────
app.patch('/v1/admin/users/:userId/trial', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const userId = String(req.params?.userId || '').trim();
  const days   = Math.max(1, Math.min(90, parseInt(String(req.body?.days || 7), 10) || 7));

  const { data: u } = await supabase.from('users').select('trial_ends_at').eq('id', userId).maybeSingle();
  if (!u) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const base    = u.trial_ends_at && Date.parse(u.trial_ends_at) > Date.now()
    ? new Date(u.trial_ends_at)
    : new Date();
  const newDate = new Date(base.getTime() + days * 86400000);

  await supabase.from('users').update({ trial_ends_at: newDate.toISOString() }).eq('id', userId);
  return reply.send({ ok: true, trialEndsAt: newDate.toISOString() });
});

// ─── Admin: extend user scans ─────────────────────────────────────────────
app.patch('/v1/admin/users/:userId/scans', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const userId = String(req.params?.userId || '').trim();
  const amount = Math.max(1, Math.min(10000, parseInt(String(req.body?.amount || 500), 10) || 500));

  const { data: u } = await supabase.from('users').select('extra_scans').eq('id', userId).maybeSingle();
  if (!u) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const current = Number(u.extra_scans || 0);
  const newTotal = current + amount;
  await supabase.from('users').update({ extra_scans: newTotal }).eq('id', userId);
  return reply.send({ ok: true, extraScans: newTotal });
});

// ─── Admin: delete user ────────────────────────────────────────────────────
app.delete('/v1/admin/users/:userId', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const userId = String(req.params?.userId || '').trim();
  if (!userId) return reply.code(400).send({ ok: false, error: 'USER_ID_REQUIRED' });
  if (userId === actor.id) return reply.code(400).send({ ok: false, error: 'CANNOT_DELETE_SELF' });

  // Get auth_user_id before deleting local row
  const { data: userRow } = await supabase.from('users').select('auth_user_id').eq('id', userId).maybeSingle();
  const authUserId = userRow?.auth_user_id || null;

  // Delete all related data then the user row
  await supabase.from('leads_cloud').delete().eq('user_id', userId);
  await supabase.from('leads').delete().eq('user_id', userId);
  await supabase.from('usage_daily').delete().eq('user_id', userId);
  await supabase.from('subscriptions').delete().eq('user_id', userId);
  await supabase.from('api_tokens').delete().eq('user_id', userId);
  await supabase.from('team_members').delete().or(`owner_user_id.eq.${userId},member_user_id.eq.${userId}`);
  await supabase.from('sessions').delete().eq('user_id', userId);

  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) return reply.code(500).send({ ok: false, error: 'DELETE_FAILED', detail: error.message });

  // Delete from Supabase Auth so the email can be re-used
  if (authUserId) {
    await supabase.auth.admin.deleteUser(authUserId);
  }

  return { ok: true, deleted: userId };
});

// ─── Admin: platform activity (30 days) ───────────────────────────────────
app.get('/v1/admin/activity', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const days = 30;
  const startDate = new Date(Date.now() - (days - 1) * 86400000);
  startDate.setUTCHours(0, 0, 0, 0);
  const startStr = startDate.toISOString().slice(0, 10);

  const [usageRes, usersRes] = await Promise.all([
    supabase
      .from('usage_daily')
      .select('day, profiles_scanned, messages_generated, seo_exports')
      .gte('day', startStr)
      .order('day', { ascending: true }),
    supabase
      .from('users')
      .select('created_at')
      .gte('created_at', startDate.toISOString()),
  ]);

  // Build day map for usage
  const usageByDay = {};
  for (const row of (usageRes.data || [])) {
    const d = String(row.day).slice(0, 10);
    if (!usageByDay[d]) usageByDay[d] = { scans: 0, messages: 0, seo: 0 };
    usageByDay[d].scans    += Number(row.profiles_scanned   || 0);
    usageByDay[d].messages += Number(row.messages_generated || 0);
    usageByDay[d].seo      += Number(row.seo_exports        || 0);
  }

  // Build day map for new signups
  const signupsByDay = {};
  for (const u of (usersRes.data || [])) {
    const d = String(u.created_at || '').slice(0, 10);
    if (d) signupsByDay[d] = (signupsByDay[d] || 0) + 1;
  }

  // Build full 30-day array
  const result = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(startDate.getTime() + i * 86400000);
    const d  = dt.toISOString().slice(0, 10);
    result.push({
      day:      d,
      scans:    usageByDay[d]?.scans    || 0,
      messages: usageByDay[d]?.messages || 0,
      seo:      usageByDay[d]?.seo      || 0,
      signups:  signupsByDay[d]         || 0,
    });
  }

  return reply.send({ ok: true, days: result });
});

// ─── Admin: global stats ───────────────────────────────────────────────────
app.get('/v1/admin/stats', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const [usersRes, usersCountRes, subsRes, leadsCountRes] = await Promise.all([
    supabase.from('users').select('id, plan, created_at'),
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('plan, status').eq('status', 'ACTIVE'),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
  ]);

  const allUsers = usersRes.data || [];
  const totalUsers = usersCountRes.count ?? allUsers.length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const newToday = allUsers.filter(u => u.created_at && new Date(u.created_at) >= today).length;

  // Plan breakdown from active subscriptions (source of truth)
  const activeSubs = (subsRes.data || []).length;
  const byPlan = { FREE: Math.max(0, totalUsers - activeSubs), STARTER: 0, PRO: 0, AGENCY: 0 };
  for (const s of (subsRes.data || [])) {
    const p = normalizePlan(s.plan || 'FREE', 'FREE');
    if (p in byPlan) byPlan[p]++;
  }
  const totalLeads = leadsCountRes.count ?? 0;

  return {
    ok: true,
    totalUsers,
    newToday,
    byPlan,
    activeSubs,
    totalLeads,
  };
});

// ─── Admin: update user plan/status ───────────────────────────────────────
app.patch('/v1/admin/users/:userId', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(userToken);
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const userId = String(req.params?.userId || '').trim();
  if (!userId) return reply.code(400).send({ ok: false, error: 'USER_ID_REQUIRED' });

  const body = req.body || {};

  // users table only has plan — status lives in subscriptions
  if (body.plan === undefined) {
    return reply.code(400).send({ ok: false, error: 'NO_FIELDS_TO_UPDATE' });
  }
  const newPlan = normalizePlan(String(body.plan), 'FREE');

  const { error } = await supabase.from('users').update({ plan: newPlan }).eq('id', userId);
  if (error) return reply.code(500).send({ ok: false, error: 'USER_UPDATE_FAILED', detail: error.message });

  // also update any active subscription plan to stay in sync
  if (body.status !== undefined) {
    const newStatus = String(body.status).toUpperCase();
    await supabase.from('subscriptions').update({ plan: newPlan, status: newStatus }).eq('user_id', userId);
  } else {
    await supabase.from('subscriptions').update({ plan: newPlan }).eq('user_id', userId);
  }

  const { data: updated } = await supabase.from('users').select('id, email, full_name, plan').eq('id', userId).maybeSingle();
  return { ok: true, user: updated || null };
});

app.post('/v1/auth/session', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
  if (!requireSupabase(reply)) return;
  if (!isExtAuthorized(req.headers)) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  }

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const linkedinProfileUrl = normalizeProfileUrl(body.linkedinProfileUrl);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : 'extension';

  if (!email && !linkedinProfileUrl) {
    return reply.code(400).send({
      ok: false,
      error: 'IDENTITY_REQUIRED',
      hint: 'Provide email or linkedinProfileUrl',
    });
  }

  let user = null;

  if (linkedinProfileUrl) {
    const q = await supabase
      .from('users')
      .select('*')
      .eq('linkedin_profile_url', linkedinProfileUrl)
      .maybeSingle();
    if (q.data) user = q.data;
  }

  if (!user && email) {
    const q = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (q.data) user = q.data;
  }

  if (!user) {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        email,
        linkedin_profile_url: linkedinProfileUrl,
        full_name: fullName,
        plan: 'FREE',
        trial_ends_at: addDaysIso(TRIAL_DAYS),
      }])
      .select('*')
      .single();

    if (error || !data) {
      req.log.error({ error }, 'failed to create user');
      return reply.code(500).send({ ok: false, error: 'USER_CREATE_FAILED' });
    }
    user = data;
  } else {
    const patch = {};
    if (email && !user.email) patch.email = email;
    if (linkedinProfileUrl && !user.linkedin_profile_url) patch.linkedin_profile_url = linkedinProfileUrl;
    if (fullName && !user.full_name) patch.full_name = fullName;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await supabase.from('users').update(patch).eq('id', user.id);
    }
  }

  const tokenPlain = randomBytes(32).toString('hex');
  const expiresAt = addDaysIso(API_TOKEN_TTL_DAYS);

  const { error: tokenError } = await supabase
    .from('api_tokens')
    .insert([{
      user_id: user.id,
      token_hash: sha256(tokenPlain),
      label,
      expires_at: expiresAt,
    }]);

  if (tokenError) {
    req.log.error({ error: tokenError }, 'failed to create api token');
    return reply.code(500).send({ ok: false, error: 'TOKEN_CREATE_FAILED' });
  }

  return {
    ok: true,
    token: tokenPlain,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      linkedinProfileUrl: user.linkedin_profile_url,
      fullName: user.full_name,
      role: user.role || null,
      isAdmin: isAdminUser(user),
      plan: user.plan,
      trialEndsAt: user.trial_ends_at,
    },
  };
});

app.get('/v1/entitlements', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const ent = await buildEntitlements(user.id, { includeSeats: true });
  if (!ent) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  return { ok: true, ...ent };
});

app.post('/v1/usage/consume', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const body = req.body || {};
  const metric = body.metric;
  const amount = body.amount;
  const out = await consumeUsage(user.id, metric, amount);

  if (!out.ok) {
    return reply.code(out.code || 500).send(out);
  }
  return out;
});

app.post('/v1/assistant/query', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  if (!isExtAuthorized(req.headers)) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  }

  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const ent = await buildEntitlements(user.id);
  if (!ent) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  if (!ent.features?.icpAssistant) {
    return reply.code(403).send({ ok: false, error: 'FEATURE_DISABLED_ICP_ASSISTANT' });
  }

  const body = req.body || {};
  const checkOnly = body?.checkOnly === true;
  if (checkOnly) {
    return {
      ok: true,
      allowed: true,
      plan: ent.user?.plan || 'FREE',
      features: {
        icpAssistant: true,
      },
    };
  }

  const payload = {
    state: body?.state || {},
    _saas: {
      userId: user.id,
      plan: ent.user?.plan || 'FREE',
    },
  };

  if (N8N_WEBHOOK_ASSISTANT_URL) {
    const n8n = await callN8nWebhook(N8N_WEBHOOK_ASSISTANT_URL, payload, { timeoutMs: 15000 });
    if (n8n.ok) {
      const queries = n8n.data?.queries && typeof n8n.data.queries === 'object'
        ? n8n.data.queries
        : (n8n.data?.json?.queries && typeof n8n.data.json.queries === 'object'
          ? n8n.data.json.queries
          : null);
      if (queries) {
        return {
          ok: true,
          plan: ent.user?.plan || 'FREE',
          queries,
          source: 'n8n',
        };
      }
      req.log.warn({ data: n8n.data }, 'assistant n8n response missing queries, fallback');
    } else {
      req.log.warn({ error: n8n.error, status: n8n.status }, 'assistant n8n call failed, fallback');
    }
  }

  const groqQueries = await callGroqAssistant(body?.state?.prompt);
  if (groqQueries) {
    return {
      ok: true,
      plan: ent.user?.plan || 'FREE',
      queries: groqQueries,
      source: 'groq',
    };
  }

  const queries = buildAssistantQueries(body?.state || {});
  return {
    ok: true,
    plan: ent.user?.plan || 'FREE',
    queries,
    source: 'backend_fallback',
  };
});

app.post('/v1/messages/generate', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  // Accept extension key OR a valid user JWT (site web)
  if (!isExtAuthorized(req.headers) && !getTokenFromHeaders(req.headers)) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  }

  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const ent = await buildEntitlements(user.id);
  if (!ent) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  const body = req.body || {};
  const lead = body?.lead && typeof body.lead === 'object' ? body.lead : null;
  if (!lead) {
    return reply.code(400).send({ ok: false, error: 'INVALID_LEAD_PAYLOAD' });
  }
  const opportunityId = String(body?.opportunityId || '').trim() || null;
  const language = String(body?.language || 'fr').toLowerCase();
  const tone = String(body?.tone || body?.messageType || 'professional').toLowerCase();
  const context = String(body?.context || '').trim() || null;

  const selectedOpportunity = pickPrimaryOpportunityFromLead(lead, opportunityId);
  const payload = {
    lead,
    opportunityId,
    language,
    tone,
    context,
    _saas: {
      userId: user.id,
      plan: ent.user?.plan || 'FREE',
    },
  };

  if (N8N_WEBHOOK_MESSAGE_URL) {
    const n8n = await callN8nWebhook(N8N_WEBHOOK_MESSAGE_URL, payload, { timeoutMs: 18000 });
    if (n8n.ok) {
      const data = n8n.data?.json && typeof n8n.data.json === 'object' ? n8n.data.json : n8n.data;
      if (data && typeof data.message === 'string' && data.message.trim()) {
        return {
          ok: true,
          message: data.message,
          variants: Array.isArray(data.variants) ? data.variants : [data.message],
          source: 'n8n',
        };
      }
      req.log.warn({ data: n8n.data }, 'message n8n response missing message, fallback');
    } else {
      req.log.warn({ error: n8n.error, status: n8n.status }, 'message n8n call failed, fallback');
    }
  }

  return buildFallbackLeadMessage({
    lead,
    opportunity: selectedOpportunity,
    language,
    tone,
  });
});

// ========== MESSAGE TRACKING LOGS ==========
app.post('/v1/messages/log', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const { profileUrl, leadName, opportunityName, action, wasEdited, sentStatus, messagePreview } = req.body || {};
  if (!profileUrl || !action) return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS' });

  const now = new Date().toISOString();

  if (action === 'generation') {
    const { data: existing } = await supabase
      .from('message_logs')
      .select('generation_count')
      .eq('user_id', user.id)
      .eq('profile_url', profileUrl)
      .maybeSingle();

    const genCount = ((existing?.generation_count) || 0) + 1;
    const genUpsert = {
      user_id: user.id,
      profile_url: profileUrl,
      lead_name: String(leadName || ''),
      opportunity_name: String(opportunityName || ''),
      generation_count: genCount,
      last_generated_at: now,
      updated_at: now,
    };
    if (messagePreview) genUpsert.message_preview = String(messagePreview).slice(0, 500);
    const { error: upsertErr } = await supabase.from('message_logs').upsert(genUpsert, { onConflict: 'user_id,profile_url' });
    if (upsertErr) {
      req.log.error({ error: upsertErr.message, code: upsertErr.code }, 'message_logs upsert failed');
      return reply.code(500).send({ ok: false, error: upsertErr.message });
    }
  } else if (action === 'sent') {
    const { error: upsertErr } = await supabase.from('message_logs').upsert({
      user_id: user.id,
      profile_url: profileUrl,
      lead_name: String(leadName || ''),
      sent_at: now,
      sent_status: ['SENT', 'DRAFT_FILLED', 'UNKNOWN'].includes(String(sentStatus || '')) ? String(sentStatus) : 'SENT',
      was_manually_edited: wasEdited === true,
      message_preview: String(messagePreview || '').slice(0, 200),
      updated_at: now,
    }, { onConflict: 'user_id,profile_url' });
    if (upsertErr) {
      req.log.error({ error: upsertErr.message, code: upsertErr.code }, 'message_logs sent upsert failed');
      return reply.code(500).send({ ok: false, error: upsertErr.message });
    }
  } else {
    return reply.code(400).send({ ok: false, error: 'UNKNOWN_ACTION' });
  }

  return { ok: true };
});

app.get('/v1/messages/logs', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });

  const { data, error } = await supabase
    .from('message_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return reply.code(500).send({ ok: false, error: error.message });
  return { ok: true, logs: data || [] };
});

app.post('/v1/seo/export-single', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  if (!isExtAuthorized(req.headers)) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  }

  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const ent = await buildEntitlements(user.id);
  if (!ent) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  if (!ent.features?.exportCsv) {
    return reply.code(403).send({ ok: false, error: 'FEATURE_DISABLED_EXPORT_CSV' });
  }

  const body = req.body || {};
  const lead = body?.lead && typeof body.lead === 'object' ? body.lead : null;
  if (!lead) {
    return reply.code(400).send({ ok: false, error: 'INVALID_LEAD_PAYLOAD' });
  }
  const opportunityId = String(body?.opportunityId || '').trim() || null;
  const language = String(body?.language || 'fr').toLowerCase();
  const selectedOpportunity = pickPrimaryOpportunityFromLead(lead, opportunityId);

  const payload = {
    lead,
    opportunityId,
    language,
    format: 'csv',
    _saas: {
      userId: user.id,
      plan: ent.user?.plan || 'FREE',
    },
  };

  if (N8N_WEBHOOK_SEO_EXPORT_URL) {
    const n8n = await callN8nWebhook(N8N_WEBHOOK_SEO_EXPORT_URL, payload, { timeoutMs: 18000 });
    if (n8n.ok) {
      const data = n8n.data?.json && typeof n8n.data.json === 'object' ? n8n.data.json : n8n.data;
      if (data && typeof data.csv === 'string') {
        return {
          ok: true,
          format: 'csv',
          mimeType: data.mimeType || 'text/csv',
          filename: data.filename || `seo-audit-${new Date().toISOString().slice(0, 10)}.csv`,
          csv: data.csv,
          source: 'n8n',
        };
      }
      req.log.warn({ data: n8n.data }, 'seo export n8n response missing csv, fallback');
    } else {
      req.log.warn({ error: n8n.error, status: n8n.status }, 'seo export n8n call failed, fallback');
    }
  }

  return buildFallbackSingleSeoCsv({
    lead,
    opportunity: selectedOpportunity,
    language,
  });
});

app.get('/v1/billing/providers', async (_req, reply) => {
  const providers = {
    lemonsqueezy: {
      enabled: Boolean(LEMON_API_KEY && LEMON_STORE_ID),
      variants: {
        starter: LEMON_VARIANT_STARTER_ID || null,
        pro: LEMON_VARIANT_PRO_ID || null,
        agency: LEMON_VARIANT_AGENCY_ID || null,
        scale: LEMON_VARIANT_AGENCY_ID || null,
      },
    },
    nowpayments: {
      enabled: Boolean(NOWPAYMENTS_API_KEY),
      priceCurrency: NOWPAYMENTS_PRICE_CURRENCY,
    },
  };
  return reply.send({
    ok: true,
    defaultProvider: normalizeProvider(BILLING_DEFAULT_PROVIDER),
    providers,
    pricesUsd: PLAN_PRICES_USD,
  });
});

app.post('/v1/billing/checkout-link', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const userToken = getTokenFromHeaders(req.headers);
  const user = await getUserByToken(userToken);
  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_USER_TOKEN' });
  }

  const body = req.body || {};
  const plan = normalizePlan(body.plan || 'PRO', 'PRO');
  const source = String(body.source || 'extension');
  const preferredProvider = normalizeProvider(body.provider || BILLING_DEFAULT_PROVIDER);

  const providersToTry = preferredProvider === 'nowpayments'
    ? ['nowpayments', 'lemonsqueezy']
    : ['lemonsqueezy', 'nowpayments'];

  for (const provider of providersToTry) {
    const out = provider === 'nowpayments'
      ? await createNowPaymentsCheckoutForUser({ user, plan, source })
      : await createLemonCheckoutForUser({ user, plan, source });
    if (out.ok) {
      return reply.send({
        ok: true,
        provider: out.provider,
        checkoutUrl: out.checkoutUrl,
        plan,
        meta: out.meta || {},
      });
    }
  }

  return reply.code(500).send({
    ok: false,
    error: 'NO_BILLING_PROVIDER_AVAILABLE',
    hint: 'Configure LemonSqueezy or NOWPayments env vars',
  });
});

app.post(
  '/v1/billing/webhook/nowpayments',
  { config: { rawBody: true } },
  async (req, reply) => {
    if (!requireSupabase(reply)) return;
    if (!NOWPAYMENTS_API_KEY) {
      return reply.code(500).send({ ok: false, error: 'NOWPAYMENTS_NOT_CONFIGURED' });
    }

    if (NOWPAYMENTS_IPN_SECRET) {
      const rawBody = req.rawBody || toJsonText(req.body);
      const signature =
        req.headers['x-nowpayments-sig'] ||
        req.headers['x-nowpayments-signature'] ||
        req.headers['x-signature'];
      const signatureOk = verifyNowPaymentsSignature(rawBody, signature, NOWPAYMENTS_IPN_SECRET);
      if (!signatureOk) {
        req.log.warn('invalid nowpayments webhook signature');
        return reply.code(401).send({ ok: false, error: 'INVALID_SIGNATURE' });
      }
    }

    const body = req.body || {};
    const paymentStatus = String(body.payment_status || body.invoice_status || '').toLowerCase();
    const paid = isNowPaidStatus(paymentStatus);
    const pending = isNowPendingStatus(paymentStatus);

    const parsedOrder = parseNowOrderId(body.order_id);
    const userId = parsedOrder?.userId || null;
    const plan = parsedOrder?.plan || normalizePlan(body.plan || 'PRO', 'PRO');
    if (!userId) {
      return reply.code(200).send({ ok: true, ignored: true, reason: 'ORDER_ID_UNREADABLE' });
    }

    const userOut = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (userOut.error || !userOut.data) {
      return reply.code(200).send({ ok: true, ignored: true, reason: 'USER_NOT_FOUND' });
    }
    const user = userOut.data;

    if (!paid) {
      return reply.code(200).send({
        ok: true,
        ignored: true,
        reason: pending ? 'PAYMENT_PENDING' : 'PAYMENT_NOT_COMPLETED',
        paymentStatus,
      });
    }

    const status = 'ACTIVE';

    const now = new Date();
    const periodStart = now.toISOString();
    const periodEnd = addDaysIso(Math.max(1, NOWPAYMENTS_PERIOD_DAYS));
    const providerSubscriptionId = `np_${String(body.payment_id || body.invoice_id || body.order_id || Date.now())}`;

    const subResult = await upsertSubscriptionFromProvider({
      userId: user.id,
      provider: 'nowpayments',
      providerCustomerId: user.email || null,
      providerSubscriptionId,
      plan,
      status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: false,
    });
    if (!subResult.ok) {
      req.log.error({ error: subResult.error, body }, 'nowpayments upsert failed');
      return reply.code(500).send({ ok: false, error: 'SUBSCRIPTION_UPSERT_FAILED' });
    }

    return reply.code(200).send({
      ok: true,
      provider: 'nowpayments',
      userId: user.id,
      plan,
      status,
      paymentStatus,
    });
  }
);

app.post(
  '/v1/billing/webhook/lemonsqueezy',
  { config: { rawBody: true } },
  async (req, reply) => {
    if (!requireSupabase(reply)) return;
    if (!LEMON_WEBHOOK_SECRET) {
      return reply.code(500).send({ ok: false, error: 'LEMON_WEBHOOK_SECRET_MISSING' });
    }

    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const signature = req.headers['x-signature'];
    const signatureOk = verifyLemonSignature(rawBody, signature, LEMON_WEBHOOK_SECRET);
    if (!signatureOk) {
      req.log.warn('invalid lemon webhook signature');
      return reply.code(401).send({ ok: false, error: 'INVALID_SIGNATURE' });
    }

    const body = req.body || {};
    const eventName = String(body?.meta?.event_name || body?.event_name || '').trim();
    const data = body?.data || {};
    const attrs = data?.attributes || {};

    const email = normalizeEmail(
      attrs.user_email ||
      attrs.customer_email ||
      attrs.email ||
      body?.meta?.custom_data?.email
    );
    const fullName = attrs.user_name || attrs.customer_name || body?.meta?.custom_data?.name || null;

    if (!email) {
      return reply.code(200).send({
        ok: true,
        ignored: true,
        reason: 'EMAIL_NOT_FOUND',
        eventName,
      });
    }

    const user = await findOrCreateUserByEmail(email, fullName);
    if (!user?.id) {
      return reply.code(500).send({ ok: false, error: 'USER_RESOLVE_FAILED' });
    }

    const providerSubscriptionId =
      data?.id ? String(data.id) : (attrs.subscription_id ? String(attrs.subscription_id) : null);
    const providerCustomerId =
      attrs.customer_id ? String(attrs.customer_id) : null;

    const variantId =
      attrs.variant_id ||
      attrs.first_subscription_item?.variant_id ||
      attrs.first_order_item?.variant_id ||
      attrs.order_item?.variant_id ||
      null;

    const existingSub = await getSubscriptionByProviderId(providerSubscriptionId);
    let plan = mapLemonPlanByVariant(variantId);
    if (plan === 'FREE' && existingSub?.plan) {
      plan = existingSub.plan;
    }

    let status = mapLemonSubStatus(attrs.status);
    const ev = eventName.toLowerCase();
    if (ev === 'subscription_cancelled') status = 'CANCELED';
    if (ev === 'subscription_expired') status = 'EXPIRED';
    if (ev === 'subscription_payment_failed') status = 'PAST_DUE';
    if (ev === 'subscription_payment_success') status = 'ACTIVE';
    if (ev === 'subscription_resumed' || ev === 'subscription_unpaused') status = 'ACTIVE';
    if (ev === 'subscription_paused') status = 'PAST_DUE';

    const periodStart =
      attrs.current_period_start ||
      attrs.updated_at ||
      attrs.created_at ||
      null;
    const periodEnd =
      attrs.current_period_end ||
      attrs.renews_at ||
      attrs.ends_at ||
      null;
    const cancelAtPeriodEnd = Boolean(
      attrs.cancelled ||
      attrs.cancel_at_end ||
      attrs.cancel_at_period_end
    );

    const shouldUpsert =
      ev.startsWith('subscription_') ||
      ev === 'order_created';

    if (shouldUpsert) {
      const subResult = await upsertSubscriptionFromLemon({
        userId: user.id,
        providerCustomerId,
        providerSubscriptionId:
          providerSubscriptionId || `ls_order_${data?.id || Date.now()}`,
        plan,
        status,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd,
      });
      if (!subResult.ok) {
        req.log.error({ error: subResult.error, eventName }, 'lemonsqueezy upsert failed');
        return reply.code(500).send({ ok: false, error: 'SUBSCRIPTION_UPSERT_FAILED' });
      }
    }

    return reply.code(200).send({
      ok: true,
      event: eventName,
      userId: user.id,
      plan,
      status,
    });
  }
);

app.post('/v1/scan', async (req, reply) => {
  const extAuthorized = isExtAuthorized(req.headers);
  const userToken = getTokenFromHeaders(req.headers);
  const user = userToken ? await getUserByToken(userToken) : null;

  if (!user) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED', hint: 'missing x-user-token' });
  }
  if (!N8N_WEBHOOK_SCAN_URL) {
    return reply.code(500).send({ ok: false, error: 'N8N_WEBHOOK_SCAN_URL_MISSING' });
  }

  if (user && supabase) {
    const ent = await buildEntitlements(user.id);
    if (!ent) {
      return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
    }
    if (Number(ent.remaining?.profiles_scanned || 0) < 1) {
      return reply.code(429).send({
        ok: false,
        error: 'LIMIT_REACHED',
        metric: 'profiles_scanned',
        limit: Number(ent.limits?.profiles_scanned || 0),
        used: Number(ent.usage?.profiles_scanned || 0),
      });
    }
  }

  const payload = req.body || {};
  if (user) {
    payload._saas = {
      userId: user.id,
      plan: user.plan || 'FREE',
    };
  }

  const n8n = await callN8nWebhook(N8N_WEBHOOK_SCAN_URL, payload, { timeoutMs: 30000 });
  if (!n8n.ok) {
    return reply.code(Number(n8n.status) || 502).send({
      ok: false,
      error: n8n.error || 'SCAN_WEBHOOK_FAILED',
      detail: n8n.data || null,
    });
  }

  // Usage is consumed by the extension flow:
  // - profiles_scanned: when a profile capture starts
  // - seo_exports: only on explicit export actions

  return n8n.data;
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOG
// ═══════════════════════════════════════════════════════════════════════════

// ─── Public: list published posts ─────────────────────────────────────────
app.get('/v1/blog/posts', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const limit  = Math.min(parseInt(req.query?.limit  || '20', 10), 100);
  const offset = Math.max(parseInt(req.query?.offset || '0',  10), 0);
  const tag    = String(req.query?.tag || '').trim() || null;

  let q = supabase.from('blog_posts').select('id,slug,title,excerpt,cover_image,author_name,tags,published_at', { count: 'exact' })
    .eq('published', true)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (tag) q = q.contains('tags', [tag]);

  const { data, count, error } = await q;
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_FETCH_FAILED', hint: error.message });
  return { ok: true, posts: data || [], total: count || 0, limit, offset };
});

// ─── Public: single post by slug ──────────────────────────────────────────
app.get('/v1/blog/posts/:slug', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const slug = String(req.params?.slug || '').trim();
  if (!slug) return reply.code(400).send({ ok: false, error: 'SLUG_REQUIRED' });

  const { data, error } = await supabase.from('blog_posts').select('*')
    .eq('slug', slug).eq('published', true).maybeSingle();
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_FETCH_FAILED', hint: error.message });
  if (!data) return reply.code(404).send({ ok: false, error: 'POST_NOT_FOUND' });
  return { ok: true, post: data };
});

// ─── Admin: list all posts (incl. drafts) ─────────────────────────────────
app.get('/v1/admin/blog/posts', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const token = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(token);
  const moderator = actor ? null : getModeratorByToken(token);
  if (!actor && !moderator) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (actor && !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });

  const { data, error } = await supabase.from('blog_posts')
    .select('id,slug,title,excerpt,cover_image,author_name,tags,published,published_at,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_FETCH_FAILED', hint: error.message });
  return { ok: true, posts: data || [] };
});

// ─── Admin: get single post (full content for editing) ────────────────────
app.get('/v1/admin/blog/posts/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const token = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(token);
  const moderator = actor ? null : getModeratorByToken(token);
  if (!actor && !moderator) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (actor && !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });

  const { data, error } = await supabase.from('blog_posts').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_FETCH_FAILED', hint: error.message });
  if (!data) return reply.code(404).send({ ok: false, error: 'POST_NOT_FOUND' });
  return { ok: true, post: data };
});

// ─── Admin: create post ────────────────────────────────────────────────────
app.post('/v1/admin/blog/posts', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const token = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(token);
  const moderator = actor ? null : getModeratorByToken(token);
  if (!actor && !moderator) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (actor && !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });

  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (!title) return reply.code(400).send({ ok: false, error: 'TITLE_REQUIRED' });

  const toSlug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const slug = toSlug(String(body.slug || '').trim() || title);

  const now = new Date().toISOString();
  const published = body.published === true;
  const authorId = actor ? actor.id : moderator.id;
  const authorName = String(body.author_name || (actor ? (actor.full_name || actor.email) : moderator.name) || '').trim();
  const payload = {
    slug,
    title,
    excerpt:     String(body.excerpt     || '').trim() || null,
    content:     String(body.content     || '').trim() || null,
    cover_image: String(body.cover_image || '').trim() || null,
    author_id:   authorId,
    author_name: authorName,
    tags:        Array.isArray(body.tags) ? body.tags : [],
    published,
    published_at: published ? now : null,
    created_at:  now,
    updated_at:  now,
  };

  const { data, error } = await supabase.from('blog_posts').insert([payload]).select().maybeSingle();
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_CREATE_FAILED', hint: error.message });
  return { ok: true, post: data };
});

// ─── Admin: update post ────────────────────────────────────────────────────
app.patch('/v1/admin/blog/posts/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const token = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(token);
  const moderator = actor ? null : getModeratorByToken(token);
  if (!actor && !moderator) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (actor && !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });

  const { data: existing } = await supabase.from('blog_posts').select('published,published_at').eq('id', req.params.id).maybeSingle();
  if (!existing) return reply.code(404).send({ ok: false, error: 'POST_NOT_FOUND' });

  const body = req.body || {};
  const now  = new Date().toISOString();
  const patch = { updated_at: now };

  if (body.title       !== undefined) patch.title       = String(body.title).trim();
  if (body.slug        !== undefined) patch.slug        = String(body.slug).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  if (body.excerpt     !== undefined) patch.excerpt     = String(body.excerpt).trim() || null;
  if (body.content     !== undefined) patch.content     = String(body.content).trim() || null;
  if (body.cover_image !== undefined) patch.cover_image = String(body.cover_image).trim() || null;
  if (body.author_name !== undefined) patch.author_name = String(body.author_name).trim();
  if (body.tags        !== undefined) patch.tags        = Array.isArray(body.tags) ? body.tags : [];
  if (body.published   !== undefined) {
    patch.published    = body.published === true;
    if (patch.published && !existing.published_at) patch.published_at = now;
    if (!patch.published) patch.published_at = null;
  }

  const { data, error } = await supabase.from('blog_posts').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_UPDATE_FAILED', hint: error.message });
  return { ok: true, post: data };
});

// ─── Admin: delete post ────────────────────────────────────────────────────
app.delete('/v1/admin/blog/posts/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const token = getTokenFromHeaders(req.headers);
  const actor = await getUserByToken(token);
  const moderator = actor ? null : getModeratorByToken(token);
  if (!actor && !moderator) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (actor && !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });

  const { error } = await supabase.from('blog_posts').delete().eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'BLOG_DELETE_FAILED', hint: error.message });
  return { ok: true };
});

// ─── Moderator helpers ────────────────────────────────────────────────────

function hashModeratorPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyModeratorPassword(password, stored) {
  // stored format: "salt:hash"
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = hashModeratorPassword(password, salt);
  try {
    return timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function createModeratorPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = hashModeratorPassword(password, salt);
  return `${salt}:${hash}`;
}

function signModeratorToken(mod) {
  const payload = Buffer.from(JSON.stringify({
    id: mod.id, email: mod.email, name: mod.name,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64');
  const sig = createHmac('sha256', INVITE_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyModeratorToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', INVITE_SECRET).update(payload).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (!data.id || Date.now() > data.exp) return null;
    return { id: data.id, email: data.email, name: data.name };
  } catch { return null; }
}

function getModeratorByToken(tokenPlain) {
  return verifyModeratorToken(tokenPlain);
}

// ─── Moderator: login ─────────────────────────────────────────────────────
app.post('/v1/moderator/login', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const { email, password } = req.body || {};
  if (!email || !password) return reply.code(400).send({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' });

  const { data: mod, error } = await supabase
    .from('moderators').select('*').eq('email', String(email).toLowerCase().trim()).maybeSingle();
  if (error || !mod) return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });

  if (!verifyModeratorPassword(String(password), mod.password_hash))
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });

  const token = signModeratorToken(mod);
  return { ok: true, token, moderator: { id: mod.id, email: mod.email, name: mod.name } };
});

// ─── Admin: list moderators ───────────────────────────────────────────────
app.get('/v1/admin/moderators', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { data, error } = await supabase.from('moderators')
    .select('id,email,name,created_at').order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });
  return { ok: true, moderators: data || [] };
});

// ─── Admin: create moderator ──────────────────────────────────────────────
app.post('/v1/admin/moderators', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return reply.code(400).send({ ok: false, error: 'EMAIL_PASSWORD_NAME_REQUIRED' });
  if (String(password).length < 8) return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT' });

  const password_hash = createModeratorPasswordHash(String(password));
  const { data, error } = await supabase.from('moderators')
    .insert([{ email: String(email).toLowerCase().trim(), password_hash, name: String(name).trim() }])
    .select('id,email,name,created_at').maybeSingle();
  if (error) return reply.code(500).send({ ok: false, error: 'CREATE_FAILED', hint: error.message });
  return { ok: true, moderator: data };
});

// ─── Admin: delete moderator ──────────────────────────────────────────────
app.delete('/v1/admin/moderators/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { error } = await supabase.from('moderators').delete().eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'DELETE_FAILED' });
  return { ok: true };
});

// ─── AI Support Chat ───────────────────────────────────────────────────────

app.post('/v1/support/chat', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
}, async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  if (!GROQ_API_KEY) return reply.code(503).send({ ok: false, error: 'AI_UNAVAILABLE' });

  const { messages, userContext } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return reply.code(400).send({ ok: false, error: 'INVALID_MESSAGES' });
  }

  // Build user context block if provided
  let userContextBlock = '';
  if (userContext && typeof userContext === 'object') {
    const { email, plan, status, usage, limits, remaining, nextReset } = userContext;
    userContextBlock = `
--- CURRENT USER ACCOUNT CONTEXT ---
Email: ${email || 'unknown'}
Plan: ${plan || 'FREE'} | Status: ${status || 'ACTIVE'}
Scans:    ${usage?.scans ?? '?'} used / ${limits?.scans ?? '?'} limit (${remaining?.scans ?? '?'} remaining)
SEO audits: ${usage?.seo ?? '?'} used / ${limits?.seo ?? '?'} limit (${remaining?.seo ?? '?'} remaining)
Messages: ${usage?.messages ?? '?'} used / ${limits?.messages ?? '?'} limit (${remaining?.messages ?? '?'} remaining)
Next quota reset: ${nextReset || 'unknown'}
--- END CONTEXT ---

Use this data to give precise, personalized answers about the user's account. Do not say you don't have access to their account — you do.`;
  }

  const SYSTEM_PROMPT = `You are the support assistant for Seoprospector, a Chrome extension that helps SEO agencies prospect on LinkedIn.

You help users with:
- Extension installation, connection, and the session token (found in Account > Extension tab)
- Understanding and managing quotas: scans, SEO audits, and message generation (visible in Account > Profile)
- Billing and plan details: FREE (40 scans, 5 SEO, 0 messages), STARTER $29/mo (500 scans, 50 SEO, 100 messages), PRO $59/mo (3000 scans, 1200 SEO, 400 messages), AGENCY $149/mo (18000 scans, 6000 SEO, 2000 messages, up to 5 seats)
- LinkedIn prospecting workflow: scanning profiles, scoring leads as HOT/WARM/COLD, generating AI outreach messages
- Agency plan: team seats at $19/seat, shared dashboard, member management
- Technical troubleshooting for the dashboard and Chrome extension
${userContextBlock}
Rules:
- Be concise and clear. Use short paragraphs or bullet points.
- Use the account context above to give precise, personalized answers.
- If the issue truly cannot be resolved (e.g. needs manual action), suggest creating a support ticket.
- Respond in the same language as the user (English or French).
- Do not mention competitors.
- Always refer to the product as "Seoprospector" — never "SEO Prospector", "seo prospector", "seoprospector", or any other variant.`;

  const safeMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...safeMessages],
        max_tokens: 1024,
        temperature: 0.6,
      }),
    });
  } catch (fetchErr) {
    app.log.error({ fetchErr }, 'Groq fetch error');
    return reply.code(502).send({ ok: false, error: 'AI_UNAVAILABLE' });
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    app.log.error({ errText }, 'Groq API error');
    return reply.code(502).send({ ok: false, error: 'AI_ERROR' });
  }

  const data = await groqRes.json();
  const answer = data.choices?.[0]?.message?.content || '';
  return { ok: true, answer };
});

// ─── Support Tickets (user) ────────────────────────────────────────────────

app.get('/v1/support/tickets', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', actor.id)
    .order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });
  return { ok: true, tickets: data };
});

app.post('/v1/support/tickets', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { subject, message } = req.body || {};
  if (!subject?.trim() || !message?.trim()) return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS' });

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .insert({ user_id: actor.id, subject: subject.trim(), status: 'open' })
    .select()
    .single();
  if (tErr) return reply.code(500).send({ ok: false, error: 'CREATE_FAILED' });

  const { error: mErr } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticket.id, sender_type: 'user', sender_name: actor.full_name || actor.email, content: message.trim() });
  if (mErr) return reply.code(500).send({ ok: false, error: 'MESSAGE_FAILED' });

  return { ok: true, ticket };
});

app.get('/v1/support/tickets/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', actor.id)
    .single();
  if (tErr || !ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  const { data: messages } = await supabase
    .from('support_messages')
    .select('*')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true });

  return { ok: true, ticket, messages: messages || [] };
});

app.post('/v1/support/tickets/:id/messages', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data: ticket } = await supabase.from('support_tickets').select('id,status').eq('id', req.params.id).eq('user_id', actor.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
  if (ticket.status === 'closed') return reply.code(400).send({ ok: false, error: 'TICKET_CLOSED' });

  const { content } = req.body || {};
  if (!content?.trim()) return reply.code(400).send({ ok: false, error: 'MISSING_CONTENT' });

  await supabase.from('support_messages').insert({ ticket_id: ticket.id, sender_type: 'user', sender_name: actor.full_name || actor.email, content: content.trim() });
  await supabase.from('support_tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', ticket.id);
  return { ok: true };
});

app.patch('/v1/support/tickets/:id/close', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data: ticket } = await supabase.from('support_tickets').select('id').eq('id', req.params.id).eq('user_id', actor.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  await supabase.from('support_tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
  return { ok: true };
});

// ─── Support Tickets (admin) ───────────────────────────────────────────────

app.get('/v1/admin/support/tickets', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { status } = req.query || {};
  let q = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return reply.code(500).send({ ok: false, error: error.message });

  // Enrich with user emails
  const userIds = [...new Set((data || []).map(t => t.user_id))];
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: usersData } = await supabase.from('users').select('id, email, full_name').in('id', userIds);
    usersMap = Object.fromEntries((usersData || []).map(u => [u.id, u]));
  }
  const tickets = (data || []).map(t => ({ ...t, user: usersMap[t.user_id] || null }));
  return { ok: true, tickets };
});

app.get('/v1/admin/support/tickets/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { data: ticket } = await supabase.from('support_tickets').select('*').eq('id', req.params.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  const { data: userData } = await supabase.from('users').select('id, email, full_name').eq('id', ticket.user_id).single();
  const { data: messages } = await supabase.from('support_messages').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
  return { ok: true, ticket: { ...ticket, user: userData || null }, messages: messages || [] };
});

app.post('/v1/admin/support/tickets/:id/messages', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { content } = req.body || {};
  if (!content?.trim()) return reply.code(400).send({ ok: false, error: 'MISSING_CONTENT' });

  const { data: ticket } = await supabase.from('support_tickets').select('id,status,user_id,subject').eq('id', req.params.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  await supabase.from('support_messages').insert({ ticket_id: ticket.id, sender_type: 'admin', sender_name: actor.full_name || 'Support', content: content.trim() });
  await supabase.from('support_tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticket.id);
  await notifyUser(ticket.user_id, {
    title: 'New reply on your support ticket',
    message: ticket.subject || null,
    type: 'info',
    category: 'ticket',
    actionUrl: `/support/${ticket.id}`,
  });
  return { ok: true };
});

app.patch('/v1/admin/support/tickets/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { status } = req.body || {};
  if (!status) return reply.code(400).send({ ok: false, error: 'MISSING_STATUS' });

  const { error } = await supabase.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  return { ok: true };
});

// ─── Support Agent helpers ─────────────────────────────────────────────────

function verifySupportAgentPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function createSupportAgentPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function signSupportAgentToken(agent) {
  const payload = Buffer.from(JSON.stringify({
    id: agent.id, email: agent.email, name: agent.name, role: 'support_agent',
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64');
  const sig = createHmac('sha256', INVITE_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function getSupportAgentByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', INVITE_SECRET).update(payload).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (!data.id || data.role !== 'support_agent' || Date.now() > data.exp) return null;
    return { id: data.id, email: data.email, name: data.name, role: 'support_agent' };
  } catch { return null; }
}

// ─── Support Agent: login ──────────────────────────────────────────────────
app.post('/v1/support-agent/login', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const { email, password } = req.body || {};
  if (!email || !password) return reply.code(400).send({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' });

  const { data: agent, error } = await supabase
    .from('support_agents').select('*').eq('email', String(email).toLowerCase().trim()).maybeSingle();
  if (error || !agent) return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });

  if (!verifySupportAgentPassword(String(password), agent.password_hash))
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });

  const token = signSupportAgentToken(agent);
  return { ok: true, token, agent: { id: agent.id, email: agent.email, name: agent.name } };
});

// ─── Admin: support agents CRUD ───────────────────────────────────────────
app.get('/v1/admin/support-agents', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { data, error } = await supabase.from('support_agents')
    .select('id,email,name,created_at').order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });
  return { ok: true, agents: data };
});

app.post('/v1/admin/support-agents', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8)
    return reply.code(400).send({ ok: false, error: 'INVALID_FIELDS' });

  const password_hash = createSupportAgentPasswordHash(String(password));
  const { data, error } = await supabase.from('support_agents')
    .insert({ name: String(name).trim(), email: String(email).toLowerCase().trim(), password_hash })
    .select('id,email,name,created_at').single();
  if (error) return reply.code(500).send({ ok: false, error: 'CREATE_FAILED' });
  return { ok: true, agent: data };
});

app.delete('/v1/admin/support-agents/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  if (!isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });

  const { error } = await supabase.from('support_agents').delete().eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'DELETE_FAILED' });
  return { ok: true };
});

// ─── Support Agent: ticket management ─────────────────────────────────────
app.get('/v1/support-agent/tickets', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data, error } = await supabase
    .from('support_tickets').select('*').order('created_at', { ascending: true });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });

  // Enrich with user emails
  const userIds = [...new Set((data || []).map(t => t.user_id))];
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: usersData } = await supabase.from('users').select('id, email, full_name').in('id', userIds);
    usersMap = Object.fromEntries((usersData || []).map(u => [u.id, u]));
  }

  // Sort by priority: open (oldest first) > in_progress > closed
  const priority = { open: 0, in_progress: 1, closed: 2 };
  const tickets = (data || [])
    .map(t => ({ ...t, user: usersMap[t.user_id] || null }))
    .sort((a, b) => {
      const pd = (priority[a.status] ?? 3) - (priority[b.status] ?? 3);
      if (pd !== 0) return pd;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  return { ok: true, tickets };
});

app.get('/v1/support-agent/tickets/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data: ticket } = await supabase.from('support_tickets').select('*').eq('id', req.params.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  const { data: userData } = await supabase.from('users').select('id, email, full_name').eq('id', ticket.user_id).single();
  const { data: messages } = await supabase.from('support_messages').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
  return { ok: true, ticket: { ...ticket, user: userData || null }, messages: messages || [] };
});

app.post('/v1/support-agent/tickets/:id/messages', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { content } = req.body || {};
  if (!content?.trim()) return reply.code(400).send({ ok: false, error: 'MISSING_CONTENT' });

  const { data: ticket } = await supabase.from('support_tickets').select('id,status,user_id,subject').eq('id', req.params.id).single();
  if (!ticket) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

  await supabase.from('support_messages').insert({ ticket_id: ticket.id, sender_type: 'admin', sender_name: agent.name || 'Support', content: content.trim() });
  await supabase.from('support_tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticket.id);
  await notifyUser(ticket.user_id, {
    title: 'New reply on your support ticket',
    message: ticket.subject || null,
    type: 'info',
    category: 'ticket',
    actionUrl: `/support/${ticket.id}`,
  });
  return { ok: true };
});

app.patch('/v1/support-agent/tickets/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { status } = req.body || {};
  if (!status) return reply.code(400).send({ ok: false, error: 'MISSING_STATUS' });

  const { error } = await supabase.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  return { ok: true };
});

// ─── Support Agent: user management (no delete) ────────────────────────────
app.get('/v1/support-agent/users', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { q, plan } = req.query || {};
  let query = supabase.from('users').select('id, email, full_name, plan, created_at, trial_ends_at').order('created_at', { ascending: false }).limit(100);
  if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });

  const rows = data || [];
  const userIds = rows.map(u => u.id).filter(Boolean);

  // Fetch subscriptions
  let subsMap = {};
  if (userIds.length > 0) {
    const { data: subs } = await supabase.from('subscriptions').select('user_id, plan, status').in('user_id', userIds).not('status', 'in', '("EXPIRED","CANCELED")');
    for (const s of (subs || [])) { if (!subsMap[s.user_id]) subsMap[s.user_id] = s; }
  }

  // Fetch team_members: members inherit owner's subscription for plan resolution
  let memberOwnerMap = {};
  if (userIds.length > 0) {
    const { data: memberLinks } = await supabase.from('team_members').select('owner_user_id, member_user_id').in('member_user_id', userIds).eq('status', 'ACTIVE');
    for (const lnk of (memberLinks || [])) { memberOwnerMap[lnk.member_user_id] = lnk.owner_user_id; }
    const ownerIds = [...new Set(Object.values(memberOwnerMap))].filter(id => !subsMap[id]);
    if (ownerIds.length > 0) {
      const { data: ownerSubs } = await supabase.from('subscriptions').select('user_id, plan, status').in('user_id', ownerIds).not('status', 'in', '("EXPIRED","CANCELED")');
      for (const s of (ownerSubs || [])) { if (!subsMap[s.user_id]) subsMap[s.user_id] = s; }
    }
  }

  const users = rows.map(u => {
    const ownerId = memberOwnerMap[u.id] || null;
    const sub = subsMap[u.id] || (ownerId ? subsMap[ownerId] : null) || null;
    const resolved = resolvePlanAndStatus(u, sub);
    // Apply plan filter after resolution
    if (plan && resolved.plan !== normalizePlan(plan, plan)) return null;
    return { id: u.id, email: u.email, full_name: u.full_name || null, plan: resolved.plan, status: resolved.status, created_at: u.created_at, trial_ends_at: u.trial_ends_at };
  }).filter(Boolean);

  return { ok: true, users };
});

app.patch('/v1/support-agent/users/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const body = req.body || {};
  const updates = {};
  if (body.plan !== undefined) updates.plan = String(body.plan).toUpperCase();
  if (body.email !== undefined) {
    const newEmail = String(body.email).toLowerCase().trim();
    // Update Supabase Auth email too
    const { data: userRow } = await supabase.from('users').select('auth_user_id').eq('id', req.params.id).single();
    if (userRow?.auth_user_id) {
      await supabase.auth.admin.updateUserById(userRow.auth_user_id, { email: newEmail });
    }
    updates.email = newEmail;
  }

  if (Object.keys(updates).length === 0 && body.status === undefined) return reply.code(400).send({ ok: false, error: 'NO_FIELDS' });
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error } = await supabase.from('users').update(updates).eq('id', req.params.id);
    if (error) return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  }
  if (body.status !== undefined) {
    await supabase.from('subscriptions').update({ status: String(body.status).toUpperCase() }).eq('user_id', req.params.id);
  }
  return { ok: true };
});

app.post('/v1/support-agent/users/:id/reset-password', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { new_password } = req.body || {};
  if (!new_password || String(new_password).length < 8) return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT' });

  const { data: userRow } = await supabase.from('users').select('auth_user_id').eq('id', req.params.id).single();
  if (!userRow?.auth_user_id) return reply.code(404).send({ ok: false, error: 'AUTH_USER_NOT_FOUND' });

  const { error } = await supabase.auth.admin.updateUserById(userRow.auth_user_id, { password: String(new_password) });
  if (error) return reply.code(500).send({ ok: false, error: 'RESET_FAILED' });
  return { ok: true };
});

app.get('/v1/support-agent/moderators', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const agent = getSupportAgentByToken(getTokenFromHeaders(req.headers));
  if (!agent) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const { data, error } = await supabase.from('moderators')
    .select('id, email, name, created_at').order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });
  return { ok: true, moderators: data || [] };
});

// ─── Waitlist ───────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'onboarding@resend.dev';

async function sendWaitlistConfirmation(email, name, plan) {
  const planLabel = { STARTER: 'Starter ($29/mo)', PRO: 'Pro ($59/mo)', AGENCY: 'Agency ($149/mo)' }[plan] ?? plan;
  const greeting  = name ? `Hi ${name},` : 'Hi,';
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1e293b">
      <h1 style="font-size:22px;font-weight:800;margin:0 0 8px">You're on the waitlist.</h1>
      <p style="margin:0 0 16px;color:#475569">${greeting}</p>
      <p style="margin:0 0 16px;color:#475569">
        You've joined the waitlist for <strong>seoprospector ${planLabel}</strong>.
        We're rolling out paid plans progressively — you'll get early access with a locked-in price.
      </p>
      <p style="margin:0 0 24px;color:#475569">
        In the meantime, our <strong>Free plan</strong> is available now — no credit card required.
        Start capturing LinkedIn leads and scoring SEO opportunities today.
      </p>
      <a href="https://app.example.com/register" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">
        Start free trial →
      </a>
      <p style="margin:32px 0 0;font-size:12px;color:#94a3b8">
        seoprospector · Questions? Reply to this email or contact <a href="mailto:support@example.com" style="color:#2563eb">support@example.com</a>
      </p>
    </div>`;

  if (!RESEND_API_KEY) {
    console.log(`[WAITLIST EMAIL] No RESEND_API_KEY — would send to ${email} for plan ${plan}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `seoprospector <${FROM_EMAIL}>`, to: [email], subject: `You're on the waitlist — seoprospector ${planLabel}`, html }),
    });
    if (!res.ok) console.error('[WAITLIST EMAIL] Resend error:', await res.text());
  } catch (err) {
    console.error('[WAITLIST EMAIL] Failed:', err.message);
  }
}

// ─── Generic email sender ────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, tag = 'transactional' }) {
  if (!RESEND_API_KEY) { console.log(`[EMAIL] No RESEND_API_KEY — skipping "${subject}" to ${to}`); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `seoprospector <${FROM_EMAIL}>`, to: [to], subject, html, tags: [{ name: 'category', value: tag }] }),
    });
    if (!res.ok) { console.error(`[EMAIL] Resend error for "${subject}":`, await res.text()); return false; }
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send "${subject}":`, err.message);
    return false;
  }
}

const EMAIL_SITE_URL = process.env.EMAIL_SITE_URL || 'https://api.example.com';
const EMAIL_LOGO = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
  <tr>
    <td>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle">
            <img src="${EMAIL_SITE_URL}/icon-email.png" width="42" height="42" alt="seoprospector" style="display:block"/>
          </td>
          <td style="padding-left:10px;vertical-align:middle">
            <span style="font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;font-family:'Manrope',sans-serif">seoprospector</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

function emailBtn(label, href, color = '#1B68D0') {
  return `<table cellpadding="0" cellspacing="0" style="margin-top:24px">
    <tr>
      <td style="background:${color};border-radius:8px">
        <a href="${href}" style="display:inline-block;padding:13px 28px;color:#fff;text-decoration:none;font-weight:700;font-size:14px;font-family:sans-serif">${label}</a>
      </td>
    </tr>
  </table>`;
}

function emailWrapper(content) {
  return `<!DOCTYPE html><html><head><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Manrope',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;font-family:'Manrope',sans-serif">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);font-family:'Manrope',sans-serif">
        <tr><td style="padding:36px 40px 0">
          ${EMAIL_LOGO}
          ${content}
        </td></tr>
        <tr><td style="padding:28px 40px 32px;border-top:1px solid #e2e8f0;margin-top:32px">
          <p style="margin:0;font-size:12px;color:#94a3b8;font-family:sans-serif">
            &copy; 2025 seoprospector &nbsp;·&nbsp;
            <a href="https://app.example.com" style="color:#94a3b8;text-decoration:none">app.example.com</a>
            &nbsp;·&nbsp;
            <a href="mailto:support@example.com" style="color:#94a3b8;text-decoration:none">support@example.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendEmailConfirmation(email, fullName, confirmLink) {
  const first = (fullName || '').split(' ')[0] || 'there';
  const html = emailWrapper(`
    <h1 style="font-size:22px;font-weight:800;margin:0 0 6px;color:#0f172a;font-family:sans-serif">Confirm your email</h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;font-family:sans-serif">One last step before you start</p>
    <p style="margin:0 0 14px;color:#475569;font-size:15px;font-family:sans-serif">Hi ${first}, thanks for signing up for seoprospector.</p>
    <p style="margin:0 0 28px;color:#475569;font-size:15px;font-family:sans-serif">Click the button below to verify your email address and activate your account. The link expires in <strong>24 hours</strong>.</p>
    ${emailBtn('Confirm email address', confirmLink)}
    <p style="margin:20px 0 28px;font-size:12px;color:#94a3b8;font-family:sans-serif;word-break:break-all">Or copy this link: <a href="${confirmLink}" style="color:#1B68D0">${confirmLink}</a></p>
    <p style="margin:0 0 28px;font-size:12px;color:#94a3b8;font-family:sans-serif">If you didn't create an account, you can safely ignore this email.</p>`);
  return sendEmail({ to: email, subject: 'Confirm your seoprospector account', html, tag: 'auth' });
}

async function sendWelcomeEmail(email, fullName) {
  const first = (fullName || '').split(' ')[0] || 'there';
  const html = emailWrapper(`
    <h1 style="font-size:22px;font-weight:800;margin:0 0 6px;color:#0f172a;font-family:sans-serif">Welcome, ${first}</h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;font-family:sans-serif">Your free trial is active — no credit card needed</p>
    <p style="margin:0 0 14px;color:#475569;font-size:15px;font-family:sans-serif">You're all set. Install the Chrome extension, browse LinkedIn profiles, and seoprospector will automatically score every lead for SEO opportunity.</p>
    <p style="margin:0 0 12px;color:#475569;font-size:15px;font-family:sans-serif">Here's what to do first:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px">
      <tr><td style="padding:6px 0;color:#475569;font-size:14px;font-family:sans-serif">&#10102;&nbsp; Install the <strong>seoprospector Chrome extension</strong></td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-size:14px;font-family:sans-serif">&#10103;&nbsp; Browse any LinkedIn profile or search results</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-size:14px;font-family:sans-serif">&#10104;&nbsp; See HOT / WARM / COLD leads scored automatically</td></tr>
    </table>
    ${emailBtn('Open dashboard', `${APP_BASE_URL}/dashboard`)}
    <p style="margin:28px 0 0">&nbsp;</p>`);
  return sendEmail({ to: email, subject: 'Welcome to seoprospector — you\'re all set', html, tag: 'welcome' });
}

async function sendPasswordResetEmail(email, resetLink) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;font-weight:800;margin:0 0 6px;color:#0f172a;font-family:sans-serif">Reset your password</h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;font-family:sans-serif">This link expires in 1 hour</p>
    <p style="margin:0 0 14px;color:#475569;font-size:15px;font-family:sans-serif">We received a request to reset your password for <strong>${email}</strong>.</p>
    <p style="margin:0 0 4px;color:#475569;font-size:15px;font-family:sans-serif">Click the button below to set a new password. If you didn't request this, you can safely ignore this email.</p>
    ${emailBtn('Reset password', resetLink)}
    <p style="margin:20px 0 28px;font-size:12px;color:#94a3b8;font-family:sans-serif;word-break:break-all">Or copy this link: <a href="${resetLink}" style="color:#1B68D0">${resetLink}</a></p>`);
  return sendEmail({ to: email, subject: 'Reset your seoprospector password', html, tag: 'auth' });
}

async function sendNotificationEmail(email, { title, message, actionUrl }) {
  const btn = actionUrl ? emailBtn('View details', actionUrl) : '';
  const html = emailWrapper(`
    <h1 style="font-size:20px;font-weight:800;margin:0 0 16px;color:#0f172a;font-family:sans-serif">${title}</h1>
    <p style="margin:0 0 8px;color:#475569;font-size:15px;font-family:sans-serif">${message || ''}</p>
    ${btn}
    <p style="margin:28px 0 0">&nbsp;</p>`);
  return sendEmail({ to: email, subject: title, html, tag: 'notification' });
}

const VALID_WAITLIST_PLANS = ['STARTER', 'PRO', 'AGENCY'];

app.post('/v1/waitlist', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const { email, name, plan = 'PRO' } = req.body || {};
  if (!email || !String(email).includes('@')) return reply.code(400).send({ ok: false, error: 'INVALID_EMAIL' });
  const planNorm = String(plan).toUpperCase();
  if (!VALID_WAITLIST_PLANS.includes(planNorm)) return reply.code(400).send({ ok: false, error: 'INVALID_PLAN' });

  const { error } = await supabase.from('waitlist').insert({
    email: String(email).trim().toLowerCase(),
    name:  name ? String(name).trim() : null,
    plan:  planNorm,
  });

  if (error) {
    if (error.code === '23505') return reply.code(409).send({ ok: false, error: 'ALREADY_ON_WAITLIST' });
    console.error('[WAITLIST] Insert error:', error);
    return reply.code(500).send({ ok: false, error: 'INSERT_FAILED' });
  }

  void sendWaitlistConfirmation(String(email).trim().toLowerCase(), name, planNorm);
  return { ok: true };
});

app.get('/v1/admin/waitlist', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor || !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });
  const { data, error } = await supabase.from('waitlist').select('*').order('created_at', { ascending: false });
  if (error) return reply.code(500).send({ ok: false, error: 'FETCH_FAILED' });
  const byPlan = { STARTER: 0, PRO: 0, AGENCY: 0 };
  for (const row of data || []) byPlan[row.plan] = (byPlan[row.plan] || 0) + 1;
  return { ok: true, entries: data || [], total: data?.length ?? 0, byPlan };
});

app.delete('/v1/admin/waitlist/:id', async (req, reply) => {
  if (!requireSupabase(reply)) return;
  const actor = await getUserByToken(getTokenFromHeaders(req.headers));
  if (!actor || !isAdminUser(actor)) return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });
  const { error } = await supabase.from('waitlist').delete().eq('id', req.params.id);
  if (error) return reply.code(500).send({ ok: false, error: 'DELETE_FAILED' });
  return { ok: true };
});

// ─── Public: beta guide auth ───────────────────────────────────────────────
app.post('/v1/guide-auth', async (req, reply) => {
  const guidePassword = process.env.GUIDE_PASSWORD || '';
  if (!guidePassword) return reply.code(503).send({ ok: false, error: 'NOT_CONFIGURED' });
  const { password } = req.body || {};
  if (!password || password !== guidePassword) {
    return reply.code(401).send({ ok: false, error: 'INVALID_PASSWORD' });
  }
  return { ok: true };
});

// Serve logo PNGs for emails
const iconPngBuf      = (() => { try { return readFileSync(resolve(__dirname, 'icon128.png')); } catch { return null; } })();
const iconEmailPngBuf = (() => { try { return readFileSync(resolve(__dirname, 'icon-email.png')); } catch { return null; } })();
app.get('/icon128.png', async (_req, reply) => {
  if (!iconPngBuf) return reply.code(404).send('Not found');
  reply.header('Content-Type', 'image/png').header('Cache-Control', 'public,max-age=86400').send(iconPngBuf);
});
app.get('/icon-email.png', async (_req, reply) => {
  if (!iconEmailPngBuf) return reply.code(404).send('Not found');
  reply.header('Content-Type', 'image/png').header('Cache-Control', 'public,max-age=86400').send(iconEmailPngBuf);
});

app.listen({ port: PORT, host: '0.0.0.0' });
