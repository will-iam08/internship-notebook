/*
 * Refreshes the small "Latest internship openings" feed shown on the Today page.
 *
 * It merges two public GitHub lists:
 * - SimplifyJobs/Summer2027-Internships, run by Pitt CSC and Simplify, which aggregates postings
 *   from company career pages. It is tens of thousands of roles across many hiring seasons
 *   (13+ MB) and mostly US-based.
 * - negarprh/Canadian-Tech-Internships-2027, a list of tech internships based in Canada, read
 *   from its README table (see canadian-internships.mjs).
 * Shipping either in full to every visitor is out of the question, so this script keeps a small
 * selection: the newest Canadian roles up to a quota, then the newest Simplify roles up to the
 * limit, and writes it into the site. Run on a schedule by
 * .github/workflows/update-internships.yml, and safe to run locally to test.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRegion, listingCountries, listingRegions, workModeFrom } from "../src/main/resources/public/js/listings.js";
import { CANADIAN_README_URLS, CANADIAN_REPO, normalizeCanadian, parseCanadianTable } from "./canadian-internships.mjs";
export const SOURCE_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
export const SOURCE_REPO = "https://github.com/SimplifyJobs/Summer2027-Internships";
export const SOURCES = {
  simplify: { id: "simplify", name: "Pitt CSC & Simplify", url: SOURCE_REPO },
  "canadian-tech-internships": { id: "canadian-tech-internships", name: "Canadian Tech Internships", url: CANADIAN_REPO }
};
const LIMIT = 150;
// Up to this many Canadian roles are kept even when newer US roles would otherwise fill the feed.
const CANADA_QUOTA = 60;

/*
 * The source data has no separate "remote/hybrid/on-site" field or a clean country column,
 * only a free-text locations list (e.g. "Remote in USA", "Surrey, BC, Canada", "SF"). workMode
 * and country/region tags are inferred from that same text (rules in public/js/listings.js) rather than
 * invented from nothing, and location stays free text so filtering can match a city, region, or
 * country anywhere in the world, not just a fixed list. isCoop is likewise read from the
 * posting's own title, which already says "Co-op" when a role is one (as opposed to a
 * standard-length internship).
 */

/**
 * The source data's "degrees" field lists which degree levels a role accepts (e.g. Bachelor's,
 * Master's, PhD, MBA), which is about how advanced a degree is required, not "years of
 * experience" - there is no such field. This app is aimed at college students, so it collapses
 * that into three student-relevant tiers instead of showing raw degree names most applicants
 * here don't need: Junior (no grad degree needed - Bachelor's/Associate's/Certificate/Bootcamp
 * or nothing specified), Intermediate (open to Bachelor's or Master's), Senior (Master's/MBA,
 * without Bachelor's). Roles that only accept PhD or JD candidates are Advanced and appear
 * under "Any experience level"; accepting those degrees as well does not exclude other students.
 */
function experienceLevel(degrees) {
  const set = new Set(degrees);
  const undergradFriendly = set.size === 0 || set.has("Bachelor's") || set.has("Associate's") || set.has("Certificate") || set.has("Bootcamp");
  const gradLevel = set.has("Master's") || set.has("MBA");
  if (gradLevel && undergradFriendly) return "Intermediate";
  if (gradLevel) return "Senior";
  if (!undergradFriendly && (set.has("PhD") || set.has("JD"))) return "Advanced";
  return "Junior";
}

/** Every valid Simplify role in the feed's listing shape, newest first. */
export function normalizeSimplify(rawListings) {
  const list = Array.isArray(rawListings) ? rawListings : [];
  return list
    .filter(role => role
      && role.active
      && role.is_visible
      && Number.isFinite(role.date_posted)
      && String(role.company_name ?? "").trim()
      && String(role.title ?? "").trim()
      && /^https:\/\//i.test(role.url ?? ""))
    .sort((left, right) => right.date_posted - left.date_posted)
    .map(role => {
      const location = Array.isArray(role.locations) ? role.locations.join(", ") : "";
      const title = String(role.title ?? "").trim();
      return {
        company: String(role.company_name ?? "").trim(),
        role: title,
        location,
        workMode: workModeFrom(location),
        isCoop: /co-?op/i.test(title),
        terms: Array.isArray(role.terms) ? role.terms.filter(term => typeof term === "string") : [],
        degrees: Array.isArray(role.degrees) ? role.degrees.filter(degree => typeof degree === "string") : [],
        experienceLevel: experienceLevel(Array.isArray(role.degrees) ? role.degrees : []),
        url: /^https:\/\//i.test(role.url ?? "") ? role.url : "",
        postedAt: new Date(role.date_posted * 1000).toISOString(),
        source: "simplify",
        region: classifyRegion(location),
        countries: listingCountries({ location }),
        regions: listingRegions({ location })
      };
    });
}
/** Pure transform, unit-tested separately from the network call and file write. */
export function selectListings(rawListings, { limit = LIMIT } = {}) {
  return normalizeSimplify(rawListings).slice(0, limit);
}
const LEGAL_SUFFIX = /\b(?:inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|plc|ulc)\b/g;
function plainWords(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/co-op/g, "coop").replace(/[^a-z0-9]+/g, " ");
}
/**
 * Two postings are the same role when the company and title match after normalizing case,
 * accents, punctuation and legal suffixes ("Shopify Inc." = "shopify"). The Canadian list adds
 * the work term to a title in parentheses ("Developer Intern (Winter 2027)") and Simplify often
 * does not, so a season-and-year phrase is ignored here; dedupeListings compares the terms
 * themselves.
 */
