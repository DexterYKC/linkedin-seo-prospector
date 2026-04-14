# n8n workflows — the brain of the product

The scoring, lead qualification and AI prompting logic of LinkedIn SEO Prospector lives in **n8n**, not in the extension or the API. I run a self-hosted n8n instance (hosted on Render); the API (`api-saas/`) calls it through four webhooks. Keeping this logic in n8n let me iterate on scoring rules and prompts in minutes, without redeploying the extension or the API, and see every execution step by step while debugging.

```
Chrome extension ──► api-saas (auth, quotas, billing) ──► n8n webhooks ──► Groq / PageSpeed / the prospect's website
                              ▲                                   │
                              └──────────── JSON result ──────────┘
```

If n8n is down or times out, `api-saas` falls back to a simpler local generator (`buildFallbackLeadMessage`, etc.), so the extension still returns something usable.

**In SaaS terms:** n8n is where the product's value is created (who is worth contacting, why, and what to say). The extension captures and displays, the API authenticates, meters and bills. See the main README for the full picture.

## The four workflows (`workflows/`)

| File | Webhook path | Role |
|---|---|---|
| `scan_ingest_score_v6.0.json` | `/seo-prospector/scan` | **Scan, score and qualify a lead** (18 nodes) |
| `lead_message_generate_v3.0_groq.json` | `/seo-prospector/message-generate` | **Write a personalised outreach message** with Groq (Llama 3.3) |
| `assistant_scan_generate_v2_groq.json` | `/seo-prospector/assistant-query` | **Turn a plain-language target description into LinkedIn Boolean searches** |
| `seo_export_single_v3.json` | `/seo-prospector/seo-export-single` | **Export one SEO audit as a CSV report** |

### 1. Scan, ingest and score (`scan_ingest_score`)
For a captured LinkedIn lead with a website:
1. Validates the payload and normalises the URL.
2. Fetches `robots.txt`, `sitemap.xml` and the homepage HTML.
3. Extracts SEO signals and computes an **SEO opportunity score out of 100** across four categories: **Indexability** (30 pts: noindex, robots rules, canonical, sitemap), **On-page** (35 pts), **Technical** (25 pts) and **Social & media** (10 pts). Every finding is returned as a passed / warning / critical / skipped item, with a "skip" state when a check can't be run, instead of a fake pass.
4. Since v6.0, calls the **Google PageSpeed API** and adjusts the score from **Core Web Vitals** (mobile performance, LCP, CLS, accessibility).
5. Detects business signals from the LinkedIn side (is the person a **decision-maker**? headline, role).
6. A **business decision engine** combines both into a verdict: `CONTACT_NOW` (hot lead: decision-maker + critical SEO), `CONTACT_SOFT` (warm: weak SEO, or no/unreachable website), `FIND_DECISION_MAKER`, or `IGNORE`, each with a confidence level and a human-readable reason.
7. A **UI mapper** shapes the result for the extension side panel.

A missing website is treated as a signal, not an error: "decision-maker with no valid website" is a warm lead with high confidence.

### 2. Message generation (`lead_message_generate`)
Builds a prompt from the lead, the chosen SEO opportunity and its audit findings (language FR/EN, tone: professional / friendly / direct / consultative, optional free-text context from the user), calls Groq, parses the response, and returns a single ready-to-send message that references real findings from the audit.

### 3. Search assistant (`assistant_scan_generate`)
The user describes their target ("marketing directors of SMEs in Lyon"); the workflow returns two valid **LinkedIn Boolean queries** (people + companies), handling French/English title equivalents and the query length limit. The user never describes the SEO service they sell — the "needs SEO" intent is implicit.

### 4. SEO export (`seo_export_single`)
Generates a vertical, Screaming-Frog-style CSV (section / value / severity), semicolon-delimited so it opens correctly in both French and English Excel.

## Wiring

On the API side, set the four webhook URLs:

```
N8N_WEBHOOK_SCAN_URL
N8N_WEBHOOK_ASSISTANT_URL
N8N_WEBHOOK_MESSAGE_URL
N8N_WEBHOOK_SEO_EXPORT_URL
```

To use the workflows: import the JSON files in n8n, then in the two Groq workflows replace `YOUR_GROQ_API_KEY` (an HTTP header value in the Groq node — better stored as an n8n credential).

## Notes

- The exported JSON is sanitized: the API key that was inline in the original Groq nodes was removed.
- Logic is mostly in Code nodes (JavaScript) rather than a long chain of visual nodes, because the scoring rules are easier to read, diff and test as code.
- Earlier iterations (v1 to v5.x) are not included; only the latest version of each workflow is kept here.
