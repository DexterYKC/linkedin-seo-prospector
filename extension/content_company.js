  // ==================================================
  // SEO LinkedIn Prospector
  // content_company.js — COMPANY SCRAPER (NO-CLICK, /about/ friendly) [FIXED]
  // ==================================================
  (() => {
    "use strict";

    const LOG = "[SEO-COMPANY]";
    const log = (...a) => console.log(LOG, ...a);
    const warn = (...a) => console.warn(LOG, ...a);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let finished = false;

    const BAD_HOSTS = [
      "linkedin.com",
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "youtube.com",
      "tiktok.com",
      "bing.com",
      "google.com",
      "maps.google",
      "linktr.ee"
    ];

    function hostMatchesBlocked(host, token) {
      const h = String(host || "").toLowerCase();
      const t = String(token || "").toLowerCase();
      if (!h || !t) return false;
      if (t.endsWith(".")) {
        const base = t.slice(0, -1);
        if (!base) return false;
        return h === base || h.includes(`${base}.`);
      }
      return h === t || h.endsWith(`.${t}`);
    }

    function unwrapLinkedInRedirect(rawUrl) {
      try {
        const u = new URL(rawUrl, location.origin);
        if (!u.hostname.toLowerCase().endsWith("linkedin.com")) {
          return u.toString();
        }

        const encodedTarget =
          u.searchParams.get("url") ||
          u.searchParams.get("redirect") ||
          u.searchParams.get("dest");

        if (!encodedTarget) return u.toString();

        try {
          return decodeURIComponent(encodedTarget);
        } catch {
          return encodedTarget;
        }
      } catch {
        return rawUrl;
      }
    }

    function normalize(url) {
      try {
        const unwrapped = unwrapLinkedInRedirect(url);
        const u = new URL(unwrapped, location.origin);
        if (!["http:", "https:"].includes(u.protocol)) return null;

        const host = u.hostname.toLowerCase();
        if (BAD_HOSTS.some((b) => hostMatchesBlocked(host, b))) return null;

        u.hash = "";
        ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((p) =>
          u.searchParams.delete(p)
        );

        return u.toString();
      } catch {
        return null;
      }
    }

    function extractCompanyName() {
      const h1 = document.querySelector("h1");
      return h1?.innerText?.trim() || null;
    }

    function extractWebsiteFromLDJSON() {
      try {
        const scripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]')
        );

        for (const s of scripts) {
          const raw = s.textContent || "";
          if (!raw.trim()) continue;
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }

          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of arr) {
            if (!obj || typeof obj !== "object") continue;

            const direct = normalize(obj.url);
            if (direct) return direct;

            const sameAs = Array.isArray(obj.sameAs) ? obj.sameAs : [];
            for (const v of sameAs) {
              const u = normalize(v);
              if (u) return u;
            }
          }
        }
      } catch {}
      return null;
    }

    function findWebsiteFromLabeledRows() {
      const rows = Array.from(document.querySelectorAll("section, li, div")).slice(0, 300);
      for (const row of rows) {
        const txt = (row.innerText || "").toLowerCase();
        if (!txt) continue;
        if (!txt.includes("site web") && !txt.includes("website")) continue;
        const links = Array.from(row.querySelectorAll("a"));
        for (const a of links) {
          const href = a.href || a.getAttribute("href");
          const clean = normalize(href);
          if (clean) return clean;
        }

        const urlInText = (row.innerText || "").match(/https?:\/\/[^\s)]+/i);
        if (urlInText?.[0]) {
          const cleanTextUrl = normalize(urlInText[0]);
          if (cleanTextUrl) return cleanTextUrl;
        }
      }
      return null;
    }

    // Stronger heuristic:
    // LinkedIn About pages often show website in:
    // - a[href^="http"] near "Site web" / "Website"
    // - sometimes a button or a link with data-test attributes
  function findWebsite() {
    const fromLabel = findWebsiteFromLabeledRows();
    if (fromLabel) return fromLabel;

    return null;
  }


    function extractFromApollo() {
      try {
        const ap = window.__APOLLO_STATE__;
        if (!ap || typeof ap !== "object") return null;

        let website = null;
        let logoUrl = null;

        const pickArtifact = (rootUrl, artifacts) => {
          if (!rootUrl || !Array.isArray(artifacts) || !artifacts.length) return null;
          const valid = artifacts
            .filter((a) => a && a.fileIdentifyingUrlPathSegment)
            .sort((a, b) => (b.width || 0) - (a.width || 0));
          const pick = valid.find((a) => (a.width || 0) <= 400) || valid[0];
          return pick ? rootUrl + pick.fileIdentifyingUrlPathSegment : null;
        };

        for (const [k, v] of Object.entries(ap)) {
          if (!v || typeof v !== "object") continue;
          // Only look at Company-like entries
          if (!k.startsWith("Company:") && !k.includes("company") && !k.includes("Company")) continue;

          if (!website) {
            const raw = v.websiteUrl || v.website || v.companyPageUrl || null;
            if (raw && typeof raw === "string") website = normalize(raw);
          }

          if (!logoUrl) {
            const logo = v.logo || v.logoResolutionResult || v.squareLogo || null;
            if (logo && typeof logo === "object") {
              logoUrl =
                pickArtifact(logo.rootUrl, logo.artifacts) ||
                pickArtifact(
                  logo.displayImageReference?.vectorImage?.rootUrl,
                  logo.displayImageReference?.vectorImage?.artifacts
                ) ||
                null;
            }
          }

          if (website && logoUrl) break;
        }

        return website || logoUrl ? { website, logoUrl } : null;
      } catch {
        return null;
      }
    }

    function extractLogoFromMeta() {
      try {
        const og = document.querySelector('meta[property="og:image"]');
        if (og?.content?.includes("media.licdn.com")) return og.content;
        const li = document.querySelector('link[rel~="icon"][href*="media.licdn.com"]');
        if (li?.href) return li.href;
      } catch {}
      return null;
    }

    function send(payload) {
      if (finished) return;
      finished = true;
      log("COMPANY RESULT:", payload);

      try {
        chrome.runtime.sendMessage({ type: "COMPANY_DATA", payload });
      } catch (e) {
        // ignore
      }
    }

    async function run() {
      // give LinkedIn time to render React
      await sleep(1200);

      const companyName = extractCompanyName();

      // Fast path: try Apollo state first (instant if React already loaded)
      const apolloData = extractFromApollo();
      if (apolloData?.website) {
        send({
          website: apolloData.website,
          logoUrl: apolloData.logoUrl || extractLogoFromMeta() || null,
          companyName,
          scrapeStatus: "OK",
          companyUrl: location.href,
        });
        return;
      }

      // Collect logo early even if no website yet
      let logoUrl = apolloData?.logoUrl || extractLogoFromMeta() || null;

      // retry loop - LinkedIn loads parts late
      for (let i = 0; i < 14; i++) {
        if (i === 3) {
          window.scrollTo(0, Math.max(400, Math.floor(document.body.scrollHeight * 0.25)));
        }
        if (i === 7) {
          window.scrollTo(0, 0);
        }

        // Re-check Apollo on each tick (state fills progressively)
        const ap = extractFromApollo();
        if (!logoUrl) logoUrl = ap?.logoUrl || extractLogoFromMeta() || null;

        const website = ap?.website || findWebsite();
        if (website) {
          send({
            website,
            logoUrl,
            companyName,
            scrapeStatus: "OK",
            companyUrl: location.href,
          });
          return;
        }
        await sleep(600);
      }

      send({
        website: null,
        logoUrl,
        companyName,
        scrapeStatus: "NO_WEBSITE_FOUND",
        companyUrl: location.href,
      });
    }

    // hard timeout safety
    setTimeout(() => {
      if (!finished) {
        warn("Hard timeout");
        send({
          website: null,
          logoUrl: extractLogoFromMeta() || null,
          companyName: extractCompanyName(),
          scrapeStatus: "TIMEOUT",
          companyUrl: location.href,
        });
      }
    }, 16000);

    run().catch((e) => {
      warn("ERROR", e);
      send({
        website: null,
        companyName: extractCompanyName(),
        scrapeStatus: "ERROR",
        error: String(e),
        companyUrl: location.href,
      });
    });
  })();
