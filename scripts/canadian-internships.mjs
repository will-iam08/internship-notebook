/*
 * Reads the listings table in the README of negarprh/Canadian-Tech-Internships-2027, a community
 * list of tech internships based in Canada (or remote and open to Canadian applicants).
 *
 * The table has the columns Company | Role | Location | Apply | Date Posted. An open role's Apply
 * cell is a badge image wrapped in a link, a closed role's says "Closed", and a company's second
 * and later roles use "↳" instead of repeating its name. That repository has no license, so only
 * the public facts of each posting (company, role, location, apply link, date) are kept, and the
 * feed links back to the list. Pure functions, no dependencies, unit-tested in
 * tests/unit/canadian-internships.test.js.
 */
import { classifyRegion, workModeFrom } from "../src/main/resources/public/js/listings.js";
export const CANADIAN_REPO = "https://github.com/negarprh/Canadian-Tech-Internships-2027";
export const CANADIAN_README_URLS = ["main", "master"].map(branch =>
  `https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/${branch}/README.md`);
const COLUMNS = { company: "company", role: "role", location: "location", apply: "apply", "date posted": "date" };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "Nov", "Sept" or "November" to 0-11; -1 for anything else. */
function monthIndex(name) {
  const text = String(name).toLowerCase();
  return MONTHS.findIndex(month => text === month || text === month.slice(0, 3) || (month === "september" && text === "sept"));
}
/** Splits one table line into trimmed cells. An escaped "\|" stays inside its cell. */
export function splitRow(line) {
  let text = String(line ?? "").trim();
  if (!text.startsWith("|")) return null;
  text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") { cell += "|"; index++; continue; }
    if (char === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
/** Turns a cell's markdown or inline HTML into plain text: links keep their text, markup goes. */
export function cellText(cell) {
  return String(cell ?? "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,/]+|[\s,/]+$/g, "")
    .trim();
}
/** Only an absolute https link without spaces or credentials is kept. */
export function safeHttpsUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || /\s/.test(text)) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
/**
 * The apply link inside a cell: the target of the first markdown link around the badge image,
 * "[![Apply](badge.svg)](https://...)", read with balanced parentheses because job-board URLs
 * sometimes contain them. Falls back to an HTML href or a bare https URL. "" when the role is
 * closed or the link is not https.
 */
export function extractApplyUrl(cell) {
  const text = String(cell ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const start = text.indexOf("](");
  if (start !== -1) {
    let depth = 1;
    let url = "";
    for (let index = start + 2; index < text.length; index++) {
      const char = text[index];
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) return safeHttpsUrl(url);
      url += char;
    }
    return "";
  }
  const href = text.match(/href\s*=\s*["']([^"']+)["']/i);
  if (href) return safeHttpsUrl(href[1]);
  const bare = text.match(/https:\/\/[^\s<>()|]+/i);
  return bare ? safeHttpsUrl(bare[0]) : "";
}
/** "Nov 11, 2026", "November 11 2026", "11 Nov 2026" or "2026-11-11" to an ISO date (UTC midnight). */
export function parsePostedDate(value) {
  const text = cellText(value).replace(/\./g, "");
  let year, month, day;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  else if ((match = text.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i))) [year, month, day] = [Number(match[3]), monthIndex(match[1]), Number(match[2])];
  else if ((match = text.match(/^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i))) [year, month, day] = [Number(match[3]), monthIndex(match[2]), Number(match[1])];
  else return "";
  if (month < 0 || month > 11 || day < 1) return "";
  const date = new Date(Date.UTC(year, month, day));
  // Rejects dates that do not exist, such as Feb 30, which Date would roll into March.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return "";
  return date.toISOString();
}
/**
 * Parses the first table whose header has the Company, Role, Location, Apply and Date Posted
 * columns (in any order). Returns one row per open posting with an https apply link and a
 * readable date. Header, separator, closed, malformed and "↳" rows with no company to inherit are
 * skipped.
 */
export function parseCanadianTable(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const rows = [];
  let columns = null;
  let company = "";
  for (const line of lines) {
    const cells = splitRow(line);
    if (!columns) {
      if (!cells) continue;
      const names = cells.map(cell => COLUMNS[cellText(cell).toLowerCase()]);
      if (Object.values(COLUMNS).every(name => names.includes(name))) columns = names;
      continue;
    }
    if (!cells) {
      if (!company && !line.trim()) continue; // blank lines between the header and the first row
      break; // the table ended
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    if (cells.length !== columns.length) continue;
    const value = Object.fromEntries(columns.map((name, index) => [name, cells[index]]));
    const named = cellText(value.company);
    if (named && !/^↳/.test(named)) company = named;
    else if (!named) continue;
    if (!company) continue;
    const role = cellText(value.role);
    const url = extractApplyUrl(value.apply);
    const postedAt = parsePostedDate(value.date);
    if (!role || !url || !postedAt) continue;
    rows.push({ company, role, location: cellText(value.location), url, postedAt });
  }
  return rows;
}
const SEASON = "(?:winter|spring|summer|fall|autumn)";
const TERM_PATTERN = new RegExp(`\\b(${SEASON}(?:\\s*(?:/|&|,|-|and|or)\\s*${SEASON})*)\\s+(20\\d{2})\\b`, "gi");
/** Work terms named in text: "Software Intern (Summer 2027)" or "(Summer/Fall 2027)". */
export function termsFrom(...texts) {
  const terms = [];
  for (const text of texts) {
    for (const [, seasons, year] of String(text ?? "").matchAll(TERM_PATTERN)) {
      for (const season of seasons.match(new RegExp(SEASON, "gi"))) {
        const name = season.toLowerCase() === "autumn" ? "Fall" : season[0].toUpperCase() + season.slice(1).toLowerCase();
        const term = `${name} ${year}`;
        if (!terms.includes(term)) terms.push(term);
      }
    }
  }
  return terms;
}
/**
 * Puts parsed rows into the feed's listing shape. The list has no degree or experience columns,
 * so those stay empty rather than guessed; the feed treats an empty level as "unspecified".
 */
export function normalizeCanadian(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    company: row.company,
    role: row.role,
    location: row.location,
    workMode: workModeFrom(row.location),
    isCoop: /co-?op/i.test(row.role),
    terms: termsFrom(row.role, row.location),
    degrees: [],
    experienceLevel: "",
    url: row.url,
    postedAt: row.postedAt,
    source: "canadian-tech-internships",
    region: classifyRegion(row.location)
  }));
}
