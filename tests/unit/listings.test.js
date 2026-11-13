import test from "node:test";
import assert from "node:assert/strict";
import { REGIONS, classifyRegion, listingRegion, matchesRegion, regionCounts, workModeFrom } from "../../src/main/resources/public/js/listings.js";
const cases = {
  Canada: [
    "Toronto, ON", "Surrey, BC, Canada", "Montreal, QC", "Montréal", "Québec City, QC", "Kanata, ON", "Halifax",
    "Remote in Canada", "Remote, Canada", "Ontario, Canada", "Waterloo, ON", "Toronto, ON / Remote, Canada",
    "Toronto or remote", "Seattle, WA, Toronto, ON, Canada", "St. John's, NL", "Charlottetown, PE"
  ],
  "United States": [
    "Waterloo, IA", "Vancouver, WA", "New Brunswick, NJ", "Halifax, VA", "San Jose, CA", "NYC", "SF", "LA",
    "Remote in USA", "Remote - US", "United States", "Remote in USA, Pittsburgh, PA", "Washington, DC"
  ],
  Remote: ["Remote", "remote", "Fully Remote", "Remote / Hybrid"],
  International: ["London, UK", "Bangalore, India", "Remote in UK", "Laval", "Cambridge, UK, Reading, UK"]
};
for (const [region, locations] of Object.entries(cases)) {
  test(`classifyRegion reads ${region} locations`, () => {
    for (const location of locations) assert.equal(classifyRegion(location), region, location);
  });
}
test("classifyRegion leaves an empty location unclassified", () => {
  assert.equal(classifyRegion(""), "");
  assert.equal(classifyRegion("   "), "");
  assert.equal(classifyRegion(undefined), "");
});
test("province codes are matched in capitals only, so ordinary words are not provinces", () => {
  assert.equal(classifyRegion("Remote, on call"), "International");
  assert.equal(classifyRegion("Remote, ON"), "Canada");
});
test("listingRegion trusts a valid stored region and reads the location otherwise", () => {
  assert.equal(listingRegion({ region: "Remote", location: "Toronto, ON" }), "Remote");
  assert.equal(listingRegion({ region: "Mars", location: "Toronto, ON" }), "Canada");
  assert.equal(listingRegion({ location: "Austin, TX" }), "United States", "older feed files have no region field");
  assert.equal(listingRegion(null), "");
});
test("matchesRegion keeps everything for ALL and only that region otherwise", () => {
  const listing = { location: "Vancouver, BC" };
  assert.equal(matchesRegion(listing, "ALL"), true);
  assert.equal(matchesRegion(listing, "Canada"), true);
  assert.equal(matchesRegion(listing, "United States"), false);
});
test("regionCounts counts every chip, including empty regions", () => {
  const counts = regionCounts([
    { location: "Toronto, ON" }, { region: "Canada" }, { location: "NYC" }, { location: "Remote" }, { location: "" }
  ]);
  assert.deepEqual(counts, { ALL: 5, Canada: 2, "United States": 1, Remote: 1, International: 0 });
  assert.deepEqual(Object.keys(counts), ["ALL", ...REGIONS]);
  assert.deepEqual(regionCounts(null), { ALL: 0, Canada: 0, "United States": 0, Remote: 0, International: 0 });
});
test("workModeFrom reads remote and hybrid from the location text", () => {
  assert.equal(workModeFrom("Remote in Canada"), "Remote");
  assert.equal(workModeFrom("Hybrid - Toronto, ON"), "Hybrid");
  assert.equal(workModeFrom("Toronto, ON"), "In-person");
  assert.equal(workModeFrom(undefined), "In-person");
});
