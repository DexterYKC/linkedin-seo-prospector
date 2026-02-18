  // ==================================================
  // SEO LinkedIn Prospector â€” panel.js (V1.2 FULL) â€” PATCHED (UI-FIRST)
  // REALTIME SIDE PANEL (MV3)
  // Source of truth = background.js snapshot + events
  // ==================================================

  "use strict";

  /* ================= CONSTANTS ================= */
  const PANEL_PORT_NAME = "seo_panel";
  const SCAN_ASSIST_STORAGE_KEY = "scanAssistantV1";
  const MESSAGE_DRAFTS_STORAGE_KEY = "messageDraftsV1";
  const PANEL_THEME_STORAGE_KEY = "panelTheme";
  const PANEL_LANG_STORAGE_KEY = "panelLang";
  const FALLBACK_PRICING_URL = "https://your-store.lemonsqueezy.com";
  const SAAS_APP_URL = "https://app.example.com"; // TODO: replace with production URL

  /* ================= STATE ================= */
  let port = null;
  let snapshot = null;
  let closeTeamOverlay = () => {};
  let selectedLead = null;
  let selectedSeoLead = null;
  let selectedLeadProfileUrl = null;
  let selectedMsgLeadProfileUrl = null;
  let selectedSeoProfileUrl = null;
  let selectedSeoOpportunityId = null;
  let selectedMsgOpportunityId = null;
  let overrideEditorProfileUrl = null;
  let assistantNotchSyncRaf = 0;
  let leadsListFilter = "ALL";
  let leadsSearchQuery = "";
  let seoListFilter = "ALL";
  let _seoListRenderKey = null; // fingerprint to skip re-renders when data hasn't changed
  const opportunityOrderByLeadId = new Map();
  let scanAssistSaveTimer = null;
  const confirmArmedUntil = new Map();
  let messageDraftCache = {};
  const lastGeneratedTextByKey = new Map();
  let activeMsgContextKey = null;
  let activeMsgTone = "professional";
  let currentLang = "en";
  let pipelineStatusRaw = "RUNNING";
  let chatMessages = [];
  let chatMyUserId = null;
  let chatPollInterval = null;
  let chatUnreadInterval = null;
  let notifUnreadInterval = null;

  /* ================= SAFE DOM ================= */
  const $ = (id) => document.getElementById(id);
  const exists = (el) => !!el;
  const onClickSafe = (el, fn) => { if (el) el.addEventListener("click", fn); };
  const setTextSafe = (el, txt) => { if (el) el.textContent = String(txt ?? ""); };
  const setHtmlSafe = (el, html) => { if (el) el.innerHTML = html; };
  const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const toastHostEl = $("toastHost");

  /* ── LOGIN GATE ── */
  let _loginGateVisible = null;
  let _loginGateHideTimer = null;
  let _isLoggedIn = false;

  function setNavAuthState(loggedIn) {
    _isLoggedIn = loggedIn;
    menuItems.forEach(btn => {
      btn.classList.toggle("nav-locked", !loggedIn);
      btn.title = loggedIn ? "" : "Sign in to access this section";
    });
  }

  function showLoginGate(show) {
    if (_loginGateVisible === show) return;
    _loginGateVisible = show;
    const gate = document.getElementById("loginGate");
    const app  = document.querySelector(".app");
    if (!gate) return;

    // Cancel any pending hide-after-transition
    if (_loginGateHideTimer) { clearTimeout(_loginGateHideTimer); _loginGateHideTimer = null; }
    // Remove any lingering transitionend listener
    gate._hideListener && gate.removeEventListener("transitionend", gate._hideListener);

    if (show) {
      gate.style.display = "flex";
      if (app) { app.style.visibility = "hidden"; app.classList.remove("app--reveal"); }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => gate.classList.add("is-visible"));
      });
    } else {
      gate.classList.remove("is-visible");
      if (app) { app.style.visibility = ""; app.classList.add("app--reveal"); }
      // Hide after transition — filter to gate's own transition only (not bubbled children)
      const onEnd = (e) => {
        if (e.target !== gate) return;
        gate.style.display = "none";
        gate.removeEventListener("transitionend", onEnd);
        gate._hideListener = null;
      };
      gate._hideListener = onEnd;
      gate.addEventListener("transitionend", onEnd);
      // Fallback: hide after 500ms in case transitionend never fires
      _loginGateHideTimer = setTimeout(() => {
        gate.style.display = "none";
        gate.removeEventListener("transitionend", onEnd);
        gate._hideListener = null;
        _loginGateHideTimer = null;
      }, 500);
    }
  }

  function showToast(message, type = "info", timeoutMs = 2600) {
    if (!toastHostEl) return;
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = String(message || "");
    toastHostEl.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(4px)";
      t.style.transition = "opacity .14s ease, transform .14s ease";
      setTimeout(() => t.remove(), 150);
    }, timeoutMs);
  }

  function requireSecondClickConfirm(key, message, ttlMs = 3500) {
    const now = Date.now();
    const until = confirmArmedUntil.get(key) || 0;
    if (until > now) {
      confirmArmedUntil.delete(key);
      return true;
    }
    confirmArmedUntil.set(key, now + ttlMs);
    showToast(message, "warn", Math.min(4200, ttlMs));
    return false;
  }

  /* ================= DOM ================= */
  const routes = document.querySelectorAll(".route");
  const menuItems = document.querySelectorAll(".menu__item");

  const pipelineStatusEl = $("pipelineStatus");
  const badgeCaptureEl = $("badgeCapture");
  const todayCountEl = $("todayCount");
  const activityLogEl = $("activityLog");
  const dailyLimitLabelEl = $("dailyLimitLabel");

  const leadListEl = $("leadList");
  const leadsStatBarEl = $("leadsStatBar");
  const leadsHeaderToolsEl = $("leadsHeaderTools");
  const leadsClassicControlsEl = $("leadsClassicControls");
  const leadsSearchInputEl = $("leadsSearchInput");
  const btnLeadsSearchClear = $("btnLeadsSearchClear");

  const statCapturedEl = $("statCaptured");
  const statConversionEl = $("statConversion");
  const statDecidersEl = $("statDeciders");
  const dashCardConversionEl = $("dashCardConversion");
  const dashCardDecidersEl = $("dashCardDeciders");
  const dashTodayTextEl = $("dashTodayText");
  const dashTodayBarEl = $("dashTodayBar");
  const dashboardConvProBadgeEl = $("dashboardConvProBadge");
  const dashboardDecidersProBadgeEl = $("dashboardDecidersProBadge");
  const dashboardConvHintEl = $("dashboardConvHint");
  const dashboardDecidersHintEl = $("dashboardDecidersHint");
  const dashHotEl = $("dashHot");
  const dashHotBarEl = $("dashHotBar");
  const dashWarmEl = $("dashWarm");
  const dashWarmBarEl = $("dashWarmBar");
  const dashColdEl = $("dashCold");
  const dashColdBarEl = $("dashColdBar");
  const dashActionableEl = $("dashActionable");
  const dashActionableBarEl = $("dashActionableBar");
  const dashIgnoredEl = $("dashIgnored");
  const dashIgnoredBarEl = $("dashIgnoredBar");
  const dashLastCaptureEl = $("dashLastCapture");
  const dashPulseTagEl = $("dashPulseTag");
  const dashActionableRateEl = $("dashActionableRate");
  const dashDeciderRateEl = $("dashDeciderRate");
  const dashHotRateEl = $("dashHotRate");
  const dashQualityBarEl = $("dashQualityBar");
  const dashPulseHintEl = $("dashPulseHint");

  const msgProfileEl = $("msgProfile");
  const btnCopyMsgProfile = $("btnCopyMsgProfile");
  const msgLeadTypeEl = $("msgLeadType");
  const msgActionEl = $("msgAction");
  const msgVariantWrapEl = $("msgVariantWrap");
  const messageBoxEl = $("messageBox");
  const msgSendHintEl = $("msgSendHint");

  const btnPipelineToggle = $("btnPipelineToggle");
  const btnCopyMsg = $("btnCopyMsg");
  const btnRegenMsg = $("btnRegenMsg");
  const btnSendMsg = $("btnSendMsg");
  const btnAuthRegister = $("btnAuthRegister");
  const btnAuthLogin = $("btnAuthLogin");
  const btnAuthLogout = $("btnAuthLogout");
  const btnAuthSync = $("btnAuthSync");
  const btnUpgradePlan = $("btnUpgradePlan");
  const btnUpgradeCrypto = $("btnUpgradeCrypto");
  const btnAdminResetData = $("btnAdminResetData");
  const btnSidebarAddUser = $("btnSidebarAddUser");

  const btnExportActivity = $("btnExportActivity");
  const btnViewLeadsOnSite = $("btnViewLeadsOnSite");
  const btnExportLeads = $("btnExportLeads");
  const btnExportSEO = $("btnExportSEO"); // may not exist in HTML: safe
  const leadsExportHintEl = $("leadsExportHint");

  const navBadgeLeads    = $("navBadgeLeads");
  const navBadgeMessages = $("navBadgeMessages");
  const navBadgeChat     = $("navBadgeChat");
  const navChatBtn       = $("navChatBtn");
  const navBadgeNotif    = $("navBadgeNotif");
  const notifDropdownEl  = $("notifDropdown");
  const notifExtListEl   = $("notifExtList");
  const notifBellWrapEl  = $("notifBellWrap");
  const chatExtMessagesEl = $("chatExtMessages");
  const chatExtInputEl    = $("chatExtInput");
  const chatExtSendBtn    = $("chatExtSend");
  const themeToggleEl = $("themeToggle");
  const langToggleEl = $("langToggle");
  const langSwitchGroupEl = document.querySelector(".langSwitchGroup");

  const accountPlanEl = $("accountPlan");
  const accountQuotaEl = $("accountQuota");
  const accountBillingStatusEl = $("accountBillingStatus");
  const accountTokenPreviewEl = $("accountTokenPreview");
  const accountAuthMethodEl = $("accountAuthMethod");
  const accountIdentityEl = $("accountIdentity");
  const accountLinkedinEl = $("accountLinkedin");
  const accountLoginFirstNameEl = $("accountLoginFirstName");
  const accountLoginLastNameEl = $("accountLoginLastName");
  const accountLoginEmailEl = $("accountLoginEmail");
  const accountLoginEmailSecurityEl = $("accountLoginEmailSecurity");
  const accountLoginPasswordEl = $("accountLoginPassword");
  const accountQuotaScanTextEl = $("accountQuotaScanText");
  const accountQuotaMsgTextEl = $("accountQuotaMsgText");
  const accountQuotaSeoTextEl = $("accountQuotaSeoText");
  const accountQuotaScanBarEl = $("accountQuotaScanBar");
  const accountQuotaMsgBarEl = $("accountQuotaMsgBar");
  const accountQuotaSeoBarEl = $("accountQuotaSeoBar");
  const sidebarAccountAvatarEl = $("sidebarAccountAvatar");
  const sidebarAccountPlanHintEl = $("sidebarAccountPlanHint");
  const sidebarSeatBlockEl = document.querySelector(".sidebarSeatBlock");
  const sidebarSeatValueEl = $("sidebarSeatValue");
  const sidebarSeatUsersEl = $("sidebarSeatUsers");

  /* ===== SEO ROUTE DOM ===== */
  const seoListEl = $("seoList");
  const seoCompanyEl = $("seoCompany");
  const seoWebsiteEl = $("seoWebsite");
  const btnCopySeoWebsite = $("btnCopySeoWebsite");
  const seoStatusEl = $("seoStatus");
  const btnExportSeoSingle = $("btnExportSeoSingle");
  const seoOpportunitySelectEl = $("seoOpportunitySelect");
  const seoExportHintEl = $("seoExportHint");
  const seoFilterEl = $("seoFilter");

  const msgOpportunitySelectEl = $("msgOpportunitySelect");
  const msgPickerTriggerEl   = $("msgPickerTrigger");
  const msgPickerAvatarEl    = $("msgPickerAvatar");
  const msgPickerNameEl      = $("msgPickerName");
  const msgPickerSubEl       = $("msgPickerSub");
  const msgPickerDropdownEl  = $("msgPickerDropdown");
  const msgOppRowEl          = $("msgOppRow");

  let msgPickerOpen = false;

  /* ===== SCAN ASSISTANT DOM ===== */
  const scanAssistPromptEl = $("scanAssistPrompt");
  const scanAssistOfferEl = $("scanAssistOffer");
  const scanAssistRolesEl = $("scanAssistRoles");
  const scanAssistGeoEl = $("scanAssistGeo");
  const scanAssistExcludeEl = $("scanAssistExclude");
  const scanAssistPeopleQueryEl = $("scanAssistPeopleQuery");
  const scanAssistCompanyQueryEl = $("scanAssistCompanyQuery");
  const scanAssistAdvancedEl = $("scanAssistAdvanced");
  const assistantProBadgeEl = $("assistantProBadge");
  const assistantLockHintEl = $("assistantLockHint");
  const assistantCardEl = $("assistantCard");
  const assistantCardBodyEl = $("assistantCardBody");

  const btnScanAssistGenerate = $("scanAssistGenerate");
  const btnScanAssistFab = $("scanAssistFab");
  const btnScanAssistClose = $("scanAssistClose");
  const btnScanAssistCopyPeople = $("scanAssistCopyPeople");
  const btnScanAssistOpenPeople = $("scanAssistOpenPeople");
  const btnScanAssistCopyCompany = $("scanAssistCopyCompany");
  const btnScanAssistOpenCompany = $("scanAssistOpenCompany");
  let isScanAssistantOpen = false;

  /* ===== LEAD CHOOSER ===== */
  let leadChooserEl = $("leadChooser");
  let btnOpenMessagesEl = $("btnOpenMessages");
  let btnOpenSEOEl = $("btnOpenSEO");
  let leadChooserNameEl = $("leadChooserName");

  const I18N = {
    en: {
      "route.scan": "Scan",
      "route.leads": "Leads",
      "route.seo": "SEO",
      "route.messages": "Messages",
      "route.dashboard": "Dashboard",
      "route.chat": "Chat",
      "route.notifications": "Notifications",
      "route.account": "Account",
      "route.team": "Team",
      "team.totalLeads": "Leads",
      "team.scansMonth": "Scans / mo",
      "team.loadError": "Failed to load team stats.",
      "notif.empty": "No notifications yet.",
      "notif.markAll": "Mark all read",
      "chat.openFull": "Open full chat",
      "chat.placeholder": "Message #general…",
      "chat.empty": "No messages yet. Say hello to your team! 👋",
      "chat.loading": "Loading…",
      "chat.sending": "Sending…",
      "header.subtitle": "LinkedIn Prospecting Engine",
      "sidebar.darkMode": "Dark mode",
      "sidebar.language": "Language",
      "sidebar.status": "Status",
      "sidebar.today": "This month",
      "sidebar.perSeat": "Team",
      "sidebar.addUser": "Add user",
      "sidebar.seatUsage": "{used}/{included} users",
      "sidebar.addUserLocked": "Upgrade to AGENCY to add users.",
      "status.running": "RUNNING",
      "status.paused": "PAUSED",
      "button.start": "Start",
      "button.pause": "Pause",
      "button.generate": "Generate",
      "button.copy": "Copy",
      "button.copied": "Copied",
      "button.copyFailed": "Copy failed",
      "button.openLinkedinPeople": "LinkedIn",
      "button.regenerate": "Regenerate",
      "button.generating": "Generating...",
      "button.send": "Send",
      "button.sendPro": "Send (Pro)",
      "button.sendNow": "Send now",
      "button.sendNowPro": "Send now (Paid)",
      "button.sending": "Sending...",
      "button.openMessages": "Messages",
      "button.openSeo": "SEO",
      "button.rescan": "Rescan",
      "button.rescanning": "Launching…",
      "button.override": "Override decision",
      "button.closeOverride": "Close override",
      "button.exportActivity": "Download activity (CSV)",
      "button.exportLeadsCsv": "Export leads (CSV)",
      "button.exportLeadsPro": "Export leads (Paid)",
      "button.exportSeoAuditsCsv": "Export SEO audits (CSV)",
      "button.exportSeoAuditsPro": "Export SEO audits (Paid)",
      "button.exportSeoSingleCsv": "Export this SEO audit (CSV)",
      "button.exportSeoSinglePro": "Export this SEO audit (Paid)",
      "button.register": "Register",
      "button.login": "Login",
      "button.logout": "Logout",
      "account.signOut": "Sign out",
      "account.signOutSub": "You will be redirected to the login page.",
      "button.refreshAccount": "Refresh account",
      "button.upgradeCard": "Upgrade Card",
      "button.upgradeCrypto": "Upgrade Crypto",
      "button.resetData": "Reset account data",
      "scan.pipeline": "Pipeline",
      "scan.status": "Status",
      "scan.dailyLimit": "Monthly limit",
      "scan.dailyProfiles": "{limit}",
      "scan.howItWorks": "How it works",
      "scan.howItWorks.p1": "Browse LinkedIn profiles manually.",
      "scan.howItWorks.p2": "Capture and scoring run in background.",
      "scan.activity": "Activity",
      "scan.latestEvents": "Latest events",
      "scan.assistant.subtitle": "Generate your query with AI",
      "scan.assistant.prompt": "Describe your ideal prospect",
      "scan.assistant.prompt.placeholder": "Ex: CEO or founder of a SMB in France, B2B sector, with a website not optimized for SEO...",
      "scan.assistant.peopleQuery": "People query",
      "scan.assistant.people.placeholder": "Generated people query",
      "scan.assistant.tip": "Describe your target, AI generates the LinkedIn query.",
      "button.generateAI": "Generate with AI",
      "scan.assistant.dataset": "Dataset: {count} leads • Hot: {hot}{top}",
      "scan.assistant.top": " • Top: {company}",
      "scan.assistant.proHint": "Assistant Scan is available on paid plans. Upgrade to unlock query generation.",
      "leads.hot": "Hot leads",
      "leads.warm": "Warm leads",
      "leads.cold": "Cold leads",
      "leads.total": "Total",
      "leads.listTitle": "Lead list",
      "leads.listHint": "Pick a lead to open Messages or SEO.",
      "leads.viewOnSite": "View on site",
      "leads.empty": "No leads yet. Start the pipeline and visit LinkedIn profiles.",
      "leads.emptyFilter": "No leads for this filter.",
      "leads.position.one": "{count} position",
      "leads.position.many": "{count} positions",
      "leads.override.select": "Select a new decision",
      "leads.override.contactNow": "Contact now",
      "leads.override.contactSoft": "Contact soft",
      "leads.override.findDecider": "Find decider",
      "leads.override.ignore": "Ignore",
      "leads.badge.noActivePosition": "NO ACTIVE POSITION",
      "leads.roleLabel": "ROLE",
      "leads.confidenceLabel": "CONFIDENCE",
      "leads.opp.primary": "PRIMARY",
      "leads.opp.secondary": "SECONDARY",
      "leads.opp.ignored": "IGNORED",
      "leads.filter.all": "All leads",
      "leads.filter.hot": "Hot leads",
      "leads.filter.warm": "Warm leads",
      "leads.filter.cold": "Cold leads",
      "leads.search.placeholder": "Search by first name or last name",
      "button.searchLeads": "Search leads",
      "button.clearSearch": "Clear search",
      "leads.auditPreviewTitle": "SEO snapshot",
      "leads.auditPreviewStatus": "Status",
      "leads.auditPreviewScore": "Score",
      "leads.auditPreviewIssues": "Detected issues",
      "leads.auditPreviewReason": "Signal",
      "leads.auditPreviewHint": "Open SEO to view the full detailed audit.",
      "leads.auditPreviewHintLocked": "Full detailed audit is available on paid plans.",
      "seo.selectedTitle": "Selected SEO profile",
      "seo.company": "Company",
      "seo.website": "Website",
      "seo.status": "SEO Status",
      "seo.opportunity": "Opportunity",
      "seo.auditsTitle": "SEO audits",
      "seo.auditsHint": "Audits from captured profiles",
      "seo.empty": "No SEO audits yet.",
      "seo.emptyFilter": "No SEO audits for this filter.",
      "seo.filter.all": "All",
      "seo.filter.ok": "SEO ok",
      "seo.filter.critical": "SEO critical",
      "seo.filter.weak": "SEO weak",
      "seo.filter.noWebsite": "No website",
      "seo.filter.unreachable": "Site unreachable",
      "seo.filter.unknown": "SEO unknown",
      "seo.fullAuditTitle": "Detailed audit",
      "seo.fullAuditLockedTitle": "Detailed audit (Paid)",
      "seo.fullAuditLockedHint": "Upgrade to unlock full audit details and CSV export.",
      "seo.fullAuditStatus": "Status",
      "seo.fullAuditScore": "Technical score",
      "seo.fullAuditWebsiteStatus": "Website status",
      "seo.fullAuditSiteType": "Site type",
      "seo.fullAuditSource": "Detection source",
      "seo.fullAuditReason": "Main insight",
      "seo.fullAuditIssues": "Detected issues",
      "seo.fullAuditNoIssues": "No issue list available for this profile yet.",
      "seo.fullAuditMissing": "No detailed audit data available yet.",
      "messages.selectedLead": "Selected lead",
      "messages.lead": "Lead",
      "messages.opportunity": "Opportunity",
      "messages.profile": "Profile",
      "messages.leadType": "Lead type",
      "messages.nextAction": "Next action",
      "messages.generatedTitle": "Generated message",
      "messages.editHint": "Edit before sending",
      "messages.tone": "Tone",
      "messages.variant": "Variant",
      "messages.variant.option": "Variant {index}",
      "messages.variant.count": "{count} variants",
      "messages.placeholder": "Message will appear here...",
      "messages.sendHint": "Send opens LinkedIn profile and sends with current template.",
      "messages.sendHintPro": "Send Now is available on paid plans. Upgrade to unlock one-click sending.",
      "messages.template.greeting": "Hi {name},",
      "messages.template.line1": "I came across your profile{company} and noticed a potential opportunity to improve your website visibility on Google.",
      "messages.template.quickNote": "Quick note: {reason}",
      "messages.template.line2": "If you're open to it, I can share a short, actionable checklist based on what we detected.",
      "messages.template.signature": "Best,",
      "dashboard.captured": "Captured",
      "dashboard.totalStored": "Total stored leads",
      "dashboard.conversion": "Conversion",
      "dashboard.conversionHint": "Actionable / Total",
      "dashboard.deciders": "Deciders",
      "dashboard.decidersHint": "Decision makers detected",
      "dashboard.today": "Month progress",
      "dashboard.scansUsed": "{left}/{limit} scans left",
      "dashboard.openApp": "Open app",
      "dashboard.openApp.dashboard": "Dashboard",
      "dashboard.openApp.leads": "Leads",
      "dashboard.openApp.team": "Team",
      "dashboard.openApp.upgrade": "Upgrade",
      "dashboard.openApp.billing": "Billing",
      "account.openApp": "Open web app",
      "account.openApp.dashboard": "Dashboard",
      "account.openApp.billing": "Billing",
      "dashboard.qualityHint": "Quality score {score}/100 • {left}/{limit} scans left.",
      "dashboard.pulse.strong": "STRONG",
      "dashboard.pulse.steady": "STEADY",
      "dashboard.pulse.early": "EARLY",
      "account.title": "Account",
      "account.plan": "Plan",
      "account.billingStatus": "Billing status",
      "account.token": "Token",
      "account.authMethod": "Auth method",
      "account.identity": "Identity",
      "account.linkedin": "LinkedIn",
      "account.quotaTitle": "Quota usage",
      "account.scansPerDay": "Scans / month",
      "account.messagesPerMonth": "Messages / month",
      "account.seoPerMonth": "SEO exports / month",
      "account.authActions": "Auth & Actions",
      "account.firstName.placeholder": "First name",
      "account.lastName.placeholder": "Last name",
      "account.email.placeholder": "you@example.com",
      "account.password.placeholder": "password",
      "account.syncedHint": "Account is synced from backend session (`/v1/me`).",
      "account.quotaLabel": "scan/mo:{scan} • msg/mo:{msg} • seo/mo:{seo}",
      "account.remaining": "{used}/{limit} ({left} left)",
      "leadChooser.selected": "Selected: {name}",
      "leadChooser.selectedDefault": "Selected lead",
      "status.selectSeoProfileFirst": "Select a SEO profile first",
      "status.proFeature": "Paid plan feature",
      "status.csvExportPro": "CSV export is available on paid plans.",
      "status.seoExportPro": "SEO export is available on paid plans.",
      "status.actionablePro": "Actionable / Total (PRO)",
      "status.decidersPro": "Decision makers detected (PRO)",
      "toast.assistantPro": "Assistant Scan is available on paid plans.",
      "toast.generateFailed": "Generate failed: {error}",
      "toast.openFailed": "Open failed: {error}",
      "toast.assistantUnavailable": "Assistant unavailable: {error}",
      "toast.overrideFailed": "Override failed: {error}",
      "toast.decisionUpdated": "Decision updated: {label}",
      "toast.messageGenerated": "Message generated from audit.",
      "toast.generateFallback": "Generate failed, local fallback used: {error}",
      "toast.sendDisabledPro": "Send Now is disabled on your current plan.",
      "toast.sendingLinkedin": "Sending LinkedIn message...",
      "toast.sendFailed": "Send failed: {error}",
      "toast.messageSent": "Message sent on LinkedIn.",
      "toast.draftFilled": "Draft filled on LinkedIn.",
      "toast.messageStatus": "Message status: {status}{candidates}{docs}{hint}",
      "toast.emailPasswordRequired": "Email and password required.",
      "toast.registerFieldsRequired": "First name, last name, email and password required.",
      "toast.registerFailed": "Register failed: {error}",
      "toast.accountCreated": "Account created and logged in.",
      "toast.addUserLocked": "Add user is available only on the AGENCY plan.",
      "toast.addUserFailed": "Add user failed: {error}",
      "toast.addUserCreated": "Seat user added.",
      "toast.addUserLimit": "Included seats reached. Add-on seats are required.",
      "toast.loginFailed": "Login failed: {error}",
      "toast.loggedIn": "Logged in.",
      "toast.sessionDetected": "Session detected — welcome!",
      "toast.sessionNotFound": "No active session found. Open the site and log in first.",
      "toast.sessionDetecting": "Detecting session…",
      "toast.logoutFailed": "Logout failed: {error}",
      "toast.loggedOut": "Logged out.",
      "toast.refreshFailed": "Refresh failed: {error}",
      "toast.accountRefreshed": "Account refreshed.",
      "toast.loginRequiredUpgrade": "Login required before upgrade.",
      "toast.fallbackPricingOpened": "Fallback pricing page opened.",
      "toast.upgradeFailed": "Upgrade failed: {error}",
      "toast.checkoutOpened": "Checkout opened ({provider}).",
      "toast.checkoutOpenFailed": "Cannot open checkout: {error}",
      "toast.resetConfirm": "Click again to confirm account reset",
      "toast.resetFailed": "Reset failed: {error}",
      "toast.accountReset": "Account data reset.",
      "toast.exportDisabled": "CSV export is disabled on your current plan.",
      "toast.exportFailed": "Export failed: {error}",
      "error.noSeoAudits": "No SEO audits to export.",
    },
    fr: {
      "route.scan": "Scan",
      "route.leads": "Leads",
      "route.seo": "SEO",
      "route.messages": "Messages",
      "route.dashboard": "Dashboard",
      "route.chat": "Chat",
      "route.notifications": "Notifications",
      "route.account": "Compte",
      "route.team": "Équipe",
      "team.totalLeads": "Leads",
      "team.scansMonth": "Scans / mois",
      "team.loadError": "Impossible de charger les stats de l'équipe.",
      "notif.empty": "Aucune notification pour l'instant.",
      "notif.markAll": "Tout marquer comme lu",
      "chat.openFull": "Ouvrir le chat",
      "chat.placeholder": "Message #general…",
      "chat.empty": "Pas encore de messages. Dites bonjour à l'équipe ! 👋",
      "chat.loading": "Chargement…",
      "chat.sending": "Envoi…",
      "header.subtitle": "Moteur de prospection LinkedIn",
      "sidebar.darkMode": "Mode sombre",
      "sidebar.language": "Langue",
      "sidebar.status": "Statut",
      "sidebar.today": "Ce mois",
      "sidebar.perSeat": "Équipe",
      "sidebar.addUser": "Ajouter user",
      "sidebar.seatUsage": "{used}/{included} users",
      "sidebar.addUserLocked": "Passez au plan AGENCY pour ajouter des users.",
      "status.running": "ACTIF",
      "status.paused": "PAUSE",
      "button.start": "Démarrer",
      "button.pause": "Pause",
      "button.generate": "Générer",
      "button.copy": "Copier",
      "button.copied": "Copié",
      "button.copyFailed": "Échec copie",
      "button.openLinkedinPeople": "LinkedIn",
      "button.regenerate": "Régénérer",
      "button.generating": "Génération...",
      "button.send": "Envoyer",
      "button.sendPro": "Envoyer (Pro)",
      "button.sendNow": "Envoyer",
      "button.sendNowPro": "Envoyer (Payant)",
      "button.sending": "Envoi...",
      "button.openMessages": "Messages",
      "button.openSeo": "SEO",
      "button.override": "Override décision",
      "button.rescan": "Rescanner",
      "button.rescanning": "Lancement…",
      "button.closeOverride": "Fermer override",
      "button.exportActivity": "Télécharger activité (CSV)",
      "button.exportLeadsCsv": "Exporter leads (CSV)",
      "button.exportLeadsPro": "Exporter leads (Payant)",
      "button.exportSeoAuditsCsv": "Exporter audits SEO (CSV)",
      "button.exportSeoAuditsPro": "Exporter audits SEO (Payant)",
      "button.exportSeoSingleCsv": "Exporter cet audit SEO (CSV)",
      "button.exportSeoSinglePro": "Exporter cet audit SEO (Payant)",
      "button.register": "Créer compte",
      "button.login": "Connexion",
      "button.logout": "Déconnexion",
      "account.signOut": "Se déconnecter",
      "account.signOutSub": "Vous serez redirigé vers la page de connexion.",
      "button.refreshAccount": "Rafraîchir compte",
      "button.upgradeCard": "Upgrade carte",
      "button.upgradeCrypto": "Upgrade crypto",
      "button.resetData": "Reset données compte",
      "scan.pipeline": "Pipeline",
      "scan.status": "Statut",
      "scan.dailyLimit": "Limite/mois",
      "scan.dailyProfiles": "{limit}",
      "scan.howItWorks": "Comment ça marche",
      "scan.howItWorks.p1": "Parcourez des profils LinkedIn manuellement.",
      "scan.howItWorks.p2": "La capture et le scoring tournent en arrière-plan.",
      "scan.activity": "Activité",
      "scan.latestEvents": "Derniers événements",
      "scan.assistant.subtitle": "Générez votre requête avec l'IA",
      "scan.assistant.prompt": "Décrivez votre prospect idéal",
      "scan.assistant.prompt.placeholder": "Ex: CEO ou fondateur d'une PME en France, secteur B2B, avec un site web mal optimisé pour le SEO...",
      "scan.assistant.peopleQuery": "Requête people",
      "scan.assistant.people.placeholder": "Requête people générée",
      "scan.assistant.tip": "Décrivez votre cible, l'IA génère la requête LinkedIn.",
      "button.generateAI": "Générer avec l'IA",
      "scan.assistant.dataset": "Dataset: {count} leads • Hot: {hot}{top}",
      "scan.assistant.top": " • Top: {company}",
      "scan.assistant.proHint": "Assistant Scan est disponible sur les plans payants. Upgradez pour débloquer la génération.",
      "leads.hot": "Hot leads",
      "leads.warm": "Warm leads",
      "leads.cold": "Cold leads",
      "leads.total": "Total",
      "leads.listTitle": "Liste des leads",
      "leads.listHint": "Choisissez un lead pour ouvrir Messages ou SEO.",
      "leads.viewOnSite": "Voir sur le site",
      "leads.empty": "Aucun lead pour le moment. Démarrez le pipeline et visitez des profils LinkedIn.",
      "leads.emptyFilter": "Aucun lead pour ce filtre.",
      "leads.position.one": "{count} position",
      "leads.position.many": "{count} positions",
      "leads.override.select": "Sélectionnez une nouvelle décision",
      "leads.override.contactNow": "Contacter maintenant",
      "leads.override.contactSoft": "Contact doux",
      "leads.override.findDecider": "Trouver décideur",
      "leads.override.ignore": "Ignorer",
      "leads.badge.noActivePosition": "PAS DE POSITION ACTIVE",
      "leads.roleLabel": "RÔLE",
      "leads.confidenceLabel": "CONFIANCE",
      "leads.opp.primary": "PRIMAIRE",
      "leads.opp.secondary": "SECONDAIRE",
      "leads.opp.ignored": "IGNORÉ",
      "leads.filter.all": "All leads",
      "leads.filter.hot": "Hot leads",
      "leads.filter.warm": "Warm leads",
      "leads.filter.cold": "Cold leads",
      "leads.search.placeholder": "Rechercher par prenom ou nom",
      "button.searchLeads": "Rechercher des leads",
      "button.clearSearch": "Effacer la recherche",
      "leads.auditPreviewTitle": "Apercu SEO",
      "leads.auditPreviewStatus": "Statut",
      "leads.auditPreviewScore": "Score",
      "leads.auditPreviewIssues": "Problemes detectes",
      "leads.auditPreviewReason": "Signal",
      "leads.auditPreviewHint": "Ouvrez SEO pour voir l'audit complet detaille.",
      "leads.auditPreviewHintLocked": "L'audit complet detaille est reserve aux plans payants.",
      "seo.selectedTitle": "Profil SEO sélectionné",
      "seo.company": "Entreprise",
      "seo.website": "Site web",
      "seo.status": "Statut SEO",
      "seo.opportunity": "Opportunité",
      "seo.auditsTitle": "Audits SEO",
      "seo.auditsHint": "Audits des profils capturés",
      "seo.empty": "Aucun audit SEO.",
      "seo.emptyFilter": "Aucun audit SEO pour ce filtre.",
      "seo.filter.all": "Tous",
      "seo.filter.ok": "SEO ok",
      "seo.filter.critical": "SEO critique",
      "seo.filter.weak": "SEO faible",
      "seo.filter.noWebsite": "Pas de site",
      "seo.filter.unreachable": "Site inaccessible",
      "seo.filter.unknown": "SEO inconnu",
      "seo.fullAuditTitle": "Audit detaille",
      "seo.fullAuditLockedTitle": "Audit detaille (Payant)",
      "seo.fullAuditLockedHint": "Upgradez pour debloquer l'audit complet et l'export CSV.",
      "seo.fullAuditStatus": "Statut",
      "seo.fullAuditScore": "Score technique",
      "seo.fullAuditWebsiteStatus": "Statut du site",
      "seo.fullAuditSiteType": "Type de site",
      "seo.fullAuditSource": "Source de detection",
      "seo.fullAuditReason": "Insight principal",
      "seo.fullAuditIssues": "Problemes detectes",
      "seo.fullAuditNoIssues": "Aucune liste de problemes disponible pour ce profil.",
      "seo.fullAuditMissing": "Aucune donnee d'audit detaillee disponible pour le moment.",
      "messages.selectedLead": "Lead sélectionné",
      "messages.lead": "Lead",
      "messages.opportunity": "Opportunité",
      "messages.profile": "Profil",
      "messages.leadType": "Type de lead",
      "messages.nextAction": "Action suivante",
      "messages.generatedTitle": "Message généré",
      "messages.editHint": "Modifier avant envoi",
      "messages.tone": "Ton",
      "messages.variant": "Variante",
      "messages.variant.option": "Variante {index}",
      "messages.variant.count": "{count} variantes",
      "messages.placeholder": "Le message apparaîtra ici...",
      "messages.sendHint": "Envoyer ouvre le profil LinkedIn et envoie le template actuel.",
      "messages.sendHintPro": "Send Now est disponible sur les plans payants. Upgradez pour débloquer l'envoi en 1 clic.",
      "messages.template.greeting": "Bonjour {name},",
      "messages.template.line1": "J'ai vu votre profil{company} et identifié une opportunité potentielle d'améliorer la visibilité de votre site sur Google.",
      "messages.template.quickNote": "Note rapide: {reason}",
      "messages.template.line2": "Si vous êtes ouvert, je peux partager une checklist courte et actionnable basée sur ce que nous avons détecté.",
      "messages.template.signature": "Bien à vous,",
      "dashboard.captured": "Capturés",
      "dashboard.totalStored": "Total de leads stockés",
      "dashboard.conversion": "Conversion",
      "dashboard.conversionHint": "Actionnables / Total",
      "dashboard.deciders": "Décideurs",
      "dashboard.decidersHint": "Décideurs détectés",
      "dashboard.today": "Progression du mois",
      "dashboard.scansUsed": "{left}/{limit} scans restants",
      "dashboard.openApp": "Ouvrir l'app",
      "dashboard.openApp.dashboard": "Dashboard",
      "dashboard.openApp.leads": "Leads",
      "dashboard.openApp.team": "Équipe",
      "dashboard.openApp.upgrade": "Upgrade",
      "dashboard.openApp.billing": "Abonnement",
      "account.openApp": "Ouvrir l'app",
      "account.openApp.dashboard": "Dashboard",
      "account.openApp.billing": "Abonnement",
      "dashboard.qualityHint": "Score qualité {score}/100 • {left}/{limit} scans restants.",
      "dashboard.pulse.strong": "FORT",
      "dashboard.pulse.steady": "STABLE",
      "dashboard.pulse.early": "DÉBUT",
      "account.title": "Compte",
      "account.plan": "Plan",
      "account.billingStatus": "Statut abonnement",
      "account.token": "Token",
      "account.authMethod": "Méthode auth",
      "account.identity": "Identité",
      "account.linkedin": "LinkedIn",
      "account.quotaTitle": "Consommation quota",
      "account.scansPerDay": "Scans / mois",
      "account.messagesPerMonth": "Messages / mois",
      "account.seoPerMonth": "Exports SEO / mois",
      "account.authActions": "Auth & Actions",
      "account.firstName.placeholder": "Prenom",
      "account.lastName.placeholder": "Nom",
      "account.email.placeholder": "vous@exemple.com",
      "account.password.placeholder": "mot de passe",
      "account.syncedHint": "Le compte est synchronisé depuis la session backend (`/v1/me`).",
      "account.quotaLabel": "scan/mois:{scan} • msg/mois:{msg} • seo/mois:{seo}",
      "account.remaining": "{used}/{limit} ({left} restants)",
      "leadChooser.selected": "Sélectionné: {name}",
      "leadChooser.selectedDefault": "Lead sélectionné",
      "status.selectSeoProfileFirst": "Sélectionnez d'abord un profil SEO",
      "status.proFeature": "Fonctionnalité plan payant",
      "status.csvExportPro": "L'export CSV est disponible sur les plans payants.",
      "status.seoExportPro": "L'export SEO est disponible sur les plans payants.",
      "status.actionablePro": "Actionnables / Total (PRO)",
      "status.decidersPro": "Décideurs détectés (PRO)",
      "toast.assistantPro": "Assistant Scan est disponible sur les plans payants.",
      "toast.generateFailed": "Échec génération: {error}",
      "toast.openFailed": "Échec ouverture: {error}",
      "toast.assistantUnavailable": "Assistant indisponible: {error}",
      "toast.overrideFailed": "Échec override: {error}",
      "toast.decisionUpdated": "Décision mise à jour: {label}",
      "toast.messageGenerated": "Message généré depuis l'audit.",
      "toast.generateFallback": "Échec génération, fallback local utilisé: {error}",
      "toast.sendDisabledPro": "Send Now est désactivé sur votre plan actuel.",
      "toast.sendingLinkedin": "Envoi du message LinkedIn...",
      "toast.sendFailed": "Échec envoi: {error}",
      "toast.messageSent": "Message envoyé sur LinkedIn.",
      "toast.draftFilled": "Brouillon rempli sur LinkedIn.",
      "toast.messageStatus": "Statut message: {status}{candidates}{docs}{hint}",
      "toast.emailPasswordRequired": "Email et mot de passe requis.",
      "toast.registerFieldsRequired": "Prenom, nom, email et mot de passe requis.",
      "toast.registerFailed": "Échec création compte: {error}",
      "toast.accountCreated": "Compte créé et connecté.",
      "toast.addUserLocked": "Add user est disponible seulement sur le plan AGENCY.",
      "toast.addUserFailed": "Échec ajout user: {error}",
      "toast.addUserCreated": "User seat ajouté.",
      "toast.addUserLimit": "Les seats inclus sont atteints. Des seats add-on sont requis.",
      "toast.loginFailed": "Échec connexion: {error}",
      "toast.loggedIn": "Connecté.",
      "toast.sessionDetected": "Session détectée — bienvenue !",
      "toast.sessionNotFound": "Aucune session active. Ouvrez le site et connectez-vous d'abord.",
      "toast.sessionDetecting": "Détection de session…",
      "toast.logoutFailed": "Échec déconnexion: {error}",
      "toast.loggedOut": "Déconnecté.",
      "toast.refreshFailed": "Échec refresh: {error}",
      "toast.accountRefreshed": "Compte rafraîchi.",
      "toast.loginRequiredUpgrade": "Connexion requise avant upgrade.",
      "toast.fallbackPricingOpened": "Page pricing fallback ouverte.",
      "toast.upgradeFailed": "Échec upgrade: {error}",
      "toast.checkoutOpened": "Checkout ouvert ({provider}).",
      "toast.checkoutOpenFailed": "Impossible d'ouvrir le checkout: {error}",
      "toast.resetConfirm": "Cliquez encore pour confirmer le reset du compte",
      "toast.resetFailed": "Échec reset: {error}",
      "toast.accountReset": "Données compte réinitialisées.",
      "toast.exportDisabled": "L'export CSV est désactivé sur votre plan actuel.",
      "toast.exportFailed": "Échec export: {error}",
      "error.noSeoAudits": "Aucun audit SEO à exporter.",
    },
  };

  function normalizeLanguage(raw) {
    const lang = String(raw || "en").toLowerCase();
    return lang.startsWith("fr") ? "fr" : "en";
  }

  function getPreferredLanguage() {
    try {
      const saved = localStorage.getItem(PANEL_LANG_STORAGE_KEY);
      if (saved) return normalizeLanguage(saved);
    } catch {}
    return "en";
  }

  function persistLanguage(lang) {
    try {
      localStorage.setItem(PANEL_LANG_STORAGE_KEY, normalizeLanguage(lang));
    } catch {}
  }

  function t(key, vars = {}) {
    const source = I18N[currentLang] || I18N.en;
    const fallback = I18N.en || {};
    let msg = source[key] ?? fallback[key] ?? key;
    for (const [k, v] of Object.entries(vars || {})) {
      msg = msg.replaceAll(`{${k}}`, String(v ?? ""));
    }
    return msg;
  }

  function setI18nText(id, key, vars = {}) {
    setTextSafe($(id), t(key, vars));
  }

  function setI18nPlaceholder(id, key) {
    const el = $(id);
    if (!el) return;
    el.placeholder = t(key);
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLang;
    if (langToggleEl) {
      const isFr = currentLang === "fr";
      langToggleEl.checked = isFr;
      langToggleEl.setAttribute("aria-checked", isFr ? "true" : "false");
    }
    if (langSwitchGroupEl) {
      langSwitchGroupEl.setAttribute("data-lang", currentLang === "fr" ? "fr" : "en");
    }

    setI18nText("navScanText", "route.scan");
    setI18nText("navLeadsText", "route.leads");
    setI18nText("navSeoText", "route.seo");
    setI18nText("navMessagesText", "route.messages");
    setI18nText("navDashboardText", "route.dashboard");
    setI18nText("navChatText", "route.chat");
    setI18nText("navAccountText", "route.account");
    setI18nText("btnNotifMarkAll", "notif.markAll");
    setI18nText("notifDropdownTitle", "route.notifications");
    setI18nText("btnChatOpenFull", "chat.openFull");
    const chatInputEl = $("chatExtInput");
    if (chatInputEl) chatInputEl.placeholder = t("chat.placeholder");
    setI18nText("lblPerSeat", "sidebar.perSeat");
    setI18nText("lblAddUser", "sidebar.addUser");
    setI18nText("lblDarkMode", "sidebar.darkMode");
    setI18nText("lblLanguage", "sidebar.language");
    setI18nText("lblSidebarStatus", "sidebar.status");
    setI18nText("lblSidebarToday", "sidebar.today");
    updatePipelineToggleButton(snapshot?.pipelineStatus || pipelineStatusRaw);

    setI18nText("scanPipelineTitle", "scan.pipeline");
    setI18nText("scanPipelineStatusLabel", "scan.status");
    setI18nText("scanDailyLimitText", "scan.dailyLimit");
    setI18nText("scanHowItWorksTitle", "scan.howItWorks");
    setI18nText("scanHowItWorksP1", "scan.howItWorks.p1");
    setI18nText("scanHowItWorksP2", "scan.howItWorks.p2");
    setI18nText("scanActivityTitle", "scan.activity");
    setI18nText("scanActivityHint", "scan.latestEvents");
    setI18nText("assistantSubtitle", "scan.assistant.subtitle");
    setI18nText("assistantPromptLabel", "scan.assistant.prompt");
    setI18nText("assistantPeopleQueryLabel", "scan.assistant.peopleQuery");
    setI18nText("scanAssistGenerateLabel", "button.generateAI");
    setI18nText("scanAssistCopyPeopleLabel", "button.copy");
    setI18nText("scanAssistOpenPeopleLabel", "button.openLinkedinPeople");
    setI18nPlaceholder("scanAssistPrompt", "scan.assistant.prompt.placeholder");
    setI18nPlaceholder("scanAssistPeopleQuery", "scan.assistant.people.placeholder");

    // leadsSummaryCard titles removed — replaced by leadsStatBar (dynamic)
    setI18nText("leadListTitle", "leads.listTitle");
    setI18nText("leadListHint", "leads.listHint");
    setI18nText("leadListHint", "leads.listHint");
    setI18nText("btnViewLeadsOnSiteLabel", "leads.viewOnSite");
    // btnExportLeads is icon-only — no text to set
    setI18nPlaceholder("leadsSearchInput", "leads.search.placeholder");
    if (btnLeadsSearchClear) {
      const label = t("button.clearSearch");
      btnLeadsSearchClear.setAttribute("aria-label", label);
      btnLeadsSearchClear.title = label;
    }

    setI18nText("seoCompanyLabel", "seo.company");
    setI18nText("seoWebsiteLabel", "seo.website");
    setI18nText("seoStatusLabel", "seo.status");
    setI18nText("seoOpportunityLabel", "seo.opportunity");
    setI18nText("seoAuditsTitle", "seo.auditsTitle");
    setI18nText("seoAuditsHint", "seo.auditsHint");

    setI18nText("msgOppLabel", "messages.opportunity");
    setI18nText("messagesEditHint", "messages.editHint");
    setI18nPlaceholder("messageBox", "messages.placeholder");
    setI18nText("btnCopyMsgLabel", "button.copy");
    setI18nText("btnRegenMsgLabel", "button.generateAI");
    // Update tone pill labels for current language
    const isFr = getUiLanguage() === "fr";
    const toneLabels = {
      professional: isFr ? "Professionnel" : "Professional",
      friendly:     isFr ? "Amical"        : "Friendly",
      direct:       isFr ? "Direct"        : "Direct",
      consultative: isFr ? "Consultatif"   : "Consultative",
    };
    const tonePillsEl = $("msgTonePills");
    if (tonePillsEl) {
      tonePillsEl.querySelectorAll(".msgTonePill").forEach(p => {
        const key = p.dataset.tone;
        if (key && toneLabels[key]) p.textContent = toneLabels[key];
      });
    }
    setI18nText("msgToneLabel", "messages.tone");

    setI18nText("dashTodayTitle", "dashboard.today");
    setI18nText("dashActionableLabel", "dashboard.actionable");
    setI18nText("dashIgnoredLabel", "dashboard.ignored");
    setI18nText("dashLastCaptureLabel", "dashboard.lastCapture");
    setI18nText("dashActionableRateLabel", "dashboard.actionableRate");
    setI18nText("dashDeciderRateLabel", "dashboard.deciderRate");
    setI18nText("dashHotRateLabel", "dashboard.hotLeadRatio");

    setI18nText("accountPlanLabel", "account.plan");
    setI18nText("accountBillingLabel", "account.billingStatus");
    setI18nText("accountTokenLabel", "account.token");
    setI18nText("accountAuthMethodLabel", "account.authMethod");
    setI18nText("accountIdentityLabel", "account.identity");
    setI18nText("accountLinkedinLabel", "account.linkedin");
    setI18nText("accountScansPerDayLabel", "account.scansPerDay");
    setI18nText("accountMessagesPerMonthLabel", "account.messagesPerMonth");
    setI18nText("accountSeoExportsPerMonthLabel", "account.seoPerMonth");
    setI18nText("btnAuthRegister", "button.register");
    setI18nText("btnAuthLogin", "button.login");
    setI18nText("btnAuthLogout", "button.logout");
    setI18nText("extSignOutTitle", "account.signOut");
    setI18nText("extSignOutSub", "account.signOutSub");
    setI18nText("btnAuthSync", "button.refreshAccount");
    setI18nText("btnUpgradePlan", "button.upgradeCard");
    setI18nText("btnUpgradeCrypto", "button.upgradeCrypto");
    setI18nText("btnAdminResetData", "button.resetData");
    setI18nPlaceholder("accountLoginFirstName", "account.firstName.placeholder");
    setI18nPlaceholder("accountLoginLastName", "account.lastName.placeholder");
    setI18nPlaceholder("accountLoginEmail", "account.email.placeholder");
    setI18nPlaceholder("accountLoginPassword", "account.password.placeholder");
    setI18nText("seoSelectedTitle", "seo.selectedTitle");
    setI18nText("dashCapturedTitle", "dashboard.captured");
    setI18nText("dashCapturedHint", "dashboard.totalStored");
    setI18nText("dashConversionTitle", "dashboard.conversion");
    setI18nText("dashDecidersTitle", "dashboard.deciders");
    setI18nText("dashOpenAppTitle", "dashboard.openApp");
    setI18nText("dashOpenAppDashboardLabel", "dashboard.openApp.dashboard");
    setI18nText("dashOpenAppLeadsLabel", "dashboard.openApp.leads");
    setI18nText("dashOpenAppTeamLabel",    "dashboard.openApp.team");
    setI18nText("dashOpenAppUpgradeLabel", "dashboard.openApp.upgrade");
    setI18nText("dashOpenAppBillingLabel", "dashboard.openApp.billing");
    setI18nText("accountOpenAppLabel", "account.openApp");
    setI18nText("accountOpenDashLabel", "account.openApp.dashboard");
    setI18nText("accountOpenBillingLabel", "account.openApp.billing");
    setI18nText("accountTitle", "account.title");
    setI18nText("accountQuotaTitle", "account.quotaTitle");
    setI18nText("accountAuthActionsTitle", "account.authActions");
    setI18nText("accountSyncHint", "account.syncedHint");

    const _msgLbl = $("btnOpenMessagesLabel"); if (_msgLbl) setTextSafe(_msgLbl, t("button.openMessages"));
    const _seoLbl = $("btnOpenSEOLabel");      if (_seoLbl) setTextSafe(_seoLbl, t("button.openSeo"));

    const currentRouteBtn = document.querySelector(".menu__item.active");
    const currentRoute = currentRouteBtn?.dataset?.route || "scan";
    setTextSafe($("routeTitle"), t(`route.${currentRoute}`));
    setTextSafe($("btnExportActivityLabel") || $("btnExportActivity"), t("button.exportActivity"));
    setTextSafe($("btnExportSeoSingle"), t("button.exportSeoSingleCsv"));

    // leadsFilter select removed — labels now rendered dynamically in renderLeadsStatBar()
    if (seoFilterEl) {
      const labels = {
        ALL: t("seo.filter.all"),
        OK: t("seo.filter.ok"),
        CRITIQUE: t("seo.filter.critical"),
        FAIBLE: t("seo.filter.weak"),
        NO_WEBSITE: t("seo.filter.noWebsite"),
        SITE_UNREACHABLE: t("seo.filter.unreachable"),
        UNKNOWN: t("seo.filter.unknown"),
      };
      for (const opt of Array.from(seoFilterEl.options || [])) {
        if (labels[opt.value]) opt.textContent = labels[opt.value];
      }
    }
  }

  function wireLanguageToggle() {
    currentLang = getPreferredLanguage();
    applyStaticTranslations();
    if (!langToggleEl) return;
    langToggleEl.addEventListener("change", () => {
      currentLang = langToggleEl.checked ? "fr" : "en";
      persistLanguage(currentLang);
      applyStaticTranslations();
      renderAll();
    });
  }

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(PANEL_THEME_STORAGE_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    return prefersDark ? "dark" : "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("theme-dark", isDark);
    document.body.classList.toggle("theme-light", !isDark);
    if (themeToggleEl) {
      themeToggleEl.checked = isDark;
      themeToggleEl.setAttribute("aria-checked", isDark ? "true" : "false");
    }
    const moon = document.getElementById("themeIconMoon");
    const sun  = document.getElementById("themeIconSun");
    if (moon) moon.style.display = isDark ? "none" : "";
    if (sun)  sun.style.display  = isDark ? "" : "none";
    const themeToggleAppearanceEl2 = document.getElementById("themeToggleAppearance");
    if (themeToggleAppearanceEl2) {
      themeToggleAppearanceEl2.checked = isDark;
      themeToggleAppearanceEl2.setAttribute("aria-checked", isDark ? "true" : "false");
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(PANEL_THEME_STORAGE_KEY, theme);
    } catch {}
  }

  function wireThemeToggle() {
    applyTheme(getPreferredTheme());
    if (themeToggleEl) {
      themeToggleEl.addEventListener("change", () => {
        const nextTheme = themeToggleEl.checked ? "dark" : "light";
        applyTheme(nextTheme);
        persistTheme(nextTheme);
      });
    }
    const btnTheme = document.getElementById("btnThemeToggle");
    if (btnTheme) {
      btnTheme.addEventListener("click", () => {
        const isDark = document.body.classList.contains("theme-dark");
        const nextTheme = isDark ? "light" : "dark";
        applyTheme(nextTheme);
        persistTheme(nextTheme);
      });
    }
  }

  /* ================= CHAT ================= */
  function chatGetSenderName(senderId) {
    if (senderId === chatMyUserId) {
      const acct = snapshot?.account || {};
      return (acct.identity || acct.email || "You").split(" ")[0];
    }
    return "Member";
  }

  function chatFormatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function chatFormatDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }

  function renderChatMessages() {
    if (!chatExtMessagesEl) return;
    const msgs = chatMessages;
    if (msgs.length === 0) {
      chatExtMessagesEl.innerHTML = `<div class="chatExtEmpty">${t("chat.empty")}</div>`;
      return;
    }
    const groups = [];
    for (const msg of msgs) {
      const d = chatFormatDate(msg.created_at);
      const last = groups[groups.length - 1];
      if (last?.date === d) last.msgs.push(msg);
      else groups.push({ date: d, msgs: [msg] });
    }
    let html = "";
    for (const group of groups) {
      html += `<div class="chatExtDateDivider"><span>${escHtml(group.date)}</span></div>`;
      for (let i = 0; i < group.msgs.length; i++) {
        const msg = group.msgs[i];
        const isOwn = msg.sender_id === chatMyUserId;
        const isSameAuthor = i > 0 && group.msgs[i - 1].sender_id === msg.sender_id;
        const name = escHtml(chatGetSenderName(msg.sender_id));
        const time = chatFormatTime(msg.created_at);
        const content = escHtml(msg.content);
        html += `<div class="chatExtMsg${isOwn ? " chatExtMsg--own" : ""}">`;
        if (!isSameAuthor) {
          html += `<div class="chatExtMsgMeta"><span class="chatExtMsgName">${name}</span><span>${time}</span></div>`;
        }
        html += `<div class="chatExtBubble">${content}</div></div>`;
      }
    }
    const wasAtBottom = chatExtMessagesEl.scrollHeight - chatExtMessagesEl.scrollTop - chatExtMessagesEl.clientHeight < 60;
    chatExtMessagesEl.innerHTML = html;
    if (wasAtBottom) chatExtMessagesEl.scrollTop = chatExtMessagesEl.scrollHeight;
  }

  async function fetchChatMessages(_silent = false) {
    try {
      const payload = await chrome.runtime.sendMessage({ type: "CHAT_FETCH" });
      if (!payload?.ok) return;
      if (payload.userId) chatMyUserId = payload.userId;
      chatMessages = Array.isArray(payload.messages) ? payload.messages : [];
      renderChatMessages();
      updateChatBadge(0);
    } catch { /* ignore */ }
  }

  async function fetchChatUnread() {
    try {
      const payload = await chrome.runtime.sendMessage({ type: "CHAT_UNREAD" });
      updateChatBadge(Number(payload?.count) || 0);
    } catch { /* ignore */ }
  }

  function updateChatBadge(count) {
    if (!navBadgeChat) return;
    if (count > 0) {
      navBadgeChat.style.display = "grid";
      navBadgeChat.textContent = count > 99 ? "99+" : String(count);
    } else {
      navBadgeChat.style.display = "none";
    }
  }

  async function sendChatMessage(content) {
    if (!content.trim()) return;
    if (chatExtSendBtn) chatExtSendBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "CHAT_SEND", content: content.trim() });
      await fetchChatMessages(true);
    } catch { /* ignore */ }
    finally {
      if (chatExtSendBtn) chatExtSendBtn.disabled = !chatExtInputEl?.value?.trim();
    }
  }

  function startChatPoll() {
    if (chatPollInterval) clearInterval(chatPollInterval);
    if (chatUnreadInterval) { clearInterval(chatUnreadInterval); chatUnreadInterval = null; }
    void fetchChatMessages();
    chatPollInterval = setInterval(() => void fetchChatMessages(true), 4000);
  }

  function stopChatPoll() {
    if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  }

  function startChatUnreadPoll() {
    if (chatUnreadInterval) return;
    void fetchChatUnread();
    chatUnreadInterval = setInterval(() => void fetchChatUnread(), 30000);
  }

  function stopChatUnreadPoll() {
    if (chatUnreadInterval) { clearInterval(chatUnreadInterval); chatUnreadInterval = null; }
  }

  // ================= NOTIFICATIONS =================
  let notifDropdownOpen = false;

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatNotifTime(iso) {
    if (!iso) return "";
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function renderNotifications(notifs) {
    if (!notifExtListEl) return;
    const unreadBadgeEl = $("notifUnreadBadge");
    if (!notifs || !notifs.length) {
      notifExtListEl.innerHTML = `<div class="notifExtEmpty">
        <svg class="notifExtEmptyIcon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6z"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>
        <div class="notifExtEmptyTitle">All caught up!</div>
        <div class="notifExtEmptySub">No notifications yet</div>
      </div>`;
      if (unreadBadgeEl) unreadBadgeEl.style.display = "none";
      return;
    }
    const dotColors = { danger: "#ef4444", warning: "#f59e0b", success: "#10b981", info: "#3b82f6" };
    const pillColors = { danger: "rgba(239,68,68,0.12)", warning: "rgba(245,158,11,0.12)", success: "rgba(16,185,129,0.12)", info: "rgba(59,130,246,0.12)" };
    const unreadCount = notifs.filter(n => !n.read).length;
    if (unreadBadgeEl) {
      unreadBadgeEl.textContent = unreadCount;
      unreadBadgeEl.style.display = unreadCount > 0 ? "inline-block" : "none";
    }
    notifExtListEl.innerHTML = notifs.map(n => {
      const dot = dotColors[n.type] || "#3b82f6";
      const pill = pillColors[n.type] || "rgba(59,130,246,0.12)";
      const ago = formatNotifTime(n.created_at);
      const hasLink = !!n.action_url;
      return `<div class="notifExtItem${n.read ? "" : " notifExtItem--unread"}${hasLink ? " notifExtItem--link" : ""}" data-action-url="${hasLink ? escapeHtml(n.action_url) : ""}">
        <div class="notifExtPill" style="background:${pill}">
          <span class="notifExtDot" style="background:${dot}"></span>
        </div>
        <div class="notifExtBody">
          <div class="notifExtItemTitle${n.read ? "" : " notifExtItemTitle--unread"}">${escapeHtml(n.title)}</div>
          ${n.message ? `<div class="notifExtMsg">${escapeHtml(n.message)}</div>` : ""}
          <div class="notifExtMeta">
            <span class="notifExtTime">${ago}</span>
            ${hasLink ? `<span class="notifExtLink">View →</span>` : ""}
          </div>
        </div>
        ${!n.read ? `<span class="notifExtUnreadDot" style="background:${dot}"></span>` : ""}
      </div>`;
    }).join("");

    // Wire click handlers for items with action_url
    notifExtListEl.querySelectorAll(".notifExtItem--link").forEach(el => {
      el.addEventListener("click", () => {
        const url = el.getAttribute("data-action-url");
        if (url) { chrome.tabs.create({ url: `${SAAS_APP_URL}${url}`, active: true }); }
      });
    });
  }

  function updateNotifBadge(count) {
    if (!navBadgeNotif) return;
    if (count > 0) {
      navBadgeNotif.style.display = "grid";
      navBadgeNotif.textContent = count > 99 ? "99+" : String(count);
    } else {
      navBadgeNotif.style.display = "none";
    }
  }

  function openNotifDropdown() {
    if (!notifDropdownEl) return;
    notifDropdownOpen = true;
    notifDropdownEl.style.display = "flex";
    notifDropdownEl.style.flexDirection = "column";
    void fetchNotifications();
    void markNotifsRead();
  }

  function closeNotifDropdown() {
    if (!notifDropdownEl) return;
    notifDropdownOpen = false;
    notifDropdownEl.style.display = "none";
  }

  async function fetchNotifications() {
    try {
      const payload = await chrome.runtime.sendMessage({ type: "NOTIF_FETCH" });
      if (!payload?.ok) return;
      renderNotifications(payload.notifications || []);
      updateNotifBadge(0);
    } catch { /* ignore */ }
  }

  async function fetchNotifUnread() {
    try {
      const payload = await chrome.runtime.sendMessage({ type: "NOTIF_FETCH" });
      if (!payload?.ok) return;
      const unread = (payload.notifications || []).filter(n => !n.read).length;
      updateNotifBadge(unread);
    } catch { /* ignore */ }
  }

  async function markNotifsRead() {
    try {
      await chrome.runtime.sendMessage({ type: "NOTIF_READ" });
      updateNotifBadge(0);
    } catch { /* ignore */ }
  }

  // ================= SUPPORT OVERLAY =================
  let supportOverlayEl = null;
  let supportActiveTab = "chat"; // "chat" | "tickets"
  let supportChatMessages = []; // { role, content }
  let supportThinking = false;
  let supportTicketsLoaded = false;

  const SUPPORT_WELCOME = "Hi! I'm your seoprospector assistant. How can I help you today? I can answer questions about the extension, quotas, billing, LinkedIn prospecting, and more.";

  function initSupportElements() {
    supportOverlayEl = $("supportOverlay");
  }

  function openSupportOverlay() {
    if (!supportOverlayEl) initSupportElements();
    supportOverlayEl.style.display = "flex";
    void supportOverlayEl.offsetHeight;
    supportOverlayEl.classList.add("open");
    // Init chat if first open
    if (supportChatMessages.length === 0) {
      supportChatMessages = [];
      renderSupportChat();
    }
    switchSupportTab("chat");
  }

  function closeSupportOverlay() {
    if (!supportOverlayEl) return;
    supportOverlayEl.classList.remove("open");
    setTimeout(() => {
      if (supportOverlayEl && !supportOverlayEl.classList.contains("open")) {
        supportOverlayEl.style.display = "";
      }
    }, 250);
  }

  function switchSupportTab(tab) {
    supportActiveTab = tab;
    const chatEl    = $("supportTabChat");
    const ticketsEl = $("supportTabTickets");
    const tabBtns   = supportOverlayEl ? supportOverlayEl.querySelectorAll(".supportExtTabBtn") : [];
    tabBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    const showEl = tab === "chat" ? chatEl : ticketsEl;
    const hideEl = tab === "chat" ? ticketsEl : chatEl;
    if (hideEl) hideEl.style.display = "none";
    if (showEl) {
      showEl.style.opacity = "0";
      showEl.style.display = "flex";
      requestAnimationFrame(() => {
        showEl.style.transition = "opacity 0.2s ease";
        showEl.style.opacity = "1";
      });
    }
    if (tab === "tickets" && !supportTicketsLoaded) void fetchSupportTickets();
  }

  function renderSupportChat() {
    const container = $("supportExtMessages");
    if (!container) return;
    const msgs = supportChatMessages;
    container.innerHTML = "";

    // Welcome message
    container.appendChild(makeSupportBubble("assistant", SUPPORT_WELCOME));

    msgs.forEach(m => container.appendChild(makeSupportBubble(m.role, m.content)));

    if (supportThinking) {
      const wrap = document.createElement("div");
      wrap.className = "supportExtMsg supportExtMsg--assistant";
      wrap.innerHTML = `
        <div class="supportExtBotAvatar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><path d="M5 14v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>
        </div>
        <div class="supportExtBubble supportExtBubble--typing"><span></span><span></span><span></span></div>`;
      container.appendChild(wrap);
    }
    container.scrollTop = container.scrollHeight;
  }

  function makeSupportBubble(role, content) {
    const wrap = document.createElement("div");
    wrap.className = `supportExtMsg supportExtMsg--${role}`;
    const bubble = document.createElement("div");
    bubble.className = "supportExtBubble";
    bubble.textContent = content;
    if (role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "supportExtBotAvatar";
      avatar.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><path d="M5 14v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>`;
      wrap.appendChild(avatar);
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  async function sendSupportChat() {
    const inputEl = $("supportExtInput");
    const sendBtn = $("btnSupportSend");
    const text = inputEl?.value?.trim() || "";
    if (!text || supportThinking) return;
    inputEl.value = "";
    if (sendBtn) sendBtn.disabled = true;
    supportChatMessages.push({ role: "user", content: text });
    supportThinking = true;
    renderSupportChat();
    try {
      const acct = snapshot?.account || {};
      const userCtx = {
        email:     String(acct.email   || ""),
        plan:      String(acct.plan    || "FREE").toUpperCase(),
        status:    String(acct.status  || "ACTIVE").toUpperCase(),
        usage:     { scans: Number(acct.usage?.profiles_scanned  || acct.usageScans   || 0), seo: Number(acct.usage?.seo_exports || acct.usageSeo || 0), messages: Number(acct.usage?.messages_generated || acct.usageMessages || 0) },
        limits:    { scans: Number(acct.limits?.profiles_scanned || acct.limitScans   || 0), seo: Number(acct.limits?.seo_exports || acct.limitSeo || 0), messages: Number(acct.limits?.messages_generated || acct.limitMessages || 0) },
        remaining: { scans: 0, seo: 0, messages: 0 },
        nextReset: String(acct.quota_reset_at || acct.nextResetAt || ""),
      };
      // Only send last 10 messages to avoid payload size issues
      const history = supportChatMessages.slice(-10);
      const res = await chrome.runtime.sendMessage({ type: "SUPPORT_CHAT", messages: history, userContext: userCtx });
      if (res?.ok && res?.answer) {
        supportChatMessages.push({ role: "assistant", content: res.answer });
      } else {
        const errCode = res?.error || "unknown";
        throw new Error(String(errCode));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      const friendlyErr = msg === "NO_TOKEN"
        ? "Please reconnect your account in the extension settings."
        : msg === "AI_UNAVAILABLE" || msg === "503"
        ? "The AI service is temporarily unavailable. Please try again in a moment."
        : "Sorry, I'm having trouble connecting right now. Please try again or create a support ticket.";
      supportChatMessages.push({ role: "assistant", content: friendlyErr });
    }
    supportThinking = false;
    renderSupportChat();
    if (sendBtn && inputEl) sendBtn.disabled = !inputEl.value.trim();
  }

  function renderSupportTickets(tickets) {
    const el = $("supportTabTickets");
    if (!el) return;
    supportTicketsLoaded = true;
    if (!tickets || !tickets.length) {
      el.innerHTML = `<div class="supportEmptyState">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>No tickets yet.</span>
        <button class="btn sm" onclick="document.getElementById('supportExtModalOverlay').style.display='flex'" style="font-size:11px;margin-top:4px;">Create your first ticket</button>
      </div>`;
      return;
    }
    const statusLabel = { open: "Open", in_progress: "In progress", closed: "Closed" };
    el.innerHTML = tickets.map(t => {
      const badge = `ticketBadge--${t.status || "open"}`;
      const label = statusLabel[t.status] || t.status;
      const date  = t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
      return `<div class="supportTicketItem" data-ticket-id="${escapeHtml(t.id)}">
        <div class="supportTicketSubject">${escapeHtml(t.subject || "")}</div>
        <div class="supportTicketMeta">
          <span class="ticketBadge ${badge}">${escapeHtml(label)}</span>
          <span class="supportTicketDate">${escapeHtml(date)}</span>
        </div>
      </div>`;
    }).join("");
    el.querySelectorAll(".supportTicketItem[data-ticket-id]").forEach(item => {
      item.addEventListener("click", () => {
        const id = item.dataset.ticketId;
        if (id) chrome.tabs.create({ url: `${SAAS_APP_URL}/support/${id}`, active: true });
      });
    });
  }

  function openSupportModal() {
    const modal = $("supportExtModalOverlay");
    if (!modal) return;
    modal.style.display = "flex";
    const subjectEl = $("supportSubjectInput");
    const msgEl     = $("supportMessageInput");
    const errorEl   = $("supportFormError");
    if (subjectEl) subjectEl.value = "";
    if (msgEl)     msgEl.value     = "";
    if (errorEl)   errorEl.style.display = "none";
  }

  function closeSupportModal() {
    const modal = $("supportExtModalOverlay");
    if (modal) modal.style.display = "none";
  }

  /* ================= TEAM STATS ================= */
  async function loadTeamStats() {
    const listEl = $("teamMembersList");
    const loadingEl = $("teamStatsLoading");
    if (!listEl) return;
    if (loadingEl) loadingEl.style.display = "";

    const res = await chrome.runtime.sendMessage({ type: "TEAM_STATS_FETCH" });
    if (loadingEl) loadingEl.style.display = "none";

    if (!res?.ok || !Array.isArray(res.members)) {
      listEl.innerHTML = `<div class="teamStatsLoading">${t("team.loadError") || "Failed to load team stats."}</div>`;
      return;
    }

    // month label
    const metaEl = $("teamStatsMeta");
    if (metaEl && res.month) metaEl.textContent = res.month;

    // clear previous cards (keep loading el)
    Array.from(listEl.children).forEach(c => { if (c !== loadingEl) c.remove(); });

    const currentEmail = String(snapshot?.account?.email || "").trim().toLowerCase();

    // Put the connected user's card first
    const members = [...res.members].sort((a, b) => {
      const aMe = currentEmail && String(a.email || "").toLowerCase() === currentEmail ? -1 : 0;
      const bMe = currentEmail && String(b.email || "").toLowerCase() === currentEmail ? -1 : 0;
      return aMe - bMe;
    });

    const maxLeads = Math.max(1, ...members.map(m => m.leads?.total || 0));

    for (const member of members) {
      const leads = member.leads || { total: 0, HOT: 0, WARM: 0, COLD: 0 };
      const isOwner = member.teamRole === "OWNER";
      const displayName = member.fullName || member.email || "User";
      const nameParts = displayName.trim().split(/\s+/);
      const initials = nameParts.length >= 2
        ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
        : (nameParts[0] || "?").slice(0, 2).toUpperCase();

      const card = document.createElement("div");
      card.className = `teamMemberCard ${isOwner ? "is-owner" : "is-member"}`;

      // Header
      const head = document.createElement("div");
      head.className = "teamMemberCardHead";

      const avatar = document.createElement("span");
      avatar.className = "teamMemberAvatar";
      applyInitialsAvatar(avatar, initials, displayName);

      const info = document.createElement("div");
      info.className = "teamMemberInfo";
      const nameEl = document.createElement("div");
      nameEl.className = "teamMemberName";
      nameEl.textContent = displayName;
      const emailEl = document.createElement("div");
      emailEl.className = "teamMemberEmail";
      emailEl.textContent = member.email || "";
      info.appendChild(nameEl);
      info.appendChild(emailEl);

      const isMe = currentEmail && String(member.email || "").toLowerCase() === currentEmail;
      const badge = document.createElement("span");
      badge.className = `teamMemberRoleBadge ${isOwner ? "owner" : "member"}`;
      badge.textContent = isOwner ? "Owner" : "Member";

      head.appendChild(avatar);
      head.appendChild(info);
      if (isMe) {
        const youBadge = document.createElement("span");
        youBadge.className = "teamMemberYouBadge";
        youBadge.textContent = "You";
        head.appendChild(youBadge);
      }
      head.appendChild(badge);

      // Lead bars
      const bars = document.createElement("div");
      bars.className = "teamLeadBars";
      for (const [type, color] of [["HOT", "hot"], ["WARM", "warm"], ["COLD", "cold"]]) {
        const count = leads[type] || 0;
        const pct = maxLeads > 0 ? Math.round((count / maxLeads) * 100) : 0;
        const row = document.createElement("div");
        row.className = "teamLeadBarRow";
        row.innerHTML = `
          <span class="teamLeadBarLabel ${color}">${type}</span>
          <div class="teamLeadBarTrack"><div class="teamLeadBarFill ${color}" style="width:${pct}%"></div></div>
          <span class="teamLeadBarCount">${count}</span>`;
        bars.appendChild(row);
      }

      // Footer stats
      const stats = document.createElement("div");
      stats.className = "teamMemberStats";
      stats.innerHTML = `
        <div class="teamMemberStat">
          <span class="teamMemberStatValue">${leads.total}</span>
          <span class="teamMemberStatLabel">${t("team.totalLeads") || "Leads"}</span>
        </div>
        <div class="teamMemberStat">
          <span class="teamMemberStatValue">${member.scansThisMonth || 0}</span>
          <span class="teamMemberStatLabel">${t("team.scansMonth") || "Scans / mo"}</span>
        </div>`;

      card.appendChild(head);
      if (leads.total > 0) card.appendChild(bars);
      card.appendChild(stats);
      listEl.appendChild(card);
    }
  }

  async function fetchSupportTickets() {
    const el = $("supportTabTickets");
    try {
      const res = await chrome.runtime.sendMessage({ type: "SUPPORT_FETCH" });
      if (!res?.ok) {
        if (el) el.innerHTML = `<div class="supportEmptyState">Failed to load tickets.</div>`;
        return;
      }
      renderSupportTickets(res.tickets || []);
    } catch {
      if (el) el.innerHTML = `<div class="supportEmptyState">Failed to load tickets.</div>`;
    }
  }

  async function submitSupportTicket() {
    const subjectEl = $("supportSubjectInput");
    const messageEl = $("supportMessageInput");
    const errorEl   = $("supportFormError");
    const submitBtn = $("btnSupportSubmit");
    const subject = subjectEl?.value?.trim() || "";
    const message = messageEl?.value?.trim() || "";
    if (!subject || !message) {
      if (errorEl) { errorEl.textContent = "Please fill in both fields."; errorEl.style.display = ""; }
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }
    if (errorEl) errorEl.style.display = "none";
    try {
      const res = await chrome.runtime.sendMessage({ type: "SUPPORT_CREATE", subject, message });
      if (!res?.ok) throw new Error("create failed");
      closeSupportModal();
      supportTicketsLoaded = false;
      switchSupportTab("tickets");
    } catch {
      if (errorEl) { errorEl.textContent = "Failed to send. Please try again."; errorEl.style.display = ""; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Send ticket"; }
    }
  }

  function startNotifUnreadPoll() {
    if (notifUnreadInterval) return;
    void fetchNotifUnread();
    notifUnreadInterval = setInterval(() => void fetchNotifUnread(), 60000);
  }

  function stopNotifUnreadPoll() {
    if (notifUnreadInterval) { clearInterval(notifUnreadInterval); notifUnreadInterval = null; }
  }

  /* ================= ROUTING ================= */
  function goToRoute(route) {
    if (!_isLoggedIn) return;
    closeTeamOverlay();
    closeSupportOverlay();
    menuItems.forEach(b => b.classList.toggle("active", b.dataset.route === route));
    routes.forEach(r => r.classList.toggle("active", r.id === `route-${route}`));

    const titleEl = $("routeTitle");
    if (titleEl) titleEl.textContent = t(`route.${route}`);

    if (route !== "scan") {
      setScanAssistantOpen(false);
    }
    if (route !== "leads") {
      overrideEditorProfileUrl = null;
    }
    // Always fully reset drawer state on navigation — drawer must not reopen on return
    closeDetailDrawer();
    selectedLead = null;
    selectedLeadProfileUrl = null;
    overrideEditorProfileUrl = null;
    clearSeoLeadSelection();
    hideLeadChooser();

    // Keep route-specific selectors/cards visually in sync after programmatic navigation.
    if (route === "leads") renderLeads();
    if (route === "seo") renderSeoList();
    if (route === "messages") renderMessageSelectors();
    if (route === "scan") queueSyncAssistantNotchPosition();
    if (route === "chat") startChatPoll();
    else stopChatPoll();

    // Stagger animation on route enter
    const activeRoute = document.getElementById(`route-${route}`);
    if (activeRoute) {
      activeRoute.classList.remove("route-entering");
      void activeRoute.offsetHeight;
      activeRoute.classList.add("route-entering");
    }
  }

  menuItems.forEach(btn => {
    btn.addEventListener("click", () => goToRoute(btn.dataset.route));
  });

  /* ================= PORT ================= */
  function connectPort() {
    port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
    port.onMessage.addListener(onPortMessage);

    port.onDisconnect.addListener(() => {
      console.warn("[PANEL] Port disconnected, retryingâ€¦");
      setTimeout(connectPort, 800);
    });

    port.postMessage({ type: "REQ_SNAPSHOT" });
  }

  function onPortMessage(msg) {
    if (!msg?.type) return;

    if (msg.type === "SNAPSHOT") {
      snapshot = msg.snapshot;
      if (selectedLeadProfileUrl) {
        selectedLead = findLeadByProfileUrl(selectedLeadProfileUrl);
      }
      if (selectedSeoProfileUrl) {
        selectedSeoLead = findLeadByProfileUrl(selectedSeoProfileUrl);
      }
      renderAll();
      return;
    }

    if (msg.type === "LOG_APPENDED") {
      if (snapshot?.logs) snapshot.logs.push(msg.entry);
      appendLog(msg.entry);
      renderMenuBadges();
      return;
    }

    if (msg.type === "LEAD_ADDED") {
      if (!snapshot) return;

      snapshot.leads = snapshot.leads || [];
      const idx = snapshot.leads.findIndex((l) => l.profileUrl === msg.lead.profileUrl);
      if (idx >= 0) snapshot.leads[idx] = msg.lead;
      else snapshot.leads.unshift(msg.lead);
      snapshot.leadStats = msg.stats;
      snapshot.leadsCount = (snapshot.leadsCount || 0) + 1;

      if (selectedLeadProfileUrl) {
        selectedLead = findLeadByProfileUrl(selectedLeadProfileUrl);
      }
      if (selectedSeoProfileUrl) {
        selectedSeoLead = findLeadByProfileUrl(selectedSeoProfileUrl);
      }

      // keep realtime refresh consistent
      renderLeads();
      renderSeoList();
      renderMessageSelectors();
      renderDashboard();
      renderMenuBadges();
      return;
    }
  }

  /* ================= HELPERS ================= */

  function getDecisionObj(lead) {
    if (lead?.decision && typeof lead.decision === "object") {
      return lead.decision;
    }

    // Fallback legacy (temporaire)
    return {
      final: lead?.action || "UNDECIDED",
      confidence: lead?.confidence || "LOW",
      reason: lead?.reason || lead?.detectedHeadline || "Decision based on legacy signals",
      painBusiness: lead?.painBusiness || "UNKNOWN",
      signals: {
        role: lead?.role || "UNKNOWN",
        seo: lead?.seoOpportunity || "UNKNOWN",
        siteType: "UNKNOWN",
        jsHeavy: false
      },
      rulesFired: ["LEGACY_FALLBACK"],
      engineVersion: "LEGACY"
    };
  }

  // âœ… UI-FIRST: toujours lire l.ui.* en prioritÃ©, sinon fallback propre
  function getUiObj(lead) {
    // ===============================
    // 1ï¸âƒ£ SOURCE CANONIQUE â€” lead.ui
    // ===============================
// ================= NO ACTIVE POSITION UI =================
if (lead?.skippedReason === "NO_ACTIVE_POSITION") {
  return {
    seoBadge: `🚫 ${t("leads.badge.noActivePosition")}`,
    seoColor: "gray",
    seoEmoji: "🚫",
    seoLabel: currentLang === "fr" ? "Aucun poste actif" : "No active job",

    actionLabel: "SKIPPED",
    actionEmoji: "â›”",

    role: "N/A",
    detectedHeadline: lead.headline || "",

    confidence: lead.ui?.confidence || "MEDIUM",
    painBusiness: "UNKNOWN",
    reason: lead.ui?.reason || (currentLang === "fr" ? "Aucune expérience active détectée" : "No active experience detected"),
  };
}


    if (lead?.ui && typeof lead.ui === "object") {
      const ui = lead.ui;

      return {
        seoBadge: ui.seoBadge ?? "SEO: UNKNOWN",
        seoColor: ui.seoColor ?? "gray",
        seoEmoji: ui.seoEmoji ?? "â“",
        seoLabel: ui.seoLabel ?? "",

        actionLabel: ui.actionLabel ?? "UNDECIDED",
        actionEmoji: ui.actionEmoji ?? "â¸ï¸",

        role: ui.role ?? "UNKNOWN",
        detectedHeadline: ui.detectedHeadline ?? "",

        confidence: ui.confidence ?? "LOW",
        painBusiness: ui.painBusiness ?? "UNKNOWN",
        reason: ui.reason ?? ""
      };
    }

    // =================================================
    // 2ï¸âƒ£ FALLBACK STRUCTURÃ‰ â€” lead.opportunities[].ui
    // =================================================
    if (Array.isArray(lead?.opportunities) && lead.opportunities.length > 0) {
      // prioritÃ© HOT > WARM > first
      const opp =
        lead.opportunities.find(o => o.leadType === "HOT_LEAD") ||
        lead.opportunities.find(o => o.leadType === "WARM_LEAD") ||
        lead.opportunities[0];

      if (opp?.ui && typeof opp.ui === "object") {
        const ui = opp.ui;

        return {
          seoBadge: ui.seoBadge ?? "SEO: UNKNOWN",
          seoColor: ui.seoColor ?? "gray",
          seoEmoji: ui.seoEmoji ?? "â“",
          seoLabel: ui.seoLabel ?? "",

          actionLabel: ui.actionLabel ?? "UNDECIDED",
          actionEmoji: ui.actionEmoji ?? "â¸ï¸",

          role: ui.role ?? "UNKNOWN",
          detectedHeadline: ui.detectedHeadline ?? "",

          confidence: ui.confidence ?? "LOW",
          painBusiness: ui.painBusiness ?? "UNKNOWN",
          reason: ui.reason ?? ""
        };
      }
    }

    // =========================================
    // 3ï¸âƒ£ DERNIER RECOURS â€” decision (legacy)
    // =========================================
    const d = getDecisionObj(lead);

    return {
      seoBadge: "SEO: UNKNOWN",
      seoColor: "gray",
      seoEmoji: "â“",
      seoLabel: "SEO non Ã©valuÃ©",

      actionLabel: String(d?.final || "UNDECIDED").replaceAll("_", " "),
      actionEmoji: "â¸ï¸",

      role: d?.signals?.role || "UNKNOWN",
      detectedHeadline: d?.detectedHeadline || "",

      confidence: d?.confidence || "LOW",
      painBusiness: d?.painBusiness || "UNKNOWN",
      reason: d?.reason || "UI missing â€” legacy fallback"
    };
  }


  function safeText(x) {
    return (x === null || x === undefined) ? "" : String(x);
  }

  function getUiLanguage() {
    return currentLang || "en";
  }


  function clampText(text, max = 80) {
  if (!text) return "";
  const s = String(text);
  return s.length > max ? s.slice(0, max - 1) + "â€¦" : s;
}


  function normalizeLeadType(x) {
    const v = String(x || "").toUpperCase();
    if (v.includes("HOT")) return "HOT";
    if (v.includes("WARM")) return "WARM";
    if (v.includes("COLD")) return "COLD";
    return "UNCLASSIFIED";
  }

  // legacy helpers kept (export / compatibility)
  function normalizeSeoLabel(lead) {
    const raw = (lead?.seoLabel || lead?.seoOpportunity || lead?.seoBadge || "").toUpperCase();
    if (raw.includes("CRITICAL")) return { label: "SEO: CRITICAL", cls: "badgeMini badge_bad" };
    if (raw.includes("WEAK")) return { label: "SEO: WEAK", cls: "badgeMini badge_warn" };
    if (raw.includes("OK")) return { label: "SEO: OK", cls: "badgeMini badge_good" };
    return { label: "SEO: UNKNOWN", cls: "badgeMini" };
  }

  function normalizeRole(lead) {
    const raw = (lead?.role || "").toUpperCase();
    if (!raw) return { label: "ROLE: UNKNOWN", cls: "badgeMini" };
    if (raw.includes("DECISION") || raw.includes("CEO") || raw.includes("FOUNDER")) {
      return { label: "ROLE: DECISION MAKER", cls: "badgeMini badge_good" };
    }
    if (raw.includes("MARKETING")) return { label: "ROLE: MARKETING", cls: "badgeMini" };
    if (raw.includes("SALES")) return { label: "ROLE: SALES", cls: "badgeMini" };
    return { label: `ROLE: ${raw}`, cls: "badgeMini" };
  }

  function isActionable(lead) {
    const ui = getUiObj(lead);
    return ["CONTACT NOW", "CONTACT SOFT", "FIND DECISION MAKER"]
      .some(k => String(ui.actionLabel || "").toUpperCase().includes(k));
  }


  function downloadBlob(filename, content, mime = "text/plain") {
    let finalContent = content;
    if (
      typeof finalContent === "string" &&
      String(mime || "").toLowerCase().includes("csv") &&
      !finalContent.startsWith("\ufeff")
    ) {
      finalContent = `\ufeff${finalContent}`;
    }
    const blob = new Blob([finalContent], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function toCsvRow(values) {
    return values
      .map(v => {
        const s = safeText(v);
        const escaped = s.replaceAll('"', '""');
        return `"${escaped}"`;
      })
      .join(",");
  }

  function toCsvRowWithDelimiter(values, delimiter = ",") {
    const d = String(delimiter || ",");
    return values
      .map((v) => {
        const s = safeText(v);
        const escaped = s.replaceAll('"', '""');
        return `"${escaped}"`;
      })
      .join(d);
  }

  function isoDateForFile() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function findLeadByProfileUrl(profileUrl) {
    if (!snapshot?.leads?.length || !profileUrl) return null;
    return snapshot.leads.find((l) => l.profileUrl === profileUrl) || null;
  }

  function getPrimaryOpp(lead) {
    const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
    // HOT first, then WARM, then PRIMARY flag, then first
    return opps.find((o) => normalizeLeadType(o?.leadType || "") === "HOT")
        || opps.find((o) => normalizeLeadType(o?.leadType || "") === "WARM")
        || opps.find((o) => o.opportunityStatus === "PRIMARY")
        || opps[0]
        || null;
  }

  function getMostCriticalOpp(lead) {
    const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
    if (!opps.length) return null;
    const urgency = { CRITICAL: 0, SITE_UNREACHABLE: 0, WEAK: 1, NO_WEBSITE: 1, OK: 2 };
    return opps.slice().sort((a, b) => {
      const cA = String(a.ui?._seoCode || a.seoLevel || "").toUpperCase();
      const cB = String(b.ui?._seoCode || b.seoLevel || "").toUpperCase();
      const uA = urgency[cA] ?? 3;
      const uB = urgency[cB] ?? 3;
      if (uA !== uB) return uA - uB;
      const sA = typeof a.rawScore === "number" ? a.rawScore : 999;
      const sB = typeof b.rawScore === "number" ? b.rawScore : 999;
      return sA - sB;
    })[0] || getPrimaryOpp(lead);
  }

  function getOpportunityLabel(opp, max = 24) {
    const base = sanitizeLeadName(opp?.company || opp?.jobTitle || "") || (currentLang === "fr" ? "Inconnu" : "Unknown");
    return clampText(base, max);
  }

  function getOrderedOpportunities(lead) {
    const opps = Array.isArray(lead?.opportunities) ? lead.opportunities : [];
    if (!lead?.id || !opps.length) return opps;

    const existingOrder = opportunityOrderByLeadId.get(lead.id);
    if (!existingOrder?.length) {
      // Sort initial order: HOT first, then WARM, then others
      const typeRank = (o) => {
        const t = normalizeLeadType(o?.leadType || "");
        if (t === "HOT")  return 0;
        if (t === "WARM") return 1;
        return 2;
      };
      const sorted = [...opps].sort((a, b) => typeRank(a) - typeRank(b));
      const order = sorted.map((o) => o.id);
      opportunityOrderByLeadId.set(lead.id, order);
      return sorted;
    }

    const merged = [...existingOrder];
    for (const o of opps) {
      if (!merged.includes(o.id)) merged.push(o.id);
    }
    opportunityOrderByLeadId.set(lead.id, merged);
    return merged.map((id) => opps.find((o) => o.id === id)).filter(Boolean);
  }

  function getSelectedMessageContext() {
    const lead = findLeadByProfileUrl(selectedMsgLeadProfileUrl) || selectedLead;
    if (!lead) return { lead: null, opp: null };
    const ordered = getOrderedOpportunities(lead);
    const primary = getPrimaryOpp(lead);
    const opp =
      ordered.find((o) => o.id === selectedMsgOpportunityId) ||
      primary ||
      ordered[0] ||
      null;
    return { lead, opp };
  }

  function loadMessageDraftCache() {
    try {
      const raw = localStorage.getItem(MESSAGE_DRAFTS_STORAGE_KEY);
      if (!raw) {
        messageDraftCache = {};
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        messageDraftCache = parsed;
        return;
      }
    } catch {}
    messageDraftCache = {};
  }

  function persistMessageDraftCache() {
    try {
      const entries = Object.entries(messageDraftCache || {}).filter(
        ([k, v]) => Boolean(k) && v && typeof v === "object"
      );
      if (entries.length > 180) {
        entries.sort((a, b) => {
          const ta = Date.parse(String(a?.[1]?.updatedAt || "")) || 0;
          const tb = Date.parse(String(b?.[1]?.updatedAt || "")) || 0;
          return tb - ta;
        });
        messageDraftCache = Object.fromEntries(entries.slice(0, 180));
      }
      localStorage.setItem(MESSAGE_DRAFTS_STORAGE_KEY, JSON.stringify(messageDraftCache || {}));
    } catch {}
  }

  function getMessageContextKey(lead, opp = null) {
    if (!lead) return null;
    const leadKey = String(lead.profileUrl || lead.id || "").trim();
    if (!leadKey) return null;
    const oppId = String(opp?.id || getPrimaryOpp(lead)?.id || "primary").trim() || "primary";
    return `${leadKey}::${oppId}`;
  }

  function normalizeMessageVariants(variants = [], fallbackText = "") {
    const out = [];
    const seen = new Set();
    const pushVariant = (value) => {
      const text = String(value || "").replace(/\r\n/g, "\n").trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    };
    for (const item of Array.isArray(variants) ? variants : []) {
      if (typeof item === "string") {
        pushVariant(item);
      } else if (item && typeof item === "object") {
        pushVariant(item.text || item.message || item.content || item.variant || "");
      }
    }
    pushVariant(fallbackText);
    return out;
  }

  function getMessageDraft(contextKey) {
    if (!contextKey) return null;
    const raw = messageDraftCache?.[contextKey];
    if (!raw || typeof raw !== "object") return null;
    const variants = normalizeMessageVariants(raw.variants, raw.text || "");
    if (!variants.length && !String(raw.text || "").trim()) return null;
    let selectedVariant = Number(raw.selectedVariant);
    if (!Number.isFinite(selectedVariant)) selectedVariant = 0;
    selectedVariant = Math.max(0, Math.min(Math.max(0, variants.length - 1), selectedVariant));
    const text = String(raw.text || variants[selectedVariant] || variants[0] || "");
    return {
      text,
      variants,
      selectedVariant,
      generated: Boolean(raw.generated),
      source: String(raw.source || ""),
      updatedAt: String(raw.updatedAt || ""),
    };
  }

  function saveMessageDraft(contextKey, patch = {}) {
    if (!contextKey) return null;
    const current = getMessageDraft(contextKey) || {
      text: "",
      variants: [],
      selectedVariant: 0,
      generated: false,
      source: "",
      updatedAt: "",
    };
    const merged = {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
    };
    const variants = normalizeMessageVariants(merged.variants, merged.text || "");
    let selectedVariant = Number(merged.selectedVariant);
    if (!Number.isFinite(selectedVariant)) selectedVariant = 0;
    selectedVariant = Math.max(0, Math.min(Math.max(0, variants.length - 1), selectedVariant));
    const text = String(merged.text || variants[selectedVariant] || variants[0] || "");
    const next = {
      text,
      variants,
      selectedVariant,
      generated: Boolean(merged.generated),
      source: String(merged.source || ""),
      updatedAt: new Date().toISOString(),
    };
    messageDraftCache[contextKey] = next;
    persistMessageDraftCache();
    return next;
  }

  function clearMessageVariantSelector() { /* variant picker removed */ }
  function renderMessageVariantSelector(_contextKey) { /* variant picker removed */ }

  function updateSendButtonState() {
    if (!btnSendMsg) return;
    const account = snapshot?.account || {};
    const rawPlan = String(account.plan || "FREE").toUpperCase();
    const plan = rawPlan === "TRIAL" ? "FREE" : (rawPlan === "SCALE" ? "AGENCY" : rawPlan);
    const isFreePlan = plan === "FREE";
    const isTrial = isFreePlan && String(account.subscriptionStatus || "").toUpperCase() === "TRIALING";
    if (isFreePlan && !isTrial) {
      btnSendMsg.classList.add("btnHidden");
      return;
    }
    btnSendMsg.classList.remove("btnHidden");
    const { lead } = getSelectedMessageContext();
    const hasMessage = Boolean(String(messageBoxEl?.value || "").trim());
    const canSend = Boolean(lead?.profileUrl && hasMessage);
    btnSendMsg.disabled = !canSend;
  }

  function formatDateTime(x) {
    if (!x) return "—";
    try {
      return new Date(x).toLocaleString();
    } catch {
      return "—";
    }
  }

  function capitalizeNamePart(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function parseIdentityName(account = {}) {
    const identity = String(account.identity || "").trim();
    if (identity) {
      const parts = identity.split(/\s+/).filter(Boolean);
      return {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" "),
        fullName: parts.join(" "),
      };
    }
    const localPart = String(account.email || "").split("@")[0] || "";
    if (localPart) {
      const parts = localPart
        .replace(/[._-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map(capitalizeNamePart);
      return {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" "),
        fullName: parts.join(" "),
      };
    }
    return { firstName: "", lastName: "", fullName: "" };
  }

  // Windows-1252 special chars → byte values (for mojibake reversal)
  const _w1252 = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
  function sanitizeLeadName(str) {
    if (!str) return "";
    let s = String(str).trim();
    // Detect mojibake using char code checks (avoids invalid regex ranges)
    let isMojibake = false;
    for (let i = 0; i < s.length - 1 && !isMojibake; i++) {
      const c = s.charCodeAt(i);
      const n = s.charCodeAt(i + 1);
      // â (0xE2) + € (0x20AC) → 3-byte UTF-8 sequence misread as CP1252
      if (c === 0xE2 && n === 0x20AC) isMojibake = true;
      // Ã (0xC3) or Â (0xC2) + Latin-1 continuation char → 2-byte UTF-8 misread
      else if ((c === 0xC3 || c === 0xC2) && n >= 0x80 && n <= 0xBF) isMojibake = true;
    }
    if (isMojibake) {
      try {
        const bytes = new Uint8Array([...s].map(c => {
          const code = c.charCodeAt(0);
          return _w1252[code] !== undefined ? _w1252[code] : code <= 0xFF ? code : 0x3F;
        }));
        s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch { return ""; }
    }
    // Strip trailing ellipsis / truncation noise
    s = s.replace(/[\u2026\s]+$/, "").trim();
    if (!s) return "";
    return s;
  }

  function buildInitials(firstName, lastName, fallback = "AC") {
    const a = String(firstName || "").trim().charAt(0);
    const b = String(lastName || "").trim().charAt(0);
    const initials = `${a}${b}`.toUpperCase();
    if (initials) return initials;
    const alt = String(firstName || "").trim().slice(0, 2).toUpperCase();
    return alt || fallback;
  }

  function avatarHueForSeed(seed) {
    const s = String(seed || "account");
    let hash = 0;
    for (let i = 0; i < s.length; i += 1) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
  }

  function applyInitialsAvatar(el, initials, seed) {
    if (!el) return;
    const hue = avatarHueForSeed(seed || initials || "account");
    el.textContent = String(initials || "AC").toUpperCase();
    el.style.background = `hsl(${hue} 28% 40%)`;
  }

  function applyUserAvatar(el, avatarUrl, initials, seed) {
    if (!el) return;
    if (avatarUrl) {
      el.textContent = "";
      el.style.background = "transparent";
      let img = el.querySelector("img.userPhotoImg");
      if (!img) {
        img = document.createElement("img");
        img.className = "userPhotoImg";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";
        img.onerror = () => applyInitialsAvatar(el, initials, seed);
        el.appendChild(img);
      }
      img.src = avatarUrl;
    } else {
      const img = el.querySelector("img.userPhotoImg");
      if (img) img.remove();
      applyInitialsAvatar(el, initials, seed);
    }
  }

  function sanitizeSeatUser(row) {
    if (!row || typeof row !== "object") return null;
    const email = String(row.email || "").trim().toLowerCase();
    const firstNameRaw = String(row.firstName || "").trim();
    const lastNameRaw = String(row.lastName || "").trim();
    const fullNameRaw = String(row.fullName || `${firstNameRaw} ${lastNameRaw}`).trim();
    const parsedParts = fullNameRaw.split(/\s+/).filter(Boolean);
    const firstName = firstNameRaw || parsedParts[0] || "";
    const lastName = lastNameRaw || parsedParts.slice(1).join(" ");
    const fullName = String(fullNameRaw || `${firstName} ${lastName}`).trim();
    if (!fullName && !email) return null;
    return {
      email,
      firstName,
      lastName,
      fullName,
      teamRole: String(row.teamRole || "MEMBER").toUpperCase(),
      createdAt: row.createdAt || null,
    };
  }

  function getSeatUsersFromAccount(account = {}) {
    const source = Array.isArray(account.seatUsers) ? account.seatUsers : [];
    const users = [];
    const seen = new Set();
    for (const row of source) {
      const item = sanitizeSeatUser(row);
      if (!item) continue;
      const dedupeKey = item.email || item.fullName.toLowerCase();
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      users.push(item);
    }
    return users;
  }

  function getTeamPolicyFromAccount(account = {}, plan = "FREE") {
    const team = account?.team && typeof account.team === "object" ? account.team : {};
    const planCode = String(plan || "FREE").trim().toUpperCase();
    const isAgency = planCode === "AGENCY";
    const includedRaw = Number(team.includedUsers);
    const includedUsers = isAgency
      ? (
        Number.isFinite(includedRaw) && includedRaw > 0
          ? Math.max(1, Math.round(includedRaw))
          : 5
      )
      : 1;
    const addOnUsdRaw = Number(team.additionalSeatUsd);
    const additionalSeatUsd = isAgency
      ? (Number.isFinite(addOnUsdRaw) ? addOnUsdRaw : 19)
      : 0;
    const blockedStatuses = new Set(["EXPIRED", "CANCELED", "PAST_DUE"]);
    const billingActive = !blockedStatuses.has(String(account.subscriptionStatus || account.status || "").toUpperCase());
    const seatAddOnEnabled = billingActive && isAgency && (
      team.seatAddOnEnabled === true ||
      additionalSeatUsd > 0
    );
    return { includedUsers, additionalSeatUsd, seatAddOnEnabled, billingActive };
  }

  function renderSidebarSeatUsers(account = {}) {
    const currentEmail = String(account.email || "").trim().toLowerCase();

    // All seat members, excluding the logged-in user (already shown in bottom account button)
    const members = getSeatUsersFromAccount(account)
      .filter((x) => (x.email || "").toLowerCase() !== currentEmail)
      .map((x) => ({ ...x, owner: x.teamRole === "OWNER" }));

    if (!sidebarSeatUsersEl) return members.length + 1;

    sidebarSeatUsersEl.innerHTML = "";
    const popoverEl = $("sidebarMembersPopover");
    const chipLabelEl = $("sidebarMembersChipLabel");
    if (popoverEl) popoverEl.innerHTML = "";
    if (chipLabelEl) chipLabelEl.textContent = `${members.length} member${members.length !== 1 ? "s" : ""}`;

    for (const member of members) {
      const item = document.createElement("div");
      item.className = "sidebarSeatUser";

      const avatar = document.createElement("span");
      avatar.className = "sidebarSeatAvatar";
      applyInitialsAvatar(avatar, buildInitials(member.firstName, member.lastName, "U"), member.email || member.fullName);

      const name = document.createElement("span");
      name.className = "sidebarSeatName";
      name.textContent = member.firstName || member.fullName || "User";

      item.appendChild(avatar);
      item.appendChild(name);

      if (member.owner) {
        const ownerTag = document.createElement("span");
        ownerTag.className = "sidebarSeatOwnerTag";
        ownerTag.textContent = "Owner";
        item.appendChild(ownerTag);
      }

      sidebarSeatUsersEl.appendChild(item);

      // Also populate the compact popover
      if (popoverEl) {
        const pItem = document.createElement("div");
        pItem.className = "sidebarMembersPopoverItem";
        const pAvatar = document.createElement("span");
        pAvatar.className = "sidebarMembersPopoverAvatar";
        applyInitialsAvatar(pAvatar, buildInitials(member.firstName, member.lastName, "U"), member.email || member.fullName);
        const pName = document.createElement("span");
        pName.className = "sidebarMembersPopoverName";
        pName.textContent = member.firstName || member.fullName || "User";
        pItem.appendChild(pAvatar);
        pItem.appendChild(pName);
        if (member.owner) {
          const pBadge = document.createElement("span");
          pBadge.className = "sidebarMembersPopoverBadge owner";
          pBadge.textContent = "Owner";
          pItem.appendChild(pBadge);
        } else {
          const pBadge = document.createElement("span");
          pBadge.className = "sidebarMembersPopoverBadge member";
          pBadge.textContent = "Member";
          pItem.appendChild(pBadge);
        }
        popoverEl.appendChild(pItem);
      }
    }

    // +1 for the logged-in user (excluded from list but counts as a seat)
    return members.length + 1;
  }

  function toPct(used, limit) {
    const u = Number(used);
    const l = Number(limit);
    if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((u / l) * 100)));
  }

  function resolveUsageTone(used, limit) {
    const u = Number(used);
    const l = Number(limit);
    if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return "info";
    const remaining = Math.max(0, l - u);
    const goodThreshold = l >= 1500 ? 1500 : Math.ceil(l * 0.5);
    const warnThreshold = l >= 500 ? 500 : Math.ceil(l * 0.17);
    if (remaining >= goodThreshold) return "good";
    if (remaining > warnThreshold) return "warn";
    return "bad";
  }

  function applyQuotaBadgeTone(el, tone, extraClass = "") {
    if (!el) return;
    const mappedTone = tone === "good" || tone === "warn" || tone === "bad" ? tone : "info";
    const extra = String(extraClass || "").trim();
    el.className = `badge ${mappedTone}${extra ? ` ${extra}` : ""}`.trim();
  }

  function renderMonthlyScanBadges(usedRaw, limitRaw) {
    const used = Number(usedRaw || 0);
    const limit = Number(limitRaw || 0);
    const left = Math.max(0, limit - used);
    setTextSafe(todayCountEl, `${left}`);
    setTextSafe(dailyLimitLabelEl, t("scan.dailyProfiles", { limit }));

    const tone = resolveUsageTone(used, limit);
    applyQuotaBadgeTone(todayCountEl, tone, "sidebarUsageBadge");
    applyQuotaBadgeTone(dailyLimitLabelEl, tone, "scanLimitBadge");
  }

  function setBar(el, pct, tone = null) {
    if (!el) return;
    el.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
    el.classList.remove("bar-good", "bar-warn", "bar-bad");
    if (tone === "good" || tone === "warn" || tone === "bad") {
      el.classList.add(`bar-${tone}`);
    }
  }

  function canExportCsvFeature() {
    return snapshot?.account?.features?.exportCsv !== false;
  }

  function canViewFullSeoAudit() {
    return canExportCsvFeature();
  }

  function translatePassedItem(str, lang) {
    if (lang === "fr") return str;
    const s = String(str || "").trim();
    // Static map
    const map = {
      "Pas de noindex":                            "No noindex",
      "robots.txt présent":                        "robots.txt present",
      "Sitemap index multi-fichiers détecté":      "Multi-file sitemap index detected",
      "Sitemap référencé dans robots.txt":         "Sitemap referenced in robots.txt",
      "Canonical HTTPS défini":                    "Canonical HTTPS defined",
      "H1 unique présent":                         "H1 unique present",
      "HTTPS actif":                               "HTTPS active",
      "Viewport mobile présent":                   "Mobile viewport present",
      "Rendu côté serveur — crawlabilité optimale":"Server-side rendering — optimal crawlability",
      "Scripts <head> bien maîtrisés":             "Scripts in <head> well managed",
      "HSTS activé":                               "HSTS enabled",
      "X-Frame-Options défini":                    "X-Frame-Options defined",
      "Content-Security-Policy présent":           "Content-Security-Policy present",
      "X-Content-Type-Options défini":             "X-Content-Type-Options defined",
      "Favicon présent":                           "Favicon present",
      "Web App Manifest (PWA) présent":            "Web App Manifest (PWA) present",
      "Version AMP liée":                          "AMP version linked",
      "Lazy loading images activé":                "Lazy loading images active",
      "og:image présent":                          "og:image present",
      "Hreflang: internationalisation active":     "Hreflang: international targeting active",
    };
    if (map[s]) return map[s];
    // Dynamic patterns
    return s
      .replace(/^Sitemap XML présent — (\d+) URL\(s\) détectée\(s\)$/, "Sitemap XML present — $1 URL(s) detected")
      .replace(/^Title OK — (\d+) car\.$/, "Title OK — $1 chars.")
      .replace(/^Meta description OK — (\d+) car\.$/, "Meta description OK — $1 chars.")
      .replace(/^(\d+) H2(?:, (\d+) H3)? détectés$/, (_, h2, h3) => h3 ? `${h2} H2, ${h3} H3 detected` : `${h2} H2 detected`)
      .replace(/^Contenu estimé: ~(\d+) mots$/, "Estimated content: ~$1 words")
      .replace(/^Alt text complet — (\d+) images$/, "Complete alt text — $1 images")
      .replace(/^robots\.txt présent(.*)$/, (_, rest) => `robots.txt present${rest.replace("règle(s) Disallow", "Disallow rule(s)")}`)
      .replace(/^Schema Product\/Offer détecté — bon pour le rich snippet e-commerce$/, "Schema Product/Offer detected — good for e-commerce rich snippet")
      .replace(/^BreadcrumbList Schema détecté$/, "BreadcrumbList Schema detected");
  }

  function humanizeAuditToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const token = normalizeFilterToken(raw);
    if (!token) return raw;
    return token
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function localizeAuditWebsiteStatus(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const token = normalizeFilterToken(raw);
    if (!token) return raw;
    if (/\bNO[\s_]*WEBSITE\b|\bNO[\s_]*SITE\b|\bMISSING\b|\bABSENT\b/.test(token)) {
      return currentLang === "fr" ? "Aucun site detecte" : "No website detected";
    }
    if (/\bUNREACHABLE\b|\bINACCESSIBLE\b|\bDOWN\b|\bTIMEOUT\b/.test(token)) {
      return currentLang === "fr" ? "Site inaccessible" : "Website unreachable";
    }
    if (/\bOK\b|\bUP\b|\bLIVE\b|\bREACHABLE\b/.test(token)) {
      return currentLang === "fr" ? "Site accessible" : "Website reachable";
    }
    return humanizeAuditToken(raw);
  }

  function localizeAuditSiteType(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const token = normalizeFilterToken(raw);
    if (!token) return raw;
    if (/\bJS[\s_]*HEAVY\b/.test(token)) {
      return currentLang === "fr" ? "Site JS lourd" : "JS-heavy site";
    }
    if (/\bNO[\s_]*WEBSITE\b|\bNO[\s_]*SITE\b/.test(token)) {
      return currentLang === "fr" ? "Aucun site" : "No website";
    }
    return humanizeAuditToken(raw);
  }

  function normalizeAuditIssues(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    for (const item of input) {
      if (typeof item === "string") {
        const value = item.trim();
        if (value) out.push({ msg: humanizeAuditToken(value), severity: "info" });
        continue;
      }
      if (item && typeof item === "object") {
        const candidate = item.msg || item.label || item.issue || item.code || item.key || item.type;
        const value = String(candidate || "").trim();
        if (value) out.push({ msg: humanizeAuditToken(value), severity: item.severity || "info" });
      }
    }
    return out.filter(x => x.msg);
  }

  function buildSeoAuditSnapshot(lead, opportunity = null) {
    const chosenOpp = (opportunity && typeof opportunity === "object")
      ? opportunity
      : getPrimaryOpp(lead);
    const decision = getDecisionObj(lead) || {};
    const signals = (decision?.signals && typeof decision.signals === "object")
      ? decision.signals
      : {};
    const ui = getUiDisplay(
      lead,
      chosenOpp?.ui && typeof chosenOpp.ui === "object" ? chosenOpp.ui : null
    );

    const rawScore = chosenOpp?.rawScore ?? signals?.rawScore;
    const score = Number.isFinite(Number(rawScore))
      ? Math.max(0, Math.round(Number(rawScore)))
      : null;

    const websiteStatusRaw = chosenOpp?.websiteStatus ?? signals?.websiteStatus ?? lead?.websiteStatus ?? "";
    const siteTypeRaw = chosenOpp?.siteType ?? signals?.siteType ?? lead?.siteType ?? "";
    const sourceRaw = chosenOpp?.seoSource ?? signals?.seoSource ?? "";
    const issues = normalizeAuditIssues(chosenOpp?.seoIssues ?? signals?.seoIssues);
    const seoPassed = Array.isArray(chosenOpp?.seoPassed) ? chosenOpp.seoPassed
      : (Array.isArray(signals?.seoPassed) ? signals.seoPassed : []);
    const bestPractices = chosenOpp?.bestPractices ?? signals?.bestPractices ?? null;
    const gatheredAt = chosenOpp?.gatheredAt ?? signals?.gatheredAt ?? null;
    const reason = String(chosenOpp?.reason || decision?.reason || ui?.reason || "").trim();

    const uiRaw = chosenOpp?.ui ?? signals ?? {};
    const mobilePerf  = uiRaw.mobilePerf  ?? null;
    const mobileA11y  = uiRaw.mobileA11y  ?? null;
    const psSeoScore  = uiRaw.psSeoScore  ?? null;
    const lcpMs       = uiRaw.lcpMs       ?? null;
    const clsScore    = uiRaw.clsScore    ?? null;
    const fcpMs       = uiRaw.fcpMs       ?? null;
    const tbtMs       = uiRaw.tbtMs       ?? null;
    const cwvDelta    = uiRaw.cwvDelta    ?? null;

    const websiteRaw = chosenOpp?.website ?? signals?.website ?? lead?.website ?? "";
    const companyRaw = chosenOpp?.company ?? signals?.company ?? lead?.company ?? "";

    return {
      ui,
      score,
      issues,
      issuesCount: issues.length,
      website: String(websiteRaw),
      company: String(companyRaw),
      websiteStatus: localizeAuditWebsiteStatus(websiteStatusRaw),
      siteType: localizeAuditSiteType(siteTypeRaw),
      source: humanizeAuditToken(sourceRaw),
      reason,
      mobilePerf,
      mobileA11y,
      psSeoScore,
      lcpMs,
      clsScore,
      fcpMs,
      tbtMs,
      cwvDelta,
      seoPassed,
      bestPractices,
      gatheredAt,
    };
  }

  function updateSeoSingleExportButtonState() {
    if (!btnExportSeoSingle) return;
    const canExportCsv = canExportCsvFeature();
    const hasSelectedSeoLead = Boolean(selectedSeoLead);
    btnExportSeoSingle.style.display = canExportCsv ? "" : "none";
    if (canExportCsv) {
      btnExportSeoSingle.disabled = !hasSelectedSeoLead;
      btnExportSeoSingle.textContent = t("button.exportSeoSingleCsv");
      btnExportSeoSingle.title = hasSelectedSeoLead ? "" : t("status.selectSeoProfileFirst");
    }
  }

  function renderAccount() {
    const account = snapshot?.account || {};
    const rawPlan = String(account.plan || "FREE").toUpperCase();
    const plan = rawPlan === "TRIAL" ? "FREE" : (rawPlan === "SCALE" ? "AGENCY" : rawPlan);
    const limits = account.limits || {};
    const usage = account.usage || {};
    const remaining = account.remaining || {};

    const scanLimit = Number.isFinite(Number(limits.profiles_scanned)) ? Number(limits.profiles_scanned) : null;
    const scanUsed = Number.isFinite(Number(usage.profiles_scanned)) ? Number(usage.profiles_scanned) : 0;
    const scanRemaining = Number.isFinite(Number(remaining.profiles_scanned)) ? Number(remaining.profiles_scanned) : null;

    const msgLimit = Number.isFinite(Number(limits.messages_generated)) ? Number(limits.messages_generated) : null;
    const msgUsed = Number.isFinite(Number(usage.messages_generated)) ? Number(usage.messages_generated) : 0;
    const msgRemaining = Number.isFinite(Number(remaining.messages_generated)) ? Number(remaining.messages_generated) : null;

    const seoLimit = Number.isFinite(Number(limits.seo_exports)) ? Number(limits.seo_exports) : null;
    const seoUsed = Number.isFinite(Number(usage.seo_exports)) ? Number(usage.seo_exports) : 0;
    const seoRemaining = Number.isFinite(Number(remaining.seo_exports)) ? Number(remaining.seo_exports) : null;

    const quotaLabel =
      scanLimit == null && msgLimit == null && seoLimit == null
        ? "—"
        : t("account.quotaLabel", { scan: scanLimit ?? "?", msg: msgLimit ?? "?", seo: seoLimit ?? "?" });

    const isTrial = plan === "FREE" && String(account.subscriptionStatus || "").toUpperCase() === "TRIALING";
    const showSeoQuota = plan !== "FREE" || isTrial;
    const seoRowEl = $("accountSeoExportsRow");
    if (seoRowEl) seoRowEl.style.display = "none";
    setTextSafe(accountPlanEl, plan);
    setTextSafe(accountQuotaEl, quotaLabel);
    const teamBadgeEl = $("accountScansTeamBadge");
    if (teamBadgeEl) teamBadgeEl.style.display = plan === "AGENCY" ? "" : "none";
    const billingStatusRaw = String(account.subscriptionStatus || account.status || "—");
    const billingToken = String(account.subscriptionStatus || account.status || "").toUpperCase();
    const billingTone = new Set(["ACTIVE", "TRIALING"]).has(billingToken)
      ? "good"
      : (new Set(["PAST_DUE", "EXPIRED", "CANCELED"]).has(billingToken) ? "bad" : "warn");
    setTextSafe(accountBillingStatusEl, billingStatusRaw);
    applyQuotaBadgeTone(accountBillingStatusEl, billingTone, "accountBillingBadge");
    setTextSafe(accountTokenPreviewEl, account.tokenPreview || "—");
    setTextSafe(accountAuthMethodEl, account.authMethod || "GUEST");
    setTextSafe(accountIdentityEl, account.identity || "—");
    setTextSafe(accountLinkedinEl, account.linkedinProfileUrl || "—");
    const identityName = parseIdentityName(account);
    const firstName = identityName.firstName || t("route.account");
    const initials = buildInitials(identityName.firstName, identityName.lastName, "AC");
    applyUserAvatar(sidebarAccountAvatarEl, account.avatarUrl || null, initials, identityName.fullName || account.email || plan);
    setTextSafe($("navAccountText"), firstName);
    // Profile tab card
    const acctExtAvatarEl = $("acctExtAvatar");
    if (acctExtAvatarEl) {
      if (account.avatarUrl) {
        acctExtAvatarEl.textContent = "";
        let img = acctExtAvatarEl.querySelector("img.userPhotoImg");
        if (!img) {
          img = document.createElement("img");
          img.className = "userPhotoImg";
          img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";
          img.onerror = () => { acctExtAvatarEl.textContent = initials.charAt(0) || "?"; };
          acctExtAvatarEl.appendChild(img);
        }
        img.src = account.avatarUrl;
      } else {
        const img = acctExtAvatarEl.querySelector("img.userPhotoImg");
        if (img) img.remove();
        acctExtAvatarEl.textContent = initials.charAt(0) || "?";
      }
    }
    setTextSafe($("acctExtName"), identityName.fullName || account.email || "—");
    setTextSafe($("acctExtEmail"), account.email || "—");

    if (accountLoginFirstNameEl && document.activeElement !== accountLoginFirstNameEl) {
      accountLoginFirstNameEl.value = identityName.firstName || "";
    }
    if (accountLoginLastNameEl && document.activeElement !== accountLoginLastNameEl) {
      accountLoginLastNameEl.value = identityName.lastName || "";
    }
    if (accountLoginEmailEl && document.activeElement !== accountLoginEmailEl) {
      accountLoginEmailEl.value = account.email || "";
    }
    if (accountLoginEmailSecurityEl && document.activeElement !== accountLoginEmailSecurityEl) {
      accountLoginEmailSecurityEl.value = account.email || "";
    }
    const loggedIn = Boolean(account.userId && account.authMethod === "EMAIL");
    if (btnAuthLogout) btnAuthLogout.disabled = !loggedIn;
    // Show login gate if not authenticated; gate navbar when logged out
    setNavAuthState(loggedIn);
    showLoginGate(!loggedIn);
    const adminResetWrap = document.getElementById("adminResetDataWrap");
    if (adminResetWrap) adminResetWrap.style.display = account.isAdmin === true ? "" : "none";
    if (btnAdminResetData) btnAdminResetData.disabled = account.isAdmin !== true;

    if (accountPlanEl) {
      accountPlanEl.className = `badge accountPlanBadge ${["STARTER", "PRO", "AGENCY"].includes(plan) ? "good" : "info"}`;
    }
    const accountTrialBadgeEl = $("accountTrialBadge");
    if (accountTrialBadgeEl) {
      accountTrialBadgeEl.style.display = isTrial ? "" : "none";
    }

    const isAgencyPlan   = String(plan || "").toUpperCase() === "AGENCY";
    const isFreePlan     = String(plan || "").toUpperCase() === "FREE";
    const teamRole       = String(account.teamRole || "OWNER").toUpperCase();
    const isTeamOwner    = teamRole !== "MEMBER";
    const isAgencyOwner  = isAgencyPlan && isTeamOwner;
    const isAgencyMember = isAgencyPlan && !isTeamOwner;

    // Hub tile visibility:
    //   FREE          → Dashboard, Leads, Upgrade
    //   Starter/Pro   → Dashboard, Leads, Billing
    //   Agency owner  → Dashboard, Leads, Team, Billing
    //   Agency member → Dashboard, Leads only
    const btnOpenAppTeam    = $("btnOpenAppTeam");
    const btnOpenAppUpgrade = $("btnOpenAppUpgrade");
    const btnOpenAppBilling = $("btnOpenAppBilling");
    if (btnOpenAppTeam)    btnOpenAppTeam.style.display    = isAgencyOwner                   ? "flex" : "none";
    if (btnOpenAppUpgrade) btnOpenAppUpgrade.style.display = isFreePlan                      ? "flex" : "none";
    if (btnOpenAppBilling) btnOpenAppBilling.style.display = (!isFreePlan && !isAgencyMember) ? "flex" : "none";

    if (navChatBtn) navChatBtn.style.display = isAgencyPlan ? "" : "none";
    if (isAgencyPlan) startChatUnreadPoll();
    else stopChatUnreadPoll();
    startNotifUnreadPoll();

    // Role badge next to account name (only visible on agency plan)
    const roleBadgeEl = $("sidebarRoleBadge");
    if (roleBadgeEl) {
      if (isAgencyPlan) {
        const isOwnerRole = account.teamRole !== "MEMBER";
        roleBadgeEl.textContent = isOwnerRole ? "Owner" : "Member";
        roleBadgeEl.className = `sidebarRoleBadge ${isOwnerRole ? "is-owner" : "is-member"}`;
        roleBadgeEl.style.display = "";
      } else {
        roleBadgeEl.style.display = "none";
      }
    }

    if (sidebarSeatBlockEl) {
      sidebarSeatBlockEl.style.display = isAgencyPlan ? "" : "none";
    }

    const teamPolicy = getTeamPolicyFromAccount(account, plan);
    const usedUsers = isAgencyPlan ? renderSidebarSeatUsers(account) : 1;
    const includedDisplay = String(teamPolicy.includedUsers);
    if (isAgencyPlan) {
      setTextSafe(
        sidebarSeatValueEl,
        t("sidebar.seatUsage", {
          used: usedUsers,
          included: includedDisplay,
        })
      );
      setTextSafe(sidebarAccountPlanHintEl, `${plan} • ${usedUsers}/${includedDisplay}`);
    } else {
      if (sidebarSeatUsersEl) sidebarSeatUsersEl.innerHTML = "";
      setTextSafe(sidebarSeatValueEl, "");
      setTextSafe(sidebarAccountPlanHintEl, plan);
    }
    if (sidebarAccountPlanHintEl) {
      const planKey = (plan || "FREE").toUpperCase();
      sidebarAccountPlanHintEl.className = "sidebarAccountPlanHint plan-" + planKey.toLowerCase();
    }
    const sidebarTrialBadgeEl = $("sidebarTrialBadge");
    if (sidebarTrialBadgeEl) sidebarTrialBadgeEl.style.display = isTrial ? "" : "none";

    // ── Sidebar upsell card ──
    const upsellEl = $("sidebarUpsell");
    const upsellMsgEl = $("sidebarUpsellMsg");
    const upsellPlanEl = $("sidebarUpsellPlan");
    const upsellBtnEl = $("sidebarUpsellBtn");
    if (upsellEl) {
      const upsellConfig = {
        FREE_TRIAL:   { msg: "Trial ending — don't lose your leads", plan: "Pro · $59/mo",     cta: "Upgrade to Pro" },
        FREE:         { msg: "You're using 10% of the tool",          plan: "Starter · $29/mo", cta: "Get Started" },
        STARTER:      { msg: "Need 4x more scans?",                   plan: "Pro · $59/mo",     cta: "Go Pro" },
        PRO:          { msg: "Managing multiple clients?",             plan: "Agency · $149/mo", cta: "Get Agency" },
      };
      const upsellKey = plan === "FREE" ? (isTrial ? "FREE_TRIAL" : "FREE") : plan;
      const dismissFlag = `sidebarUpsellDismissed_${upsellKey}`;
      const UPSELL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      chrome.storage.local.get(dismissFlag, (s) => {
        const dismissedAt = s[dismissFlag];
        if (dismissedAt && (Date.now() - dismissedAt) < UPSELL_SNOOZE_MS) { upsellEl.style.display = "none"; return; }
        const cfg = upsellConfig[upsellKey];
        if (cfg) {
          if (upsellMsgEl) upsellMsgEl.textContent = cfg.msg;
          if (upsellPlanEl) upsellPlanEl.textContent = cfg.plan;
          if (upsellBtnEl) { upsellBtnEl.textContent = cfg.cta; upsellBtnEl.dataset.upsellFlag = dismissFlag; }
          upsellEl.style.display = "";
        } else {
          upsellEl.style.display = "none";
        }
      });
    }
    if (btnSidebarAddUser) {
      const isTeamOwner = !account.teamRole || account.teamRole === "OWNER";
      const canAddSeatUser = loggedIn && isTeamOwner && teamPolicy.billingActive && (
        teamPolicy.seatAddOnEnabled ||
        teamPolicy.includedUsers > 1
      );
      btnSidebarAddUser.style.display = isAgencyPlan && isTeamOwner ? "" : "none";
      btnSidebarAddUser.disabled = !isAgencyPlan || !canAddSeatUser;
      btnSidebarAddUser.title = isAgencyPlan && canAddSeatUser ? "" : t("sidebar.addUserLocked");
    }

    setTextSafe(
      accountQuotaScanTextEl,
      scanLimit == null ? "—" : t("account.remaining", {
        used: scanUsed,
        limit: scanLimit,
        left: scanRemaining ?? Math.max(0, scanLimit - scanUsed),
      })
    );
    applyQuotaBadgeTone(accountQuotaScanTextEl, resolveUsageTone(scanUsed, scanLimit), "quotaValueBadge");
    setTextSafe(
      accountQuotaMsgTextEl,
      msgLimit == null ? "—" : t("account.remaining", {
        used: msgUsed,
        limit: msgLimit,
        left: msgRemaining ?? Math.max(0, msgLimit - msgUsed),
      })
    );
    applyQuotaBadgeTone(accountQuotaMsgTextEl, resolveUsageTone(msgUsed, msgLimit), "quotaValueBadge");
    setTextSafe(
      accountQuotaSeoTextEl,
      seoLimit == null ? "—" : t("account.remaining", {
        used: seoUsed,
        limit: seoLimit,
        left: seoRemaining ?? Math.max(0, seoLimit - seoUsed),
      })
    );
    applyQuotaBadgeTone(accountQuotaSeoTextEl, resolveUsageTone(seoUsed, seoLimit), "quotaValueBadge");

    setBar(accountQuotaScanBarEl, toPct(scanUsed, scanLimit), resolveUsageTone(scanUsed, scanLimit));
    setBar(accountQuotaMsgBarEl, toPct(msgUsed, msgLimit), resolveUsageTone(msgUsed, msgLimit));
    setBar(accountQuotaSeoBarEl, toPct(seoUsed, seoLimit), resolveUsageTone(seoUsed, seoLimit));

    // ── Dashboard quota card (site-matching design) ──
    const features = account.features || {};
    setTextSafe($("dashQPlanBadge"), plan);

    const quotaRows = [
      { label: "Messages / month", used: msgUsed, limit: msgLimit, left: msgRemaining ?? Math.max(0, msgLimit != null ? msgLimit - msgUsed : 0), tone: resolveUsageTone(msgUsed, msgLimit) },
      { label: "SEO exports",      used: seoUsed, limit: seoLimit, left: seoRemaining ?? Math.max(0, seoLimit != null ? seoLimit - seoUsed : 0), tone: resolveUsageTone(seoUsed, seoLimit), hide: !showSeoQuota || seoLimit == null },
      { label: "Scans / month",    used: scanUsed, limit: scanLimit, left: scanRemaining ?? Math.max(0, scanLimit != null ? scanLimit - scanUsed : 0), tone: resolveUsageTone(scanUsed, scanLimit) },
    ];
    const dashQItemsEl = $("dashQItems");
    if (dashQItemsEl) {
      dashQItemsEl.innerHTML = quotaRows.filter(r => !r.hide && r.limit != null).map(r => {
        const fillColor = r.tone === "good" ? "#10b981" : r.tone === "warn" ? "#f59e0b" : "#ef4444";
        const pct = r.limit > 0 ? Math.min(100, Math.round((r.used / r.limit) * 100)) : 0;
        return `<div class="dashQItem">
          <div class="dashQItemTop">
            <span class="dashQItemLabel">${escHtml(r.label)}</span>
            <span class="dashQItemNums">${Number(r.used).toLocaleString()} / ${Number(r.limit).toLocaleString()}</span>
          </div>
          <div class="dashQItemBar"><div style="width:${pct}%;background:${fillColor};height:100%;border-radius:999px;transition:width 0.4s ease;"></div></div>
          <div class="dashQItemBottom"><span style="color:${fillColor};font-size:11px;font-weight:700;">${Number(r.left).toLocaleString()} left</span></div>
        </div>`;
      }).join("");
    }

    const feats = [
      { key: "exportCsv",    label: "CSV export" },
      { key: "sendNow",      label: "Send now" },
      { key: "icpAssistant", label: "AI scanner" },
    ];
    const dashQFeatGridEl = $("dashQFeatGrid");
    if (dashQFeatGridEl) {
      dashQFeatGridEl.innerHTML = feats.map(f => {
        const on = features[f.key] !== false;
        return `<div class="dashQFeatItem${on ? " dashQFeatItem--on" : ""}">
          <span class="dashQFeatCheck">${on
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
          }</span>${escHtml(f.label)}
        </div>`;
      }).join("");
    }

    const dashQResetDateEl = $("dashQResetDate");
    if (dashQResetDateEl) {
      const now = new Date();
      let reset;
      const periodEndRaw = account.periodEnd || account.period_end || account.quota_reset_at || account.nextResetAt;
      if (periodEndRaw) {
        const parsed = Date.parse(String(periodEndRaw));
        if (Number.isFinite(parsed)) reset = new Date(parsed);
      }
      if (!reset) {
        const created = account.createdAt ? new Date(account.createdAt) : null;
        const day = created ? created.getDate() : now.getDate();
        reset = new Date(now.getFullYear(), now.getMonth() + 1, day);
      }
      dashQResetDateEl.textContent = reset.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    }
  }

  function applyPlanFeatureGates() {
    const features = snapshot?.account?.features || {};
    const account = snapshot?.account || {};
    const rawPlan = String(account.plan || "FREE").toUpperCase();
    const plan = rawPlan === "TRIAL" ? "FREE" : (rawPlan === "SCALE" ? "AGENCY" : rawPlan);
    const isFreePlan = plan === "FREE";
    const isTrial = isFreePlan && String(account.subscriptionStatus || "").toUpperCase() === "TRIALING";
    const isFreeNoTrial = isFreePlan && !isTrial;

    const canExportCsv    = !isFreeNoTrial && features.exportCsv    !== false;
    const canIcpAssistant = features.icpAssistant !== false;
    const canSendNow      = !isFreeNoTrial && features.sendNow      !== false;
    const canAdvancedDashboard = features.dashboardAdvanced !== false;

    if (btnExportLeads) {
      if (canExportCsv) { btnExportLeads.classList.remove("btnHidden"); btnExportLeads.disabled = false; btnExportLeads.title = t("button.exportLeadsCsv"); }
      else { btnExportLeads.classList.add("btnHidden"); }
    }
    if (btnExportSEO) {
      if (canExportCsv) { btnExportSEO.classList.remove("btnHidden"); btnExportSEO.disabled = false; btnExportSEO.textContent = t("button.exportSeoAuditsCsv"); btnExportSEO.title = ""; }
      else { btnExportSEO.classList.add("btnHidden"); }
    }
    updateSeoSingleExportButtonState();
    if (leadsExportHintEl) {
      leadsExportHintEl.style.display = "none";
      leadsExportHintEl.textContent = "";
    }
    if (seoExportHintEl) {
      seoExportHintEl.style.display = "none";
      seoExportHintEl.textContent = "";
    }

    if (btnScanAssistGenerate) btnScanAssistGenerate.disabled = !canIcpAssistant;
    if (btnScanAssistCopyPeople) btnScanAssistCopyPeople.disabled = !canIcpAssistant;
    if (btnScanAssistOpenPeople) btnScanAssistOpenPeople.disabled = !canIcpAssistant;
    if (btnScanAssistCopyCompany) btnScanAssistCopyCompany.disabled = !canIcpAssistant;
    if (btnScanAssistOpenCompany) btnScanAssistOpenCompany.disabled = !canIcpAssistant;

    if (scanAssistPromptEl) scanAssistPromptEl.disabled = !canIcpAssistant;
    if (assistantProBadgeEl) assistantProBadgeEl.style.display = canIcpAssistant ? "none" : "inline-block";
    if (assistantLockHintEl) {
      if (canIcpAssistant) {
        assistantLockHintEl.style.display = "none";
        assistantLockHintEl.textContent = "";
      } else {
        assistantLockHintEl.style.display = "block";
        assistantLockHintEl.textContent = t("scan.assistant.proHint");
        if (scanAssistPeopleQueryEl) scanAssistPeopleQueryEl.value = "";
        if (scanAssistCompanyQueryEl) scanAssistCompanyQueryEl.value = "";
      }
    }

    const msgBtnRow = document.querySelector("#route-messages .msg-btn-row");
    if (btnSendMsg) {
      if (canSendNow) {
        btnSendMsg.classList.remove("btnHidden");
        const sendLbl = $("btnSendMsgLabel");
        if (sendLbl) sendLbl.textContent = t("button.send") || "Send";
        btnSendMsg.title = t("messages.sendHint");
        if (msgBtnRow) msgBtnRow.classList.remove("msg-btn-row--no-send");
      } else {
        btnSendMsg.classList.add("btnHidden");
        if (msgBtnRow) msgBtnRow.classList.add("msg-btn-row--no-send");
      }
    }
    if (msgSendHintEl) {
      msgSendHintEl.style.display = canSendNow ? "" : "none";
      msgSendHintEl.textContent = canSendNow ? t("messages.sendHint") : "";
    }

    if (!canAdvancedDashboard) {
      setTextSafe(statConversionEl, "—");
      setTextSafe(statDecidersEl, "—");
      setTextSafe(dashActionableEl, "—");
      setTextSafe(dashIgnoredEl, "—");
      setBar(dashActionableBarEl, 0);
      setBar(dashIgnoredBarEl, 0);
      if (dashCardConversionEl) dashCardConversionEl.style.display = "none";
      if (dashCardDecidersEl) dashCardDecidersEl.style.display = "none";
      if (dashboardConvProBadgeEl) dashboardConvProBadgeEl.style.display = "inline-block";
      if (dashboardDecidersProBadgeEl) dashboardDecidersProBadgeEl.style.display = "inline-block";
      if (dashboardConvHintEl) dashboardConvHintEl.textContent = t("status.actionablePro");
      if (dashboardDecidersHintEl) dashboardDecidersHintEl.textContent = t("status.decidersPro");
    } else {
      if (dashCardConversionEl) dashCardConversionEl.style.display = "";
      if (dashCardDecidersEl) dashCardDecidersEl.style.display = "";
      if (dashboardConvProBadgeEl) dashboardConvProBadgeEl.style.display = "none";
      if (dashboardDecidersProBadgeEl) dashboardDecidersProBadgeEl.style.display = "none";
      if (dashboardConvHintEl) dashboardConvHintEl.textContent = t("dashboard.conversionHint");
      if (dashboardDecidersHintEl) dashboardDecidersHintEl.textContent = t("dashboard.decidersHint");
    }
  }

  /* ================= SCAN ASSISTANT ================= */
  function splitTerms(input) {
    return String(input || "")
      .split(/[;,]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function quoteIfNeeded(term) {
    const s = String(term || "").trim();
    if (!s) return "";
    return /\s/.test(s) ? `"${s}"` : s;
  }

  function orClause(terms) {
    if (!terms.length) return "";
    if (terms.length === 1) return quoteIfNeeded(terms[0]);
    return `(${terms.map(quoteIfNeeded).join(" OR ")})`;
  }

  function notClause(terms) {
    if (!terms.length) return "";
    return terms.map((t) => `NOT ${quoteIfNeeded(t)}`).join(" ");
  }

  function getScanAssistantState() {
    return {
      prompt:      scanAssistPromptEl?.value?.trim() || "",
      peopleQuery: scanAssistPeopleQueryEl?.value || "",
    };
  }

  function setScanAssistantState(data = {}) {
    if (scanAssistPromptEl)      scanAssistPromptEl.value      = data.prompt      || "";
    if (scanAssistPeopleQueryEl) scanAssistPeopleQueryEl.value = data.peopleQuery || "";
    if (scanAssistCompanyQueryEl) scanAssistCompanyQueryEl.value = "";
  }

  async function saveScanAssistantState() {
    if (!scanAssistPromptEl || !chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({
        [SCAN_ASSIST_STORAGE_KEY]: getScanAssistantState(),
      });
    } catch (e) {
      console.warn("[PANEL] Scan assistant state save failed", e);
    }
  }

  function scheduleSaveScanAssistantState() {
    if (scanAssistSaveTimer) clearTimeout(scanAssistSaveTimer);
    scanAssistSaveTimer = setTimeout(() => {
      saveScanAssistantState();
      scanAssistSaveTimer = null;
    }, 250);
  }

  async function loadScanAssistantState() {
    if (!scanAssistPromptEl || !chrome?.storage?.local) return;
    try {
      const data = await chrome.storage.local.get(SCAN_ASSIST_STORAGE_KEY);
      setScanAssistantState(data?.[SCAN_ASSIST_STORAGE_KEY] || {});
    } catch (e) {
      console.warn("[PANEL] Scan assistant state load failed", e);
    }
  }

  async function generateScanAssistantQueries({ persist = true, silent = false } = {}) {
    if (!scanAssistPeopleQueryEl || !scanAssistCompanyQueryEl) return;

    const state = getScanAssistantState();
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({
        type: "ASSISTANT_GENERATE_FROM_PROMPT",
        prompt: state.prompt,
      });
    } catch (e) {
      if (!silent) showToast(t("toast.assistantUnavailable", { error: String(e?.message || e) }), "error", 3200);
      return false;
    }

    if (!res?.ok) {
      const blocked = String(res?.error || "").includes("FEATURE_DISABLED_ICP_ASSISTANT");
      if (blocked) {
        scanAssistPeopleQueryEl.value = "";
        scanAssistCompanyQueryEl.value = "";
      }
      if (!silent) {
        showToast(
          blocked ? t("toast.assistantPro") : t("toast.generateFailed", { error: res?.error || "unknown error" }),
          blocked ? "warn" : "error",
          3200
        );
      }
      return false;
    }

    const queries = res?.queries || {};
    scanAssistPeopleQueryEl.value = String(queries.people || "");
    scanAssistCompanyQueryEl.value = String(queries.company || "");

    if (persist) scheduleSaveScanAssistantState();
    return true;
  }

  async function copyScanAssistantQuery(kind, btnEl) {
    let access = null;
    try {
      access = await chrome.runtime.sendMessage({ type: "ASSISTANT_ASSERT_ACCESS" });
    } catch (e) {
      showToast(t("toast.assistantUnavailable", { error: String(e?.message || e) }), "error", 3200);
      return;
    }
    if (!access?.ok) {
      showToast(t("toast.assistantPro"), "warn", 2800);
      return;
    }

    const text = kind === "company"
      ? (scanAssistCompanyQueryEl?.value || "")
      : (scanAssistPeopleQueryEl?.value || "");
    if (!text) return;
    const btn = btnEl instanceof HTMLElement ? btnEl : null;
    const labelEl = btn ? btn.querySelector("span") : null;
    const iconCopy = btn ? btn.querySelector(".iconCopyAssist") : null;
    const iconCopied = btn ? btn.querySelector(".iconCopiedAssist") : null;
    const originalLabel = labelEl ? labelEl.textContent : "";
    let resetTimer = null;
    const resetBtn = () => {
      if (!btn) return;
      if (resetTimer) clearTimeout(resetTimer);
      btn.classList.remove("is-copied", "is-copy-error");
      if (labelEl) labelEl.textContent = originalLabel;
      if (iconCopy) iconCopy.style.display = "";
      if (iconCopied) iconCopied.style.display = "none";
    };
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.classList.remove("is-copy-error");
        btn.classList.add("is-copied");
        if (labelEl) labelEl.textContent = t("button.copied");
        if (iconCopy) iconCopy.style.display = "none";
        if (iconCopied) iconCopied.style.display = "";
        resetTimer = setTimeout(resetBtn, 1500);
      }
    } catch (e) {
      console.warn("[PANEL] Clipboard copy failed", e);
      if (btn) {
        btn.classList.remove("is-copied");
        btn.classList.add("is-copy-error");
        if (labelEl) labelEl.textContent = t("button.copyFailed");
        resetTimer = setTimeout(resetBtn, 1500);
      }
    }
  }

  async function openLinkedInSearch(kind) {
    const state = getScanAssistantState();
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({
        type: "ASSISTANT_OPEN_LINKEDIN",
        kind,
        state,
      });
    } catch (e) {
      showToast(t("toast.assistantUnavailable", { error: String(e?.message || e) }), "error", 3200);
      return;
    }
    if (!res?.ok) {
      const blocked = String(res?.error || "").includes("FEATURE_DISABLED_ICP_ASSISTANT");
      showToast(
        blocked ? t("toast.assistantPro") : t("toast.openFailed", { error: res?.error || "unknown error" }),
        blocked ? "warn" : "error",
        3200
      );
      return;
    }
    if (res?.queries) {
      scanAssistPeopleQueryEl.value = String(res.queries.people || scanAssistPeopleQueryEl.value || "");
      scanAssistCompanyQueryEl.value = String(res.queries.company || scanAssistCompanyQueryEl.value || "");
      scheduleSaveScanAssistantState();
    }
  }

  function setScanAssistantOpen(open) {
    isScanAssistantOpen = Boolean(open);
    document.body.classList.toggle("scan-assistant-open", isScanAssistantOpen);
    if (assistantCardEl) {
      if (isScanAssistantOpen) {
        assistantCardEl.classList.remove("is-closing");
        assistantCardEl.classList.remove("is-open");
        assistantCardEl.setAttribute("aria-hidden", "false");
        void assistantCardEl.offsetHeight; // force reflow so element renders before animation
        assistantCardEl.classList.add("is-open");
        // Scroll assistant into view on small screens (after animation starts)
        setTimeout(() => { assistantCardEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 220);
      } else {
        assistantCardEl.classList.remove("is-open");
        assistantCardEl.classList.add("is-closing");
        setTimeout(() => {
          if (!isScanAssistantOpen && assistantCardEl) {
            assistantCardEl.classList.remove("is-closing");
            assistantCardEl.setAttribute("aria-hidden", "true");
          }
        }, 260);
      }
    }
    if (btnScanAssistFab) {
      btnScanAssistFab.setAttribute("aria-expanded", isScanAssistantOpen ? "true" : "false");
    }
    updateScanAssistantAdvancedState();
    queueSyncAssistantNotchPosition();
  }

  function updateScanAssistantAdvancedState() {
    const advancedOpen = Boolean(scanAssistAdvancedEl?.open);
    if (assistantCardEl) {
      assistantCardEl.classList.toggle("is-advanced-open", advancedOpen);
    }
    document.body.classList.toggle(
      "scan-assistant-advanced-open",
      isScanAssistantOpen && advancedOpen
    );
    queueSyncAssistantNotchPosition();
  }

  function syncAssistantNotchPosition() {
    assistantNotchSyncRaf = 0;
    if (!assistantCardEl || !btnScanAssistFab) return;

    const dotEl = btnScanAssistFab.querySelector(".assistantFabDot") || btnScanAssistFab;
    const cardRect = assistantCardEl.getBoundingClientRect();
    const dotRect = dotEl.getBoundingClientRect();
    if (!cardRect.width || !cardRect.height || !dotRect.width || !dotRect.height) return;

    const centerX = dotRect.left + dotRect.width / 2 - cardRect.left;
    const centerY = dotRect.top + dotRect.height / 2 - cardRect.top;
    const notchSize = Math.max(dotRect.width, dotRect.height) + 34;

    assistantCardEl.style.setProperty("--assistant-notch-x", `${centerX}px`);
    assistantCardEl.style.setProperty("--assistant-notch-y", `${centerY}px`);
    assistantCardEl.style.setProperty("--assistant-notch-size", `${notchSize}px`);
  }

  function queueSyncAssistantNotchPosition() {
    if (assistantNotchSyncRaf) return;
    assistantNotchSyncRaf = requestAnimationFrame(syncAssistantNotchPosition);
  }

  function wireAssistantNotchSync() {
    queueSyncAssistantNotchPosition();
    window.addEventListener("resize", queueSyncAssistantNotchPosition, { passive: true });
    window.addEventListener("scroll", queueSyncAssistantNotchPosition, true);
    if (assistantCardBodyEl) {
      assistantCardBodyEl.addEventListener("scroll", queueSyncAssistantNotchPosition, { passive: true });
    }
  }

  function wireScanAssistantInputs() {
    if (scanAssistPromptEl) {
      scanAssistPromptEl.addEventListener("input", () => scheduleSaveScanAssistantState());
      scanAssistPromptEl.addEventListener("change", () => scheduleSaveScanAssistantState());
    }
  }

  function setDashboardCardOpen(card, open) {
    if (!card) return;
    const isOpen = Boolean(open);
    card.classList.toggle("is-open", isOpen);
    const trigger = card.querySelector(".dashCollapseBtn");
    if (trigger) {
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  }

  function wireDashboardCollapsibleCards() {
    const cards = document.querySelectorAll("#route-dashboard .dashboardCollapsible");
    for (const card of cards) {
      const trigger = card.querySelector(".dashCollapseBtn");
      if (!trigger || trigger.dataset.wired === "1") continue;

      setDashboardCardOpen(card, false);

      const toggle = () => {
        setDashboardCardOpen(card, !card.classList.contains("is-open"));
      };

      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      });

      trigger.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      });

      trigger.dataset.wired = "1";
    }
  }



  /* ================= PIPELINE UI ================= */
  function updatePipelineToggleButton(status) {
    if (!btnPipelineToggle) return;
    const s = String(status || pipelineStatusRaw || "RUNNING").toUpperCase();
    const next = s === "RUNNING" ? "PAUSED" : "RUNNING";
    btnPipelineToggle.dataset.next = next;
    const isStart = next === "RUNNING";
    const icon = isStart
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="flex-shrink:0;vertical-align:middle;margin-bottom:1px"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="flex-shrink:0;vertical-align:middle;margin-bottom:1px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    btnPipelineToggle.innerHTML = `${icon}<span style="display:inline-block">${isStart ? t("button.start") : t("button.pause")}</span>`;
  }

  function setPipelineUI(status) {
    const s = String(status || "PAUSED").toUpperCase();
    pipelineStatusRaw = s;
    const localized = s === "RUNNING" ? t("status.running") : t("status.paused");
    setTextSafe(pipelineStatusEl, localized);
    setTextSafe(badgeCaptureEl, localized);

    const cls = s === "RUNNING" ? "badge good badge-running" : "badge info badge-paused";
    if (pipelineStatusEl) pipelineStatusEl.className = cls;
    if (badgeCaptureEl) badgeCaptureEl.className = cls;
    updatePipelineToggleButton(s);
  }

  /* ================= LOGS ================= */
  function renderLogs() {
    if (!activityLogEl) return;
    setHtmlSafe(activityLogEl, "");
    const logs = snapshot?.logs || [];
    logs.slice(Math.max(0, logs.length - 200)).forEach(appendLog);
  }

  function appendLog(entry) {
    if (!activityLogEl || !entry) return;
    const isAdmin = snapshot?.account?.isAdmin;
    // admin-only entries: hide from regular users
    if (entry.userMsg === false && !isAdmin) return;
    const text = (!isAdmin && entry.userMsg != null && entry.userMsg !== false)
      ? entry.userMsg
      : entry.message || "";
    const div = document.createElement("div");
    const t = entry.at ? new Date(entry.at).toLocaleTimeString() : "";
    div.textContent = `[${t}] ${text}`;
    activityLogEl.appendChild(div);
    activityLogEl.scrollTop = activityLogEl.scrollHeight;
  }

  /* ================= LEAD CHOOSER ================= */
  function ensureLeadChooser() {
    leadChooserEl = $("leadChooser") || leadChooserEl;
    btnOpenMessagesEl = $("btnOpenMessages") || btnOpenMessagesEl;
    btnOpenSEOEl = $("btnOpenSEO") || btnOpenSEOEl;
    leadChooserNameEl = $("leadChooserName") || leadChooserNameEl;

    // If already exists in HTML => inject icons + wire
    if (leadChooserEl && btnOpenMessagesEl && btnOpenSEOEl && leadChooserNameEl) {
      // Always (re)inject innerHTML so icons survive Chrome's HTML cache
      btnOpenMessagesEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span id="btnOpenMessagesLabel">${escHtml(t("button.openMessages"))}</span>`;
      btnOpenSEOEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18.5h16"/><path d="M7 16v-3.5M12 16V8.5M17 16v-5"/><path d="M6 9.5l4-3 4 2 4-3"/></svg><span id="btnOpenSEOLabel">${escHtml(t("button.openSeo"))}</span>`;
      wireLeadChooserButtons();
      return;
    }

    // Create minimal chooser if missing
    if (!leadChooserEl) {
      leadChooserEl = document.createElement("div");
      leadChooserEl.id = "leadChooser";
      leadChooserEl.style.position = "fixed";
      leadChooserEl.style.right = "16px";
      leadChooserEl.style.bottom = "16px";
      leadChooserEl.style.zIndex = "9999";
      leadChooserEl.style.padding = "12px";
      leadChooserEl.style.borderRadius = "12px";
      leadChooserEl.style.background = "#111";
      leadChooserEl.style.border = "1px solid rgba(255,255,255,0.12)";
      leadChooserEl.style.display = "none";
      leadChooserEl.style.minWidth = "260px";

      leadChooserNameEl = document.createElement("div");
      leadChooserNameEl.id = "leadChooserName";
      leadChooserNameEl.style.fontWeight = "700";
      leadChooserNameEl.style.marginBottom = "8px";
      leadChooserNameEl.style.color = "#fff";

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";

      btnOpenMessagesEl = document.createElement("button");
      btnOpenMessagesEl.id = "btnOpenMessages";
      btnOpenMessagesEl.className = "btn primary";
      btnOpenMessagesEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span id="btnOpenMessagesLabel">${escHtml(t("button.openMessages"))}</span>`;

      btnOpenSEOEl = document.createElement("button");
      btnOpenSEOEl.id = "btnOpenSEO";
      btnOpenSEOEl.className = "btn";
      btnOpenSEOEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18.5h16"/><path d="M7 16v-3.5M12 16V8.5M17 16v-5"/><path d="M6 9.5l4-3 4 2 4-3"/></svg><span id="btnOpenSEOLabel">${escHtml(t("button.openSeo"))}</span>`;

      row.appendChild(btnOpenMessagesEl);
      row.appendChild(btnOpenSEOEl);

      leadChooserEl.appendChild(leadChooserNameEl);
      leadChooserEl.appendChild(row);
      document.body.appendChild(leadChooserEl);
    }

    wireLeadChooserButtons();
  }

  function wireLeadChooserButtons() {
    if (btnOpenMessagesEl) {
      btnOpenMessagesEl.onclick = async () => {
    const lead = findLeadByProfileUrl(selectedLeadProfileUrl) || selectedLead;
    if (!lead) return;

    const opp =
      lead.opportunities?.find(o => o.opportunityStatus === "PRIMARY") ||
      lead.opportunities?.[0];

    if (!opp) return;

    await chrome.runtime.sendMessage({
      type: "SET_PRIMARY_OPPORTUNITY",
      leadId: lead.id,
      opportunityId: opp.id
    });

    selectLead(lead);
    goToRoute("messages");
    hideLeadChooser();
  };

    }

    if (btnOpenSEOEl) {
      btnOpenSEOEl.onclick = async () => {
    const lead = findLeadByProfileUrl(selectedLeadProfileUrl) || selectedLead;
    if (!lead) return;

    const opp =
      lead.opportunities?.find(o => o.opportunityStatus === "PRIMARY") ||
      lead.opportunities?.[0];

    if (!opp) return;

    await chrome.runtime.sendMessage({
      type: "SET_PRIMARY_OPPORTUNITY",
      leadId: lead.id,
      opportunityId: opp.id
    });

    goToRoute("seo");
    hideLeadChooser();
    selectSeoLead(lead);
    renderSeoList();
  };

    }
  }

  function showLeadChooser(lead) {
    ensureLeadChooser();
    if (!leadChooserEl) return;

    if (leadChooserNameEl) {
      const _chooserName = sanitizeLeadName(lead?.name);
      leadChooserNameEl.textContent = _chooserName
        ? t("leadChooser.selected", { name: _chooserName })
        : t("leadChooser.selectedDefault");
    }
    leadChooserEl.style.display = "block";
  }

  function hideLeadChooser() {
    if (leadChooserEl) leadChooserEl.style.display = "none";
  }

  function centerLeadCard(profileUrl) {
    if (!leadListEl || !profileUrl) return;
    requestAnimationFrame(() => {
      const cards = leadListEl.querySelectorAll(".leadCard");
      let target = null;
      for (const card of cards) {
        if (card?.dataset?.profileUrl === profileUrl) {
          target = card;
          break;
        }
      }
      if (!target) return;
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    });
  }

  function normalizeSearchToken(v) {
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function getLeadSearchText(lead) {
    const fullName = String(lead?.name || "").trim();
    const firstName = String(lead?.firstName || "").trim();
    const lastName = String(lead?.lastName || "").trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const resolvedFirst = firstName || nameParts[0] || "";
    const resolvedLast = lastName || nameParts.slice(1).join(" ");
    const initials = buildInitials(resolvedFirst, resolvedLast, "");

    return normalizeSearchToken([
      fullName,
      resolvedFirst,
      resolvedLast,
      `${resolvedFirst} ${resolvedLast}`.trim(),
      `${resolvedLast} ${resolvedFirst}`.trim(),
      initials,
    ].join(" "));
  }

  function leadMatchesSearch(lead, query = "") {
    const normalizedQuery = normalizeSearchToken(query);
    if (!normalizedQuery) return true;
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystack = getLeadSearchText(lead);
    return terms.every((term) => haystack.includes(term));
  }

  function syncLeadsSearchUi() {
    const hasQuery = Boolean(String(leadsSearchQuery || "").trim());
    if (leadsSearchInputEl && leadsSearchInputEl.value !== leadsSearchQuery) {
      leadsSearchInputEl.value = leadsSearchQuery;
    }
    if (btnLeadsSearchClear) {
      btnLeadsSearchClear.classList.toggle("is-visible", hasQuery);
      btnLeadsSearchClear.disabled = !hasQuery;
    }
  }

  function clearLeadsSearch({ rerender = true } = {}) {
    const hadQuery = Boolean(String(leadsSearchQuery || "").trim());
    leadsSearchQuery = "";
    syncLeadsSearchUi();
    if (hadQuery && rerender) renderLeads();
  }

  /* ================= LEADS ================= */

  /* ================= LEAD DETAIL CONTENT ================= */
  function buildLeadDetailContent(l, primaryOpp, orderedOpps) {
    const wrap = document.createElement("div");
    wrap.className = "drawerContent";

    const ui = getUiDisplay(l);
    const seoCode = ui._seoCode || "UNKNOWN";
    const leadAudit = buildSeoAuditSnapshot(l, primaryOpp);
    const leadType = getLeadType(l);

    // ── HERO ──
    const heroKey = seoCode === "CRITICAL" ? "critical"
      : seoCode === "WEAK" ? "weak"
      : seoCode === "OK" ? "ok"
      : seoCode === "SITE_UNREACHABLE" ? "unreachable" : "unknown";

    const hero = document.createElement("div");
    hero.className = `drawerHero drawerHero--${heroKey}`;

    // Score (left) + badges stacked (right) — same layout as SEO drawer
    const heroMain = document.createElement("div");
    heroMain.className = "drawerHeroMain";

    const heroLeft = document.createElement("div");
    heroLeft.className = "drawerHeroLeft";

    const knownSeoCodeDrawer = ["OK", "WEAK", "CRITICAL", "SITE_UNREACHABLE", "NO_WEBSITE"].includes(seoCode);
    if (knownSeoCodeDrawer && leadAudit.score !== null && l.skippedReason !== "NO_ACTIVE_POSITION") {
      const scoreRow = document.createElement("div");
      scoreRow.className = "drawerHeroScoreRow";
      const scoreNum = document.createElement("span");
      scoreNum.className = "drawerHeroScore";
      scoreNum.textContent = String(leadAudit.score);
      const scoreUnit = document.createElement("span");
      scoreUnit.className = "drawerHeroScoreUnit";
      scoreUnit.textContent = "/100";
      scoreRow.append(scoreNum, scoreUnit);
      heroLeft.appendChild(scoreRow);
    }
    heroMain.appendChild(heroLeft);

    const heroBadgesCol = document.createElement("div");
    heroBadgesCol.className = "drawerHeroBadgesCol";

    const seoBadge = document.createElement("span");
    seoBadge.className = "drawerHeroBadge";
    seoBadge.textContent = ui.seoBadge || "SEO";
    heroBadgesCol.appendChild(seoBadge);

    if (l.skippedReason !== "NO_ACTIVE_POSITION") {
      const ltKey = String(leadType || "COLD").toUpperCase();
      const typeBadge = document.createElement("span");
      typeBadge.className = `drawerHeroBadge drawerHeroBadge--${ltKey === "HOT" ? "hot" : ltKey === "WARM" ? "warm" : "cold"}`;
      typeBadge.textContent = leadType;
      heroBadgesCol.appendChild(typeBadge);
    }

    heroMain.appendChild(heroBadgesCol);
    hero.appendChild(heroMain);

    if (leadAudit.issuesCount > 0 && seoCode !== "OK" && l.skippedReason !== "NO_ACTIVE_POSITION") {
      const metaEl = document.createElement("div");
      metaEl.className = "drawerHeroMeta";
      metaEl.textContent = currentLang === "fr"
        ? `${leadAudit.issuesCount} problème${leadAudit.issuesCount > 1 ? "s" : ""} SEO détecté${leadAudit.issuesCount > 1 ? "s" : ""}`
        : `${leadAudit.issuesCount} SEO issue${leadAudit.issuesCount > 1 ? "s" : ""} detected`;
      hero.appendChild(metaEl);
    }

    if (ui.reason) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "drawerHeroReason";
      reasonEl.textContent = ui.reason;
      hero.appendChild(reasonEl);
    }

    wrap.appendChild(hero);

    // ── NO_ACTIVE_POSITION early exit ──
    if (l.skippedReason === "NO_ACTIVE_POSITION") {
      const sec = document.createElement("div");
      sec.className = "drawerSection";
      const note = document.createElement("div");
      note.className = "drawerMuted";
      note.textContent = currentLang === "fr" ? "Aucun poste actif détecté." : "No active position detected.";
      sec.appendChild(note);
      wrap.appendChild(sec);
      return wrap;
    }


    // ── SECTION: SEO Snapshot ──
    const seoSec = document.createElement("div");
    const seoSecTone = seoCode === "CRITICAL" ? "danger" : seoCode === "WEAK" ? "warn" : seoCode === "OK" ? "success" : "";
    seoSec.className = "drawerSection drawerSection--data" + (seoSecTone ? ` drawerSection--${seoSecTone}` : "");

    const seoSecTitle = document.createElement("div");
    seoSecTitle.className = "drawerSectionTitle";
    const seoTitleLeft = document.createElement("span");
    seoTitleLeft.style.cssText = "display:flex;align-items:center;gap:0";
    const seoTitleDot = document.createElement("span");
    seoTitleDot.className = "liveDot";
    seoTitleLeft.append(seoTitleDot, t("leads.auditPreviewTitle"));
    seoSecTitle.appendChild(seoTitleLeft);
    seoSec.appendChild(seoSecTitle);

    const kvGrid = document.createElement("div");
    kvGrid.className = "drawerKvGrid";

    const appendKv = (key, value, tone) => {
      const tv = String(value || "").trim();
      if (!tv) return;
      const row = document.createElement("div");
      row.className = "drawerKvRow";
      const k = document.createElement("span");
      k.className = "drawerKvKey";
      k.textContent = key;
      const v = document.createElement("span");
      v.className = "drawerKvVal" + (tone ? ` drawerKvVal--${tone}` : "");
      v.textContent = tv;
      row.append(k, v);
      kvGrid.appendChild(row);
    };

    appendKv(t("leads.auditPreviewStatus"), leadAudit.ui?.seoLabel || leadAudit.ui?.seoBadge || "—");
    if (leadAudit.score !== null) {
      const tone = leadAudit.score >= 75 ? "good" : leadAudit.score >= 50 ? "warn" : "bad";
      appendKv(t("leads.auditPreviewScore"), `${leadAudit.score}/100`, tone);
    }
    if (leadAudit.issuesCount > 0) {
      appendKv(t("leads.auditPreviewIssues"), String(leadAudit.issuesCount), leadAudit.issuesCount <= 3 ? "warn" : "bad");
    }
    if (leadAudit.websiteStatus) {
      appendKv(t("seo.fullAuditWebsiteStatus"), leadAudit.websiteStatus);
    }
    if (!kvGrid.childElementCount) {
      appendKv(t("leads.auditPreviewStatus"), currentLang === "fr" ? "SEO INCONNU" : "SEO UNKNOWN");
    }

    const hint = document.createElement("div");
    hint.className = (canViewFullSeoAudit() ? "drawerHint" : "drawerHint drawerHint--locked") + " drawerHint--row";

    const hintText = document.createElement("span");
    hintText.textContent = canViewFullSeoAudit() ? t("leads.auditPreviewHint") : t("leads.auditPreviewHintLocked");
    hint.appendChild(hintText);

    if (canViewFullSeoAudit()) {
      const btnSeoHint = document.createElement("button");
      btnSeoHint.className = "drawerHintBtn";
      btnSeoHint.textContent = t("button.openSeo");
      btnSeoHint.onclick = (e) => {
        e.stopPropagation();
        goToRoute("seo");
        selectSeoLead(l);
        renderSeoList();
      };
      hint.appendChild(btnSeoHint);
    }

    seoSec.append(kvGrid, hint);
    wrap.appendChild(seoSec);

    // ── SECTION: Opportunities (always shown) ──
    if (Array.isArray(l.opportunities) && l.opportunities.length > 0) {
      const oppSec = document.createElement("div");
      oppSec.className = "drawerSection";

      const oppTitle = document.createElement("div");
      oppTitle.className = "drawerSectionTitle";
      const oppLabel = document.createElement("span");
      oppLabel.textContent = currentLang === "fr" ? "Opportunités" : "Opportunities";
      if (orderedOpps.length > 1) {
        const oppCount = document.createElement("span");
        oppCount.className = "drawerSectionCount";
        oppCount.textContent = String(orderedOpps.length);
        oppTitle.append(oppLabel, oppCount);
      } else {
        oppTitle.append(oppLabel);
      }
      oppSec.appendChild(oppTitle);

      const oppList = document.createElement("div");
      oppList.className = "drawerOppsWrap";
      orderedOpps.forEach((o) => {
        const row = document.createElement("div");
        row.className = "drawerOppRow";

        // Company favicon (paid only)
        if (canViewFullSeoAudit()) {
          const siteUrl = o.website || "";
          const logoWrap = document.createElement("span");
          logoWrap.className = "drawerOppLogo";
          if (siteUrl) {
            try {
              const hostname = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).hostname.replace(/^www\./, "");
              const img = document.createElement("img");
              img.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
              img.alt = hostname;
              img.width = 16; img.height = 16;
              img.onerror = () => { img.style.display = "none"; logoWrap.classList.add("drawerOppLogo--fallback"); };
              logoWrap.appendChild(img);
            } catch { logoWrap.classList.add("drawerOppLogo--fallback"); }
          } else {
            logoWrap.classList.add("drawerOppLogo--fallback");
          }
          row.appendChild(logoWrap);
        }

        const lbl = document.createElement("span");
        lbl.className = "drawerOppName";
        const dn = sanitizeLeadName(o.company || o.jobTitle || "") || (currentLang === "fr" ? "Inconnu" : "Unknown");
        lbl.textContent = clampText(dn, 28);
        lbl.title = dn;
        const badge = document.createElement("span");
        badge.className = "badgeMini";
        if (o.opportunityStatus === "PRIMARY") {
          badge.textContent = t("leads.opp.primary");
          badge.classList.add("badge_good");
        } else if (o.opportunityStatus === "SECONDARY") {
          badge.textContent = t("leads.opp.secondary");
          badge.classList.add("badge_warn");
        } else {
          badge.textContent = t("leads.opp.ignored");
          badge.classList.add("badge_bad");
        }
        row.append(lbl, badge);
        oppList.appendChild(row);
      });

      const switchRow = document.createElement("div");
      switchRow.className = "primarySwitch";
      switchRow.style.marginTop = "8px";
      orderedOpps.forEach((o) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("switchBtn");
        btn.textContent = getOpportunityLabel(o, 16);
        btn.title = o.company || o.jobTitle || "";
        if (o.opportunityStatus === "PRIMARY") btn.classList.add("active");
        btn.onclick = async (e) => {
          e.stopPropagation();
          await chrome.runtime.sendMessage({
            type: "SET_PRIMARY_OPPORTUNITY",
            leadId: l.id,
            opportunityId: o.id,
          });
          if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
        };
        switchRow.appendChild(btn);
      });

      if (orderedOpps.length > 1) {
        oppSec.append(oppList, switchRow);
      } else {
        oppSec.appendChild(oppList);
      }
      wrap.appendChild(oppSec);
    }

    // ── SECONDARY ACTIONS ──
    const isOverrideOpen = overrideEditorProfileUrl === l.profileUrl;
    const currentDecision = String(getDecisionObj(l).final || "IGNORE").toUpperCase();
    const isFreeRetry = !ui._seoCode || ui._seoCode === "SITE_UNREACHABLE";

    const secActions = document.createElement("div");
    secActions.className = "drawerSecondaryActions";

    const btnOverride = document.createElement("button");
    btnOverride.className = "drawerBtn drawerBtn--soft";
    btnOverride.textContent = isOverrideOpen ? t("button.closeOverride") : t("button.override");
    btnOverride.onclick = (e) => {
      e.stopPropagation();
      const opening = !isOverrideOpen;
      overrideEditorProfileUrl = isOverrideOpen ? null : (l.profileUrl || null);
      renderLeads();
      requestAnimationFrame(() => {
        const drawerBody = document.getElementById("leadDetailDrawer")?.querySelector(".leadDrawerBody");
        if (!drawerBody) return;
        if (opening) {
          const panel = drawerBody.querySelector(".drawerOverridePanel");
          if (panel) {
            const top = panel.getBoundingClientRect().top - drawerBody.getBoundingClientRect().top + drawerBody.scrollTop;
            drawerBody.scrollTo({ top, behavior: "smooth" });
          }
        } else {
          drawerBody.scrollTo({ top: drawerBody.scrollHeight, behavior: "smooth" });
        }
      });
    };

    const rescanIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-1px"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
    const rescanLabel = isFreeRetry ? `${t("button.rescan")} (free)` : t("button.rescan");

    const btnRescan = document.createElement("button");
    btnRescan.className = "drawerBtn drawerBtn--soft";
    btnRescan.innerHTML = rescanIcon + rescanLabel;
    btnRescan.onclick = async (e) => {
      e.stopPropagation();
      btnRescan.disabled = true;
      btnRescan.textContent = t("button.rescanning");
      try {
        const res = await chrome.runtime.sendMessage({
          type: "TRIGGER_RESCAN",
          profileUrl: l.profileUrl,
          freeRetry: isFreeRetry,
        });
        if (!res?.ok) {
          showToast(res?.error || "Rescan failed", "error", 3200);
          return;
        }
        showToast(
          currentLang === "fr" ? "Profil ouvert — scan en cours…" : "Profile opened — scanning…",
          "success",
          3000
        );
      } catch (err) {
        showToast(String(err?.message || err), "error", 3200);
      } finally {
        btnRescan.disabled = false;
        btnRescan.innerHTML = rescanIcon + rescanLabel;
      }
    };

    secActions.append(btnOverride, btnRescan);
    wrap.appendChild(secActions);

    // ── OVERRIDE PANEL ──
    if (isOverrideOpen) {
      const overridePanel = document.createElement("div");
      overridePanel.className = "drawerOverridePanel";
      overridePanel.onclick = (e) => e.stopPropagation();

      const overrideLabel = document.createElement("div");
      overrideLabel.className = "drawerOverrideLabel";
      overrideLabel.textContent = t("leads.override.select");

      const overrideChoices = document.createElement("div");
      overrideChoices.className = "drawerOverrideChoices";

      const options = [
        { value: "CONTACT_NOW", label: t("leads.override.contactNow"), tone: "hot" },
        { value: "CONTACT_SOFT", label: t("leads.override.contactSoft"), tone: "warm" },
        { value: "FIND_DECISION_MAKER", label: t("leads.override.findDecider"), tone: "warm" },
        { value: "IGNORE", label: t("leads.override.ignore"), tone: "cold" },
      ];

      options.forEach((option) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `leadOverrideChoice leadOverrideChoice--${option.tone}`;
        btn.textContent = option.label;
        if (currentDecision === option.value) btn.classList.add("active");
        btn.onclick = async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          try {
            const res = await chrome.runtime.sendMessage({
              type: "OVERRIDE_DECISION",
              profileUrl: l.profileUrl,
              decision: { final: option.value, source: "LEADS_INLINE_OVERRIDE", route: "leads" },
            });
            if (!res?.ok) {
              showToast(t("toast.overrideFailed", { error: res?.error || "unknown error" }), "error", 3200);
              return;
            }
            overrideEditorProfileUrl = null;
            showToast(t("toast.decisionUpdated", { label: option.label }), "success", 2000);
            if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
          } catch (err) {
            showToast(t("toast.overrideFailed", { error: String(err?.message || err) }), "error", 3200);
          } finally {
            btn.disabled = false;
          }
        };
        overrideChoices.appendChild(btn);
      });

      overridePanel.append(overrideLabel, overrideChoices);
      wrap.appendChild(overridePanel);
    }

    return wrap;
  }


  /* ================= DETAIL DRAWER ================= */
  function closeDetailDrawer() {
    const drawer = document.getElementById("leadDetailDrawer");
    if (drawer) drawer.classList.remove("is-open");
    const backdrop = document.getElementById("drawerBackdrop");
    if (backdrop) backdrop.classList.remove("is-active");
  }

  function openDrawerBackdrop(onClose) {
    const backdrop = document.getElementById("drawerBackdrop");
    if (!backdrop) return;
    // Sync backdrop bottom with current drawer height
    const drawer = document.getElementById("leadDetailDrawer");
    if (drawer && drawer.style.height) {
      backdrop.style.bottom = drawer.style.height;
    }
    backdrop.classList.add("is-active");
    backdrop.onclick = () => {
      onClose();
    };
  }

  const DRAWER_HEIGHT_MIN = 32;
  const DRAWER_HEIGHT_MAX = 88;
  const DRAWER_H_KEY_LEADS = "prospector_drawerH_leads";
  const DRAWER_H_KEY_SEO   = "prospector_drawerH_seo";

  function applyDrawerHeight(drawer, pct) {
    const clamped = Math.max(DRAWER_HEIGHT_MIN, Math.min(DRAWER_HEIGHT_MAX, pct));
    drawer.style.height = `${clamped}%`;
    // Keep backdrop bottom in sync (leads drawer only)
    const backdrop = document.getElementById("drawerBackdrop");
    if (backdrop && backdrop.classList.contains("is-active")) {
      backdrop.style.bottom = `${clamped}%`;
    }
  }

  function initDrawerResize(drawer, storageKey) {
    const handle = drawer.querySelector(".drawerHandle");
    if (!handle) return;

    // Restore saved height
    const saved = parseFloat(localStorage.getItem(storageKey) || "");
    const defaultH = storageKey === DRAWER_H_KEY_SEO ? 54 : 54;
    const initH = (saved >= DRAWER_HEIGHT_MIN && saved <= DRAWER_HEIGHT_MAX) ? saved : defaultH;
    applyDrawerHeight(drawer, initH);

    let startY = 0;
    let startHeightPx = 0;
    let panelHeightPx = 0;
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = startY - clientY; // up = positive = drawer grows
      const newPx = startHeightPx + dy;
      const newPct = (newPx / panelHeightPx) * 100;
      applyDrawerHeight(drawer, newPct);
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      drawer.style.transition = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      const finalPct = parseFloat(drawer.style.height) || initH;
      localStorage.setItem(storageKey, String(Math.round(finalPct)));
    };

    const onStart = (clientY) => {
      dragging = true;
      startY = clientY;
      startHeightPx = drawer.getBoundingClientRect().height;
      panelHeightPx = (drawer.parentElement || document.body).getBoundingClientRect().height;
      drawer.style.transition = "none"; // instant follow during drag
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
    };

    handle.style.cursor = "ns-resize";
    handle.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientY); });
    handle.addEventListener("touchstart", (e) => {
      e.preventDefault();
      onStart(e.touches[0].clientY);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    }, { passive: false });
  }

  function showLeadInDrawer(l) {
    const drawer = document.getElementById("leadDetailDrawer");
    if (!drawer) return;
    const primaryOpp = getPrimaryOpp(l);
    const orderedOpps = getOrderedOpportunities(l);
    const leadType = getLeadType(l);

    // Header
    const header = document.createElement("div");
    header.className = "leadDrawerHeader";

    const titleEl = document.createElement("div");
    titleEl.className = "leadDrawerTitle";
    titleEl.textContent = sanitizeLeadName(l.name) || "—";

    const badgeEl = document.createElement("span");
    badgeEl.className = "badgeMini";
    if (leadType === "HOT") badgeEl.classList.add("badge-lead-hot");
    else if (leadType === "WARM") badgeEl.classList.add("badge-lead-warm");
    else badgeEl.classList.add("badge-lead-cold");
    badgeEl.textContent = leadType;

    const closeBtn = document.createElement("button");
    closeBtn.className = "leadDrawerClose";
    closeBtn.title = currentLang === "fr" ? "Fermer" : "Close";
    closeBtn.innerHTML = "&#10005;";
    closeBtn.onclick = () => {
      selectedLead = null;
      selectedLeadProfileUrl = null;
      overrideEditorProfileUrl = null;
      closeDetailDrawer();
      hideLeadChooser();
      renderLeads();
      renderMessageSelectors();
    };

    header.append(titleEl, badgeEl, closeBtn);

    // Body
    const body = document.createElement("div");
    body.className = "leadDrawerBody";
    body.appendChild(buildLeadDetailContent(l, primaryOpp, orderedOpps));

    const handle = document.createElement("div");
    handle.className = "drawerHandle";

    drawer.innerHTML = "";
    drawer.appendChild(handle);
    drawer.appendChild(header);
    drawer.appendChild(body);

    drawer.classList.add("is-open");
    initDrawerResize(drawer, DRAWER_H_KEY_LEADS);
    openDrawerBackdrop(() => {
      selectedLead = null;
      selectedLeadProfileUrl = null;
      overrideEditorProfileUrl = null;
      closeDetailDrawer();
      hideLeadChooser();
      renderLeads();
      renderMessageSelectors();
    });
  }

  function showSeoInDrawer(l, audit, canFullAudit) {
    const drawer = document.getElementById("leadDetailDrawer");
    if (!drawer) return;

    // Sort opportunities by SEO criticality: CRITICAL/SITE_UNREACHABLE first, then WEAK/NO_WEBSITE, then OK
    const seoUrgencyRank = (o) => {
      const c = String(o?.ui?._seoCode || o?.seoLevel || "").toUpperCase();
      if (c === "CRITICAL" || c === "SITE_UNREACHABLE") return 0;
      if (c === "WEAK"     || c === "NO_WEBSITE")       return 1;
      if (c === "OK")                                    return 2;
      return 3;
    };
    const rawOpps = Array.isArray(l?.opportunities) ? l.opportunities : [];
    const opportunities = rawOpps.slice().sort((a, b) => seoUrgencyRank(a) - seoUrgencyRank(b));
    const primaryOpp = getMostCriticalOpp(l);

    // Header
    const header = document.createElement("div");
    header.className = "leadDrawerHeader";

    const titleEl = document.createElement("div");
    titleEl.className = "leadDrawerTitle";
    titleEl.textContent = sanitizeLeadName(l.name) || "—";

    // Opportunity switcher — visible in header when multiple opportunities
    if (opportunities.length > 1) {
      const oppWrap = document.createElement("div");
      oppWrap.className = "seoDrawerOppWrap";
      const oppSelect = document.createElement("select");
      oppSelect.className = "routeSelect seoDrawerOppSelect";
      for (const o of opportunities) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = getOpportunityLabel(o, 32);
        if (o.id === selectedSeoOpportunityId) opt.selected = true;
        oppSelect.appendChild(opt);
      }
      oppSelect.addEventListener("change", () => {
        selectedSeoOpportunityId = oppSelect.value || null;
        selectSeoLead(l);
        const newOpp = getOrderedOpportunities(l).find((o) => o.id === selectedSeoOpportunityId) || primaryOpp;
        const newAudit = buildSeoAuditSnapshot(l, newOpp);
        showSeoInDrawer(l, newAudit, canFullAudit);
      });
      oppWrap.appendChild(oppSelect);
      header.append(titleEl, oppWrap);
    } else {
      const seoUrl = l.website || primaryOpp?.website || "";
      if (seoUrl) {
        const urlEl = document.createElement("div");
        urlEl.className = "leadDrawerSubtitle";
        urlEl.textContent = seoUrl;
        urlEl.title = seoUrl;
        header.append(titleEl, urlEl);
      } else {
        header.append(titleEl);
      }
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "leadDrawerClose";
    closeBtn.title = currentLang === "fr" ? "Fermer" : "Close";
    closeBtn.innerHTML = "&#10005;";
    closeBtn.onclick = () => {
      clearSeoLeadSelection();
      closeDetailDrawer();
      renderSeoList();
    };
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    body.className = "leadDrawerBody";
    body.appendChild(buildSeoDetailContent(l, audit, canFullAudit));

    const handle = document.createElement("div");
    handle.className = "drawerHandle";

    drawer.innerHTML = "";
    drawer.appendChild(handle);
    drawer.appendChild(header);
    drawer.appendChild(body);

    drawer.classList.add("is-open");
    initDrawerResize(drawer, DRAWER_H_KEY_SEO);
    openDrawerBackdrop(() => {
      clearSeoLeadSelection();
      closeDetailDrawer();
      renderSeoList();
    });
  }

  function renderLeadsStatBar() {
    if (!leadsStatBarEl) return;
    const s = snapshot?.leadStats || {};
    const leads = snapshot?.leads || [];
    const total = leads.length;
    const hot  = Number(s.HOT  || 0);
    const warm = Number(s.WARM || 0);
    const cold = Number(s.COLD || 0);
    const statDefs = [
      { key: "ALL",  label: "ALL",  color: "#3b82f6", bg: "rgba(59,130,246,0.08)",  count: total },
      { key: "HOT",  label: "HOT",  color: "#ef4444", bg: "rgba(239,68,68,0.08)",   count: hot  },
      { key: "WARM", label: "WARM", color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  count: warm },
      { key: "COLD", label: "COLD", color: "#10b981", bg: "rgba(16,185,129,0.08)",  count: cold },
    ];
    leadsStatBarEl.innerHTML = "";
    statDefs.forEach((s) => {
      const active = leadsListFilter === s.key;
      const btn = document.createElement("button");
      btn.className = "leadsStatItem" + (active ? " leadsStatItem--active" : "");
      btn.style.cssText = `background:${active ? s.color : s.bg};border:none;`;
      btn.innerHTML = `<span class="leadsStatNum" style="color:${active ? "#fff" : s.color};font-size:20px">${s.count}</span>`
                    + `<span class="leadsStatLabel" style="color:${active ? "rgba(255,255,255,0.85)" : "var(--muted)"}">${s.label}</span>`;
      btn.addEventListener("click", () => {
        if (leadsListFilter === s.key) return;
        leadsListFilter = s.key;
        closeDetailDrawer();
        const list = leadListEl;
        if (list) {
          list.style.opacity = "0";
          setTimeout(() => { renderLeads(); list.style.opacity = "1"; }, 120);
        } else { renderLeads(); }
      });
      leadsStatBarEl.appendChild(btn);
    });
  }

  function renderLeads() {
    if (!snapshot || !leadListEl) return;
    syncLeadsSearchUi();
    renderLeadsStatBar();

    leadListEl.innerHTML = "";

    const leads = snapshot.leads || [];
    if (!leads.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = t("leads.empty");
      leadListEl.appendChild(empty);
      return;
    }

    const filteredLeads = filterLeadsList(leads);
    if (!filteredLeads.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = t("leads.emptyFilter");
      leadListEl.appendChild(empty);
      return;
    }

    filteredLeads.forEach((l) => {
      const isSelected = Boolean(selectedLeadProfileUrl && selectedLeadProfileUrl === l.profileUrl);
      const leadType = getLeadType(l);
      const orderedOpps = getOrderedOpportunities(l);
      const positionsCount = orderedOpps.length || (Array.isArray(l.opportunities) ? l.opportunities.length : 0);
      const positionsLabel = positionsCount > 1
        ? t("leads.position.many", { count: positionsCount })
        : t("leads.position.one", { count: positionsCount });
      const leadUiDisplay = getUiDisplay(l);
      const leadSeoCode = String(leadUiDisplay?._seoCode || "").toUpperCase();
      const isUnknownSeo = l.skippedReason === "NO_ACTIVE_POSITION" || !["OK", "WEAK", "CRITICAL", "SITE_UNREACHABLE", "NO_WEBSITE"].includes(leadSeoCode);

      const card = document.createElement("div");
      card.className = "leadCard";
      card.dataset.profileUrl = l.profileUrl || "";
      card.classList.add(isUnknownSeo ? "lead-unknown" : `lead-${String(leadType || "").toLowerCase()}`);
      if (isSelected) {
        card.classList.add("selected");
      }

      const top = document.createElement("div");
      top.className = "leadTop";

      const left = document.createElement("div");
      left.className = "leadTopLeft";
      const leadIdentity = document.createElement("div");
      leadIdentity.className = "leadIdentity";

      const leadFullName = sanitizeLeadName(l.name);
      const nameParts = leadFullName.split(/\s+/).filter(Boolean);
      const leadFirstName = sanitizeLeadName(l.firstName || nameParts[0] || "");
      const leadLastName = sanitizeLeadName(l.lastName || nameParts.slice(1).join(" ") || "");

      const avatar = document.createElement("span");
      avatar.className = "leadAvatar";
      if (l.avatarUrl) {
        const img = document.createElement("img");
        img.src = l.avatarUrl;
        img.alt = leadFullName || "Lead";
        img.className = "leadAvatarImg";
        img.onerror = () => {
          // fallback to initials if image fails to load
          avatar.removeChild(img);
          applyInitialsAvatar(
            avatar,
            buildInitials(leadFirstName, leadLastName, "LD"),
            l.profileUrl || leadFullName || l.id || "lead"
          );
        };
        avatar.appendChild(img);
      } else {
        applyInitialsAvatar(
          avatar,
          buildInitials(leadFirstName, leadLastName, "LD"),
          l.profileUrl || leadFullName || l.id || "lead"
        );
      }
      avatar.title = leadFullName || l.profileUrl || "Lead";

      const name = document.createElement("div");
      name.className = "leadName";
      name.textContent = leadFullName || "—";

      const compactMeta = document.createElement("div");
      compactMeta.className = "leadCompactMeta";
      compactMeta.textContent = isUnknownSeo ? (currentLang === "fr" ? "Aucune position détectée" : "No position detected") : positionsLabel;

      leadIdentity.append(avatar, name);
      left.appendChild(leadIdentity);
      left.appendChild(compactMeta);

      const right = document.createElement("div");
      right.className = "leadTopRight";

      const leadTypeBadge = document.createElement("span");
      leadTypeBadge.className = "badgeMini";
      if (isUnknownSeo) {
        leadTypeBadge.classList.add("badge-lead-unknown");
        leadTypeBadge.textContent = "UNKNOWN";
      } else if (leadType === "HOT") {
        leadTypeBadge.classList.add("badge-lead-hot");
        leadTypeBadge.textContent = leadType;
      } else if (leadType === "WARM") {
        leadTypeBadge.classList.add("badge-lead-warm");
        leadTypeBadge.textContent = leadType;
      } else {
        leadTypeBadge.classList.add("badge-lead-cold");
        leadTypeBadge.textContent = leadType;
      }
      right.appendChild(leadTypeBadge);

      top.appendChild(left);
      top.appendChild(right);
      card.appendChild(top);

      card.onclick = () => {
        const isSame = Boolean(selectedLeadProfileUrl && selectedLeadProfileUrl === l.profileUrl);
        if (isSame) {
          selectedLead = null;
          selectedLeadProfileUrl = null;
          overrideEditorProfileUrl = null;
          closeDetailDrawer();
          hideLeadChooser();
          renderLeads();
          renderMessageSelectors();
          return;
        }
        selectedLead = l;
        selectedLeadProfileUrl = l.profileUrl || null;
        overrideEditorProfileUrl = null;
        showLeadInDrawer(l);
        renderMessageSelectors();
        showLeadChooser(l);
        centerLeadCard(l.profileUrl);
      };
      leadListEl.appendChild(card);
    });

    // Refresh drawer if a lead is currently open
    if (selectedLeadProfileUrl) {
      const sel = filteredLeads.find((l) => l.profileUrl === selectedLeadProfileUrl);
      if (sel) showLeadInDrawer(sel);
    }
  }
  /* ================= DASHBOARD ================= */
  function renderDashboard() {
    if (!snapshot) return;

    const dash = snapshot.dashboard || {};
    const leadStats = dash.leadStats || snapshot.leadStats || {};
    const total = Number(dash.leadsCount ?? leadStats.TOTAL ?? snapshot.leadsCount ?? (snapshot.leads || []).length ?? 0);
    setTextSafe(statCapturedEl, total);

    const actionable = Number(dash.actionable ?? (snapshot.leads || []).filter(isActionable).length);
    const conv = Number(
      dash.conversionPct ??
      (total > 0 ? Math.round((actionable / total) * 100) : 0)
    );
    setTextSafe(statConversionEl, `${conv}%`);

    // Count as decider if lead OR any opportunity carries a decider signal.
    const hasDeciderSignal = (rawRole) => {
      const r = String(rawRole || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
      return (
        r.includes("DECISION") ||
        r.includes("DECIDEUR") ||
        r.includes("CEO") ||
        r.includes("FOUNDER") ||
        r.includes("OWNER") ||
        r.includes("DIRECTOR")
      );
    };

    const deciders = Number(
      dash.deciders ??
      (snapshot.leads || []).filter((l) => {
        const ui = getUiObj(l);
        if (hasDeciderSignal(ui.role)) return true;
        const opps = Array.isArray(l?.opportunities) ? l.opportunities : [];
        return opps.some((o) => hasDeciderSignal(o?.role || o?.ui?.role));
      }).length
    );

    setTextSafe(statDecidersEl, deciders);

    const ignored = Number(
      dash.ignored ??
      (snapshot.leads || []).filter((l) => {
        const action = String(getUiObj(l)?.actionLabel || "").toUpperCase();
        return action.includes("IGNORE");
      }).length
    );
    const dailyLimit = Number(snapshot.dailyLimit || 0);
    const todayCount = Number(snapshot.todayCount || 0);
    const scansLeft = Math.max(0, dailyLimit - todayCount);

    setTextSafe(dashHotEl, leadStats.HOT || 0);
    setTextSafe(dashWarmEl, leadStats.WARM || 0);
    setTextSafe(dashColdEl, leadStats.COLD || 0);
    setTextSafe(dashActionableEl, actionable);
    setTextSafe(dashIgnoredEl, ignored);
    setTextSafe(dashLastCaptureEl, formatDateTime(dash.lastCaptureAt || snapshot?.lastCapture?.at));
    setTextSafe(dashTodayTextEl, t("dashboard.scansUsed", { left: scansLeft, limit: dailyLimit }));
    applyQuotaBadgeTone(dashTodayTextEl, resolveUsageTone(todayCount, dailyLimit), "dashboardTodayBadge");

    const hot = Number(leadStats.HOT || 0);
    const warm = Number(leadStats.WARM || 0);
    const cold = Number(leadStats.COLD || 0);

    setBar(dashTodayBarEl, toPct(scansLeft, dailyLimit), resolveUsageTone(todayCount, dailyLimit));
    setBar(dashHotBarEl, toPct(hot, total));
    setBar(dashWarmBarEl, toPct(warm, total));
    setBar(dashColdBarEl, toPct(cold, total));
    setBar(dashActionableBarEl, toPct(actionable, total));
    setBar(dashIgnoredBarEl, toPct(ignored, total));

    const actionableRate = total > 0 ? Math.round((actionable / total) * 100) : 0;
    const deciderRate = total > 0 ? Math.round((deciders / total) * 100) : 0;
    const hotRate = total > 0 ? Math.round((hot / total) * 100) : 0;
    const qualityScore = Math.round((actionableRate * 0.5) + (deciderRate * 0.3) + (hotRate * 0.2));

    setTextSafe(dashActionableRateEl, `${actionableRate}%`);
    setTextSafe(dashDeciderRateEl, `${deciderRate}%`);
    setTextSafe(dashHotRateEl, `${hotRate}%`);
    setBar(dashQualityBarEl, qualityScore);

    if (dashPulseTagEl) {
      dashPulseTagEl.className = "badge info";
      if (qualityScore >= 70) {
        dashPulseTagEl.className = "badge good";
        dashPulseTagEl.textContent = t("dashboard.pulse.strong");
      } else if (qualityScore >= 45) {
        dashPulseTagEl.className = "badge info";
        dashPulseTagEl.textContent = t("dashboard.pulse.steady");
      } else {
        dashPulseTagEl.className = "badge warn";
        dashPulseTagEl.textContent = t("dashboard.pulse.early");
      }
    }

    setTextSafe(
      dashPulseHintEl,
      t("dashboard.qualityHint", {
        score: qualityScore,
        left: scansLeft,
        limit: dailyLimit || 0,
      })
    );
  }

  /* ================= MENU BADGES ================= */
  function renderMenuBadges() {
    if (!snapshot) return;

    const dash = snapshot.dashboard || {};
    const leadsTotal = Number(
      dash.leadsCount ??
      snapshot.leadStats?.TOTAL ??
      snapshot.leadsCount ??
      (snapshot.leads || []).length ??
      0
    );
    const actionable = Number(dash.actionable ?? (snapshot.leads || []).filter(isActionable).length);

    if (navBadgeLeads) {
      if (leadsTotal > 0) {
        navBadgeLeads.style.display = "grid";
        navBadgeLeads.textContent = String(leadsTotal);
      } else {
        navBadgeLeads.style.display = "none";
      }
    }

    if (navBadgeMessages) {
      if (actionable > 0) {
        navBadgeMessages.style.display = "grid";
        navBadgeMessages.textContent = String(actionable);
      } else {
        navBadgeMessages.style.display = "none";
      }
    }
  }
  function getLeadType(l) {
    // Scan all opportunities — show the hottest type (HOT > WARM > COLD)
    const opps = Array.isArray(l?.opportunities) ? l.opportunities : [];
    for (const opp of opps) {
      if (normalizeLeadType(opp?.leadType || "") === "HOT") return "HOT";
    }
    for (const opp of opps) {
      if (normalizeLeadType(opp?.leadType || "") === "WARM") return "WARM";
    }
    // Fall back to lead-level decision
    const directType = normalizeLeadType(
      l?.leadType ||
      l?.decision?.leadType ||
      getDecisionObj(l)?.leadType ||
      ""
    );
    if (directType === "HOT" || directType === "WARM" || directType === "COLD") {
      return directType;
    }

    const ui = getUiObj(l);
    const act = String(ui.actionLabel || getDecisionObj(l)?.final || "").toUpperCase();

    if (
      act.includes("CONTACT_NOW") ||
      act.includes("CONTACT NOW")
    ) return "HOT";

    if (
      act.includes("CONTACT_SOFT") ||
      act.includes("CONTACT SOFT") ||
      act.includes("CONTACT DOUX") ||
      act.includes("FIND_DECISION_MAKER") ||
      act.includes("FIND DECISION MAKER") ||
      act.includes("DECISION") ||
      act.includes("TROUVER")
    ) return "WARM";

    return "COLD";
  }

  function normalizeFilterToken(v) {
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  function getSeoAuditCategory(lead) {
    const ui = getUiObj(lead);
    const d = getDecisionObj(lead);
    const seoSignal = normalizeFilterToken(d?.signals?.seoLevel || d?.signals?.seo || "");
    const token = normalizeFilterToken(
      `${ui.seoBadge || ""} ${ui.seoLabel || ""} ${seoSignal}`
    );
    if (/\bNO[\s_]*WEBSITE\b|\bNO[\s_]*SITE\b|\bSANS[\s_]*SITE\b|\bAUCUN[\s_]*SITE\b/.test(token)) {
      return "NO_WEBSITE";
    }
    if (/\bSITE[\s_]*(INACCESSIBLE|UNREACHABLE|DOWN)\b|\bUNREACHABLE\b|\bTIMEOUT\b/.test(token)) {
      return "SITE_UNREACHABLE";
    }
    if (/\bCRIT(?:IQUE)?\b/.test(token)) return "CRITIQUE";
    if (/\bFAIBLE\b|\bLOW\b|\bWEAK\b/.test(token)) return "FAIBLE";
    if (/\bUNKNOWN\b|\bINCONNU\b/.test(token)) return "UNKNOWN";
    if (/\bSEO\s*OK\b|\bOK\b/.test(token)) return "OK";
    return "UNKNOWN";
  }

  function filterLeadsList(leads = []) {
    const all = Array.isArray(leads) ? leads : [];
    const byType = leadsListFilter === "ALL"
      ? all
      : all.filter((l) => getLeadType(l) === leadsListFilter);
    const query = String(leadsSearchQuery || "");
    if (!query.trim()) return byType;
    return byType.filter((l) => leadMatchesSearch(l, query));
  }

  function filterSeoList(leads = []) {
    const all = Array.isArray(leads) ? leads : [];
    if (seoListFilter === "ALL")      return all;
    if (seoListFilter === "CRITICAL") return all.filter((l) => ["CRITIQUE", "SITE_UNREACHABLE"].includes(getSeoAuditCategory(l)));
    if (seoListFilter === "WEAK")     return all.filter((l) => ["FAIBLE", "NO_WEBSITE"].includes(getSeoAuditCategory(l)));
    if (seoListFilter === "OK")       return all.filter((l) => getSeoAuditCategory(l) === "OK");
    return all.filter((l) => getSeoAuditCategory(l) === seoListFilter);
  }

  function parseActionCode(rawFinal, rawLabel) {
    const token = normalizeFilterToken(`${rawFinal || ""} ${rawLabel || ""}`);
    if (/\bCONTACT[_\s]*NOW\b|\bCONTACTER[\s_]*MAINTENANT\b/.test(token)) return "CONTACT_NOW";
    if (/\bCONTACT[_\s]*(SOFT|DOUX)\b|\bCONTACT[\s_]*DOUX\b/.test(token)) return "CONTACT_SOFT";
    if (/\bFIND[\s_]*DECISION\b|\bTROUVER[\s_]*DECIDEUR\b|\bDECISION[_\s]*MAKER\b/.test(token)) return "FIND_DECISION_MAKER";
    if (/\bIGNORE\b|\bIGNORER\b/.test(token)) return "IGNORE";
    if (/\bSKIPPED?\b|\bSKIP\b/.test(token)) return "SKIPPED";
    return "UNKNOWN";
  }

  function parseRoleCode(rawRole) {
    const token = normalizeFilterToken(rawRole || "");
    if (/\bDECISION[_\s]*MAKER\b|\bDECIDEUR\b|\bCEO\b|\bFOUNDER\b|\bOWNER\b|\bDIRECTOR\b/.test(token)) return "DECISION_MAKER";
    if (/\bMARKETING\b/.test(token)) return "MARKETING";
    if (/\bSALES\b/.test(token)) return "SALES";
    return "UNKNOWN";
  }

  function parseSeoCode(ui, decision) {
    const token = normalizeFilterToken(
      `${ui?.seoBadge || ""} ${ui?.seoLabel || ""} ${decision?.signals?.seoLevel || ""} ${decision?.signals?.seo || ""}`
    );
    if (/\bNO[\s_]*WEBSITE\b|\bNO[\s_]*SITE\b|\bAUCUN[\s_]*SITE\b|\bSANS[\s_]*SITE\b/.test(token)) return "NO_WEBSITE";
    if (/\bSITE[\s_]*(INACCESSIBLE|UNREACHABLE|DOWN)\b|\bUNREACHABLE\b|\bTIMEOUT\b/.test(token)) return "SITE_UNREACHABLE";
    if (/\bCRIT(?:ICAL|IQUE)?\b/.test(token)) return "CRITICAL";
    if (/\bWEAK\b|\bFAIBLE\b|\bLOW\b/.test(token)) return "WEAK";
    if (/\bSEO[\s_]*OK\b|\bOK\b/.test(token)) return "OK";
    return "UNKNOWN";
  }

  function localizeActionLabel(actionCode) {
    const isFr = currentLang === "fr";
    switch (actionCode) {
      case "CONTACT_NOW": return isFr ? "Contacter maintenant" : "Contact now";
      case "CONTACT_SOFT": return isFr ? "Contact doux" : "Contact soft";
      case "FIND_DECISION_MAKER": return isFr ? "Trouver décideur" : "Find decision maker";
      case "IGNORE": return isFr ? "Ignorer" : "Ignore";
      case "SKIPPED": return isFr ? "Ignoré" : "Skipped";
      default: return isFr ? "Inconnu" : "Unknown";
    }
  }

  function localizeRoleLabel(roleCode) {
    const isFr = currentLang === "fr";
    switch (roleCode) {
      case "DECISION_MAKER": return isFr ? "Décideur" : "Decision-maker";
      case "MARKETING": return isFr ? "Marketing" : "Marketing";
      case "SALES": return isFr ? "Ventes" : "Sales";
      default: return isFr ? "Inconnu" : "Unknown";
    }
  }

  function localizeSeoBadge(seoCode) {
    const isFr = currentLang === "fr";
    switch (seoCode) {
      case "CRITICAL": return isFr ? "SEO CRITIQUE" : "SEO CRITICAL";
      case "WEAK": return isFr ? "SEO FAIBLE" : "SEO WEAK";
      case "OK": return "SEO OK";
      case "NO_WEBSITE": return isFr ? "PAS DE SITE WEB" : "NO WEBSITE";
      case "SITE_UNREACHABLE": return isFr ? "SITE INACCESSIBLE" : "SITE UNREACHABLE";
      default: return isFr ? "SEO INCONNU" : "SEO UNKNOWN";
    }
  }

  function localizeSeoLabel(seoCode) {
    const isFr = currentLang === "fr";
    switch (seoCode) {
      case "CRITICAL": return isFr ? "SEO critique détecté" : "Critical SEO issues detected";
      case "WEAK": return isFr ? "Faiblesses SEO détectées" : "SEO weaknesses detected";
      case "OK": return isFr ? "SEO correct" : "SEO looks healthy";
      case "NO_WEBSITE": return isFr ? "Aucun site web détecté" : "No website detected";
      case "SITE_UNREACHABLE": return isFr ? "Site web inaccessible" : "Website unreachable";
      default: return isFr ? "Statut SEO inconnu" : "SEO status unknown";
    }
  }

  function localizeReason(lead, ui, actionCode, roleCode, seoCode) {
    const isFr = currentLang === "fr";
    if (actionCode === "SKIPPED" || lead?.skippedReason === "NO_ACTIVE_POSITION") {
      return isFr ? "Aucune position active détectée" : "No active position detected";
    }
    if (roleCode === "DECISION_MAKER") {
      if (seoCode === "CRITICAL") return isFr ? "Décideur identifié et SEO critique" : "Decision-maker identified and SEO is critical";
      if (seoCode === "WEAK") return isFr ? "Décideur identifié et SEO faible" : "Decision-maker identified and SEO has weaknesses";
      if (seoCode === "NO_WEBSITE") return isFr ? "Décideur identifié mais entreprise sans site web" : "Decision-maker identified but company has no website";
      if (seoCode === "SITE_UNREACHABLE") return isFr ? "Site web inaccessible + décideur identifié" : "Website unreachable + decision-maker identified";
      if (seoCode === "OK") return isFr ? "Décideur identifié et SEO correct" : "Decision-maker identified and SEO looks healthy";
    }
    if (actionCode === "FIND_DECISION_MAKER") {
      return isFr ? "Trouver le décideur dans l'entreprise" : "Find the decision-maker in the company";
    }
    if (actionCode === "IGNORE") {
      return isFr ? "Priorité faible pour le moment" : "Low priority for now";
    }
    const raw = String(ui?.reason || "").trim();
    if (!raw) return isFr ? "Raison indisponible" : "Reason unavailable";
    if (isFr) {
      return raw
        .replace("Decision-maker identified and SEO is critical", "Décideur identifié et SEO critique")
        .replace("Decision-maker identified and SEO has weaknesses", "Décideur identifié et SEO faible")
        .replace("Decision-maker identified but company has no website", "Décideur identifié mais entreprise sans site web")
        .replace("Site web inaccessible + decision-maker identified", "Site web inaccessible + décideur identifié");
    }
    return raw
      .replace("Décideur identifié et SEO critique", "Decision-maker identified and SEO is critical")
      .replace("Décideur identifié et SEO faible", "Decision-maker identified and SEO has weaknesses")
      .replace("Décideur identifié mais entreprise sans site web", "Decision-maker identified but company has no website")
      .replace("Site web inaccessible + décideur identifié", "Website unreachable + decision-maker identified");
  }

  function getUiDisplay(lead, uiCandidate = null) {
    const rawUi = (uiCandidate && typeof uiCandidate === "object")
      ? {
          ...getUiObj(lead),
          ...uiCandidate,
        }
      : getUiObj(lead);
    const decision = getDecisionObj(lead) || {};
    const actionCode = parseActionCode(decision?.final, rawUi?.actionLabel);
    const roleCode = parseRoleCode(decision?.signals?.role || rawUi?.role);
    const seoCode = parseSeoCode(rawUi, decision);

    return {
      ...rawUi,
      actionLabel: localizeActionLabel(actionCode),
      role: localizeRoleLabel(roleCode),
      seoBadge: localizeSeoBadge(seoCode),
      seoLabel: localizeSeoLabel(seoCode),
      reason: localizeReason(lead, rawUi, actionCode, roleCode, seoCode),
      _actionCode: actionCode,
      _roleCode: roleCode,
      _seoCode: seoCode,
    };
  }



  /* ================= MESSAGES ================= */
  function renderMessagePreview(lead, opp = null) {
    if (!lead) return;
    selectedLead = lead;
    selectedMsgLeadProfileUrl = lead.profileUrl || null;

    const chosenOpp = opp || getPrimaryOpp(lead);
    if (chosenOpp?.id) selectedMsgOpportunityId = chosenOpp.id;

    setTextSafe(msgProfileEl, lead.profileUrl || "—");
    const leadTypeVal = getLeadType(lead);
    setTextSafe(msgLeadTypeEl, leadTypeVal);
    if (msgLeadTypeEl) {
      const t = String(leadTypeVal || "").toUpperCase();
      let cls = "badge";
      if      (t === "HOT")  cls += " badge-lead-hot";
      else if (t === "WARM") cls += " badge-lead-warm";
      else if (t === "COLD") cls += " badge-lead-cold";
      else                   cls += " badge-lead-unknown";
      msgLeadTypeEl.className = cls;
    }

    const ui = getUiDisplay(
      lead,
      chosenOpp?.ui && typeof chosenOpp.ui === "object" ? chosenOpp.ui : null
    );
    setTextSafe(msgActionEl, ui.actionLabel || "—");
    if (msgActionEl) msgActionEl.className = "badge";

    const name = sanitizeLeadName(lead.name) ? ` ${sanitizeLeadName(lead.name)}` : "";
    const _companyClean = sanitizeLeadName(chosenOpp?.company || "");
    const company = _companyClean ? (currentLang === "fr" ? ` chez ${_companyClean}` : ` at ${_companyClean}`) : "";
    const reason = ui.reason || "";
    const contextKey = getMessageContextKey(lead, chosenOpp);
    activeMsgContextKey = contextKey;

    const lineQuick = reason ? `${t("messages.template.quickNote", { reason })}\n` : "";
    const fallbackMessage =
`${t("messages.template.greeting", { name })}

${t("messages.template.line1", { company })}

${lineQuick}${t("messages.template.line2")}

${t("messages.template.signature")}
`;
    let draft = getMessageDraft(contextKey);
    if (!draft) {
      draft = saveMessageDraft(contextKey, {
        text: fallbackMessage,
        variants: [fallbackMessage],
        selectedVariant: 0,
        generated: false,
        source: "template",
      });
    }
    if (messageBoxEl) {
      messageBoxEl.value = String(draft?.text || fallbackMessage);
    }
    renderMessageVariantSelector(contextKey);
    updateSendButtonState();
  }

  function getRecommendedTone(lead, opp) {
    const lt  = getLeadType(lead);                                          // HOT | WARM | COLD
    const raw = String(opp?.ui?._seoCode || opp?.seoLevel || "").toUpperCase();
    const seo = ["CRITICAL","SITE_UNREACHABLE"].includes(raw) ? "CRITICAL"
              : raw === "WEAK" ? "WEAK" : "OK";

    if (lt === "HOT")  return seo === "CRITICAL" ? "consultative" : "friendly";
    if (lt === "WARM") return seo === "CRITICAL" ? "direct"       : seo === "WEAK" ? "consultative" : "friendly";
    /* COLD */         return seo === "CRITICAL" ? "direct"       : "professional";
  }

  function applyTonePills(recommended) {
    const tonePillsEl = $("msgTonePills");
    if (!tonePillsEl) return;
    tonePillsEl.querySelectorAll(".msgTonePill").forEach(p => {
      const isActive      = p.dataset.tone === activeMsgTone;
      const isRecommended = p.dataset.tone === recommended;
      p.classList.toggle("active", isActive);
      // Add/remove ★ badge
      let badge = p.querySelector(".tonePillStar");
      if (isRecommended) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "tonePillStar";
          badge.textContent = "★";
          badge.setAttribute("aria-label", "recommended");
          p.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function closeMsgPicker() {
    msgPickerOpen = false;
    if (msgPickerDropdownEl) msgPickerDropdownEl.classList.remove("is-open");
    if (msgPickerTriggerEl)  msgPickerTriggerEl.classList.remove("is-open");
  }

  function renderMessageSelectors() {
    if (!msgOpportunitySelectEl) return;
    const leads = snapshot?.leads || [];

    if (!leads.length) {
      if (msgPickerAvatarEl) msgPickerAvatarEl.textContent = "?";
      if (msgPickerNameEl)   msgPickerNameEl.textContent = currentLang === "fr" ? "Aucun lead" : "No lead";
      if (msgPickerSubEl)    msgPickerSubEl.textContent   = "";
      if (msgPickerDropdownEl) msgPickerDropdownEl.innerHTML = "";
      if (msgOppRowEl) msgOppRowEl.style.display = "none";
      msgOpportunitySelectEl.innerHTML = "";
      activeMsgContextKey = null;
      clearMessageVariantSelector();
      if (btnSendMsg) btnSendMsg.disabled = true;
      return;
    }

    if (!selectedMsgLeadProfileUrl) {
      selectedMsgLeadProfileUrl = selectedLead?.profileUrl || leads[0]?.profileUrl || null;
    }

    let selectedLeadObj = findLeadByProfileUrl(selectedMsgLeadProfileUrl);
    if (!selectedLeadObj) {
      selectedLeadObj = leads[0];
      selectedMsgLeadProfileUrl = selectedLeadObj?.profileUrl || null;
    }
    if (!selectedLeadObj) {
      activeMsgContextKey = null;
      clearMessageVariantSelector();
      return;
    }

    // ── Opportunity select (resolve early so picker sub reflects active opp) ──
    const orderedOpps = getOrderedOpportunities(selectedLeadObj);
    const primaryOpp  = getPrimaryOpp(selectedLeadObj);
    const allowedIds  = new Set(orderedOpps.map((o) => o.id));
    if (!selectedMsgOpportunityId || !allowedIds.has(selectedMsgOpportunityId)) {
      selectedMsgOpportunityId = primaryOpp?.id || orderedOpps[0]?.id || null;
    }
    const activeOpp = orderedOpps.find((o) => o.id === selectedMsgOpportunityId) || primaryOpp || orderedOpps[0] || null;

    // ── Picker trigger display ──
    if (msgPickerAvatarEl) {
      msgPickerAvatarEl.innerHTML = "";
      msgPickerAvatarEl.style.background = "";
      const _nameParts0 = String(selectedLeadObj.name || "").trim().split(/\s+/).filter(Boolean);
      const _fn0 = String(selectedLeadObj.firstName || _nameParts0[0] || "").trim();
      const _ln0 = String(selectedLeadObj.lastName  || _nameParts0.slice(1).join(" ") || "").trim();
      if (selectedLeadObj.avatarUrl) {
        const img = document.createElement("img");
        img.src = selectedLeadObj.avatarUrl;
        img.className = "leadAvatarImg";
        img.onerror = () => {
          msgPickerAvatarEl.removeChild(img);
          applyInitialsAvatar(msgPickerAvatarEl, buildInitials(_fn0, _ln0, "?"), selectedLeadObj.profileUrl || selectedLeadObj.name || "lead");
        };
        msgPickerAvatarEl.appendChild(img);
      } else {
        applyInitialsAvatar(msgPickerAvatarEl, buildInitials(_fn0, _ln0, "?"), selectedLeadObj.profileUrl || selectedLeadObj.name || "lead");
      }
    }
    if (msgPickerNameEl)   msgPickerNameEl.textContent = sanitizeLeadName(selectedLeadObj.name) || (currentLang === "fr" ? "Inconnu" : "Unknown");
    if (msgPickerSubEl) {
      // Show active opportunity label as subtitle so user knows what's targeted
      const oppLabel = activeOpp ? getOpportunityLabel(activeOpp, 48) : null;
      msgPickerSubEl.textContent = oppLabel || sanitizeLeadName(activeOpp?.company || "") || selectedLeadObj.profileUrl || "";
    }

    // Keep hidden compat elements in sync (used by other JS consumers)
    if (msgProfileEl)   msgProfileEl.textContent  = selectedLeadObj.profileUrl || "";
    if (msgLeadTypeEl)  { const lt = getLeadType(selectedLeadObj); msgLeadTypeEl.textContent = lt; }
    const ui = getUiDisplay(selectedLeadObj, activeOpp?.ui && typeof activeOpp.ui === "object" ? activeOpp.ui : null);
    if (msgActionEl)    msgActionEl.textContent = ui.actionLabel || "";

    // ── Picker dropdown ──
    if (msgPickerDropdownEl) {
      msgPickerDropdownEl.innerHTML = "";
      for (const lead of leads) {
        const item = document.createElement("div");
        item.className = "msgPickerItem" + (lead.profileUrl === selectedMsgLeadProfileUrl ? " is-selected" : "");
        item.dataset.profileUrl = lead.profileUrl || "";
        const av = document.createElement("div");
        av.className = "msgPickerItemAvatar";
        const _np = String(lead.name || "").trim().split(/\s+/).filter(Boolean);
        const _fn = String(lead.firstName || _np[0] || "").trim();
        const _ln = String(lead.lastName  || _np.slice(1).join(" ") || "").trim();
        if (lead.avatarUrl) {
          const img = document.createElement("img");
          img.src = lead.avatarUrl;
          img.className = "leadAvatarImg";
          img.onerror = () => {
            av.removeChild(img);
            applyInitialsAvatar(av, buildInitials(_fn, _ln, "?"), lead.profileUrl || lead.name || "lead");
          };
          av.appendChild(img);
        } else {
          applyInitialsAvatar(av, buildInitials(_fn, _ln, "?"), lead.profileUrl || lead.name || "lead");
        }
        const info = document.createElement("div");
        info.className = "msgPickerItemInfo";
        const nm = document.createElement("div");
        nm.className = "msgPickerItemName";
        nm.textContent = sanitizeLeadName(lead.name) || (currentLang === "fr" ? "Inconnu" : "Unknown");
        const sub = document.createElement("div");
        sub.className = "msgPickerItemSub";
        const opp = getPrimaryOpp(lead);
        sub.textContent = sanitizeLeadName(opp?.company || "") || lead.profileUrl || "";
        info.append(nm, sub);
        const lt = normalizeLeadType(opp?.leadType || "");
        if (lt === "HOT" || lt === "WARM") {
          const badge = document.createElement("span");
          badge.className = `msgPickerBadge msgPickerBadge--${lt.toLowerCase()}`;
          badge.textContent = lt;
          item.append(av, info, badge);
        } else {
          item.append(av, info);
        }
        item.addEventListener("click", () => {
          selectedMsgLeadProfileUrl = lead.profileUrl || null;
          selectedMsgOpportunityId  = null;
          closeMsgPicker();
          renderMessageSelectors();
        });
        msgPickerDropdownEl.appendChild(item);
      }
    }

    // ── Opportunity select ──
    msgOpportunitySelectEl.innerHTML = "";
    for (const o of orderedOpps) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = getOpportunityLabel(o, 40);
      if (o.id === selectedMsgOpportunityId) opt.selected = true;
      msgOpportunitySelectEl.appendChild(opt);
    }
    // Always show opp row — even with 1 opp, so user sees what's targeted
    if (msgOppRowEl) msgOppRowEl.style.display = orderedOpps.length > 0 ? "" : "none";

    // ── Tone recommendation ──
    applyTonePills(getRecommendedTone(selectedLeadObj, activeOpp));

    renderMessagePreview(selectedLeadObj, activeOpp);
  }

  function selectLead(lead) {
    if (!lead) return;
    selectedLead = lead;
    selectedLeadProfileUrl = lead.profileUrl || null;
    selectedMsgLeadProfileUrl = lead.profileUrl || null;
    selectedMsgOpportunityId = getPrimaryOpp(lead)?.id || null;
    renderMessageSelectors();
  }

  /* ================= SEO ROUTE ================= */

  /* ================= SEO DETAIL CONTENT ================= */
  function buildSeoDetailContent(_l, audit, canFullAudit) {
    const wrap = document.createElement("div");
    wrap.className = "drawerContent";

    const seoCode = audit.ui?._seoCode || "";
    const heroKey = seoCode === "CRITICAL" ? "critical"
      : seoCode === "WEAK" ? "weak"
      : seoCode === "OK" ? "ok"
      : seoCode === "SITE_UNREACHABLE" ? "unreachable" : "unknown";

    // ── HERO ──
    const hero = document.createElement("div");
    hero.className = `drawerHero drawerHero--${heroKey}`;

    // Score (left, with logo before) + badges stacked (right)
    const heroMain = document.createElement("div");
    heroMain.className = "drawerHeroMain";

    // Left group: logo + score
    const heroLeft = document.createElement("div");
    heroLeft.className = "drawerHeroLeft";

    // Site logo (paid only)
    if (canFullAudit) {
      const siteUrl = audit.website || "";
      const drawerLogo = document.createElement("div");
      drawerLogo.className = "drawerHeroLogo";
      if (siteUrl) {
        try {
          const hostname = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).hostname.replace(/^www\./, "");
          const logoImg = document.createElement("img");
          logoImg.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
          logoImg.alt = hostname;
          logoImg.className = "drawerHeroLogoImg";
          logoImg.onerror = () => {
            drawerLogo.removeChild(logoImg);
            drawerLogo.textContent = (sanitizeLeadName(audit.company || "") || hostname).charAt(0).toUpperCase();
            drawerLogo.classList.add("drawerHeroLogoFallback");
          };
          drawerLogo.appendChild(logoImg);
        } catch {
          drawerLogo.textContent = (sanitizeLeadName(audit.company || "") || "").charAt(0).toUpperCase() || "?";
          drawerLogo.classList.add("drawerHeroLogoFallback");
        }
      } else {
        drawerLogo.textContent = (sanitizeLeadName(audit.company || "") || "").charAt(0).toUpperCase() || "?";
        drawerLogo.classList.add("drawerHeroLogoFallback");
      }
      heroLeft.appendChild(drawerLogo);
    }

    const knownSeoCode = ["OK", "WEAK", "CRITICAL", "SITE_UNREACHABLE", "NO_WEBSITE"].includes(seoCode);
    if (knownSeoCode && audit.score !== null) {
      const scoreRow = document.createElement("div");
      scoreRow.className = "drawerHeroScoreRow";
      const scoreNum = document.createElement("span");
      scoreNum.className = "drawerHeroScore";
      scoreNum.textContent = String(audit.score);
      const scoreUnit = document.createElement("span");
      scoreUnit.className = "drawerHeroScoreUnit";
      scoreUnit.textContent = "/100";
      scoreRow.append(scoreNum, scoreUnit);
      heroLeft.appendChild(scoreRow);
    }

    heroMain.appendChild(heroLeft);

    const heroBadgesCol = document.createElement("div");
    heroBadgesCol.className = "drawerHeroBadgesCol";

    const seoBadge = document.createElement("span");
    seoBadge.className = "drawerHeroBadge";
    seoBadge.textContent = audit.ui?.seoBadge || (currentLang === "fr" ? "SEO: INCONNU" : "SEO: UNKNOWN");
    heroBadgesCol.appendChild(seoBadge);

    if (canFullAudit && audit.siteType) {
      const typeBadge = document.createElement("span");
      typeBadge.className = "drawerHeroBadge drawerHeroBadge--role";
      typeBadge.textContent = audit.siteType;
      heroBadgesCol.appendChild(typeBadge);
    }

    heroMain.appendChild(heroBadgesCol);
    hero.appendChild(heroMain);

    if (audit.issuesCount > 0) {
      const metaEl = document.createElement("div");
      metaEl.className = "drawerHeroMeta";
      metaEl.textContent = currentLang === "fr"
        ? `${audit.issuesCount} problème${audit.issuesCount > 1 ? "s" : ""} SEO détecté${audit.issuesCount > 1 ? "s" : ""}`
        : `${audit.issuesCount} SEO issue${audit.issuesCount > 1 ? "s" : ""} detected`;
      hero.appendChild(metaEl);
    }

    if (audit.reason) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "drawerHeroReason";
      reasonEl.textContent = audit.reason;
      hero.appendChild(reasonEl);
    }

    wrap.appendChild(hero);

    if (canFullAudit) {
      // ── SECTION: Key metrics ──
      const metricsSec = document.createElement("div");
      metricsSec.className = "drawerSection drawerSection--data";

      const metricsTitle = document.createElement("div");
      metricsTitle.className = "drawerSectionTitle";
      const _mLeft = document.createElement("span");
      _mLeft.className = "drawerSectionTitleLeft";
      const _mDot = document.createElement("span"); _mDot.className = "drawerPulseDot";
      const _mLbl = document.createElement("span"); _mLbl.textContent = currentLang === "fr" ? "Métriques clés" : "Key metrics";
      _mLeft.append(_mDot, _mLbl);
      metricsTitle.appendChild(_mLeft);
      metricsSec.appendChild(metricsTitle);

      const kvGrid = document.createElement("div");
      kvGrid.className = "drawerKvGrid";

      const appendKv = (key, value, tone) => {
        const tv = String(value || "").trim();
        if (!tv) return;
        const row = document.createElement("div");
        row.className = "drawerKvRow";
        const k = document.createElement("span");
        k.className = "drawerKvKey";
        k.textContent = key;
        const v = document.createElement("span");
        v.className = "drawerKvVal" + (tone ? ` drawerKvVal--${tone}` : "");
        v.textContent = tv;
        row.append(k, v);
        kvGrid.appendChild(row);
      };

      if (knownSeoCode && audit.score !== null) {
        const tone = seoCode === "OK" ? "good" : seoCode === "WEAK" ? "warn" : "bad";
        appendKv(t("seo.fullAuditScore"), `${audit.score}/100`, tone);
      }
      if (audit.websiteStatus) appendKv(t("seo.fullAuditWebsiteStatus"), audit.websiteStatus);
      if (audit.source) appendKv(t("seo.fullAuditSource"), audit.source);
      if (audit.gatheredAt) {
        const d = new Date(audit.gatheredAt);
        const label = isNaN(d.getTime()) ? audit.gatheredAt : d.toLocaleDateString(currentLang === "fr" ? "fr-FR" : "en-GB");
        appendKv(currentLang === "fr" ? "Analysé le" : "Analysed on", label);
      }

      if (kvGrid.childElementCount > 0) metricsSec.appendChild(kvGrid);
      if (metricsSec.children.length > 1) wrap.appendChild(metricsSec);

      // ── SECTION: Detected Issues ──
      const issuesSec = document.createElement("div");
      issuesSec.className = "drawerSection";

      const issuesTitleEl = document.createElement("div");
      issuesTitleEl.className = "drawerSectionTitle";
      const _iLeft = document.createElement("span"); _iLeft.className = "drawerSectionTitleLeft";
      const _iDot  = document.createElement("span"); _iDot.className = "drawerPulseDot";
      const _iLbl  = document.createElement("span"); _iLbl.textContent = t("seo.fullAuditIssues");
      _iLeft.append(_iDot, _iLbl);
      issuesTitleEl.appendChild(_iLeft);
      if (audit.issuesCount > 0) {
        const issuesCntBadge = document.createElement("span");
        issuesCntBadge.className = "drawerSectionBadge drawerSectionBadge--bad";
        issuesCntBadge.textContent = String(audit.issuesCount);
        issuesTitleEl.appendChild(issuesCntBadge);
      }
      issuesSec.appendChild(issuesTitleEl);

      if (audit.issuesCount > 0) {
        const sevOrder = { critical: 0, warning: 1, info: 2 };
        const sorted = [...audit.issues].sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2));
        const groups = [
          { sev: "critical", label: currentLang === "fr" ? "Critique"  : "Critical", color: "#dc2626" },
          { sev: "warning",  label: currentLang === "fr" ? "Attention" : "Warning",  color: "#d97706" },
          { sev: "info",     label: "Info",                                            color: "#6b7280" },
        ].map(g => ({ ...g, items: sorted.filter(i => i.severity === g.sev) }))
         .filter(g => g.items.length > 0);

        const groupsWrap = document.createElement("div");
        groupsWrap.className = "drawerIssueGroups";
        for (const g of groups) {
          const groupEl = document.createElement("div");
          const groupLabel = document.createElement("div");
          groupLabel.className = "drawerIssueGroupLabel";
          const gDot = document.createElement("span");
          gDot.className = "drawerIssueGroupDot";
          gDot.style.background = g.color;
          const gText = document.createElement("span");
          gText.className = "drawerIssueGroupText";
          gText.style.color = g.color;
          gText.textContent = `${g.label} (${g.items.length})`;
          groupLabel.append(gDot, gText);
          groupEl.appendChild(groupLabel);
          const itemsList = document.createElement("div");
          itemsList.className = "drawerIssueItems";
          for (const issue of g.items) {
            const row = document.createElement("div");
            row.className = "drawerIssueRow";
            const dot = document.createElement("span");
            dot.className = "drawerIssueDot";
            dot.style.background = g.color;
            const text = document.createElement("span");
            text.textContent = issue.msg;
            row.append(dot, text);
            itemsList.appendChild(row);
          }
          groupEl.appendChild(itemsList);
          groupsWrap.appendChild(groupEl);
        }
        issuesSec.appendChild(groupsWrap);
      } else {
        const emptyNote = document.createElement("div");
        emptyNote.className = "drawerMuted";
        emptyNote.textContent = t("seo.fullAuditNoIssues");
        issuesSec.appendChild(emptyNote);
      }

      wrap.appendChild(issuesSec);

      // ── SECTION: PageSpeed ──
      const hasCwv = audit.mobilePerf !== null || audit.lcpMs !== null;
      if (hasCwv) {
        const cwvSec = document.createElement("div");
        const cwvTone = audit.mobilePerf !== null ? (audit.mobilePerf >= 70 ? "success" : audit.mobilePerf >= 50 ? "warn" : "danger") : "warn";
        cwvSec.className = `drawerSection drawerSection--${cwvTone}`;

        const cwvTitle = document.createElement("div");
        cwvTitle.className = "drawerSectionTitle";
        const _cLeft = document.createElement("span"); _cLeft.className = "drawerSectionTitleLeft";
        const _cDot  = document.createElement("span"); _cDot.className = "drawerPulseDot";
        const _cLbl  = document.createElement("span"); _cLbl.textContent = "PageSpeed — Mobile";
        _cLeft.append(_cDot, _cLbl);
        cwvTitle.appendChild(_cLeft);
        cwvSec.appendChild(cwvTitle);

        const cwvGrid = document.createElement("div");
        cwvGrid.className = "drawerKvGrid";

        const appendCwvRow = (label, value, tone) => {
          if (value === null || value === undefined) return;
          const row = document.createElement("div");
          row.className = "drawerKvRow";
          const k = document.createElement("span");
          k.className = "drawerKvKey";
          k.textContent = label;
          const v = document.createElement("span");
          v.className = "drawerKvVal" + (tone ? ` drawerKvVal--${tone}` : "");
          v.textContent = String(value);
          row.append(k, v);
          cwvGrid.appendChild(row);
        };

        if (audit.mobilePerf !== null) {
          const tone = audit.mobilePerf >= 90 ? "good" : audit.mobilePerf >= 50 ? "warn" : "bad";
          appendCwvRow(currentLang === "fr" ? "Perf. mobile" : "Mobile perf.", `${audit.mobilePerf}/100`, tone);
        }
        if (audit.mobileA11y !== null) {
          const tone = audit.mobileA11y >= 90 ? "good" : audit.mobileA11y >= 70 ? "warn" : "bad";
          appendCwvRow(currentLang === "fr" ? "Accessibilité" : "Accessibility", `${audit.mobileA11y}/100`, tone);
        }
        if (audit.psSeoScore !== null) {
          const tone = audit.psSeoScore >= 90 ? "good" : audit.psSeoScore >= 70 ? "warn" : "bad";
          appendCwvRow("SEO PageSpeed", `${audit.psSeoScore}/100`, tone);
        }
        if (audit.lcpMs !== null) {
          const lcpS = (audit.lcpMs / 1000).toFixed(1);
          const tone = audit.lcpMs <= 2500 ? "good" : audit.lcpMs <= 4000 ? "warn" : "bad";
          appendCwvRow("LCP", `${lcpS}s`, tone);
        }
        if (audit.clsScore !== null) {
          const tone = audit.clsScore <= 0.1 ? "good" : audit.clsScore <= 0.25 ? "warn" : "bad";
          appendCwvRow("CLS", String(audit.clsScore), tone);
        }
        if (audit.fcpMs !== null) {
          const fcpS = (audit.fcpMs / 1000).toFixed(1);
          const tone = audit.fcpMs <= 1800 ? "good" : audit.fcpMs <= 3000 ? "warn" : "bad";
          appendCwvRow("FCP", `${fcpS}s`, tone);
        }
        if (audit.cwvDelta !== null) {
          const sign = audit.cwvDelta >= 0 ? "+" : "";
          const tone = audit.cwvDelta >= 0 ? "good" : audit.cwvDelta >= -5 ? "warn" : "bad";
          appendCwvRow(currentLang === "fr" ? "Impact score" : "Score impact", `${sign}${audit.cwvDelta}`, tone);
        }
        if (audit.bestPractices !== null) {
          const tone = audit.bestPractices >= 90 ? "good" : audit.bestPractices >= 70 ? "warn" : "bad";
          appendCwvRow(currentLang === "fr" ? "Bonnes pratiques" : "Best practices", `${audit.bestPractices}/100`, tone);
        }

        if (cwvGrid.childElementCount > 0) cwvSec.appendChild(cwvGrid);
        wrap.appendChild(cwvSec);
      }

      // ── SECTION: Passed Checks ──
      if (Array.isArray(audit.seoPassed) && audit.seoPassed.length > 0) {
        const passedSec = document.createElement("div");
        passedSec.className = "drawerSection";

        const passedTitleEl = document.createElement("div");
        passedTitleEl.className = "drawerSectionTitle";
        const _pLeft = document.createElement("span"); _pLeft.className = "drawerSectionTitleLeft";
        const _pDot  = document.createElement("span"); _pDot.className = "drawerPulseDot drawerPulseDot--green";
        const _pLbl  = document.createElement("span"); _pLbl.textContent = currentLang === "fr" ? "Points positifs" : "Passed checks";
        _pLeft.append(_pDot, _pLbl);
        const passedCntBadge = document.createElement("span");
        passedCntBadge.className = "drawerSectionBadge drawerSectionBadge--good";
        passedCntBadge.textContent = String(audit.seoPassed.length);
        passedTitleEl.append(_pLeft, passedCntBadge);
        passedSec.appendChild(passedTitleEl);

        const passedGrid = document.createElement("div");
        passedGrid.className = "drawerPassedGrid";
        for (const item of audit.seoPassed) {
          const row = document.createElement("div");
          row.className = "drawerPassedItem";
          const dot = document.createElement("span");
          dot.className = "drawerPassedDot";
          const text = document.createElement("span");
          text.textContent = translatePassedItem(String(item), currentLang);
          row.append(dot, text);
          passedGrid.appendChild(row);
        }
        passedSec.appendChild(passedGrid);
        wrap.appendChild(passedSec);
      }

      const hasAnyData = audit.score !== null || Boolean(audit.websiteStatus) || Boolean(audit.siteType) || Boolean(audit.source) || Boolean(audit.reason) || audit.issuesCount > 0;
      if (!hasAnyData) {
        const missingSec = document.createElement("div");
        missingSec.className = "drawerSection";
        const missing = document.createElement("div");
        missing.className = "drawerMuted";
        missing.textContent = t("seo.fullAuditMissing");
        missingSec.appendChild(missing);
        wrap.appendChild(missingSec);
      }
    } else {
      // Locked view
      const kvSec = document.createElement("div");
      kvSec.className = "drawerSection";

      const kvTitle = document.createElement("div");
      kvTitle.className = "drawerSectionTitle";
      kvTitle.textContent = t("seo.fullAuditLockedTitle");
      kvSec.appendChild(kvTitle);

      if (audit.issuesCount > 0 || audit.reason) {
        const kvGrid = document.createElement("div");
        kvGrid.className = "drawerKvGrid";

        const appendKv = (key, value, tone) => {
          const tv = String(value || "").trim();
          if (!tv) return;
          const row = document.createElement("div");
          row.className = "drawerKvRow";
          const k = document.createElement("span");
          k.className = "drawerKvKey";
          k.textContent = key;
          const v = document.createElement("span");
          v.className = "drawerKvVal" + (tone ? ` drawerKvVal--${tone}` : "");
          v.textContent = tv;
          row.append(k, v);
          kvGrid.appendChild(row);
        };

        if (audit.issuesCount > 0) appendKv(t("leads.auditPreviewIssues"), String(audit.issuesCount), "bad");
        if (audit.reason) appendKv(t("seo.fullAuditReason"), clampText(audit.reason, 96));
        kvSec.appendChild(kvGrid);
      }

      const lockHint = document.createElement("div");
      lockHint.className = "drawerHint drawerHint--locked";
      lockHint.textContent = t("seo.fullAuditLockedHint");
      kvSec.appendChild(lockHint);
      wrap.appendChild(kvSec);
    }

    // ── Action buttons ──
    const actionsSec = document.createElement("div");
    actionsSec.className = "drawerActions";

    // Export CSV button
    const canExportCsv = snapshot?.account?.features?.exportCsv !== false;
    const exportBtn = document.createElement("button");
    exportBtn.className = "drawerBtn drawerBtn--primary";
    exportBtn.disabled = !canExportCsv;
    exportBtn.title = canExportCsv ? "" : t("toast.exportDisabled");
    exportBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="flex-shrink:0" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${currentLang === "fr" ? "Exporter CSV" : "Export CSV"}`;
    exportBtn.addEventListener("click", () => {
      if (!canExportCsv) { showToast(t("toast.exportDisabled"), "warn", 3000); return; }
      exportSingleSeoCsvLocal();
    });
    actionsSec.appendChild(exportBtn);

    // View on site button
    const siteBtn = document.createElement("button");
    siteBtn.className = "drawerBtn drawerBtn--ghost";
    siteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="flex-shrink:0" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${currentLang === "fr" ? "Voir sur le site" : "View on site"}`;
    siteBtn.addEventListener("click", () => {
      const profileUrl = _l?.profileUrl || "";
      const url = profileUrl
        ? `${SAAS_APP_URL}/seo?profileUrl=${encodeURIComponent(profileUrl)}`
        : `${SAAS_APP_URL}/seo`;
      chrome.tabs.create({ url, active: true });
    });
    actionsSec.appendChild(siteBtn);

    wrap.appendChild(actionsSec);

    return wrap;
  }

  function renderSeoList() {
    if (!seoListEl || !snapshot) return;

    // ── Skip re-render if nothing changed (prevents flash on periodic SW reconnect) ──
    const _leads = snapshot.leads || [];
    const _renderKey = [
      seoListFilter,
      selectedSeoProfileUrl || "",
      _leads.map((l) => {
        const opp = getMostCriticalOpp(l);
        return `${l.profileUrl}|${opp?.seoCode || ""}|${opp?.score ?? ""}`;
      }).join(";"),
    ].join("§");
    if (_renderKey === _seoListRenderKey && seoListEl.children.length > 0) return;
    _seoListRenderKey = _renderKey;

    // ── Stat bar ──
    const statBarEl = $("seoStatBar");
    if (statBarEl) {
      const allLeads = snapshot.leads || [];
      const cnt = {
        ALL:      allLeads.length,
        CRITICAL: allLeads.filter((l) => ["CRITIQUE", "SITE_UNREACHABLE"].includes(getSeoAuditCategory(l))).length,
        WEAK:     allLeads.filter((l) => ["FAIBLE",   "NO_WEBSITE"       ].includes(getSeoAuditCategory(l))).length,
        OK:       allLeads.filter((l) => getSeoAuditCategory(l) === "OK").length,
      };
      const tabs = [
        { key: "ALL",      label: currentLang === "fr" ? "Tous"     : "All",      color: "#6366f1" },
        { key: "CRITICAL", label: currentLang === "fr" ? "Critique" : "Critical", color: "#ef4444" },
        { key: "WEAK",     label: currentLang === "fr" ? "Faible"   : "Weak",     color: "#f59e0b" },
        { key: "OK",       label: "OK",                                            color: "#10b981" },
      ];
      statBarEl.innerHTML = "";
      tabs.forEach((s) => {
        const active = seoListFilter === s.key;
        const bgAlpha = `${s.color}14`; // ~8% opacity hex
        const btn = document.createElement("button");
        btn.className = "seoStatItem";
        btn.style.cssText = `background:${active ? s.color : bgAlpha};border-color:${active ? s.color : ""};`;
        btn.innerHTML = `<span class="seoStatNum" style="color:${active ? "#fff" : s.color}">${cnt[s.key]}</span><span class="seoStatLabel" style="color:${active ? "rgba(255,255,255,0.8)" : "var(--muted)"}">${escHtml(s.label)}</span>`;
        btn.addEventListener("click", () => {
          if (seoListFilter === s.key) return;
          seoListFilter = s.key;
          closeDetailDrawer();
          clearSeoLeadSelection();
          const list = $("seoList");
          if (list) {
            list.style.opacity = "0";
            setTimeout(() => {
              renderSeoList();
              list.style.opacity = "1";
            }, 120);
          } else {
            renderSeoList();
          }
        });
        statBarEl.appendChild(btn);
      });
    }

    seoListEl.innerHTML = "";

    const leads = snapshot.leads || [];
    if (!leads.length) {
      clearSeoLeadSelection();
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = t("seo.empty");
      seoListEl.appendChild(empty);
      updateSeoSingleExportButtonState();
      return;
    }

    const urgencyOrder = (l) => {
      const snap = buildSeoAuditSnapshot(l, getMostCriticalOpp(l));
      const c = (snap.ui?._seoCode || snap._seoCode || "").toUpperCase();
      if (c === "CRITICAL" || c === "SITE_UNREACHABLE") return 0;
      if (c === "WEAK"     || c === "NO_WEBSITE")       return 1;
      if (c === "OK")                                    return 2;
      return 3;
    };
    const filteredLeads = filterSeoList(leads).slice().sort((a, b) => urgencyOrder(a) - urgencyOrder(b));
    if (!filteredLeads.length) {
      clearSeoLeadSelection();
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = t("seo.emptyFilter");
      seoListEl.appendChild(empty);
      updateSeoSingleExportButtonState();
      return;
    }

    if (selectedSeoProfileUrl) {
      const hasSelectedVisible = filteredLeads.some((x) => x.profileUrl === selectedSeoProfileUrl);
      if (!hasSelectedVisible) {
        clearSeoLeadSelection();
      }
    }

    const canFullAudit = canViewFullSeoAudit();

    filteredLeads.forEach((l) => {
      const isExpanded = selectedSeoProfileUrl === l.profileUrl;
      const orderedOpps = getOrderedOpportunities(l);
      const primaryOpp = getPrimaryOpp(l);
      const selectedOpp =
        isExpanded
          ? (
            orderedOpps.find((o) => o.id === selectedSeoOpportunityId) ||
            primaryOpp ||
            orderedOpps[0] ||
            null
          )
          : getMostCriticalOpp(l);
      const audit = buildSeoAuditSnapshot(l, selectedOpp);

      const card = document.createElement("div");
      card.className = "leadCard";
      if (isExpanded) card.classList.add("selected", "is-expanded");
      const _seoCode = audit.ui?._seoCode || audit._seoCode || "";
      if      (_seoCode === "CRITICAL" || _seoCode === "SITE_UNREACHABLE") card.classList.add("seo-urgency-critical");
      else if (_seoCode === "WEAK"     || _seoCode === "NO_WEBSITE")       card.classList.add("seo-urgency-weak");
      else if (_seoCode === "OK")                                           card.classList.add("seo-urgency-ok");
      else                                                                  card.classList.add("seo-urgency-unknown");

      // Avatar
      const seoFullName = sanitizeLeadName(l.name);
      const seoNameParts = seoFullName.split(/\s+/).filter(Boolean);
      const seoFirstName = sanitizeLeadName(l.firstName || seoNameParts[0] || "");
      const seoLastName  = sanitizeLeadName(l.lastName  || seoNameParts.slice(1).join(" ") || "");
      const seoAvatar = document.createElement("span");
      seoAvatar.className = "seoCardAvatar";
      if (l.avatarUrl) {
        const img = document.createElement("img");
        img.src = l.avatarUrl;
        img.alt = seoFullName;
        img.className = "leadAvatarImg";
        img.onerror = () => {
          seoAvatar.removeChild(img);
          applyInitialsAvatar(seoAvatar, buildInitials(seoFirstName, seoLastName, "LD"), l.profileUrl || seoFullName);
        };
        seoAvatar.appendChild(img);
      } else {
        applyInitialsAvatar(seoAvatar, buildInitials(seoFirstName, seoLastName, "LD"), l.profileUrl || seoFullName);
      }

      // Text content
      const seoCardBody = document.createElement("div");
      seoCardBody.className = "seoCardBody";

      const title = document.createElement("div");
      title.className = "leadName";
      title.textContent = seoFullName || "—";

      const meta = document.createElement("div");
      meta.className = "leadMeta";
      const seoUrl = selectedOpp?.website || primaryOpp?.website || l.profileUrl || "";
      meta.textContent = seoUrl;
      meta.title = seoUrl;

      const ui = audit.ui || getUiDisplay(l);
      const badge = document.createElement("span");
      badge.className = "badgeMini";
      badge.textContent = ui.seoBadge || (currentLang === "fr" ? "SEO: INCONNU" : "SEO: UNKNOWN");
      const seoCode = ui._seoCode || audit._seoCode || "";
      if (seoCode === "OK") badge.classList.add("badge_good");
      else if (seoCode === "CRITICAL" || seoCode === "SITE_UNREACHABLE") badge.classList.add("badge_bad");
      else if (seoCode === "WEAK" || seoCode === "NO_WEBSITE") badge.classList.add("badge_warn");

      seoCardBody.appendChild(title);
      seoCardBody.appendChild(meta);
      seoCardBody.appendChild(badge);

      // Score indicator (right side) — color follows seoCode, not raw score
      const seoScoreEl = document.createElement("div");
      seoScoreEl.className = "seoCardScore";
      const knownSeoCode = ["OK", "WEAK", "CRITICAL", "SITE_UNREACHABLE", "NO_WEBSITE"].includes(seoCode);
      if (knownSeoCode && audit.score !== null && audit.score !== undefined) {
        seoScoreEl.textContent = audit.score;
        if      (seoCode === "OK")                                          seoScoreEl.classList.add("seoCardScore--good");
        else if (seoCode === "WEAK" || seoCode === "NO_WEBSITE")            seoScoreEl.classList.add("seoCardScore--warn");
        else if (seoCode === "CRITICAL" || seoCode === "SITE_UNREACHABLE")  seoScoreEl.classList.add("seoCardScore--bad");
      } else {
        seoScoreEl.textContent = "—";
        seoScoreEl.classList.add("seoCardScore--none");
      }

      card.appendChild(seoAvatar);
      card.appendChild(seoCardBody);
      card.appendChild(seoScoreEl);

      card.onclick = () => {
        const isSame = Boolean(selectedSeoProfileUrl && selectedSeoProfileUrl === l.profileUrl);
        if (isSame) {
          clearSeoLeadSelection();
          closeDetailDrawer();
          renderSeoList();
          return;
        }
        selectSeoLead(l);
        showSeoInDrawer(l, audit, canFullAudit);
        renderSeoList();
      };
      seoListEl.appendChild(card);
    });

    // Refresh drawer if a SEO lead is currently open
    if (selectedSeoProfileUrl) {
      const sel = filteredLeads.find((l) => l.profileUrl === selectedSeoProfileUrl);
      if (sel) {
        const selOpp = getOrderedOpportunities(sel).find((o) => o.id === selectedSeoOpportunityId) || getPrimaryOpp(sel) || null;
        const selAudit = buildSeoAuditSnapshot(sel, selOpp);
        showSeoInDrawer(sel, selAudit, canFullAudit);
      }
    }

    const current = selectedSeoProfileUrl
      ? filteredLeads.find((l) => l.profileUrl === selectedSeoProfileUrl)
      : null;
    if (current) selectSeoLead(current);
    else updateSeoSingleExportButtonState();
  }

  function clearSeoLeadSelection() {
    selectedSeoLead = null;
    selectedSeoProfileUrl = null;
    selectedSeoOpportunityId = null;
    if (seoOpportunitySelectEl) {
      seoOpportunitySelectEl.innerHTML = "";
      seoOpportunitySelectEl.disabled = true;
    }
    setTextSafe(seoCompanyEl, "—");
    if (seoCompanyEl) seoCompanyEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;word-break:normal;";
    setTextSafe(seoWebsiteEl, "—");
    if (seoWebsiteEl) seoWebsiteEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;word-break:normal;";
    if (seoStatusEl) {
      seoStatusEl.textContent = "—";
      seoStatusEl.className = "badge";
    }
  }

  function selectSeoLead(lead) {
    if (!lead) return;
    selectedSeoLead = lead;
    selectedSeoProfileUrl = lead.profileUrl || null;

    const opportunities = getOrderedOpportunities(lead);
    // Default to most critical SEO opportunity
    const primaryOpp = getMostCriticalOpp(lead);

    if (!selectedSeoOpportunityId || !opportunities.some((o) => o.id === selectedSeoOpportunityId)) {
      selectedSeoOpportunityId = primaryOpp?.id || opportunities[0]?.id || null;
    }

    if (seoOpportunitySelectEl) {
      seoOpportunitySelectEl.innerHTML = "";
      for (const o of opportunities) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = getOpportunityLabel(o, 40);
        if (o.id === selectedSeoOpportunityId) opt.selected = true;
        seoOpportunitySelectEl.appendChild(opt);
      }
      seoOpportunitySelectEl.disabled = opportunities.length <= 1;
    }

    const chosenOpp =
      opportunities.find((o) => o.id === selectedSeoOpportunityId) ||
      primaryOpp ||
      opportunities[0] ||
      null;

    const companyVal = sanitizeLeadName(chosenOpp?.company || "") || "—";
    const websiteVal = chosenOpp?.website || lead.website || "—";
    setTextSafe(seoCompanyEl, companyVal);
    if (seoCompanyEl) {
      seoCompanyEl.title = companyVal !== "—" ? companyVal : "";
      seoCompanyEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;word-break:normal;";
    }
    setTextSafe(seoWebsiteEl, websiteVal);
    if (seoWebsiteEl) {
      seoWebsiteEl.title = websiteVal !== "—" ? websiteVal : "";
      seoWebsiteEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;word-break:normal;";
    }

    const ui = getUiDisplay(
      lead,
      chosenOpp?.ui && typeof chosenOpp.ui === "object" ? chosenOpp.ui : null
    );

    if (seoStatusEl) {
      const badgeText = String(ui.seoBadge || (currentLang === "fr" ? "SEO: INCONNU" : "SEO: UNKNOWN")).replace(/^.*SEO\s*/i, "SEO ");
      seoStatusEl.textContent = badgeText;
      const u = badgeText.toUpperCase();
      let cls = "badge";
      if      (u.includes("CRITICAL") || u.includes("CRITIQUE"))                          cls += " badge-seo-critical";
      else if (u.includes("WEAK")     || u.includes("FAIBLE"))                            cls += " badge-seo-weak";
      else if (u.includes("OK"))                                                           cls += " badge-seo-ok";
      else if (u.includes("NO WEBSITE") || u.includes("PAS DE SITE") ||
               u.includes("UNREACHABLE") || u.includes("INACCESSIBLE"))                   cls += " badge-seo-nosite";
      else                                                                                 cls += " badge-seo-unknown";
      seoStatusEl.className = cls;
    }
    updateSeoSingleExportButtonState();
  }

  async function consumeSeoExportQuota() {
    const res = await chrome.runtime.sendMessage({ type: "CONSUME_SEO_EXPORT" });
    if (res?.ok) return true;
    if (res?.error === "FEATURE_DISABLED_EXPORT_CSV") {
      throw new Error("CSV export is disabled on your current plan.");
    }
    if (res?.limitReached) {
      throw new Error("SEO export quota reached for this month.");
    }
    if (res?.authRequired) {
      throw new Error("Login required.");
    }
    throw new Error(res?.error || "SEO_EXPORT_CONSUME_FAILED");
  }

  async function exportSingleSeoCsvLocal() {
    if (!selectedSeoLead) return;
    const lang = getUiLanguage();
    const delimiter = lang === "fr" ? ";" : ",";

    const l = selectedSeoLead;
    const raw = (l.decisionRaw && typeof l.decisionRaw === "object") ? l.decisionRaw : {};

    const header = lang === "fr"
      ? [
          "entreprise",
          "site_web",
          "url_profil",
          "badge_seo",
          "label_seo",
          "pain_business",
          "confiance",
          "role",
          "action",
          "js_heavy",
        ]
      : [
          "company",
          "website",
          "profile_url",
          "seo_badge",
          "seo_label",
          "pain_business",
          "confidence",
          "role",
          "action",
          "js_heavy",
        ];

    const opportunities = getOrderedOpportunities(l);
    const chosenOpp =
      opportunities.find((o) => o.id === selectedSeoOpportunityId) ||
      getPrimaryOpp(l) ||
      opportunities[0] ||
      null;

    const ui =
      chosenOpp?.ui && typeof chosenOpp.ui === "object"
        ? chosenOpp.ui
        : getUiObj(l);
    const jsHeavy = raw.jsHeavy || raw.JS_HEAVY_SITE || raw.js_heavy || "";

  const row = [
    chosenOpp?.company || "",
    chosenOpp?.website || l.website || "",

      l.profileUrl || "",
      ui.seoBadge || "",
      ui.seoLabel || "",
      ui.painBusiness || "",
      ui.confidence || "",
      ui.role || "",
      ui.actionLabel || "",
      jsHeavy
    ];

    const csv = [
      toCsvRowWithDelimiter(header, delimiter),
      toCsvRowWithDelimiter(row, delimiter),
    ].join("\n");

    downloadBlob(
      `seo-audit-${(l.company || l.name || "profile").toLowerCase().replace(/\s+/g, "_")}-${isoDateForFile()}.csv`,
      csv,
      "text/csv"
    );
  }

  async function exportSingleSeoCsv() {
    if (!selectedSeoLead) return;
    await consumeSeoExportQuota();
    const lang = getUiLanguage();

    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_SEO_SINGLE",
        lead: selectedSeoLead,
        opportunityId: selectedSeoOpportunityId || null,
        language: lang,
      });

      if (res?.ok && String(res?.csv || "").trim()) {
        downloadBlob(
          String(res.filename || `seo-audit-${isoDateForFile()}.csv`),
          String(res.csv || ""),
          String(res.mimeType || "text/csv")
        );
        return;
      }
    } catch (e) {
      console.warn("[PANEL] Backend single SEO export failed, fallback local", e);
    }

    await exportSingleSeoCsvLocal();
  }

  /* ================= EXPORTS ================= */
  async function exportActivityCsv() {
    const res = await chrome.runtime.sendMessage({ type: "EXPORT_LOGS" });
    if (!res?.ok) throw new Error(res?.error || "EXPORT_LOGS_FAILED");

    const logs = res.logs || [];
    const header = ["timestamp", "level", "message"];
    const rows = [toCsvRow(header)];
    logs.forEach(e => rows.push(toCsvRow([e.at, e.level, e.message])));

    downloadBlob(`seo-prospector-activity-${isoDateForFile()}.csv`, rows.join("\n"), "text/csv");
  }

  async function exportLeadsCsv() {
    const res = await chrome.runtime.sendMessage({ type: "EXPORT_LEADS" });
    if (!res?.ok) throw new Error(res?.error || "EXPORT_LEADS_FAILED");

    const leads = res.leads || [];
    const header = [
      "created_at","name","headline","company","profile_url","website",
      "lead_type","ui_role","ui_action","ui_confidence","ui_pain","ui_reason","detected_headline"
    ];
    const rows = [toCsvRow(header)];

    leads.forEach(l => {
      const ui = getUiObj(l);
      rows.push(toCsvRow([
        l.createdAt || "",
        l.name || "",
        l.headline || "",
        l.company || "",
        l.profileUrl || "",
        l.website || "",
        l.leadType || "",
        ui.role || "",
        ui.actionLabel || "",
        ui.confidence || "",
        ui.painBusiness || "",
        ui.reason || "",
        ui.detectedHeadline || ""
      ]));
    });

    downloadBlob(`seo-prospector-leads-${isoDateForFile()}.csv`, rows.join("\n"), "text/csv");
  }

  async function exportSeoAuditCsv() {
    const res = await chrome.runtime.sendMessage({ type: "EXPORT_LEADS" });
    if (!res?.ok) throw new Error(res?.error || "EXPORT_LEADS_FAILED");

    const leads = res.leads || [];
    if (!leads.length) {
      throw new Error(t("error.noSeoAudits"));
    }
    await consumeSeoExportQuota();

    const header = [
      "created_at","company","profile_url","website","scrape_status",
      "seo_badge","seo_label","pain_business","confidence","role","action","js_heavy"
    ];
    const rows = [toCsvRow(header)];

    leads.forEach(l => {
      const raw = (l.decisionRaw && typeof l.decisionRaw === "object") ? l.decisionRaw : {};
      const jsHeavy = String(raw.jsHeavy || raw.JS_HEAVY_SITE || raw.js_heavy || "");
      const ui = getUiObj(l);

      rows.push(toCsvRow([
        l.createdAt || "",
        l.company || "",
        l.profileUrl || "",
        l.website || "",
        l.scrapeStatus || "",
        ui.seoBadge || "",
        ui.seoLabel || "",
        ui.painBusiness || "",
        ui.confidence || "",
        ui.role || "",
        ui.actionLabel || "",
        jsHeavy
      ]));
    });

    downloadBlob(`seo-prospector-seo-audit-${isoDateForFile()}.csv`, rows.join("\n"), "text/csv");
  }

  /* ================= ACTIONS ================= */
  function wireActions() {
    syncLeadsSearchUi();

    onClickSafe(btnPipelineToggle, () => {
      const next =
        btnPipelineToggle?.dataset?.next ||
        (String(pipelineStatusRaw || "RUNNING").toUpperCase() === "RUNNING" ? "PAUSED" : "RUNNING");
      chrome.runtime.sendMessage({ type: "SET_PIPELINE", value: next });
    });

    onClickSafe(btnCopyMsgProfile, () => {
      const url = msgProfileEl?.textContent?.trim();
      if (!url || url === "—") return;
      navigator.clipboard.writeText(url).then(() => {
        const ic = $("iconCopyMsgProfile");
        const ik = $("iconCheckMsgProfile");
        if (btnCopyMsgProfile) btnCopyMsgProfile.classList.add("is-copied");
        if (ic) ic.style.display = "none";
        if (ik) ik.style.display = "";
        setTimeout(() => {
          if (btnCopyMsgProfile) btnCopyMsgProfile.classList.remove("is-copied");
          if (ic) ic.style.display = "";
          if (ik) ik.style.display = "none";
        }, 2000);
      });
    });

    onClickSafe(btnCopyMsg, () => {
      if (!messageBoxEl?.value) return;
      navigator.clipboard.writeText(messageBoxEl.value).then(() => {
        if (!btnCopyMsg) return;
        btnCopyMsg.classList.add("is-copied");
        const lbl = $("btnCopyMsgLabel");
        const iconCopy = $("iconCopy");
        const iconCopied = $("iconCopied");
        if (lbl) lbl.textContent = t("button.copied") || "Copied!";
        if (iconCopy) iconCopy.style.display = "none";
        if (iconCopied) iconCopied.style.display = "";
        setTimeout(() => {
          btnCopyMsg.classList.remove("is-copied");
          if (lbl) lbl.textContent = t("button.copy") || "Copy";
          if (iconCopy) iconCopy.style.display = "";
          if (iconCopied) iconCopied.style.display = "none";
        }, 2000);
      });
    });

    onClickSafe(btnRegenMsg, async () => {
      const { lead, opp } = getSelectedMessageContext();
      if (!lead || !messageBoxEl) return;
      const contextKey = getMessageContextKey(lead, opp || null);
      activeMsgContextKey = contextKey;

      const regenLbl = $("btnRegenMsgLabel");
      const prev = regenLbl?.textContent || t("button.regenerate");
      if (btnRegenMsg) {
        btnRegenMsg.disabled = true;
        if (regenLbl) regenLbl.textContent = t("button.generating") || "Generating…";
      }

      try {
        const msgContextEl = $("msgContextInput");
        const userContext = msgContextEl ? msgContextEl.value.trim() : "";
        const res = await chrome.runtime.sendMessage({
          type: "GENERATE_LEAD_MESSAGE",
          lead,
          opportunityId: opp?.id || null,
          language: getUiLanguage(),
          tone: activeMsgTone,
          context: userContext || undefined,
        });

        if (!res?.ok || !String(res?.message || "").trim()) {
          throw new Error(res?.error || "MESSAGE_GENERATE_FAILED");
        }

        const generatedMessage = String(res.message || "").trim();
        saveMessageDraft(contextKey, {
          text: generatedMessage,
          generated: true,
          source: String(res?.source || "backend"),
        });
        messageBoxEl.value = generatedMessage;
        updateSendButtonState();
        showToast(t("toast.messageGenerated"), "success", 2000);
        chrome.runtime.sendMessage({
          type: "MSG_LOG_GENERATION",
          profileUrl: lead.profileUrl,
          leadName: String(lead.name || lead.fullName || ""),
          opportunityName: String(opp?.name || opp?.company || ""),
          messagePreview: generatedMessage.slice(0, 500),
        }).catch(() => {});
      } catch (e) {
        // fallback local template
        renderMessagePreview(lead, opp || null);
        showToast(t("toast.generateFallback", { error: String(e?.message || e) }), "warn", 3200);
      } finally {
        if (btnRegenMsg) {
          btnRegenMsg.disabled = false;
          if (regenLbl) regenLbl.textContent = prev;
        }
      }
    });

    if (messageBoxEl) {
      messageBoxEl.addEventListener("input", () => {
        if (activeMsgContextKey) {
          saveMessageDraft(activeMsgContextKey, {
            text: String(messageBoxEl.value || ""),
          });
        }
        updateSendButtonState();
      });
    }

    const msgTonePillsEl = $("msgTonePills");
    if (msgTonePillsEl) {
      msgTonePillsEl.addEventListener("click", (e) => {
        const pill = e.target.closest(".msgTonePill");
        if (!pill) return;
        activeMsgTone = String(pill.dataset.tone || "professional");
        const _lead = findLeadByProfileUrl(selectedMsgLeadProfileUrl);
        const _opp  = _lead ? (_lead.opportunities || []).find(o => o.id === selectedMsgOpportunityId) || getPrimaryOpp(_lead) : null;
        applyTonePills(_lead ? getRecommendedTone(_lead, _opp) : activeMsgTone);
      });
    }

    onClickSafe(btnScanAssistGenerate, async () => {
      if (!scanAssistPromptEl?.value?.trim()) {
        scanAssistPromptEl?.focus();
        return;
      }
      const genLabelEl = $("scanAssistGenerateLabel");
      if (btnScanAssistGenerate) {
        btnScanAssistGenerate.disabled = true;
        btnScanAssistGenerate.classList.add("is-generating");
      }
      if (genLabelEl) genLabelEl.textContent = t("button.generating");
      try {
        await generateScanAssistantQueries();

      } finally {
        if (btnScanAssistGenerate) {
          btnScanAssistGenerate.disabled = false;
          btnScanAssistGenerate.classList.remove("is-generating");
        }
        if (genLabelEl) genLabelEl.textContent = t("button.generateAI");
      }
    });
    onClickSafe(btnScanAssistFab, (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      setScanAssistantOpen(!isScanAssistantOpen);
    });
    onClickSafe(btnScanAssistClose, (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      setScanAssistantOpen(false);
    });
    onClickSafe(btnScanAssistCopyPeople, async (e) => { await copyScanAssistantQuery("people", e?.currentTarget); });
    onClickSafe(btnScanAssistOpenPeople, async () => { await openLinkedInSearch("people"); });
    onClickSafe(btnScanAssistCopyCompany, async (e) => { await copyScanAssistantQuery("company", e?.currentTarget); });
    onClickSafe(btnScanAssistOpenCompany, async () => { await openLinkedInSearch("company"); });
    wireScanAssistantInputs();
    // Activity section: collapsed to a clickable bar on small screens when assistant open
    onClickSafe($("scanActivitySection"), () => {
      if (isScanAssistantOpen) setScanAssistantOpen(false);
    });
    // Best Practices chip: closes assistant to reveal the How it works accordions
    onClickSafe($("scanBestPracticesChip"), () => {
      setScanAssistantOpen(false);
    });
    // Close only via FAB button or X button — not on outside click
    document.addEventListener("keydown", (e) => {
      if (!isScanAssistantOpen) return;
      if (e.key === "Escape") {
        setScanAssistantOpen(false);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && leadsSearchQuery) {
        clearLeadsSearch({ rerender: true });
      }
    });

    if (msgPickerTriggerEl) {
      msgPickerTriggerEl.addEventListener("click", (e) => {
        // Don't toggle when clicking the copy-profile button
        if (e.target.closest("#btnCopyMsgProfile")) return;
        msgPickerOpen = !msgPickerOpen;
        if (msgPickerDropdownEl) msgPickerDropdownEl.classList.toggle("is-open", msgPickerOpen);
        msgPickerTriggerEl.classList.toggle("is-open", msgPickerOpen);
      });
    }

    document.addEventListener("click", (e) => {
      if (msgPickerOpen && !e.target.closest("#msgLeadPicker")) {
        closeMsgPicker();
      }
    });

    if (msgOpportunitySelectEl) {
      msgOpportunitySelectEl.addEventListener("change", () => {
        selectedMsgOpportunityId = msgOpportunitySelectEl.value || null;
        renderMessageSelectors();
      });
    }

    if (seoOpportunitySelectEl) {
      seoOpportunitySelectEl.addEventListener("change", async () => {
        selectedSeoOpportunityId = seoOpportunitySelectEl.value || null;
        const lead = findLeadByProfileUrl(selectedSeoProfileUrl) || selectedSeoLead;
        if (!lead || !selectedSeoOpportunityId) return;

        await chrome.runtime.sendMessage({
          type: "SET_PRIMARY_OPPORTUNITY",
          leadId: lead.id,
          opportunityId: selectedSeoOpportunityId,
        });

        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      });
    }

    onClickSafe(btnLeadsSearchClear, (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      clearLeadsSearch({ rerender: true });
      leadsSearchInputEl?.focus();
    });

    if (leadsSearchInputEl) {
      leadsSearchInputEl.addEventListener("input", () => {
        leadsSearchQuery = String(leadsSearchInputEl.value || "");
        syncLeadsSearchUi();
        renderLeads();
      });
    }

    // leadsFilter select removed — replaced by stat card bar in renderLeadsStatBar()
    // seoFilter select removed — replaced by stat card bar in renderSeoList()

    onClickSafe(btnSendMsg, async () => {
      const features = snapshot?.account?.features || {};
      if (features.sendNow === false) {
        showToast(t("toast.sendDisabledPro"), "warn", 3000);
        return;
      }
      const { lead, opp } = getSelectedMessageContext();
      const text = String(messageBoxEl?.value || "").trim();
      if (!lead?.profileUrl || !text) return;

      const sendLbl = $("btnSendMsgLabel");
      const previous = sendLbl?.textContent || t("button.send") || "Send";
      btnSendMsg.disabled = true;
      if (sendLbl) sendLbl.textContent = t("button.sending") || "Sending...";
      showToast(t("toast.sendingLinkedin"), "info", 1800);

      try {
        const res = await chrome.runtime.sendMessage({
          type: "SEND_LINKEDIN_MESSAGE",
          profileUrl: lead.profileUrl,
          message: text,
          autoSend: true,
        });

        if (!res?.ok) {
          showToast(t("toast.sendFailed", { error: res?.error || "unknown error" }), "error", 3600);
        } else {
          const status = res?.result?.status || "UNKNOWN";
          if (status === "SENT") {
            showToast(t("toast.messageSent"), "success", 2600);
          } else if (status === "DRAFT_FILLED") {
            showToast(t("toast.draftFilled"), "success", 2600);
          } else {
            const hint = res?.result?.hint ? ` (${res.result.hint})` : "";
            const candidateTxt =
              Number.isFinite(res?.result?.candidatesCount)
                ? ` candidates=${res.result.candidatesCount}`
                : "";
            const docsTxt =
              Number.isFinite(res?.result?.docsScanned)
                ? ` docs=${res.result.docsScanned}`
                : "";
            showToast(
              t("toast.messageStatus", {
                status,
                candidates: candidateTxt,
                docs: docsTxt,
                hint,
              }),
              "warn",
              4200
            );
          }
        }

        if (res?.ok) {
          const status = res?.result?.status || "UNKNOWN";
          const ck = getMessageContextKey(lead, opp);
          const wasEdited = Boolean(ck && lastGeneratedTextByKey.has(ck) && text !== lastGeneratedTextByKey.get(ck));
          chrome.runtime.sendMessage({
            type: "MSG_LOG_SENT",
            profileUrl: lead.profileUrl,
            leadName: String(lead.name || lead.fullName || ""),
            wasEdited,
            sentStatus: status,
            messagePreview: text.slice(0, 120),
          }).catch(() => {});
        }

        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.sendFailed", { error: String(e?.message || e) }), "error", 3600);
      } finally {
        if (sendLbl) sendLbl.textContent = previous;
        updateSendButtonState();
      }
    });

    onClickSafe(btnAuthRegister, async () => {
      const firstName = String(accountLoginFirstNameEl?.value || "").trim();
      const lastName = String(accountLoginLastNameEl?.value || "").trim();
      const email = String(accountLoginEmailSecurityEl?.value || "").trim();
      const password = String(accountLoginPasswordEl?.value || "");
      if (!firstName || !lastName || !email || !password) {
        showToast(t("toast.registerFieldsRequired"), "warn", 2600);
        return;
      }
      const fullName = `${firstName} ${lastName}`.trim();
      try {
        const res = await chrome.runtime.sendMessage({
          type: "AUTH_REGISTER",
          firstName,
          lastName,
          fullName,
          email,
          password,
        });
        if (!res?.ok) {
          showToast(t("toast.registerFailed", { error: res?.error || "unknown error" }), "error", 3600);
        } else {
          showToast(t("toast.accountCreated"), "success", 2600);
          if (accountLoginPasswordEl) accountLoginPasswordEl.value = "";
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.registerFailed", { error: String(e?.message || e) }), "error", 3600);
      }
    });

    onClickSafe(btnSidebarAddUser, async () => {
      const account = snapshot?.account || {};
      const rawPlan = String(account.plan || "FREE").toUpperCase();
      const plan = rawPlan === "TRIAL" ? "FREE" : (rawPlan === "SCALE" ? "AGENCY" : rawPlan);
      const isAgencyPlan = String(plan || "").toUpperCase() === "AGENCY";
      const teamPolicy = getTeamPolicyFromAccount(account, plan);
      const loggedIn = Boolean(account.userId && account.authMethod === "EMAIL");
      const canAddSeatUser = isAgencyPlan && loggedIn && teamPolicy.billingActive && (
        teamPolicy.seatAddOnEnabled ||
        teamPolicy.includedUsers > 1
      );

      if (!canAddSeatUser) {
        showToast(t("toast.addUserLocked"), "warn", 3200);
        goToRoute("account");
        return;
      }

      const firstName = String(accountLoginFirstNameEl?.value || "").trim();
      const lastName = String(accountLoginLastNameEl?.value || "").trim();
      const email = String(accountLoginEmailSecurityEl?.value || "").trim().toLowerCase();
      const password = String(accountLoginPasswordEl?.value || "");
      if (!firstName || !lastName || !email || !password) {
        showToast(t("toast.registerFieldsRequired"), "warn", 2600);
        goToRoute("account");
        return;
      }

      try {
        const res = await chrome.runtime.sendMessage({
          type: "SEAT_ADD_USER",
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          email,
          password,
        });
        if (!res?.ok) {
          if (String(res?.error || "").includes("SEAT_LIMIT_REACHED")) {
            showToast(t("toast.addUserLimit"), "warn", 3200);
          } else {
            showToast(t("toast.addUserFailed", { error: res?.error || "unknown error" }), "error", 3600);
          }
        } else {
          showToast(t("toast.addUserCreated"), "success", 2400);
          if (accountLoginPasswordEl) accountLoginPasswordEl.value = "";
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.addUserFailed", { error: String(e?.message || e) }), "error", 3600);
      }
    });

    // ── Login gate: disable right-click / context menu ──
    const loginGateEl = document.getElementById("loginGate");
    if (loginGateEl) {
      loginGateEl.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // ── Login gate: detect site session ──
    const btnDetectSession = document.getElementById("btnDetectSession");
    const btnLoginGate     = document.getElementById("btnLoginGate");
    const loginGateEmailEl = document.getElementById("loginGateEmail");
    const loginGatePassEl  = document.getElementById("loginGatePassword");
    const loginGateErrorEl = document.getElementById("loginGateError");

    if (btnDetectSession) {
      btnDetectSession.addEventListener("click", async () => {
        btnDetectSession.disabled = true;
        const lbl = document.getElementById("btnDetectSessionLabel");
        const prev = lbl?.textContent || "";
        if (loginGateErrorEl) loginGateErrorEl.style.display = "none";

        // Typewriter animation: types "Detecting..." char by char then loops
        const twText = "Detecting...";
        let twIdx = 0;
        if (lbl) lbl.textContent = "";
        const dotTimer = setInterval(() => {
          twIdx = (twIdx + 1) % (twText.length + 8); // +8 = brief pause at end before reset
          if (lbl) lbl.textContent = twText.slice(0, Math.min(twIdx, twText.length));
        }, 130);

        try {
          const res = await chrome.runtime.sendMessage({ type: "DETECT_SITE_SESSION" });
          if (res?.ok) {
            showToast(t("toast.sessionDetected"), "success", 2400);
            if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
          } else {
            const msg = res?.error === "NO_SITE_TAB" || res?.error === "NO_SESSION_FOUND"
              ? t("toast.sessionNotFound")
              : t("toast.loginFailed", { error: res?.error || "unknown" });
            if (loginGateErrorEl) { loginGateErrorEl.textContent = msg; loginGateErrorEl.style.display = ""; }
          }
        } catch (e) {
          if (loginGateErrorEl) { loginGateErrorEl.textContent = String(e?.message || e); loginGateErrorEl.style.display = ""; }
        } finally {
          clearInterval(dotTimer);
          btnDetectSession.disabled = false;
          if (lbl) lbl.textContent = prev;
        }
      });
    }

    if (btnLoginGate) {
      btnLoginGate.addEventListener("click", async () => {
        const email    = String(loginGateEmailEl?.value || "").trim();
        const password = String(loginGatePassEl?.value || "");
        if (loginGateErrorEl) loginGateErrorEl.style.display = "none";
        if (!email || !password) {
          if (loginGateErrorEl) { loginGateErrorEl.textContent = t("toast.emailPasswordRequired"); loginGateErrorEl.style.display = ""; }
          return;
        }
        btnLoginGate.disabled = true;
        try {
          const res = await chrome.runtime.sendMessage({ type: "AUTH_LOGIN", email, password });
          if (!res?.ok) {
            const errMsg = t("toast.loginFailed", { error: res?.error || "invalid credentials" });
            if (loginGateErrorEl) { loginGateErrorEl.textContent = errMsg; loginGateErrorEl.style.display = ""; }
          } else {
            showToast(t("toast.loggedIn"), "success", 2200);
            if (loginGatePassEl) loginGatePassEl.value = "";
            if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
          }
        } catch (e) {
          if (loginGateErrorEl) { loginGateErrorEl.textContent = String(e?.message || e); loginGateErrorEl.style.display = ""; }
        } finally {
          btnLoginGate.disabled = false;
        }
      });
    }

    onClickSafe(btnAuthLogin, async () => {
      const email = String(accountLoginEmailSecurityEl?.value || "").trim();
      const password = String(accountLoginPasswordEl?.value || "");
      if (!email || !password) {
        showToast(t("toast.emailPasswordRequired"), "warn", 2400);
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({
          type: "AUTH_LOGIN",
          email,
          password,
        });
        if (!res?.ok) {
          showToast(t("toast.loginFailed", { error: res?.error || "invalid credentials" }), "error", 3600);
        } else {
          showToast(t("toast.loggedIn"), "success", 2200);
          if (accountLoginPasswordEl) accountLoginPasswordEl.value = "";
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.loginFailed", { error: String(e?.message || e) }), "error", 3600);
      }
    });

    onClickSafe(btnAuthLogout, async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "AUTH_LOGOUT" });
        if (!res?.ok) {
          showToast(t("toast.logoutFailed", { error: res?.error || "unknown error" }), "error", 3600);
        } else {
          showToast(t("toast.loggedOut"), "success", 2200);
          if (accountLoginPasswordEl) accountLoginPasswordEl.value = "";
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.logoutFailed", { error: String(e?.message || e) }), "error", 3600);
      }
    });

    onClickSafe(btnAuthSync, async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "REFRESH_ENTITLEMENTS" });
        if (!res?.ok) {
          showToast(t("toast.refreshFailed", { error: res?.error || "unknown error" }), "error", 3200);
        } else {
          showToast(t("toast.accountRefreshed"), "success", 1800);
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.refreshFailed", { error: String(e?.message || e) }), "error", 3200);
      }
    });

    const openUpgradeCheckout = async (provider, plan = "STARTER") => {
      try {
        const res = await chrome.runtime.sendMessage({
          type: "OPEN_UPGRADE_CHECKOUT",
          provider,
          plan,
        });
        if (!res?.ok) {
          if (String(res?.error || "").includes("AUTH_REQUIRED")) {
            showToast(t("toast.loginRequiredUpgrade"), "warn", 3000);
            return;
          }
          if (provider === "lemonsqueezy") {
            await chrome.tabs.create({ url: FALLBACK_PRICING_URL, active: true });
            showToast(t("toast.fallbackPricingOpened"), "warn", 2600);
            return;
          }
          showToast(t("toast.upgradeFailed", { error: res?.error || "unknown error" }), "error", 3400);
          return;
        }
        showToast(
          t("toast.checkoutOpened", { provider: String(res.provider || provider).toUpperCase() }),
          "success",
          2200
        );
      } catch (e) {
        showToast(t("toast.checkoutOpenFailed", { error: String(e?.message || e) }), "error", 3400);
      }
    };

    onClickSafe(btnUpgradePlan, async () => openUpgradeCheckout("lemonsqueezy", "STARTER"));
    onClickSafe(btnUpgradeCrypto, async () => openUpgradeCheckout("nowpayments", "STARTER"));

    onClickSafe($("sidebarUpsellBtn"), () => openAppTab("/account?tab=billing"));

    onClickSafe($("sidebarUpsellDismiss"), () => {
      const el = $("sidebarUpsell");
      if (el) el.style.display = "none";
      const flag = $("sidebarUpsellBtn")?.dataset?.upsellFlag || "sidebarUpsellDismissed_FREE";
      chrome.storage.local.set({ [flag]: Date.now() });
    });

    // Open app links
    function openAppTab(path) {
      chrome.tabs.create({ url: `${SAAS_APP_URL}${path}`, active: true });
    }
    onClickSafe($("btnOpenAppDashboard"),    () => openAppTab("/dashboard"));
    onClickSafe($("btnOpenAppLeads"),        () => openAppTab("/leads"));
    onClickSafe($("btnOpenAppTeam"),         () => openAppTab("/agency"));
    onClickSafe($("btnOpenAppUpgrade"),      () => openAppTab("/account?tab=billing"));
    onClickSafe($("btnOpenAppBilling"),      () => openAppTab("/account?tab=billing"));
    onClickSafe($("btnAccountOpenDashboard"),() => openAppTab("/dashboard"));
    onClickSafe($("btnAccountOpenBilling"),  () => openAppTab("/account?tab=billing"));
    onClickSafe($("btnChatOpenFull"),        () => openAppTab("/team/chat"));
    onClickSafe($("btnNotifMarkAll"),        () => { void markNotifsRead(); void fetchNotifications(); });
    onClickSafe($("btnNotifBell"),           () => { notifDropdownOpen ? closeNotifDropdown() : openNotifDropdown(); });
    onClickSafe($("btnSupport"),             () => { initSupportElements(); openSupportOverlay(); });
    onClickSafe($("btnSupportBack"),         () => closeSupportOverlay());
    onClickSafe($("btnSupportNewTicket"),    () => openSupportModal());
    onClickSafe($("btnSupportEscalate"),     () => openSupportModal());
    onClickSafe($("btnSupportModalClose"),   () => closeSupportModal());
    onClickSafe($("btnSupportCancelForm"),   () => closeSupportModal());
    onClickSafe($("btnSupportSubmit"),       () => void submitSupportTicket());

    // Support tab switching
    document.querySelectorAll(".supportExtTabBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        switchSupportTab(btn.dataset.tab);
        if (btn.dataset.tab === "tickets") supportTicketsLoaded = false;
      });
    });

    // Account tab switching
    document.querySelectorAll(".acctExtTab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".acctExtTab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".acctExtPanel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const panelId = "acctPanel" + btn.dataset.acctTab.charAt(0).toUpperCase() + btn.dataset.acctTab.slice(1);
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add("active");
      });
    });

    // Account: Change password → open site
    onClickSafe($("btnChangePasswordSite"), () => openAppTab("/account?tab=security"));

    // Account: Appearance theme toggle sync
    const themeToggleAppearanceEl = $("themeToggleAppearance");
    if (themeToggleAppearanceEl) {
      themeToggleAppearanceEl.addEventListener("change", () => {
        const nextTheme = themeToggleAppearanceEl.checked ? "dark" : "light";
        applyTheme(nextTheme);
        persistTheme(nextTheme);
      });
    }

    // Support chat input
    const supportInputEl = $("supportExtInput");
    const supportSendBtn = $("btnSupportSend");
    if (supportInputEl) {
      supportInputEl.addEventListener("input", () => {
        if (supportSendBtn) supportSendBtn.disabled = !supportInputEl.value.trim() || supportThinking;
      });
      supportInputEl.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey && supportInputEl.value.trim() && !supportThinking) {
          e.preventDefault();
          void sendSupportChat();
        }
      });
    }
    if (supportSendBtn) supportSendBtn.addEventListener("click", () => void sendSupportChat());

    // Team overlay — chip click opens overlay (like support), back closes it
    const teamOverlayEl = $("teamOverlay");
    function openTeamOverlay() {
      if (!teamOverlayEl) return;
      teamOverlayEl.style.display = "flex";
      void teamOverlayEl.offsetHeight;
      teamOverlayEl.classList.add("open");
      void loadTeamStats();
    }
    closeTeamOverlay = function() {
      if (!teamOverlayEl) return;
      teamOverlayEl.classList.remove("open");
      setTimeout(() => {
        if (teamOverlayEl && !teamOverlayEl.classList.contains("open")) {
          teamOverlayEl.style.display = "";
        }
      }, 250);
    };
    onClickSafe($("sidebarMembersChip"), () => openTeamOverlay());
    onClickSafe($("btnTeamBack"), () => closeTeamOverlay());
    onClickSafe($("btnSupportNewTicket"),    () => showSupportForm());

    // Close notif dropdown on click outside
    document.addEventListener("mousedown", e => {
      if (notifDropdownOpen && notifBellWrapEl && !notifBellWrapEl.contains(e.target)) {
        closeNotifDropdown();
      }
    });

    // Chat input
    if (chatExtInputEl) {
      chatExtInputEl.addEventListener("input", () => {
        if (chatExtSendBtn) chatExtSendBtn.disabled = !chatExtInputEl.value.trim();
      });
      chatExtInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const content = chatExtInputEl.value.trim();
          if (!content) return;
          chatExtInputEl.value = "";
          if (chatExtSendBtn) chatExtSendBtn.disabled = true;
          void sendChatMessage(content);
        }
      });
    }
    if (chatExtSendBtn) {
      chatExtSendBtn.addEventListener("click", () => {
        const content = chatExtInputEl?.value?.trim();
        if (!content) return;
        if (chatExtInputEl) chatExtInputEl.value = "";
        chatExtSendBtn.disabled = true;
        void sendChatMessage(content);
      });
    }

    onClickSafe(btnAdminResetData, async () => {
      if (!requireSecondClickConfirm("admin_reset", t("toast.resetConfirm"), 4000)) {
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({ type: "ADMIN_RESET_CLOUD_AND_LOCAL" });
        if (!res?.ok) {
          showToast(t("toast.resetFailed", { error: res?.error || "unknown error" }), "error", 3600);
        } else {
          showToast(t("toast.accountReset"), "success", 2400);
        }
        if (port) port.postMessage({ type: "REQ_SNAPSHOT" });
      } catch (e) {
        showToast(t("toast.resetFailed", { error: String(e?.message || e) }), "error", 3600);
      }
    });

    onClickSafe(btnExportActivity, async () => {
      try { await exportActivityCsv(); }
      catch (e) { showToast(t("toast.exportFailed", { error: String(e.message || e) }), "error", 3600); }
    });

    // ── Scan tabs ──
    const scanTabPipeline    = $("scanTabPipeline");
    const scanTabHowItWorks  = $("scanTabHowItWorks");
    const scanPanelPipeline  = $("scanPanelPipeline");
    const scanPanelHowItWorks = $("scanPanelHowItWorks");

    function setScanTab(tab) {
      const isPipeline = tab === "pipeline";
      if (scanTabPipeline)   scanTabPipeline.classList.toggle("scan-tab--active", isPipeline);
      if (scanTabHowItWorks) scanTabHowItWorks.classList.toggle("scan-tab--active", !isPipeline);
      document.body.classList.toggle("scan-tab-howitworks", !isPipeline);

      const incoming = isPipeline ? scanPanelPipeline : scanPanelHowItWorks;
      const outgoing = isPipeline ? scanPanelHowItWorks : scanPanelPipeline;

      if (outgoing) {
        outgoing.classList.remove("scan-panel--in");
        outgoing.style.display = "none";
      }
      if (incoming) {
        incoming.style.display = "flex";
        incoming.classList.remove("scan-panel--in");
        void incoming.offsetHeight; // force reflow to restart animation
        incoming.classList.add("scan-panel--in");
      }

      // Close assistant when switching to "How it works" — both open is too tall on small screens
      if (!isPipeline && isScanAssistantOpen) {
        setScanAssistantOpen(false);
      }
    }

    if (scanTabPipeline)   scanTabPipeline.addEventListener("click",   () => setScanTab("pipeline"));
    if (scanTabHowItWorks) scanTabHowItWorks.addEventListener("click", () => setScanTab("howitworks"));

    if (btnViewLeadsOnSite) {
      btnViewLeadsOnSite.addEventListener("click", () => openAppTab("/leads"));
    }

    onClickSafe(btnExportLeads, async () => {
      if (snapshot?.account?.features?.exportCsv === false) {
        showToast(t("toast.exportDisabled"), "warn", 3000);
        return;
      }
      try { await exportLeadsCsv(); }
      catch (e) { showToast(t("toast.exportFailed", { error: String(e.message || e) }), "error", 3600); }
    });

    if (btnExportSEO) {
      onClickSafe(btnExportSEO, async () => {
        if (snapshot?.account?.features?.exportCsv === false) {
          showToast(t("toast.exportDisabled"), "warn", 3000);
          return;
        }
        try { await exportSeoAuditCsv(); }
        catch (e) { showToast(t("toast.exportFailed", { error: String(e.message || e) }), "error", 3600); }
      });
    }

    onClickSafe(btnCopySeoWebsite, () => {
      const url = seoWebsiteEl?.textContent?.trim();
      if (!url || url === "—") return;
      navigator.clipboard.writeText(url).then(() => {
        const ic = $("iconCopySeoWeb");
        const ik = $("iconCheckSeoWeb");
        if (btnCopySeoWebsite) btnCopySeoWebsite.classList.add("is-copied");
        if (ic) ic.style.display = "none";
        if (ik) ik.style.display = "";
        setTimeout(() => {
          if (btnCopySeoWebsite) btnCopySeoWebsite.classList.remove("is-copied");
          if (ic) ic.style.display = "";
          if (ik) ik.style.display = "none";
        }, 2000);
      });
    });

    if (btnExportSeoSingle) {
      btnExportSeoSingle.disabled = true;
      onClickSafe(btnExportSeoSingle, async () => {
        if (snapshot?.account?.features?.exportCsv === false) {
          showToast(t("toast.exportDisabled"), "warn", 3000);
          return;
        }
        try { await exportSingleSeoCsv(); }
        catch (e) { showToast(t("toast.exportFailed", { error: String(e.message || e) }), "error", 3600); }
      });
    }
  }

  /* ================= RENDER ALL ================= */
  function renderAll() {
    applyStaticTranslations();
    if (!snapshot) return;

    setPipelineUI(snapshot.pipelineStatus);
    renderMonthlyScanBadges(snapshot.todayCount, snapshot.dailyLimit);

    renderLogs();
    renderLeads();
    renderSeoList();
    renderMessageSelectors();
    renderDashboard();
    renderAccount();
    renderMenuBadges();
    applyPlanFeatureGates();
  }

  /* ================= INIT ================= */
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("DOMContentLoaded", async () => {
    // Read cached account from storage immediately to avoid login gate flash
    try {
      const stored = await chrome.storage.local.get("seo_account_v1");
      const cachedAccount = stored?.seo_account_v1 || {};
      const alreadyLoggedIn = Boolean(cachedAccount.userId && cachedAccount.authMethod === "EMAIL");
      setNavAuthState(alreadyLoggedIn);
      showLoginGate(!alreadyLoggedIn);
    } catch {
      // If storage is unavailable, default to showing gate until snapshot arrives
      setNavAuthState(false);
      showLoginGate(true);
    }

    loadMessageDraftCache();
    wireLanguageToggle();
    wireThemeToggle();
    ensureLeadChooser();
    wireActions();
    wireDashboardCollapsibleCards();
    wireAssistantNotchSync();
    await loadScanAssistantState();
    await generateScanAssistantQueries({ persist: false, silent: true });
    setScanAssistantOpen(false);
    try {
      await chrome.runtime.sendMessage({ type: "REFRESH_ENTITLEMENTS" });
    } catch {}
    connectPort();
  });