export function dedupeKey(listing) {
  const company = plainWords(listing.company).replace(LEGAL_SUFFIX, " ");
  const role = plainWords(String(listing.role ?? "")
    .replace(/\([^)]*\b20\d{2}\b[^)]*\)/g, " ")
    .replace(/\b(?:winter|spring|summer|fall|autumn)(?:\s*(?:\/|&|,|-|and|or)\s*(?:winter|spring|summer|fall|autumn))*\s+20\d{2}\b/gi, " "));
  return `${company.replace(/\s+/g, " ").trim()}|${role.replace(/\s+/g, " ").trim()}`;
}
/** How many of the optional facts a listing actually has. */
function richness(listing) {
  return [listing.location, listing.experienceLevel, listing.url, listing.postedAt].filter(Boolean).length
    + (listing.terms?.length ? 1 : 0) + (listing.degrees?.length ? 1 : 0);
}
const newestFirst = (left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt);
/** Which of two copies of the same role to keep: the richer one, the Canadian list on a tie, then the newer. */
function better(candidate, current) {
  const difference = richness(candidate) - richness(current);
  if (difference) return difference > 0;
  const canadian = listing => listing.source === "canadian-tech-internships";
  if (canadian(candidate) !== canadian(current)) return canadian(candidate);
  return newestFirst(candidate, current) < 0;
}
/** Same role in two different work terms (Summer vs Winter) are two postings; unknown terms match any. */
function sameTerm(left, right) {
  const leftTerms = left.terms || [];
  const rightTerms = right.terms || [];
  return !leftTerms.length || !rightTerms.length || leftTerms.some(term => rightTerms.includes(term));
}
/** One listing per company, role and work term, newest first. */
export function dedupeListings(listings) {
  const groups = new Map();
  for (const listing of listings) {
    const key = dedupeKey(listing);
    const group = groups.get(key) || [];
    const index = group.findIndex(kept => sameTerm(kept, listing));
    if (index === -1) group.push(listing);
    else if (better(listing, group[index])) group[index] = listing;
    groups.set(key, group);
  }
  return [...groups.values()].flat().sort(newestFirst);
}
/**
 * Merges both sources into the small feed file. After removing duplicates it keeps the newest
 * roles located in Canada (from either list) up to the quota, then fills the rest of the limit
 * with the newest Simplify roles, so Canadian roles stay visible even on days when hundreds of
 * US roles are posted, and the file stays the same size as before. The result is newest first.
 */
export function mergeListings(simplifyListings, canadianListings, { limit = LIMIT, canadaQuota = CANADA_QUOTA } = {}) {
  const all = dedupeListings([...(canadianListings || []), ...(simplifyListings || [])]);
  const canada = all.filter(listing => listing.region === "Canada").slice(0, Math.min(canadaQuota, limit));
  const picked = new Set(canada);
  const fill = all.filter(listing => !picked.has(listing) && listing.source === "simplify").slice(0, limit - canada.length);
  return [...canada, ...fill].sort(newestFirst);
}
async function fetchOk(url, read) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return read(response);
}
/** The Canadian list is a second source: if it cannot be read, the feed is still written from Simplify. */
async function fetchCanadian() {
  for (const url of CANADIAN_README_URLS) {
    try {
      const rows = parseCanadianTable(await fetchOk(url, response => response.text()));
      if (rows.length) return normalizeCanadian(rows);
      console.warn(`No open roles found in ${url}; the table format may have changed.`);
    } catch (error) {
      console.warn(`Could not read the Canadian list (${error.message}).`);
    }
  }
  return null;
}
async function main() {
  const raw = await fetchOk(SOURCE_URL, response => response.json()).catch(error => {
    throw new Error(`Could not fetch internship listings: ${error.message}`);
  });
  const canadian = await fetchCanadian();
  const listings = mergeListings(normalizeSimplify(raw), canadian || []);
  const sources = [SOURCES.simplify, ...(canadian ? [SOURCES["canadian-tech-internships"]] : [])];
  const output = { generatedAt: new Date().toISOString(), source: SOURCE_REPO, sources, listings };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.join(root, "src/main/resources/public/internships.json");
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);
  const inCanada = listings.filter(listing => listing.region === "Canada").length;
  console.log(`Wrote ${listings.length} listings (${inCanada} in Canada) to ${path.relative(root, target)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
