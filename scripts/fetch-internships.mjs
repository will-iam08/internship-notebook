/*
 * Refreshes the small "Latest internship openings" feed shown on the Today page.
 *
 * The source is SimplifyJobs/Summer2027-Internships, a public, actively-maintained GitHub
 * project run by Pitt CSC and Simplify that aggregates internship postings from company
 * career pages. It is tens of thousands of roles across many hiring seasons (13+ MB), so
 * shipping it to every visitor is out of the question; this script keeps only the newest
 * open roles and writes a small file into the site. Run on a schedule by
 * .github/workflows/update-internships.yml, and safe to run locally to test.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_URL = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
export const SOURCE_REPO = "https://github.com/SimplifyJobs/Summer2027-Internships";
const LIMIT = 150;

/**
 * The source data has no separate "remote/hybrid/on-site" field or a clean country column,
 * only a free-text locations list (e.g. "Remote in USA", "Surrey, BC, Canada", "SF"). workMode
 * is inferred from that same text rather than invented from nothing, and location stays free
 * text so filtering can match a city, region, or country anywhere in the world, not just a
 * fixed list. isCoop is likewise read from the posting's own title, which already says "Co-op"
 * when a role is one (as opposed to a standard-length internship).
 */
function workMode(locationText) {
  if (/\bremote\b/i.test(locationText)) return "Remote";
  if (/\bhybrid\b/i.test(locationText)) return "Hybrid";
  return "In-person";
}

/**
 * The source data's "degrees" field lists which degree levels a role accepts (e.g. Bachelor's,
 * Master's, PhD, MBA), which is about how advanced a degree is required, not "years of
 * experience" - there is no such field. This app is aimed at college students, so it collapses
 * that into three student-relevant tiers instead of showing raw degree names most applicants
 * here don't need: Junior (no grad degree needed - Bachelor's/Associate's/Certificate/Bootcamp
 * or nothing specified), Intermediate (open to Bachelor's or Master's), Senior (Master's/MBA,
 * without Bachelor's). A PhD or JD requirement is its own thing entirely and not a fit for this
 * audience, so those roles simply aren't offered under any of the three tiers here (they still
 * appear under "Any experience level").
 */
function experienceLevel(degrees) {
  const set = new Set(degrees);
  if (set.has("PhD") || set.has("JD")) return "Advanced";
  const undergradFriendly = set.size === 0 || set.has("Bachelor's") || set.has("Associate's") || set.has("Certificate") || set.has("Bootcamp");
  const gradLevel = set.has("Master's") || set.has("MBA");
  if (gradLevel && undergradFriendly) return "Intermediate";
  if (gradLevel) return "Senior";
  return "Junior";
}

/** Pure transform, unit-tested separately from the network call and file write. */
export function selectListings(rawListings, { limit = LIMIT } = {}) {
  const list = Array.isArray(rawListings) ? rawListings : [];
  return list
    .filter(role => role && role.active && role.is_visible && Number.isFinite(role.date_posted))
    .sort((left, right) => right.date_posted - left.date_posted)
    .slice(0, limit)
    .map(role => {
      const location = Array.isArray(role.locations) ? role.locations.join(", ") : "";
      const title = String(role.title ?? "").trim();
      return {
        company: String(role.company_name ?? "").trim(),
        role: title,
        location,
        workMode: workMode(location),
        isCoop: /co-?op/i.test(title),
        terms: Array.isArray(role.terms) ? role.terms.filter(term => typeof term === "string") : [],
        degrees: Array.isArray(role.degrees) ? role.degrees.filter(degree => typeof degree === "string") : [],
        experienceLevel: experienceLevel(Array.isArray(role.degrees) ? role.degrees : []),
        url: /^https:\/\//i.test(role.url ?? "") ? role.url : "",
        postedAt: new Date(role.date_posted * 1000).toISOString()
      };
    })
    .filter(role => role.company && role.role && role.url);
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Could not fetch internship listings: HTTP ${response.status}`);
  const raw = await response.json();
  const listings = selectListings(raw);
  const output = { generatedAt: new Date().toISOString(), source: SOURCE_REPO, listings };

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.join(root, "src/main/resources/public/internships.json");
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${listings.length} listings to ${path.relative(root, target)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
