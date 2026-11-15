/*
 * Region rules for the Today page's internship feed. Pure and dependency-free: the browser uses
 * it to count and filter openings, and scripts/fetch-internships.mjs uses the same rules to tag
 * each listing when it writes internships.json, so a file written before listings carried a
 * region still filters the same way.
 */
export const REGIONS = ["Canada", "United States", "Remote", "International"];
const PROVINCE_CODES = "ON|BC|QC|AB|MB|SK|NS|NB|NL|PE|NT|YT|NU";
const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR";
// Several of these names are also US places (Waterloo, IA; Vancouver, WA; New Brunswick, NJ), so a
// name only counts as Canadian when it is not followed by a US state code.
const CANADIAN_PLACES = [
  "Toronto", "Vancouver", "Montreal", "Ottawa", "Calgary", "Waterloo", "Mississauga", "Burnaby",
  "Edmonton", "Winnipeg", "Halifax", "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba",
  "Saskatchewan", "Nova Scotia", "New Brunswick", "Newfoundland", "Prince Edward Island"
];
const PLACE_NAME = new RegExp(`\\b(?:${CANADIAN_PLACES.join("|")})\\b`, "gi");
// Case-sensitive on purpose: "Toronto or remote" must not read "or" as Oregon.
const US_STATE_NEXT = new RegExp(`^,?\\s*(?:${STATE_CODES})\\b`);
function namesCanadianPlace(text) {
  for (const match of text.matchAll(PLACE_NAME)) {
    if (!US_STATE_NEXT.test(text.slice(match.index + match[0].length))) return true;
  }
  return false;
}
const CANADA_PATTERNS = [
  new RegExp(`,\\s*(?:${PROVINCE_CODES})\\b`),
  /\bCanada\b/i,
  { test: namesCanadianPlace }
];
const US_PATTERNS = [
  new RegExp(`,\\s*(?:${STATE_CODES})\\b`),
  /\b(?:USA|US|U\.S\.A?\.?|NYC|SF|LA)(?![\w.])/,
  /\b(?:United States|Bay Area|Silicon Valley)\b/i
];
// What is left of a remote location once the words that only describe "remote" are removed.
const REMOTE_FILLER = /\b(?:remote|fully|anywhere|worldwide|global(?:ly)?|in|or|and|hybrid)\b|[-,/|&()·]/gi;
function plainText(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
/**
 * Classifies free location text into one of REGIONS, or "" when there is no location to read.
 * Canada wins when a posting names a Canadian place at all (alongside US cities, too), because a
 * student in Canada can apply to it without relocating abroad. "Remote in Canada" is Canada,
 * "Remote in USA" is United States, and plain "Remote" is Remote.
 */
export function classifyRegion(location) {
  const text = plainText(location).trim();
  if (!text) return "";
  if (CANADA_PATTERNS.some(pattern => pattern.test(text))) return "Canada";
  if (US_PATTERNS.some(pattern => pattern.test(text))) return "United States";
  if (/\bremote\b/i.test(text) && !text.replace(REMOTE_FILLER, "").trim()) return "Remote";
  return "International";
}
/**
 * Postings have no separate remote/hybrid/on-site field, only free location text ("Remote in
 * USA", "Hybrid - Chicago, IL"), so the work mode is read from that text.
 */
export function workModeFrom(location) {
  const text = String(location ?? "");
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  return "In-person";
}
/** A listing's region, from its own field when valid, otherwise read from its location. */
export function listingRegion(listing) {
  return REGIONS.includes(listing?.region) ? listing.region : classifyRegion(listing?.location);
}
export function matchesRegion(listing, region) {
  return region === "ALL" || listingRegion(listing) === region;
}
/** Counts per region chip, with ALL as the total. */
export function regionCounts(listings) {
  const counts = { ALL: 0, ...Object.fromEntries(REGIONS.map(region => [region, 0])) };
  for (const listing of Array.isArray(listings) ? listings : []) {
    counts.ALL++;
    const region = listingRegion(listing);
    if (region) counts[region]++;
  }
  return counts;
}
