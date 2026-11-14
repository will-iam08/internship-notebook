const VISITOR_KEY = "notebook-usage-visitor-v1";
const OPT_OUT_KEY = "notebook-usage-opt-out";
const PAGES = new Set(["welcome", "today", "board", "notebook", "insights", "deleted", "settings", "entry", "setup", "build", "export", "signup"]);

// Only send a page category. Entry IDs, URL queries, titles, and notebook content stay local.
export function usagePage(hash = "") {
  const page = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return PAGES.has(page) ? page : "today";
}

export function createUsageTracker({ url = "", anonKey = "" } = {}, env = globalThis) {
  const base = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  const key = typeof anonKey === "string" ? anonKey.trim() : "";
  const configured = /^https:\/\/[-a-z0-9]+\.supabase\.co$/.test(base) && Boolean(key);
  let temporaryOptOut = null;
  let started = false;
  let lastHash = null;

  function privacyBlocked() {
    return env.navigator?.globalPrivacyControl === true || env.navigator?.doNotTrack === "1" || env.doNotTrack === "1";
  }
  function optedOut() {
    if (temporaryOptOut !== null) return temporaryOptOut;
    try { return env.localStorage.getItem(OPT_OUT_KEY) === "1"; } catch { return true; }
  }
  function setOptOut(value) {
    temporaryOptOut = Boolean(value);
    try {
      env.localStorage.setItem(OPT_OUT_KEY, value ? "1" : "0");
      if (value) env.localStorage.removeItem(VISITOR_KEY);
      temporaryOptOut = null;
      return true;
    } catch { return false; }
  }
  function visitor() {
    const day = new Date(env.Date.now()).toISOString().slice(0, 10);
    try {
      let saved;
      try { saved = JSON.parse(env.localStorage.getItem(VISITOR_KEY) || "null"); } catch { saved = null; }
      if (saved?.day === day && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.id)) return saved.id;
      const id = env.crypto.randomUUID();
      env.localStorage.setItem(VISITOR_KEY, JSON.stringify({ day, id }));
      return id;
    } catch { return null; }
  }
  async function track(pageView = false) {
    if (!configured || env.location?.hostname !== "internshipnotebook.app"
        || privacyBlocked() || optedOut() || env.document?.visibilityState !== "visible") return false;
    const id = visitor();
    if (!id) return false;
    try {
      const response = await env.fetch(`${base}/rest/v1/rpc/record_notebook_usage`, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ p_visitor: id, p_page: usagePage(env.location.hash), p_page_view: Boolean(pageView) }),
        signal: env.AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch { return false; }
  }
  function start() {
    if (started || !configured || env.location?.hostname !== "internshipnotebook.app") return;
    started = true;
    lastHash = env.location.hash;
    void track(true);
    env.addEventListener("hashchange", () => {
      if (env.location.hash === lastHash) return;
      lastHash = env.location.hash;
      void track(true);
    });
    env.document.addEventListener("visibilitychange", () => { void track(false); });
    env.setInterval(() => { void track(false); }, 60000);
  }
  return { configured, privacyBlocked, optedOut, setOptOut, track, start };
}
