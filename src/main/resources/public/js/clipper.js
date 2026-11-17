import { LIMITS, SKILL_LIMIT, STAGES, cleanLink, cleanSkills } from "./domain.js";

const KNOWN_COMPANY_NAMES = Object.freeze({
  stripe: "Stripe",
  figma: "Figma",
  shopify: "Shopify",
  google: "Google",
  meta: "Meta",
  microsoft: "Microsoft",
  amazon: "Amazon",
  apple: "Apple",
  netflix: "Netflix",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  anthropic: "Anthropic",
  databricks: "Databricks",
  snowflake: "Snowflake",
  cloudflare: "Cloudflare",
  datadog: "Datadog",
  coinbase: "Coinbase",
  robinhood: "Robinhood",
  plaid: "Plaid",
  scaleai: "Scale AI",
  scale: "Scale AI",
  palantir: "Palantir",
  discord: "Discord",
  notion: "Notion",
  linear: "Linear",
  vercel: "Vercel",
  supabase: "Supabase",
  github: "GitHub",
  gitlab: "GitLab",
  atlassian: "Atlassian",
  twilio: "Twilio",
  pinterest: "Pinterest",
  dropbox: "Dropbox",
  airbnb: "Airbnb",
  uber: "Uber",
  lyft: "Lyft",
  doordash: "DoorDash",
  instacart: "Instacart",
  reddit: "Reddit",
  snap: "Snap",
  spotify: "Spotify",
  duolingo: "Duolingo",
  ramp: "Ramp",
  brex: "Brex",
  rippling: "Rippling",
  gusto: "Gusto",
  affirm: "Affirm",
  chime: "Chime",
  wealthsimple: "Wealthsimple",
  "1password": "1Password",
  onepassword: "1Password",
  cohere: "Cohere",
  watonomous: "WATonomous",
  ibm: "IBM",
  amd: "AMD",
  intel: "Intel",
  tesla: "Tesla",
  spacex: "SpaceX",
  tiktok: "TikTok",
  bytedance: "ByteDance",
  oracle: "Oracle",
  salesforce: "Salesforce",
  adobe: "Adobe",
  intuit: "Intuit",
  servicenow: "ServiceNow",
  workday: "Workday",
  hubspot: "HubSpot",
  zendesk: "Zendesk",
  okta: "Okta",
  crowdstrike: "CrowdStrike",
  splunk: "Splunk",
  mongodb: "MongoDB",
  elastic: "Elastic",
  asana: "Asana",
  canva: "Canva",
  roblox: "Roblox",
  riotgames: "Riot Games",
  ea: "EA",
  ubisoft: "Ubisoft"
});

const SLUG_NOISE_SUFFIXES = new Set([
  "jobs",
  "careers",
  "career",
  "recruiting",
  "recruitment",
  "talent",
  "hiring",
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "hq",
  "global",
  "us",
  "ca",
  "uk",
  "eu"
]);

const ATS_RESERVED_SEGMENTS = new Set([
  "embed",
  "job_app",
  "jobs",
  "boards",
  "apply",
  "postings",
  "search",
  "v1",
  "api",
  "career",
  "careers",
  "external",
  "internal",
  "en",
  "en-us",
  "en-ca"
]);

