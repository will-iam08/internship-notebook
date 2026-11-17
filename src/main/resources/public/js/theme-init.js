// Apply the saved theme before first paint without allowing inline executable scripts.
// GitHub Pages cannot add X-Frame-Options, so fail closed if another site frames the app.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
}

let theme = null;
try { theme = localStorage.getItem("my-internship-notebook-theme"); } catch { /* private windows */ }
if (theme !== "light" && theme !== "dark") {
  theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
document.documentElement.dataset.theme = theme;

// Which screen opens: the landing page for anyone not signed in to the website edition, the
// notebook otherwise. Deciding here, before the first paint, keeps a signed-in visitor from seeing
// the landing page flash while the app loads. js/app.js (syncShellVisibility) makes the final call
// and keeps this attribute in step. Mirrors shouldGateWithLanding in js/landing.js.
let shell = "landing";
try {
  const website = window.NOTEBOOK_STORAGE_MODE === "browser" || location.hostname.endsWith(".github.io");
  const session = JSON.parse(localStorage.getItem("my-internship-notebook-session-v1") || "null");
  const signedIn = Boolean(session && typeof session.email === "string" && session.email.trim());
  if (!website || signedIn) shell = "notebook";
} catch { /* unreadable storage: show the landing page; the app decides once it loads */ }
document.documentElement.dataset.shell = shell;
