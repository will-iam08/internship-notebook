/*
 * Notebook builder: the pure half of "build your notebook your way" (website edition).
 *
 * Three answers (how to start, what it is for, what it should do) plus the usual setup fields
 * become a plan: the starter pages to create, the preferences to save, and a plain-language summary
 * for the review card. Nothing here touches the DOM, storage, or the network. It imports only
 * domain.js and onboarding.js, which are pure too, so node --test can cover every branch. The
 * wizard in app.js renders these answers and hands the plan to the same commit path guided setup
 * uses, so there is one way a real notebook gets created.
 */
import { LIMITS, clamp, dayKey } from "./domain.js";
import { buildStarterApplications, sanitizeTargetCompanies, setupFieldErrors } from "./onboarding.js";

export const START_MODES = ["template", "scratch", "import"];
export const USE_CASES = ["internship-search", "co-op", "new-grad", "research", "career-switch", "exploring"];
export const FOCUS_AREAS = ["deadlines", "responses", "openings", "interviews", "minimal"];
export const MAX_USE_CASES = 2;
export const DEFAULT_START_MODE = "template";
export const DEFAULT_USE_CASES = Object.freeze(["internship-search"]);
export const DEFAULT_FOCUS_AREAS = Object.freeze(["deadlines"]);

/* Labels and one-line explanations, kept next to the values they describe so the wizard and the
   tests read the same words. A student should understand each option in one read. */
export const START_MODE_COPY = Object.freeze({
  template: { label: "Start from a template", hint: "A few example pages for what you're looking for. Edit them or delete them." },
  scratch: { label: "Start empty", hint: "A blank notebook. Add your first role when you're ready." },
  import: { label: "Import my applications", hint: "Restore a .json backup exported from My Internship Notebook." }
});
export const USE_CASE_COPY = Object.freeze({
  "internship-search": { label: "Internship search", hint: "Summer or term internships." },
  "co-op": { label: "Co-op terms", hint: "Work terms that fit your school schedule." },
  "new-grad": { label: "New grad roles", hint: "Full-time jobs after you graduate." },
  research: { label: "Research positions", hint: "Lab, research assistant, or summer research spots." },
  "career-switch": { label: "Career switch", hint: "Apprenticeships and returnships in a new field." },
  exploring: { label: "Just exploring", hint: "Save roles that catch your eye. No pressure." }
});
export const FOCUS_COPY = Object.freeze({
  deadlines: { label: "Never miss a deadline", hint: "Today leads with what's due next." },
  responses: { label: "Track who replied", hint: "Today shows your response rate first." },
  openings: { label: "Find new openings", hint: "Today puts the latest internship postings near the top." },
  interviews: { label: "Prepare for interviews", hint: "Today lists your interview-stage pages and next steps." },
  minimal: { label: "Keep it minimal", hint: "Today shows only the essentials." }
});

/* Applications per week each use case usually supports; the busiest selected one wins. */
const BASE_GOAL = { "internship-search": 5, "co-op": 5, "new-grad": 6, research: 3, "career-switch": 4, exploring: 2 };

/* Every company a template can use. All invented, in the same spirit as the demo dataset, so a
   starter page never looks like a real employer's posting. Tests check templates against this. */
export const FICTIONAL_COMPANIES = Object.freeze([
  "Northwind Labs", "Lumen Analytics", "Harbor & Co.", "Cedar Grove Health", "Tidewater Energy", "Quarry Labs",
  "Pinecrest Bank", "Atlas Freight", "Brightwave Media", "Fernhill University Lab", "Juniper Research Institute",
  "Westbrook Data Lab", "Maplestone Civic Tech", "Greyfield Logistics", "Ostrander Studio", "Kestrel Outdoor Co.",
  "Willowmere Games", "Bluefin Transit"
]);

const EXAMPLE_NOTE = "Example page from your template. Swap in a real posting, or delete this page.";

/*
 * Starter pages per use case, always in stage order (Saved, Applied, Interview) so the picker below
 * can ask for "the interview one". `ctx` supplies the visitor's role and season and a day(offset)
 * helper; `ctx.soon` is true when the visitor asked for deadline help, which pulls deadlines in.
 */