const SKILL_PATTERNS = [
  ["TypeScript", /\btypescript\b/i],
  ["JavaScript", /\b(?:javascript|es6)\b/i],
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["C++", /(?:^|[\s,;/([+])c\+\+(?=$|[\s,;/)\].])/i],
  ["C#", /(?:^|[\s,;/([+])c#(?=$|[\s,;/)\].])/i],
  ["Go", /\b(?:golang|go\s+programming)\b/i],
  ["Rust", /\brust\b/i],
  ["React", /\breact(?:\.js|js)?\b/i],
  ["Next.js", /\bnext(?:\.js|js)\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i],
  ["Vue", /\bvue(?:\.js|js)?\b/i],
  ["Angular", /\bangular(?:\.js|js)?\b/i],
  ["HTML", /\bhtml5?\b/i],
  ["CSS", /\bcss3?\b/i],
  ["Tailwind CSS", /\btailwind(?:\s*css)?\b/i],
  ["SQL", /\bsql\b/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongodb\b/i],
  ["Redis", /\bredis\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["REST APIs", /\brest(?:ful)?\s+apis?\b/i],
  ["AWS", /\b(?:aws|amazon\s+web\s+services)\b/i],
  ["GCP", /\b(?:gcp|google\s+cloud(?:\s+platform)?)\b/i],
  ["Azure", /\bazure\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\b(?:kubernetes|k8s)\b/i],
  ["Terraform", /\bterraform\b/i],
  ["Git", /\bgit\b/i],
  ["Linux", /\b(?:linux|unix)\b/i],
  ["CI/CD", /\bci\s*\/\s*cd\b/i],
  ["PyTorch", /\bpytorch\b/i],
  ["TensorFlow", /\btensorflow\b/i],
  ["Pandas", /\bpandas\b/i],
  ["NumPy", /\bnumpy\b/i],
  ["Scikit-learn", /\b(?:scikit-learn|sklearn)\b/i],
  ["Spark", /\b(?:apache\s+spark|pyspark)\b/i],
  ["Kafka", /\bkafka\b/i],
  ["Django", /\bdjango\b/i],
  ["Flask", /\bflask\b/i],
  ["FastAPI", /\bfastapi\b/i],
  ["Spring Boot", /\bspring(?:\s+boot)?\b/i],
  ["Ruby", /\bruby(?:\s+on\s+rails)?\b/i],
  ["Swift", /\bswift\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["PHP", /\bphp\b/i],
  ["Scala", /\bscala\b/i],
  ["R", /\br\s+programming\b/i],
  ["MATLAB", /\bmatlab\b/i],
  ["Figma", /\bfigma\b/i]
];

const ROLE_KEYWORDS = /\b(?:intern|internship|co-?op|engineer|engineering|developer|software|swe|sde|frontend|front-end|backend|back-end|full-stack|fullstack|data|machine\s+learning|ml|ai|product\s+manager|pm|designer|design|analyst|researcher|research|security|devops|sre|cloud|mobile|ios|android|embedded|hardware|firmware|quant|quantitative|consultant|associate|fellow|student|undergraduate|graduate)\b/i;

const SITE_SUFFIX_SOURCES = [
  [/\s*[|\-\u2013\u2014\u00B7]\s*linkedin(?:\s+jobs)?\s*$/i, "LinkedIn"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*handshake\s*$/i, "Handshake"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*simplify(?:\.jobs)?\s*$/i, "Simplify"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*indeed(?:\.com)?\s*$/i, "Indeed"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*waterlooworks\s*$/i, "WaterlooWorks"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*glassdoor\s*$/i, "Glassdoor"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*wellfound(?:\s*\(angellist\s+talent\))?\s*$/i, "Company website"],
  [/\s*[|\-\u2013\u2014\u00B7]\s*(?:greenhouse|lever|ashby|workday|smartrecruiters|jobvite|bamboohr|rippling|workable)\s*$/i, "Company website"]
];

const LOCATION_PATTERNS = [
  /\b(?:Toronto|Waterloo|Vancouver|Montreal|Montr\u00e9al|Ottawa|Calgary|Edmonton|Mississauga|Markham|Kitchener|kanata|Halifax|Victoria|Winnipeg|Quebec\s+City),?\s*(?:ON|BC|QC|AB|MB|NS|NB|SK|NL|PE|Ontario|British\s+Columbia|Quebec|Alberta|Canada)\b/i,
  /\b(?:San\s+Francisco|New\s+York(?:\s+City)?|NYC|Seattle|Austin|Boston|Chicago|Los\s+Angeles|Mountain\s+View|Palo\s+Alto|Sunnyvale|Menlo\s+Park|Cupertino|San\s+Jose|Santa\s+Clara|Redmond|Bellevue|Atlanta|Denver|Boulder|Miami|Washington|Pittsburgh|Philadelphia|Dallas|Houston|Raleigh|Durham|Cambridge|Somerville|San\s+Diego|Irvine|San\s+Mateo),?\s*(?:CA|NY|WA|TX|MA|IL|GA|CO|FL|DC|PA|NC|VA|MD|NJ|OH|MI|MN|OR|AZ|UT)(?:\b|\s*\((?:Hybrid|Remote|On-?site)\))?/i,
  /\b(?:London,\s*UK|Dublin,\s*Ireland|Berlin,\s*Germany|Amsterdam,\s*Netherlands|Singapore|Tokyo,\s*Japan|Sydney,\s*Australia|Zurich,\s*Switzerland|Paris,\s*France)\b/i,
  /\bRemote(?:\s*\((?:US|USA|Canada|US\s*&\s*Canada|North\s+America|Global)\)|\s*-\s*(?:US|USA|Canada)\b|\b)/i,
  /\bHybrid\b/i
];

function clampField(value, max) {
  return String(value ?? "")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeHttpUrl(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text || /\s/.test(text)) return "";
  try {
    const cleaned = cleanLink(text);
    if (!cleaned) return "";
    const parsed = new URL(cleaned);
    if (parsed.hostname !== "localhost" && !parsed.hostname.includes(".")) return "";
    return cleaned;
  } catch {
    return "";
  }
}

export function humanizeSlug(slug) {
  const raw = decodeURIComponent(String(slug ?? ""))
    .trim()
    .replace(/^@+/, "");
  if (!raw) return "";

  const compactKey = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (KNOWN_COMPANY_NAMES[compactKey]) return KNOWN_COMPANY_NAMES[compactKey];

  const tokens = raw
    .split(/[-_.\s]+/)
    .map(token => token.trim())
    .filter(Boolean);

  while (tokens.length > 1 && SLUG_NOISE_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }

  const recombinedKey = tokens.join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (KNOWN_COMPANY_NAMES[recombinedKey]) return KNOWN_COMPANY_NAMES[recombinedKey];

  return tokens
    .map(token => {
      const lower = token.toLowerCase();
      if (KNOWN_COMPANY_NAMES[lower]) return KNOWN_COMPANY_NAMES[lower];
      if (/^(?:ai|ml|ui|ux|qa|sre|ios|api|sdk|aws|gcp|sql|usa|uk|eu|ii|iii|iv)$/i.test(token)) {
        return token.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function humanizeRoleSlug(slug) {
  const cleaned = decodeURIComponent(String(slug ?? ""))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/[-_]+R?[0-9]{4,}\b/gi, "")
    .replace(/^[0-9]{4,}[-_]+/, "")
    .replace(/[-_]+[0-9]{4,}$/, "")
    .trim();
  if (!cleaned || /^[0-9a-f-]+$/i.test(cleaned)) return "";
  const title = humanizeSlug(cleaned);
  return ROLE_KEYWORDS.test(title) ? title : "";
}

function firstCompanySegment(segments) {
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (!ATS_RESERVED_SEGMENTS.has(lower) && !/^[0-9]+$/.test(lower)) {
      return segment;
    }
  }
  return "";
}

export function parseJobUrl(rawUrl) {
  const empty = { company: "", role: "", location: "", source: "", link: "" };
  const cleanedUrl = safeHttpUrl(rawUrl);
  if (!cleanedUrl) return empty;

  let parsed;
  try {
    parsed = new URL(cleanedUrl);
  } catch {
    return empty;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  let company = "";
  let role = "";
  let source = "";

  // Greenhouse: boards.greenhouse.io/<company>/jobs/<id> or job-boards.greenhouse.io/<company>/jobs/<id>
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host.endsWith(".greenhouse.io")) {
    source = "Company website";
    const forParam = parsed.searchParams.get("for");
    const slug = forParam || firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Lever: jobs.lever.co/<company>/<id>
  else if (host === "jobs.lever.co" || host.endsWith(".lever.co")) {
    source = "Company website";
    const slug = firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Ashby: jobs.ashbyhq.com/<company>/<id>
  else if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) {
    source = "Company website";
    const slug = firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Workday: <company>.wd<N>.myworkdayjobs.com/.../job/<location>/<role-slug>_<id>
  else if (host.endsWith(".myworkdayjobs.com") || host.endsWith(".myworkdaysite.com")) {
    source = "Company website";
    const subdomain = host.split(".")[0];
    if (subdomain && !/^wd\d+$/i.test(subdomain)) {
      company = humanizeSlug(subdomain);
    }
    const jobIdx = segments.findIndex(seg => seg.toLowerCase() === "job");
    if (jobIdx !== -1 && segments.length > jobIdx + 1) {
      const candidateSlug = segments[segments.length - 1].split("_")[0];
      const extractedRole = humanizeRoleSlug(candidateSlug);
      if (extractedRole) role = extractedRole;
    }
  }
  // SmartRecruiters: jobs.smartrecruiters.com/<Company>/<id>-<role-slug>
  else if (host === "jobs.smartrecruiters.com" || host.endsWith(".smartrecruiters.com")) {
    source = "Company website";
    if (segments[0]) company = humanizeSlug(segments[0]);
    if (segments[1]) {
      const extractedRole = humanizeRoleSlug(segments[1]);
      if (extractedRole) role = extractedRole;
    }
  }
  // Jobvite: jobs.jobvite.com/<company>/job/<id>
  else if (host === "jobs.jobvite.com" || host.endsWith(".jobvite.com")) {
    source = "Company website";
    const slug = firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Dover: app.dover.com/apply/<company>/<id> or app.dover.io/apply/<company>/<id>
  else if (host.endsWith("dover.com") || host.endsWith("dover.io")) {
    source = "Company website";
    const applyIdx = segments.findIndex(seg => seg.toLowerCase() === "apply");
    const slug = applyIdx !== -1 ? segments[applyIdx + 1] : firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Rippling: ats.rippling.com/<company>/jobs/<id>
  else if (host === "ats.rippling.com" || host.endsWith(".rippling.com")) {
    source = "Company website";
    const slug = firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // BambooHR: <company>.bamboohr.com/careers/<id>
  else if (host.endsWith(".bamboohr.com")) {
    source = "Company website";
    const subdomain = host.split(".")[0];
    if (subdomain) company = humanizeSlug(subdomain);
  }
  // Workable: apply.workable.com/<company>/j/<id>
  else if (host === "apply.workable.com" || host.endsWith(".workable.com")) {
    source = "Company website";
    const slug = firstCompanySegment(segments);
    if (slug) company = humanizeSlug(slug);
  }
  // Recruitee / BreezyHR: <company>.recruitee.com / <company>.breezy.hr
  else if (host.endsWith(".recruitee.com") || host.endsWith(".breezy.hr")) {
    source = "Company website";
    const subdomain = host.split(".")[0];
    if (subdomain) company = humanizeSlug(subdomain);
  }
  // LinkedIn: linkedin.com/jobs/view/<role>-at-<company>-<id>
  else if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    source = "LinkedIn";
    const viewIdx = segments.findIndex(seg => seg.toLowerCase() === "view");
    const slug = viewIdx !== -1 ? segments[viewIdx + 1] : "";
    if (slug && slug.includes("-at-")) {
      const cleanedSlug = slug.replace(/-\d+$/, "");
      const atParts = cleanedSlug.split("-at-");
      if (atParts.length >= 2) {
        const rawRole = humanizeSlug(atParts.slice(0, -1).join("-at-"));
        const rawCompany = humanizeSlug(atParts[atParts.length - 1]);
        if (rawRole) role = rawRole;
        if (rawCompany) company = rawCompany;
      }
    }
  }
  // Handshake
  else if (host === "joinhandshake.com" || host.endsWith(".joinhandshake.com")) {
    source = "Handshake";
  }
  // Simplify
  else if (host === "simplify.jobs" || host.endsWith(".simplify.jobs")) {
    source = "Simplify";
    // simplify.jobs/p/<uuid>/<Role>-at-<Company>
    const lastSeg = segments[segments.length - 1] || "";
    if (lastSeg.includes("-at-")) {
      const atParts = lastSeg.split("-at-");
      if (atParts.length >= 2) {
        const rawRole = humanizeSlug(atParts.slice(0, -1).join("-at-"));
        const rawCompany = humanizeSlug(atParts[atParts.length - 1]);
        if (rawRole) role = rawRole;
        if (rawCompany) company = rawCompany;
      }
    }
  }
  // Indeed
  else if (host === "indeed.com" || host.endsWith(".indeed.com")) {
    source = "Indeed";
  }
  // WaterlooWorks
  else if (host === "waterlooworks.uwaterloo.ca" || host.endsWith(".uwaterloo.ca")) {
    source = "WaterlooWorks";
  }
  // Wellfound
  else if (host === "wellfound.com" || host.endsWith(".wellfound.com")) {
    source = "Company website";
    const compIdx = segments.findIndex(seg => seg.toLowerCase() === "company");
    if (compIdx !== -1 && segments[compIdx + 1]) {
      company = humanizeSlug(segments[compIdx + 1]);
    }
  }
  // Generic company domain (e.g., stripe.com/jobs/..., careers.google.com/...)
  else {
    const hostParts = host.split(".");
    if (hostParts.length >= 2) {
      const mainDomain = hostParts[hostParts.length - 2];
      if (KNOWN_COMPANY_NAMES[mainDomain]) {
        company = KNOWN_COMPANY_NAMES[mainDomain];
        source = "Company website";
      } else if (
        hostParts[0] === "careers" ||
        hostParts[0] === "jobs" ||
        segments.some(seg => /^(?:careers?|jobs?|internships?)$/i.test(seg))
      ) {
        company = humanizeSlug(mainDomain);
        source = "Company website";
      }
    }
  }

  return {
    company: clampField(company, LIMITS.company),
    role: clampField(role, LIMITS.role),
    location: "",
    source: clampField(source, LIMITS.source),
    link: cleanedUrl
  };
}

export function extractSkillsFromText(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const found = [];
  for (const [label, pattern] of SKILL_PATTERNS) {
    if (pattern.test(raw)) {
      found.push(label);
      if (found.length >= SKILL_LIMIT) break;
    }
  }
  return cleanSkills(found);
}

function matchKnownLocation(text) {
  for (const pattern of LOCATION_PATTERNS) {
    const match = String(text ?? "").match(pattern);
    if (match) return clampField(match[0], LIMITS.location);
  }
  return "";
}

export function extractLocationFromText(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return "";

  const labeledMatch = raw.match(/(?:^|\n)\s*(?:location|office|city|workplace(?:\s+type)?)\s*[:\-]\s*([^\n|]{2,60})/i);
  if (labeledMatch) {
    const candidate = labeledMatch[1].trim();
    return matchKnownLocation(candidate) || clampField(candidate, LIMITS.location);
  }

  return matchKnownLocation(raw);
}

function stripSiteSuffix(line) {
  let cleaned = String(line ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .trim();
  let detectedSource = "";
  for (const [pattern, sourceName] of SITE_SUFFIX_SOURCES) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "").trim();
      if (!detectedSource) detectedSource = sourceName;
    }
  }
  return { cleaned, detectedSource };
}

function parseTitleLine(rawLine) {
  const { cleaned, detectedSource } = stripSiteSuffix(rawLine);
  let company = "";
  let role = "";
  let location = "";

  if (!cleaned) return { company, role, location, source: detectedSource };

  // Pattern 1: "<Company> hiring <Role> in <Location>" or "<Company> hiring <Role>" (LinkedIn)
  const hiringMatch = cleaned.match(/^(.+?)\s+is\s+hiring\s+(.+?)(?:\s+in\s+(.+))?$/i) ||
    cleaned.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+))?$/i);
  if (hiringMatch) {
    company = hiringMatch[1].trim();
    role = hiringMatch[2].trim();
    if (hiringMatch[3]) {
      const rawLoc = hiringMatch[3].replace(/\s*\([^)]*\)\s*$/, "").trim();
      location = matchKnownLocation(rawLoc) || rawLoc;
    }
    return { company, role, location, source: detectedSource || "LinkedIn" };
  }

  // Pattern 2: "Job Application for <Role> at <Company>" (Greenhouse)
  const ghMatch = cleaned.match(/^(?:job\s+)?application\s+for\s+(.+?)\s+at\s+(.+)$/i);
  if (ghMatch) {
    role = ghMatch[1].trim();
    company = ghMatch[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
    return { company, role, location, source: detectedSource || "Company website" };
  }

  // Pattern 3: "<Role> at <Company> in <Location>" or "<Role> at/@ <Company>"
  const atMatch = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+([A-Z][A-Za-z\s,]+?))?(?:\s*\([^)]*\))?$/);
  if (atMatch) {
    const left = atMatch[1].trim();
    const right = atMatch[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (left && right) {
      role = left;
      company = right;
      if (atMatch[3]) {
        const rawLoc = atMatch[3].trim();
        location = matchKnownLocation(rawLoc) || rawLoc;
      }
      return { company, role, location, source: detectedSource };
    }
  }

  // Pattern 4: Dash or pipe separated "<Company> - <Role>" or "<Role> - <Company>"
  const dashParts = cleaned
    .split(/\s+(?:[-|\u2013\u2014\u00B7])\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (dashParts.length >= 2) {
    const first = dashParts[0];
    const second = dashParts[1];
    const third = dashParts[2] || "";

    const firstLooksLikeRole = ROLE_KEYWORDS.test(first);
    const secondLooksLikeRole = ROLE_KEYWORDS.test(second);

    if (firstLooksLikeRole && !secondLooksLikeRole) {
      role = first;
      company = second;
    } else if (secondLooksLikeRole && !firstLooksLikeRole) {
      company = first;
      role = second;
    } else {
      company = first;
      role = second;
    }

    if (third && !location) {
      const thirdLoc = extractLocationFromText(third);
      if (thirdLoc) location = thirdLoc;
    }
    return { company, role, location, source: detectedSource };
  }

  // Fallback: if single phrase looks like a role, treat as role
  if (ROLE_KEYWORDS.test(cleaned)) {
    role = cleaned;
  }

  return { company, role, location, source: detectedSource };
}

function parseLabeledText(text) {
  const result = { company: "", role: "", location: "", source: "" };
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const companyMatch = line.match(/^(?:company|employer|organization)\s*[:\-]\s*(.+)$/i);
    if (companyMatch && !result.company) {
      result.company = companyMatch[1].trim();
      continue;
    }
    const roleMatch = line.match(/^(?:role|position|job\s*title|title)\s*[:\-]\s*(.+)$/i);
    if (roleMatch && !result.role) {
      result.role = roleMatch[1].trim();
      continue;
    }
    const locMatch = line.match(/^(?:location|office|city)\s*[:\-]\s*(.+)$/i);
    if (locMatch && !result.location) {
      const candidate = locMatch[1].trim();
      result.location = matchKnownLocation(candidate) || candidate;
      continue;
    }
    const sourceMatch = line.match(/^(?:source|platform|job\s*board)\s*[:\-]\s*(.+)$/i);
    if (sourceMatch && !result.source) {
      result.source = sourceMatch[1].trim();
    }
  }
  return result;
}

function findFirstUrl(text) {
  const match = String(text ?? "").match(/https?:\/\/[^\s"'<>)\]]+/i);
  if (!match) return "";
  return match[0].replace(/[.,;:!?]+$/, "");
}

export function parseJobClip(input) {
  const normalizedInput = typeof input === "string"
    ? { title: "", text: input, url: "" }
    : (input && typeof input === "object" ? input : { title: "", text: "", url: "" });

  const rawTitle = String(normalizedInput.title ?? "").trim();
  const rawText = String(normalizedInput.text ?? "").trim();
  const explicitUrl = String(normalizedInput.url ?? "").trim();

  // Check if the whole text is just a URL
  const singleLineText = !rawTitle && !rawText.includes("\n") ? rawText : "";
  const detectedUrl = explicitUrl || (safeHttpUrl(singleLineText) ? singleLineText : "") || findFirstUrl(rawText) || findFirstUrl(rawTitle);

  const urlParts = detectedUrl ? parseJobUrl(detectedUrl) : { company: "", role: "", location: "", source: "", link: "" };
  const labeled = parseLabeledText(rawText);

  let titleParts = { company: "", role: "", location: "", source: "" };
  if (rawTitle) {
    titleParts = parseTitleLine(rawTitle);
  } else if (rawText && !safeHttpUrl(rawText)) {
    const nonUrlLines = rawText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !safeHttpUrl(line) && !/^(?:company|employer|organization|role|position|job\s*title|title|location|office|city|source|platform)\s*[:\-]/i.test(line));
    if (nonUrlLines.length > 0) {
      titleParts = parseTitleLine(nonUrlLines[0]);
      if (!titleParts.company && nonUrlLines.length >= 2 && ROLE_KEYWORDS.test(nonUrlLines[0]) && nonUrlLines[1].length <= 50) {
        // Common 2-line header: Line 1 = Role, Line 2 = Company (or vice versa)
        titleParts.company = nonUrlLines[1];
      } else if (!titleParts.role && nonUrlLines.length >= 2 && ROLE_KEYWORDS.test(nonUrlLines[1]) && nonUrlLines[0].length <= 50) {
        titleParts.company = nonUrlLines[0];
        titleParts.role = nonUrlLines[1];
      }
    }
  }

  const combinedText = [rawTitle, rawText].filter(Boolean).join("\n");
  const extractedLocation = labeled.location || titleParts.location || extractLocationFromText(combinedText) || urlParts.location;
  const extractedSkills = extractSkillsFromText(combinedText);

  const company = clampField(labeled.company || titleParts.company || urlParts.company, LIMITS.company);
  const role = clampField(labeled.role || titleParts.role || urlParts.role, LIMITS.role);
  const location = clampField(extractedLocation, LIMITS.location);
  const source = clampField(labeled.source || titleParts.source || urlParts.source, LIMITS.source);
  const link = urlParts.link;

  return {
    company,
    role,
    location,
    source,
    link,
    skills: extractedSkills
  };
}

export function parseNewIntent(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(String(searchParams ?? ""));

  const explicitCompany = params.get("company") || "";
  const explicitRole = params.get("role") || "";
  const explicitLocation = params.get("location") || "";
  const explicitSource = params.get("source") || "";
  const explicitLink = params.get("link") || params.get("url") || "";
  const explicitSkills = params.get("skills") || "";
  const explicitNotes = params.get("notes") || "";
  const explicitStage = (params.get("stage") || params.get("status") || "SAVED").toUpperCase();
  const title = params.get("title") || "";
  const text = params.get("text") || "";

  const clipped = parseJobClip({
    title,
    text,
    url: explicitLink
  });

  // Preserve plain title as role if parseJobClip couldn't find a role keyword (e.g. share-target title)
  const fallbackRole = !explicitRole && !clipped.role && title && !clipped.company
    ? clampField(title, LIMITS.role)
    : "";

  const mergedSkills = cleanSkills([
    ...(explicitSkills ? explicitSkills.split(",") : []),
    ...clipped.skills
  ]);

  const notesValue = explicitNotes || text;

  return {
    stage: STAGES.includes(explicitStage) ? explicitStage : "SAVED",
    initial: {
      company: clampField(explicitCompany || clipped.company, LIMITS.company),
      role: clampField(explicitRole || clipped.role || fallbackRole, LIMITS.role),
      location: clampField(explicitLocation || clipped.location, LIMITS.location),
      source: clampField(explicitSource || clipped.source, LIMITS.source),
      link: safeHttpUrl(explicitLink) || clipped.link,
      skills: mergedSkills,
      notes: String(notesValue ?? "").trim().slice(0, LIMITS.notes)
    }
  };
}

export function buildBookmarkletHref(baseUrl = "https://internshipnotebook.app/") {
  const cleanBase = String(baseUrl || "https://internshipnotebook.app/").replace(/[#?].*$/, "").replace(/\/?$/, "/");
  return `javascript:(()=>{const s=String(window.getSelection?window.getSelection():'').trim().slice(0,800);const u= new URLSearchParams({url:location.href,title:document.title||'',text:s});window.open(${JSON.stringify(cleanBase)}+'#/new?'+u.toString(),'_blank','noopener');})();`;
}
