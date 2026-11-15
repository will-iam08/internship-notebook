import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, COUNTRY_LABELS, parsePlaces, listingCountries, listingRegions, countryCounts, regionCountsFor, matchesCountry, matchesRegionIn, REGIONS, classifyRegion, listingRegion, matchesRegion, regionCounts, workModeFrom } from "../../src/main/resources/public/js/listings.js";
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

test("country labels cover the curated countries in expected-use order", () => {
  assert.deepEqual(COUNTRIES.slice(0, 3).map(country => country.code), ["CA", "US", "GB"]);
  for (const { code, name } of COUNTRIES) {
    assert.equal(COUNTRY_LABELS[code], name);
    assert.equal(parsePlaces(name)[0].country, code, name);
    assert.equal(parsePlaces(code)[0].country, code, code);
  }
});
const placeCases = [
  ["Waterloo, ON", "CA", "Ontario", "Waterloo"], ["Waterloo, IA", "US", "Iowa", "Waterloo"],
  ["London, UK", "GB", "England", "London"], ["London, ON", "CA", "Ontario", "London"],
  ["Cambridge, UK", "GB", "England", "Cambridge"], ["Cambridge, MA", "US", "Massachusetts", "Cambridge"],
  ["Sydney, NSW", "AU", "New South Wales", "Sydney"], ["Sydney, NS", "CA", "Nova Scotia", "Sydney"],
  ["Sydney, WA", "AU", "Western Australia", "Sydney"], ["Vancouver, WA", "US", "Washington", "Vancouver"],
  ["Bengaluru, IN", "IN", "Karnataka", "Bengaluru"], ["Munich, DE", "DE", "Bavaria", "Munich"],
  ["Bangalore, Karnataka, India", "IN", "Karnataka", "Bangalore"],
  ["Munich, Bayern, Deutschland", "DE", "Bavaria", "Munich"],
  ["Berlin", "DE", "Berlin", "Berlin"], ["Paris", "FR", "Paris", "Paris"],
  ["Tokyo", "JP", "Tokyo", "Tokyo"], ["Ontario, Canada", "CA", "Ontario", ""],
  ["Cambridge, Massachusetts, USA", "US", "Massachusetts", "Cambridge"],
  ["New South Wales, Australia", "AU", "New South Wales", ""],
  ["South Australia", "AU", "South Australia", ""],
  ["Newfoundland and Labrador, Canada", "CA", "Newfoundland and Labrador", ""], ["Toronto ON", "CA", "Ontario", "Toronto"],
  ["London United Kingdom", "GB", "England", "London"], ["Remote in Canada", "CA", "Other", ""],
  ["Remote", "REMOTE", "Other", ""], ["Atlantis", "", "Other", "Atlantis"]
];
for (const [text, country, region, city] of placeCases) {
  test(`parsePlaces reads ${text}`, () => assert.deepEqual(parsePlaces(text), [{ country, region, city }]));
}
test("aliases, UK nations, and punctuation identify the country", () => {
  for (const [text, country] of [["USA", "US"], ["US", "US"], ["U.S.A.", "US"], ["United States", "US"], ["England", "GB"], ["Scotland", "GB"], ["Wales", "GB"], ["Northern Ireland", "GB"], ["Holland", "NL"], ["UAE", "AE"], ["Remote in UK", "GB"], ["Berlin (Germany)", "DE"]]) {
    assert.equal(parsePlaces(text)[0].country, country, text);
  }
  assert.deepEqual(parsePlaces("Scotland"), [{ country: "GB", region: "Scotland", city: "" }]);
  assert.deepEqual(parsePlaces(""), []);
  assert.deepEqual(parsePlaces(null), []);
});
test("multiple cities retain their own countries and first-level areas", () => {
  assert.deepEqual(parsePlaces("Richardson, TX, Bloomington, IL"), [
    { country: "US", region: "Texas", city: "Richardson" }, { country: "US", region: "Illinois", city: "Bloomington" }
  ]);
  assert.deepEqual(parsePlaces("Toronto, ON / London, UK; Sydney, NSW"), [
    { country: "CA", region: "Ontario", city: "Toronto" }, { country: "GB", region: "England", city: "London" },
    { country: "AU", region: "New South Wales", city: "Sydney" }
  ]);
});
const worldwide = [
  { location: "Toronto, ON, Ottawa, ON, Vancouver, BC, Austin, TX" },
  { location: "Waterloo, ON" }, { location: "London, UK" }, { location: "Remote in Canada" },
  { location: "Remote" }, { location: "Atlantis" }
];
test("country and region tags work on stored and older untagged listings", () => {
  assert.deepEqual(listingCountries(worldwide[0]), ["CA", "US"]);
  assert.deepEqual(listingRegions(worldwide[0]), ["Ontario", "British Columbia", "Texas"]);
  assert.deepEqual(listingCountries({ countries: ["DE", "DE", "INVALID"] }), ["DE"]);
  assert.deepEqual(listingRegions({ regions: ["Berlin", "Berlin", null] }), ["Berlin"]);
  assert.deepEqual(listingCountries(null), []);
});
test("counts deduplicate postings and sort regions by count, then label", () => {
  assert.deepEqual(countryCounts(worldwide), { ALL: 6, CA: 3, US: 1, GB: 1, REMOTE: 1 });
  assert.deepEqual(regionCountsFor("CA", worldwide), { ALL: 3, Ontario: 2, "British Columbia": 1, Other: 1 });
  assert.deepEqual(Object.keys(regionCountsFor("CA", worldwide)), ["ALL", "Ontario", "British Columbia", "Other"]);
  assert.deepEqual(countryCounts(null), { ALL: 0 });
  assert.deepEqual(regionCountsFor("FR", worldwide), { ALL: 0 });
});
test("matching keeps country/region pairs together on multi-country postings", () => {
  assert.equal(matchesCountry(worldwide[0], "US"), true);
  assert.equal(matchesCountry(worldwide[0], "ALL"), true);
  assert.equal(matchesCountry(worldwide[0], "FR"), false);
  assert.equal(matchesRegionIn(worldwide[0], "CA", "Ontario"), true);
  assert.equal(matchesRegionIn(worldwide[0], "CA", "Texas"), false);
  assert.equal(matchesRegionIn(worldwide[0], "US", "Ontario"), false);
  assert.equal(matchesRegionIn(worldwide[0], "US", "ALL"), true);
  assert.equal(matchesRegionIn(worldwide[0], "ALL", "ALL"), true);
  assert.equal(matchesRegionIn(worldwide[0], "ALL", "Ontario"), false);
  assert.equal(matchesRegionIn({ countries: ["DE"], regions: ["Berlin"] }, "DE", "Berlin"), true);
  assert.equal(matchesRegionIn({ countries: ["DE", "FR"], regions: ["Berlin", "Paris"] }, "FR", "Berlin"), false);
});

test("region counts safely handle arbitrary place labels", () => {
  const listings = ["__proto__", "constructor"].map(region => ({ countries: ["CA"], regions: [region] }));
  const counts = regionCountsFor("CA", listings);
  assert.equal(counts.ALL, 2);
  assert.equal(counts.__proto__, 1);
  assert.equal(counts.constructor, 1);
});
