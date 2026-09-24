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
