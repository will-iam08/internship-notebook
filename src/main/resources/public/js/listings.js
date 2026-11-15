/* Shared, dependency-free location rules for the feed and both listing sources. */
export const COUNTRIES = [
  ["CA", "Canada"], ["US", "United States"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["IN", "India"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"],
  ["ES", "Spain"], ["IT", "Italy"], ["SE", "Sweden"], ["CH", "Switzerland"],
  ["PL", "Poland"], ["AU", "Australia"], ["NZ", "New Zealand"], ["SG", "Singapore"],
  ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["HK", "Hong Kong"],
  ["TW", "Taiwan"], ["AE", "United Arab Emirates"], ["IL", "Israel"], ["BR", "Brazil"],
  ["MX", "Mexico"], ["ZA", "South Africa"], ["PT", "Portugal"], ["BE", "Belgium"],
  ["AT", "Austria"], ["DK", "Denmark"], ["NO", "Norway"], ["FI", "Finland"],
  ["CZ", "Czechia"], ["RO", "Romania"], ["HU", "Hungary"], ["GR", "Greece"],
  ["TR", "Türkiye"], ["ID", "Indonesia"], ["MY", "Malaysia"], ["PH", "Philippines"],
  ["TH", "Thailand"], ["VN", "Vietnam"], ["AR", "Argentina"], ["CL", "Chile"],
  ["CO", "Colombia"], ["EG", "Egypt"], ["KE", "Kenya"], ["NG", "Nigeria"], ["SA", "Saudi Arabia"]
].map(([code, name]) => ({ code, name }));
export const COUNTRY_LABELS = { ...Object.fromEntries(COUNTRIES.map(({ code, name }) => [code, name])), REMOTE: "Remote" };
export const REGIONS = ["Canada", "United States", "Remote", "International"];
const plainText = text => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const key = text => plainText(text).toLowerCase().trim();
const unique = values => [...new Set(values)];
const aliases = {
  CA: ["CAN"], US: ["USA", "U.S.", "U.S.A.", "United States of America"],
  GB: ["UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  DE: ["Deutschland"], NL: ["Holland"], IN: ["Bharat"], KR: ["Korea", "Republic of Korea"],
  CN: ["PRC", "People's Republic of China"], AE: ["UAE"], CZ: ["Czech Republic"], TR: ["Turkey"]
};
const countryNames = new Map(COUNTRIES.flatMap(({ code, name }) => [name, ...(aliases[code] || [])].map(name => [key(name), code])));
const countrySuffix = new RegExp(`^(.+?)\\s+(${[...countryNames.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");
const AREAS = {
  CA: {
    ON: "Ontario", BC: "British Columbia", QC: "Quebec", AB: "Alberta", MB: "Manitoba", SK: "Saskatchewan",
    NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island",
    NT: "Northwest Territories", YT: "Yukon", NU: "Nunavut"
  },
  US: {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
    WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico"
  },
  AU: { NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia", WA: "Western Australia", TAS: "Tasmania", ACT: "Australian Capital Territory", NT: "Northern Territory" },
  GB: { England: "England", Scotland: "Scotland", Wales: "Wales", "Northern Ireland": "Northern Ireland" },
  IN: Object.fromEntries(["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi"].map(name => [name, name])),
  DE: { Bavaria: "Bavaria", Bayern: "Bavaria", Berlin: "Berlin", Brandenburg: "Brandenburg", Bremen: "Bremen", Hamburg: "Hamburg", Hesse: "Hesse", Hessen: "Hesse", "Baden-Württemberg": "Baden-Württemberg", "Lower Saxony": "Lower Saxony", Niedersachsen: "Lower Saxony", "North Rhine-Westphalia": "North Rhine-Westphalia", "Nordrhein-Westfalen": "North Rhine-Westphalia", "Rhineland-Palatinate": "Rhineland-Palatinate", Saarland: "Saarland", Saxony: "Saxony", Sachsen: "Saxony", "Saxony-Anhalt": "Saxony-Anhalt", "Schleswig-Holstein": "Schleswig-Holstein", Thuringia: "Thuringia", Thüringen: "Thuringia", "Mecklenburg-Vorpommern": "Mecklenburg-Vorpommern" }
};
// shortcut: unlisted bare cities need a country or area; extend this map as sources add them.
const cities = new Map();
function addCities(country, region, names) {
  for (const city of names.split("|")) cities.set(key(city), { country, region: region || city });
}
addCities("CA", "Ontario", "Toronto|Waterloo|Ottawa|Mississauga|Markham|Vaughan|Thornhill|Kanata|Kitchener|London|Richmond Hill");
addCities("CA", "British Columbia", "Vancouver|Burnaby|Surrey|Victoria|North Vancouver");
addCities("CA", "Quebec", "Montreal|Montréal|Quebec City|Québec City");
addCities("CA", "Alberta", "Calgary|Edmonton");
addCities("CA", "Manitoba", "Winnipeg");
addCities("CA", "Saskatchewan", "Saskatoon|Regina");
addCities("CA", "Nova Scotia", "Halifax");
addCities("CA", "Newfoundland and Labrador", "St. John's");
addCities("CA", "Prince Edward Island", "Charlottetown");
addCities("US", "California", "SF|San Francisco|Bay Area|Silicon Valley|LA|Los Angeles|San Jose|San Diego|Palo Alto|Mountain View|Sunnyvale|Santa Clara|Irvine|Foster City");
addCities("US", "New York", "NYC|New York|New York City");
addCities("US", "Washington", "Seattle|Redmond|Bellevue");
addCities("US", "Massachusetts", "Boston|Cambridge");
addCities("US", "Texas", "Austin|Dallas|Houston|Richardson|Plano");
addCities("US", "Illinois", "Chicago");
addCities("US", "Pennsylvania", "Pittsburgh|Philadelphia");
addCities("US", "Georgia", "Atlanta");
addCities("US", "District of Columbia", "Washington DC|Washington D.C.");
addCities("GB", "England", "London|Cambridge|Manchester|Bristol|Reading|Oxford|Birmingham");
addCities("GB", "Scotland", "Edinburgh|Glasgow");
addCities("GB", "Wales", "Cardiff");
addCities("GB", "Northern Ireland", "Belfast");
addCities("IE", "", "Dublin|Cork|Galway");
addCities("IN", "Karnataka", "Bangalore|Bengaluru");
addCities("IN", "Telangana", "Hyderabad");
addCities("IN", "Maharashtra", "Mumbai|Pune");
addCities("IN", "Tamil Nadu", "Chennai");
addCities("IN", "Delhi", "Delhi|New Delhi");
addCities("IN", "Haryana", "Gurgaon|Gurugram");
addCities("IN", "Uttar Pradesh", "Noida");
addCities("DE", "Bavaria", "Munich|München");
addCities("DE", "Berlin", "Berlin");
addCities("DE", "Hamburg", "Hamburg");
addCities("DE", "Hesse", "Frankfurt|Frankfurt am Main");
addCities("DE", "Baden-Württemberg", "Stuttgart|Karlsruhe");
addCities("DE", "North Rhine-Westphalia", "Cologne|Köln|Düsseldorf");
addCities("AU", "New South Wales", "Sydney");
addCities("AU", "Victoria", "Melbourne");
addCities("AU", "Queensland", "Brisbane");
addCities("AU", "Western Australia", "Perth");
for (const [country, names] of Object.entries({
  FR: "Paris|Lyon|Toulouse", NL: "Amsterdam|Rotterdam|Eindhoven", ES: "Madrid|Barcelona", IT: "Rome|Milan|Milano",
  SE: "Stockholm|Gothenburg", CH: "Zurich|Zürich|Geneva|Lausanne", PL: "Warsaw|Krakow|Kraków|Wroclaw",
  NZ: "Auckland|Wellington", SG: "Singapore", JP: "Tokyo|Osaka", KR: "Seoul|Busan", CN: "Beijing|Shanghai|Shenzhen",
  HK: "Hong Kong", TW: "Taipei|Hsinchu", AE: "Dubai|Abu Dhabi", IL: "Tel Aviv|Jerusalem|Haifa", BR: "São Paulo|Rio de Janeiro",
  MX: "Mexico City|Guadalajara|Monterrey", ZA: "Cape Town|Johannesburg", PT: "Lisbon|Porto", BE: "Brussels",
  AT: "Vienna", DK: "Copenhagen", NO: "Oslo", FI: "Helsinki", CZ: "Prague", RO: "Bucharest", HU: "Budapest",
  GR: "Athens", TR: "Istanbul", ID: "Jakarta", MY: "Kuala Lumpur", PH: "Manila", TH: "Bangkok", VN: "Hanoi|Ho Chi Minh City",
  AR: "Buenos Aires", CL: "Santiago", CO: "Bogotá", EG: "Cairo", KE: "Nairobi", NG: "Lagos", SA: "Riyadh"
})) addCities(country, "", names);
const areaAliases = Object.entries(AREAS).flatMap(([country, areas]) => Object.entries(areas)
  .map(([alias, region]) => ({ country, region, name: key(region), alias: alias.length > 3 ? key(alias) : alias, isCode: alias.length <= 3 })));
function areaFrom(text, country, hasCity, preferredCountry) {
  const name = key(text);
  // Codes stay case-sensitive: "on call" and "or remote" are ordinary words.
  const matches = areaAliases.filter(area => (!country || area.country === country)
    && (area.name === name || (area.isCode ? area.alias === text && (hasCity || !COUNTRY_LABELS[text]) : area.alias === name)));
  const area = matches.find(area => area.country === preferredCountry) || matches[0];
  return area ? { country: area.country, region: area.region } : null;
}
const REMOTE_FILLER = /\b(?:remote|fully|anywhere|worldwide|global(?:ly)?|in|or|and|hybrid)\b|[-,/|&()·]/gi;
/** Unknown places keep an empty country; only unrestricted remote gets REMOTE. */
export function parsePlaces(locationText) {
  const text = plainText(locationText).trim();
  if (!text) return [];
  if (/\bremote\b/i.test(text) && !text.replace(REMOTE_FILLER, "").trim()) return [{ country: "REMOTE", region: "Other", city: "" }];
  const parts = text.replace(/\b(?:(?:or|and)\s+)?(?:fully\s+)?remote\b(?:\s+(?:in|or|and)\b)?|\bhybrid\b/gi, "")
    .replace(/\s+-\s+|[()]/g, ",")
    .split(/[,;/|&\n]+/).flatMap(part => areaFrom(part.trim(), "", false) ? [part] : part.split(/\s+(?:or|and)\s+/i)).flatMap(part => {
      const trimmed = part.trim().replace(/^[-·\s]+|[-·\s]+$/g, "");
      const suffix = countryNames.has(key(trimmed)) || cities.has(key(trimmed)) || areaFrom(trimmed, "", false) ? null
        : trimmed.match(countrySuffix) || trimmed.match(/^(.+?)\s+([A-Z]{2,3})$/);
      return suffix ? [suffix[1], suffix[2]] : [trimmed];
    }).filter(Boolean);
  const places = [];
  let current = null;
  let explicitCountry = false;
  let explicitArea = false;
  const flush = () => {
    if (current) places.push(current);
    current = null;
    explicitCountry = false;
    explicitArea = false;
  };
  for (const part of parts) {
    const city = cities.get(key(part));
    const country = countryNames.get(key(part)) || (COUNTRIES.some(({ code }) => code === part) ? part : "");
    const area = areaFrom(part, explicitCountry ? current.country : city?.country || "", Boolean(current?.city), current?.country);
    if (area && (!city || part.length <= 3) && !(country && current?.country === country && area.country !== country)) {
      if (explicitArea && !current.city && current.country !== area.country && !explicitCountry) current.city = current.region;
      else if (explicitArea || (explicitCountry && current.country !== area.country)) flush();
      current = { country: area.country, region: area.region, city: current?.city || "" };
      explicitArea = true;
    } else if (country && !city) {
      if (explicitCountry || (explicitArea && current.country !== country)) flush();
      current = { country, region: current?.country === country ? current.region : current?.city || "Other", city: current?.city || "" };
      explicitCountry = true;
    } else {
      if (current?.country || city) flush();
      if (!current) current = { country: city?.country || "", region: city?.region || "Other", city: part };
    }
  }
  flush();
  return places.filter((place, index) => places.findIndex(other => other.country === place.country && other.region === place.region && other.city === place.city) === index);
}
/** Flat tags are for display; parse location again to retain country/region pairs when filtering. */
export function listingCountries(listing) {
  return unique(Array.isArray(listing?.countries) ? listing.countries.filter(code => Object.hasOwn(COUNTRY_LABELS, code)) : parsePlaces(listing?.location).map(place => place.country).filter(Boolean));
}
export function listingRegions(listing) {
  return unique(Array.isArray(listing?.regions) ? listing.regions.filter(region => typeof region === "string" && region) : parsePlaces(listing?.location).map(place => place.region));
}
function regionsIn(listing, country) {
  if (!matchesCountry(listing, country)) return [];
  const places = parsePlaces(listing?.location).filter(place => place.country === country);
  if (places.length) return unique(places.map(place => place.region));
  // Flat tags can only be paired safely when there is a single country.
  return listingCountries(listing).length === 1 ? listingRegions(listing) : [];
}
export function matchesCountry(listing, code) {
  return code === "ALL" || listingCountries(listing).includes(code);
}
export function matchesRegionIn(listing, country, region) {
  return matchesCountry(listing, country) && (region === "ALL" || (country !== "ALL" && regionsIn(listing, country).includes(region)));
}
export function countryCounts(listings) {
  const counts = { ALL: 0 };
  for (const listing of Array.isArray(listings) ? listings : []) {
    counts.ALL++;
    for (const country of listingCountries(listing)) counts[country] = (counts[country] || 0) + 1;
  }
  return counts;
}
/** One posting counts once in each region it offers, with ALL counting unique postings. */
export function regionCountsFor(country, listings) {
  const counts = Object.create(null);
  let total = 0;
  for (const listing of Array.isArray(listings) ? listings : []) {
    if (!matchesCountry(listing, country)) continue;
    total++;
    for (const region of country === "ALL" ? listingRegions(listing) : regionsIn(listing, country)) counts[region] = (counts[region] || 0) + 1;
  }
  return { ALL: total, ...Object.fromEntries(Object.entries(counts).sort(([a, left], [b, right]) => right - left || a.localeCompare(b))) };
}
/** Legacy coarse regions retain Canada-first precedence for multi-country postings. */
export function classifyRegion(location) {
  if (!String(location ?? "").trim()) return "";
  const countries = parsePlaces(location).map(place => place.country);
  if (countries.includes("CA")) return "Canada";
  if (countries.includes("US")) return "United States";
  return countries.includes("REMOTE") ? "Remote" : "International";
}
export function workModeFrom(location) {
  const text = String(location ?? "");
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  return "In-person";
}
export function listingRegion(listing) {
  return REGIONS.includes(listing?.region) ? listing.region : classifyRegion(listing?.location);
}
export function matchesRegion(listing, region) {
  return region === "ALL" || listingRegion(listing) === region;
}
export function regionCounts(listings) {
  const counts = { ALL: 0, ...Object.fromEntries(REGIONS.map(region => [region, 0])) };
  for (const listing of Array.isArray(listings) ? listings : []) {
    counts.ALL++;
    const region = listingRegion(listing);
    if (region) counts[region]++;
  }
  return counts;
}