const TEMPLATES = {
  "internship-search": ctx => [
    { company: "Northwind Labs", role: ctx.role, location: "Remote", source: "LinkedIn", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 5 : 12), skills: ["Resume", "Cover letter"], contact: "University recruiting team",
      notes: `${EXAMPLE_NOTE}\nBefore applying: match your resume bullets to the posting's top three requirements.` },
    { company: "Lumen Analytics", role: "Data Analyst Intern", location: "Toronto, ON", source: "Company website", status: "APPLIED",
      skills: ["SQL", "Excel"], contact: "careers@lumen.example", nextStep: "Follow up if there is no reply", nextStepDate: ctx.day(7),
      notes: `${EXAMPLE_NOTE}\nApplied through the portal. A short, polite follow-up after a week is normal.` },
    { company: "Harbor & Co.", role: "Product Design Intern", location: "Vancouver, BC", source: "Handshake", status: "INTERVIEW",
      skills: ["Figma", "Portfolio"], contact: "Sam Rivera, Recruiter", nextStep: "First-round interview", nextStepDate: ctx.day(3),
      notes: `${EXAMPLE_NOTE}\nPrep: two stories about a project you are proud of, and three questions for them.` }
  ],
  "co-op": ctx => [
    { company: "Cedar Grove Health", role: ctx.role, location: "Hybrid - Ottawa, ON", source: "WaterlooWorks", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 4 : 9), skills: ["Java", "Teamwork"], contact: "Co-op office",
      notes: `${EXAMPLE_NOTE}\nCheck that the term dates line up with your ${ctx.season || "next"} work term.` },
    { company: "Tidewater Energy", role: "Controls Co-op", location: "Calgary, AB", source: "Career fair", status: "APPLIED",
      skills: ["MATLAB", "PLC"], contact: "Priya Anand, Talent Partner", nextStep: "Check the ranking deadline", nextStepDate: ctx.day(6),
      notes: `${EXAMPLE_NOTE}\nMet the team at the career fair; mention that in any follow-up.` },
    { company: "Quarry Labs", role: "QA Automation Co-op", location: "Waterloo, ON", source: "WaterlooWorks", status: "INTERVIEW",
      skills: ["Python", "Testing"], contact: "Dana Okoro, QA Lead", nextStep: "Technical interview", nextStepDate: ctx.day(4),
      notes: `${EXAMPLE_NOTE}\nReview test-case design and one bug you tracked down end to end.` }
  ],
  "new-grad": ctx => [
    { company: "Pinecrest Bank", role: ctx.role, location: "Toronto, ON", source: "Company website", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 6 : 14), skills: ["Communication", "Problem solving"], contact: "Campus recruiting",
      notes: `${EXAMPLE_NOTE}\nNew grad programs often open months early. Note when offers are expected.` },
    { company: "Atlas Freight", role: "Associate Software Engineer", location: "Montreal, QC", source: "Referral", status: "APPLIED",
      skills: ["TypeScript", "APIs"], contact: "Marcus Lee, Engineering Manager", nextStep: "Thank your referrer and follow up", nextStepDate: ctx.day(5),
      notes: `${EXAMPLE_NOTE}\nReferred by a friend from the coding club.` },
    { company: "Brightwave Media", role: "Junior Data Engineer", location: "Remote", source: "LinkedIn", status: "INTERVIEW",
      skills: ["Python", "Airflow"], contact: "Sophie Tremblay, Recruiter", nextStep: "Final round: team match", nextStepDate: ctx.day(4),
      notes: `${EXAMPLE_NOTE}\nAsk about mentorship, on-call, and what the first six months look like.` }
  ],
  research: ctx => [
    { company: "Fernhill University Lab", role: ctx.role, location: "On campus", source: "Professor's website", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 7 : 14), skills: ["Literature review", "Python"], contact: "Prof. A. Lindqvist",
      notes: `${EXAMPLE_NOTE}\nEmail the professor with one paper of theirs you read and why it interested you.` },
    { company: "Juniper Research Institute", role: "Summer Research Fellow", location: "Halifax, NS", source: "Department newsletter", status: "APPLIED",
      skills: ["Statistics", "R"], contact: "fellowships@juniper.example", nextStep: "Confirm reference letters were sent", nextStepDate: ctx.day(5),
      notes: `${EXAMPLE_NOTE}\nTwo reference letters required. Ask early.` },
    { company: "Westbrook Data Lab", role: "Undergraduate Research Assistant", location: "Hybrid", source: "Referral", status: "INTERVIEW",
      skills: ["Data cleaning", "Writing"], contact: "Dr. R. Osei, Lab Manager", nextStep: "Meet the lab group", nextStepDate: ctx.day(6),
      notes: `${EXAMPLE_NOTE}\nBe ready to talk through a past project and the hours you can commit.` }
  ],
  "career-switch": ctx => [
    { company: "Maplestone Civic Tech", role: ctx.role, location: "Remote", source: "Bootcamp job board", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 5 : 12), skills: ["Transferable skills", "Portfolio"], contact: "Apprenticeship coordinator",
      notes: `${EXAMPLE_NOTE}\nLead with what your last field taught you that this role needs.` },
    { company: "Greyfield Logistics", role: "Operations Analyst Apprentice", location: "Edmonton, AB", source: "LinkedIn", status: "APPLIED",
      skills: ["Excel", "Process mapping"], contact: "talent@greyfield.example", nextStep: "Follow up with the hiring manager", nextStepDate: ctx.day(7),
      notes: `${EXAMPLE_NOTE}\nReturnship program; ask about the training plan.` },
    { company: "Ostrander Studio", role: "UX Design Returnship", location: "Vancouver, BC", source: "Referral", status: "INTERVIEW",
      skills: ["User research", "Figma"], contact: "Jordan Park, Design Lead", nextStep: "Portfolio walkthrough", nextStepDate: ctx.day(5),
      notes: `${EXAMPLE_NOTE}\nPick one case study and tell it as problem, process, result.` }
  ],
  exploring: ctx => [
    { company: "Kestrel Outdoor Co.", role: ctx.role, location: "Remote", source: "Instagram", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 7 : 21), skills: ["Curiosity"], contact: "",
      notes: `${EXAMPLE_NOTE}\nNot sure yet? Save anything interesting and note what drew you to it.` },
    { company: "Willowmere Games", role: "Community Intern", location: "Montreal, QC", source: "Discord", status: "SAVED",
      deadline: ctx.day(ctx.soon ? 10 : 28), skills: ["Writing", "Social media"], contact: "",
      notes: `${EXAMPLE_NOTE}\nCompare a few roles side by side before deciding where to apply.` },
    { company: "Bluefin Transit", role: "Planning Intern", location: "Toronto, ON", source: "Career fair", status: "APPLIED",
      skills: ["GIS", "Excel"], contact: "Info session host", nextStep: "Ask for an informational chat", nextStepDate: ctx.day(8),
      notes: `${EXAMPLE_NOTE}\nAn informational chat is a low-pressure way to learn about a field.` }
  ]
};

