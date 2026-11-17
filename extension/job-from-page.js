/*
 * Turns what the popup read from a job page into the fields of a new notebook page, and builds
 * the notebook address that opens with those fields filled in. Pure: no browser APIs, so it is
 * tested with node --test (tests/unit/extension.test.js). The job clipper from the notebook app
 * (js/clipper.js) is passed in, so this file works both in the built extension and in the tests.
 *
 * Most job sites (Greenhouse, Lever, Ashby, Workday, LinkedIn, SmartRecruiters and others) embed
 * a schema.org JobPosting in the page for search engines. When there is one, it is the most
 * reliable source for the company, title, location and closing date, so it wins; the clipper's
 * reading of the page title, address and selected text fills whatever it leaves out.
 */

export const DEFAULT_NOTEBOOK = "https://internshipnotebook.app/";
// The notebook's own limits (LIMITS and SKILL_LIMIT in js/domain.js). The notebook checks them
// again when the page is saved; keeping to them here keeps the address it opens short.
const LIMITS = { company: 80, role: 100, location: 80, source: 60, link: 500, notes: 10000 };
const SKILL_LIMIT = 12;
const SEARCH_DEPTH = 6;
const SEARCH_NODES = 400;

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const clamp = (value, limit) => clean(value).slice(0, limit);

/** Every schema.org JobPosting in the page's structured data, in page order. Looks inside arrays
 *  and @graph lists, and stops after a fixed amount of searching so a huge page cannot stall it. */
export function findJobPostings(structured) {
  const found = [];
  let visited = 0;
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > SEARCH_DEPTH || visited++ > SEARCH_NODES) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
    const types = [].concat(node["@type"] ?? []).map(type => String(type).replace(/^.*[/#]/, ""));
    if (types.includes("JobPosting")) found.push(node);
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) visit(node[key], depth + 1);
  };
  visit(structured, 0);
  return found;
}

/** A plain name from a schema.org value that may be a string, an object with a name, or a list. */
function nameOf(value) {
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === "object") return plain(value.name ?? value["@value"] ?? "");
  return plain(value);
}

/** "Toronto, ON" style text for one schema.org Place (or a plain string). */
function placeText(place) {
  if (!place) return "";
  if (typeof place !== "object") return plain(place);
  const address = place.address ?? place;
  if (typeof address !== "object") return plain(address);
  const city = nameOf(address.addressLocality);
  const region = nameOf(address.addressRegion);
  const country = nameOf(address.addressCountry);
  const parts = [city, region].filter(Boolean);
  return parts.length ? parts.join(", ") : country || nameOf(place);
}

/** Where the job is: up to two places, "Remote" for a remote posting, or both ("Toronto, ON or Remote"). */
export function postingLocation(posting) {
  if (!posting) return "";
  const places = [...new Set([].concat(posting.jobLocation ?? []).map(placeText).filter(Boolean))];
  const physical = places.slice(0, 2).join("; ");
  const remote = [].concat(posting.jobLocationType ?? []).some(type => /telecommute|remote/i.test(String(type)));
  if (remote && physical) return clamp(`${physical} or Remote`, LIMITS.location);
  if (remote) {
    const where = nameOf([].concat(posting.applicantLocationRequirements ?? [])[0]);
    return clamp(where ? `Remote (${where})` : "Remote", LIMITS.location);
  }
  return clamp(physical, LIMITS.location);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", bull: "-", middot: "-" };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
  if (code[0] === "#") {
    const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number < 0x110000 ? String.fromCodePoint(number) : "";
  }
  return ENTITIES[code.toLowerCase()] ?? whole;
});
// Names and titles in structured data are often HTML-escaped too ("Johnson &amp; Johnson").
const plain = value => clean(decode(String(value ?? "")));

/** Readable text from a posting's HTML description: paragraphs and list items on their own
 *  lines, everything else removed. Job sites often escape the HTML once more, so it decodes,
 *  strips tags, and decodes again. Em and en dashes become hyphens, as in the notebook's own copy. */
export function descriptionText(html) {
  const once = decode(String(html ?? ""));
  return decode(once
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<(table|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    // Inline tags such as <strong> sit inside a sentence, so they go without leaving a space.
    .replace(/<[^>]*>/g, ""))
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .split("\n").map(line => line.trim()).filter(Boolean).join("\n")
    .slice(0, LIMITS.notes);
}

/** "2026-12-01" from a closing date like "2026-12-01T23:59:00Z", or "" when it is not a real day. */
export function closingDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(value));
  if (!match) return "";
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : "";
}

/**
 * The fields for a new notebook page, from a snapshot taken by readJobPage (page-reader.js).
 * `clipper` is the notebook's js/clipper.js module (parseJobClip and extractSkillsFromText are used).
 * Returns { company, role, location, source, link, deadline, skills, selection, description, fromPosting }.
 */
export function jobFromPage(snapshot = {}, clipper) {
  const posting = findJobPostings(snapshot.structured)[0] || null;
  const selection = String(snapshot.selection ?? "").trim().slice(0, LIMITS.notes);
  const clip = clipper.parseJobClip({ title: snapshot.title || snapshot.ogTitle || "", text: selection, url: snapshot.url || "" });
  // Most job pages put the job title in their main heading; only trust it when it reads like one.
  const headingRole = clean(snapshot.heading) ? clipper.parseJobClip({ title: snapshot.heading }).role : "";
  const description = posting ? descriptionText(posting.description) : "";
  const skills = [...new Set([...clip.skills, ...clipper.extractSkillsFromText(description)])].slice(0, SKILL_LIMIT);
  return {
    company: clamp(nameOf(posting?.hiringOrganization) || clip.company, LIMITS.company),
    role: clamp(plain(posting?.title) || clip.role || headingRole, LIMITS.role),
    location: postingLocation(posting) || clamp(clip.location, LIMITS.location),
    source: clamp(clip.source, LIMITS.source),
    link: clip.link,
    deadline: closingDay(posting?.validThrough),
    skills,
    selection,
    description,
    fromPosting: Boolean(posting)
  };
}

/**
 * The notebook address to open, cleaned up: http or https only, without any query or # part,
 * ending in "/" unless it names a file such as index.html. Returns "" for anything else.
 */
export function cleanNotebookAddress(value) {
  let url;
  try {
    const text = clean(value);
    // "localhost:4173" has no scheme even though it looks like "javascript:": a scheme is never
    // followed by a port number. A local copy without a scheme is served over plain http.
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text);
    url = new URL(hasScheme ? text : `${local ? "http" : "https"}://${text}`);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "";
  const path = /\.[a-z0-9]+$/i.test(url.pathname) || url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

/**
 * The address that opens the notebook's new-application sheet with the job filled in. The job
 * travels after the "#", which browsers never send to a server, so it goes no further than the
 * notebook tab itself. Notes hold the selected text, plus the job description when asked for.
 * Returns "" when the notebook address is not usable.
 */
export function notebookNewUrl(notebook, job, { includeDescription = false } = {}) {
  const base = cleanNotebookAddress(notebook);
  if (!base) return "";
  const notes = [job.selection, includeDescription && job.description ? `Job description (saved ${job.savedOn || "from the posting"}):\n${job.description}` : ""]
    .filter(Boolean).join("\n\n").slice(0, LIMITS.notes);
  const fields = {
    company: job.company, role: job.role, location: job.location, source: job.source, link: job.link,
    deadline: job.deadline, skills: (job.skills || []).join(", "), notes
  };
  const params = new URLSearchParams(Object.entries(fields).filter(([, value]) => value));
  return `${base}#/new${params.size ? `?${params}` : ""}`;
}
