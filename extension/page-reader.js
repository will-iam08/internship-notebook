/*
 * readJobPage runs inside the job posting's tab, only when the person clicks the extension's
 * button (the activeTab permission). It copies a few facts off the page and hands them back to
 * the popup; it changes nothing on the page and sends nothing anywhere.
 *
 * The browser serializes this function and runs it on its own in the page, so it must not use
 * anything from outside its own body: no imports and no shared helpers.
 */
export function readJobPage() {
  const tidy = (value, limit) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const meta = name => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") || "";
  // schema.org data that job sites embed for search engines. A broken block is skipped, and a
  // page with an enormous amount of it is only read in part.
  const structured = [];
  let budget = 1_000_000;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent || "";
    if (structured.length >= 20 || raw.length > budget) break;
    budget -= raw.length;
    try { structured.push(JSON.parse(raw)); } catch { /* not valid JSON: skip it */ }
  }
  return {
    url: location.href,
    title: tidy(document.title, 300),
    heading: tidy(document.querySelector("h1")?.textContent, 300),
    ogTitle: tidy(meta("og:title"), 300),
    selection: String(window.getSelection?.() ?? "").trim().slice(0, 4000),
    structured
  };
}
