# LinkedIn SEO Prospector — Chrome extension + SaaS API (work in progress)

A **Manifest V3 Chrome extension** that helps SEO agencies prospect on LinkedIn: capture profiles and companies while browsing, run a quick SEO scan on the prospect's website, score the lead, and generate AI-assisted outreach messages — backed by a **multi-tenant SaaS API** that handles auth, quotas, billing and support.

> **Status: no longer live.** The capture → scan → score → message loop is built, along with billing, team management and support tooling. The extension was **published on the Chrome Web Store, then taken down by Google**: its backend ran on a free hosting tier (Render) that I never moved to a paid plan, so the extension was left without a reliable server. Shared as a portfolio piece, not as a ready-to-install product. Production URLs, keys and branding were replaced with `example.com` placeholders.

## How it fits together

```
Chrome extension ──► api-saas (auth, quotas, billing, leads) ──► n8n (self-hosted) ──► Groq · PageSpeed · prospect's site
```

**n8n is a core part of the product**, not an add-on. The lead scanning and scoring pipeline, the business decision engine (hot / warm / ignore), the LinkedIn Boolean-search assistant, the AI outreach prompts and the SEO CSV export all run as n8n workflows on my self-hosted instance, called by the API through webhooks. If n8n is unreachable the API falls back to a simpler local generator. See [`n8n/`](n8n/README.md) for the workflows and a walkthrough.

## The product idea: how n8n turns this into a SaaS

I designed this as a SaaS where **n8n is the engine, and a very large part of the product's value**. The way I saw it, there are three layers, each with one job:

1. **The extension is the front door.** It sits where SEO freelancers and agencies already work (LinkedIn) and captures a prospect in one click. It holds no business logic, so it rarely needs a Chrome Web Store update.
2. **n8n is the engine, and the product's actual value.** The scoring rules, the hot/warm/ignore decision logic, the Core Web Vitals adjustment, the prompts that write the outreach message and the Boolean-search assistant all live in n8n workflows. I could change how a lead is scored, or how a message is written, in minutes, test it on real executions, and ship it to every user at once, with no extension release and no API redeploy. Improving the product mostly meant editing a workflow.
3. **The API is the SaaS shell around it.** `api-saas` turns the engine into something sellable: accounts, plans and monthly quotas (each scan consumes credits), team seats, billing, support tickets and an admin console. n8n never talks to users directly. It only answers authenticated, metered requests from the API.

The commercial model that follows is simple: a prospect is only worth contacting if the person is a decision-maker *and* their website has real SEO problems. The product finds those, explains the problem with concrete audit findings, and writes the first message citing them. That is what an agency would otherwise do by hand for each lead. Quotas map to scans, seats map to team size, and the whole thing is paid through Lemon Squeezy (cards) or NOWPayments (crypto).

It did go live briefly, but I never put it on paid infrastructure, so it never got further. The architecture was built so that the part customers pay for (the qualification and messaging intelligence) could improve independently of everything around it.

## Semi-automatic by design — not a LinkedIn bot

This is deliberately **not** a Waalaxy-style automation tool. It does not auto-scroll search results, auto-paginate, mass-send connection requests or run message sequences in the background — the behaviours that get LinkedIn accounts restricted or banned. The human stays in the loop at every step that touches LinkedIn:

| Step | Who does it |
|---|---|
| Choosing who to look at (search, browsing, opening profiles) | **The user**, manually, at human speed |
| Capturing the lead and reading the page being displayed | Extension, passively, on pages the user has opened |
| Scanning the prospect's *website*, scoring, qualifying, drafting a message | Automatic, but off LinkedIn (n8n and the API call the prospect's own site, PageSpeed and Groq — not LinkedIn) |
| Deciding whether and what to send | **The user**: the draft is shown, editable, and nothing is sent without an explicit click on one lead |
| Sending | One message per click, on one lead. No bulk send, no queue, no schedule, no sequences |

In short: the automation is in the *analysis* (which is where the value is), and the *actions on LinkedIn* stay manual and one at a time. No tool can promise zero risk on a platform that restricts automation, but the design keeps the extension's footprint on LinkedIn close to that of a user browsing normally.

## What's in here

### `extension/` — browser side
- Content scripts for LinkedIn profile pages, search lists and company pages
- Side panel UI (`panel.html/css/js`) for lead lists, scan results, scoring and message drafts
- `background.js` service worker: scan pipeline, session handling, quota checks, lead sync with the API, assistant queries, message logging
- A small content script that syncs the web-app session into the extension

### `n8n/` — scoring, qualification and AI prompting
Four exported workflows (scan + SEO score + Core Web Vitals + decision engine, message generation, search assistant, SEO export) and their documentation. Credentials removed.

### `api-saas/` — server side (Fastify + Supabase)
- Auth (register / login / password reset / session) with per-IP rate limits on sensitive routes
- **Entitlements and usage metering**: plans, monthly quotas, per-scan consumption
- **Team seats**: invites with signed tokens, seat billing, per-member dashboards
- **Billing**: Lemon Squeezy checkout + signed webhooks, NOWPayments (crypto) invoices + IPN signature verification
- **AI**: Groq-backed outreach message generation and a support chat assistant
- Lead storage, dashboard stats, exports
- Admin, moderator and support-agent roles; support-ticket system; blog CMS endpoints
- SQL migrations in `api-saas/sql/`

## Stack

Chrome Extension MV3 (vanilla JS, service worker, side panel) · **n8n (self-hosted)** · Node.js · Fastify · Supabase (Postgres) · Groq (LLM) · Lemon Squeezy · NOWPayments · Resend.

## Engineering notes

- All secrets are read from environment variables; payment webhooks are verified with HMAC (SHA-256 for Lemon Squeezy, SHA-512 for NOWPayments) before any state change.
- Known gaps: no automated tests, and `server.js` is one large file that should be split into route modules.

## Configuration

The API expects the environment variables referenced at the top of `api-saas/src/server.js` (Supabase URL and service key, the four `N8N_WEBHOOK_*` URLs, Groq, Lemon Squeezy, NOWPayments, Resend, `EXT_API_KEY`). No values are included in this repo.