/* ---------- Answer clean-up ---------- */

const unique = list => [...new Set(list)];
const pickFrom = (allowed, values) => unique((Array.isArray(values) ? values : []).filter(value => allowed.includes(value)));

/** Known use cases only, without repeats, at most MAX_USE_CASES. Empty when none are valid. */
export function cleanUseCases(values) {
  return pickFrom(USE_CASES, values).slice(0, MAX_USE_CASES);
}

/** Known focus areas only, without repeats, in FOCUS_AREAS order. Empty when none are valid. */
export function cleanFocusAreas(values) {
  const chosen = pickFrom(FOCUS_AREAS, values);
  return FOCUS_AREAS.filter(area => chosen.includes(area));
}

/** Applications per week to suggest for these answers, always 1..50 like the Settings stepper. */
export function weeklyGoalFor(useCases, focusAreas) {
  const cases = cleanUseCases(useCases);
  const focus = cleanFocusAreas(focusAreas);
  let goal = Math.max(...(cases.length ? cases : DEFAULT_USE_CASES).map(useCase => BASE_GOAL[useCase]));
  if (focus.includes("deadlines")) goal += 1; // a deadline-driven search sends a little more each week
  if (focus.includes("minimal")) goal = Math.min(goal, 3);
  return clamp(goal, 1, 50);
}

/* ---------- Validation ---------- */

/**
 * Field-level errors for the builder's answers, as { field: message }. The name, target role,
 * season, and companies rules are exactly guided setup's (setupFieldErrors); the three choices are
 * checked against their lists. Returns { ok, errors }.
 */
export function validatePlan(answers) {
  const errors = { ...setupFieldErrors(answers) };
  if (!START_MODES.includes(answers?.startMode)) errors.startMode = "Choose how to start your notebook.";
  const useCases = Array.isArray(answers?.useCases) ? answers.useCases : [];
  if (!cleanUseCases(useCases).length) errors.useCases = "Pick at least one.";
  else if (pickFrom(USE_CASES, useCases).length > MAX_USE_CASES) errors.useCases = `Pick up to ${MAX_USE_CASES}.`;
  if (!cleanFocusAreas(answers?.focusAreas).length) errors.focusAreas = "Pick at least one.";
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ---------- Planning ---------- */

const fit = (value, limit) => (typeof value === "string" ? value.trim().slice(0, limit) : "");

/** Chooses 2-4 example pages for the answers: two from the main use case, one from a second, and
 *  an Interview or Applied page if the focus asks for one. "Keep it minimal" keeps two: the first
 *  example plus the stage the focus asked for (Interview, then Applied), else the second example. */
function pickExamples(useCases, focusAreas, ctx, takenCompanies) {
  const [primary, secondary] = useCases.map(useCase => TEMPLATES[useCase](ctx));
  const picked = [];
  const add = entry => {
    if (!entry) return;
    const key = entry.company.toLowerCase();
    if (takenCompanies.has(key) || picked.some(item => item.company.toLowerCase() === key)) return;
    picked.push(entry);
  };
  const all = [...primary, ...(secondary || [])];
  const needsStage = stage => !picked.some(entry => entry.status === stage);
  const addStages = () => {
    if (focusAreas.includes("interviews") && needsStage("INTERVIEW")) add(all.find(entry => entry.status === "INTERVIEW"));
    if (focusAreas.includes("responses") && needsStage("APPLIED")) add(all.find(entry => entry.status === "APPLIED"));
  };
  if (focusAreas.includes("minimal")) {
    add(primary[0]);
    addStages();
    for (const entry of all) if (picked.length < 2) add(entry);
    return picked.slice(0, 2);
  }
  primary.slice(0, 2).forEach(add);
  if (secondary) add(secondary[0]);
  addStages();
  // A visitor whose target companies collided with both main examples still gets at least two.
  for (const entry of [...primary, ...(secondary || [])]) if (picked.length < 2) add(entry);
  return picked.slice(0, 4);
}

/* Example pages arrive with a short past: saved two weeks ago, applied ten days ago, interview
   booked a week ago. A week starts at most six days back, so none of it lands in "this week" and
   the weekly goal ring only ever counts what the visitor really sent. */
const HISTORY_DAYS_AGO = { SAVED: 14, APPLIED: 10, INTERVIEW: 7 };
const STAGE_PATH = { SAVED: ["SAVED"], APPLIED: ["SAVED", "APPLIED"], INTERVIEW: ["SAVED", "APPLIED", "INTERVIEW"] };

/** Shapes a template entry exactly like a saved page's fields, within every domain limit. */
function toApplication(entry, now) {
  const at = stage => new Date(now.getTime() - HISTORY_DAYS_AGO[stage] * 86_400_000).toISOString();
  const history = STAGE_PATH[entry.status].map(stage => ({ status: stage, at: at(stage) }));
  return {
    company: fit(entry.company, LIMITS.company),
    role: fit(entry.role, LIMITS.role),
    location: fit(entry.location, LIMITS.location),
    source: fit(entry.source, LIMITS.source),
    status: entry.status,
    deadline: entry.deadline || "",
    notes: fit(entry.notes, LIMITS.notes),
    skills: [...entry.skills],
    contact: fit(entry.contact, LIMITS.contact),
    nextStep: fit(entry.nextStep, LIMITS.nextStep),
    nextStepDate: entry.nextStepDate || "",
    link: "",
    createdAt: history[0].at,
    updatedAt: history.at(-1).at,
    history
  };
}

/**
 * Turns the builder's answers into what the notebook should start with:
 *   { startMode, applications, prefs, summary: { headline, bullets }, openImport }
 * - template: 2-4 tailored example pages (fictional companies, dates relative to `now`) plus one
 *   Saved page per target company, the same pages guided setup creates.
 * - scratch: no pages. import: no pages, and openImport tells the wizard to open the import picker.
 * prefs always carry started: true, the cleaned focus areas, and a suggested weekly goal. Unknown or
 * missing choices fall back to the defaults; call validatePlan first to show errors instead.
 * Every call builds new objects, so callers can mutate a plan without affecting another.
 */
export function buildNotebookPlan(answers = {}, { now = new Date() } = {}) {
  const startMode = START_MODES.includes(answers.startMode) ? answers.startMode : DEFAULT_START_MODE;
  const useCases = cleanUseCases(answers.useCases);
  const focus = cleanFocusAreas(answers.focusAreas);
  const cases = useCases.length ? useCases : [...DEFAULT_USE_CASES];
  const focusAreas = focus.length ? focus : [...DEFAULT_FOCUS_AREAS];
  const name = fit(answers.name, 40);
  const targetRole = fit(answers.targetRole, LIMITS.role);
  const season = typeof answers.season === "string" ? answers.season : "";
  const targetCompanies = sanitizeTargetCompanies(answers.targetCompanies);
  const weeklyGoal = weeklyGoalFor(cases, focusAreas);

  let applications = [];
  let examples = [];
  let companyPages = [];
  if (startMode === "template") {
    const today = new Date(now);
    const ctx = {
      role: targetRole || "Intern",
      season,
      soon: focusAreas.includes("deadlines"),
      day: offset => { const date = new Date(today); date.setDate(date.getDate() + offset); return dayKey(date); }
    };
    companyPages = buildStarterApplications({ targetRole, targetCompanies });
    const taken = new Set(companyPages.map(entry => entry.company.toLowerCase()));
    examples = pickExamples(cases, focusAreas, ctx, taken).map(entry => toApplication(entry, today));
    applications = [...examples, ...companyPages];
  }

  const owner = name ? `${name}'s notebook` : "Your notebook";
  const headline = startMode === "scratch" ? `${owner}, starting empty.`
    : startMode === "import" ? `${owner}, ready for your backup.`
    : `${owner} for ${[season, targetRole || "internship"].filter(Boolean).join(" ")} roles.`;
  const bullets = [];
  if (startMode === "template") {
    bullets.push(`${examples.length} example pages to edit or delete: ${examples.map(entry => entry.company).join(", ")}.`);
    if (companyPages.length) bullets.push(`${companyPages.length} ${companyPages.length === 1 ? "page" : "pages"} for your target companies.`);
  } else if (startMode === "scratch") {
    bullets.push("No pages yet. Add your first role from Today.");
  } else {
    bullets.push("Once it's created, choose your backup file to import.");
  }
  for (const area of focusAreas) bullets.push(FOCUS_COPY[area].hint);
  bullets.push(`Weekly goal: ${weeklyGoal} ${weeklyGoal === 1 ? "application" : "applications"}.`);

  return {
    startMode,
    applications,
    prefs: { name, targetRole, season, targetCompanies, started: true, focusAreas: [...focusAreas], weeklyGoal },
    summary: { headline, bullets },
    openImport: startMode === "import"
  };
}
