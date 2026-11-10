/*
 * Demo dataset for demo-first onboarding (website edition only).
 *
 * This module is a pure, in-memory showcase. It imports only domain helpers and NOTHING from
 * storage.js or api.js, so it is structurally incapable of writing to the Real_Notebook_Key or
 * any other storage. buildDemoDataset() returns a fresh deep copy on every call, so the demo can
 * be mutated in memory (create, edit, delete, undo, import) without ever changing DEMO_SEED or
 * leaking into a visitor's real notebook. Dates for the two interviews are computed relative to
 * "now" at build time so the agenda always shows two upcoming interviews.
 */
import { dayKey, normalize } from "./domain.js";

/** A date `offset` days from today, in the "YYYY-MM-DD" form the notebook uses. */
function relativeDay(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

/** An ISO timestamp `daysAgo` days in the past, for believable createdAt/updatedAt values. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/*
 * Six fictional applications, one in each board column plus a second Interview, using invented
 * company names only. Two Interview-stage entries carry a nextStepDate within the next week so the
 * agenda shows exactly two upcoming interviews. Every entry has at least one note, a contact, and
 * a skill tag so the board, notebook pages, agenda, and insights all render as a lived-in notebook.
 */
const SEED_ENTRIES = [
  {
    id: 1,
    company: "Northwind Robotics",
    role: "Software Engineering Intern",
    location: "Remote",
    source: "Referral",
    status: "SAVED",
    deadline: relativeDay(25),
    notes: "Saw this through a friend in the robotics club. Tailor the resume to highlight the C++ course project before applying.",
    skills: ["C++", "ROS", "Linux"],
    contact: "Priya Anand, University Recruiter",
    link: "https://example.com/northwind/swe-intern",
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1)
  },
  {
    id: 2,
    company: "Lumen Analytics",
    role: "Data Science Intern",
    location: "Toronto, ON",
    source: "Company website",
    status: "APPLIED",
    notes: "Applied through the portal. Role leans on pandas and SQL; mentioned the churn-analysis side project in the cover letter.",
    skills: ["Python", "SQL", "pandas"],
    contact: "careers@lumenanalytics.example",
    link: "https://example.com/lumen/data-science-intern",
    createdAt: daysAgo(14),
    updatedAt: daysAgo(10)
  },
  {
    id: 3,
    company: "Harbor & Co.",
    role: "Product Design Intern",
    location: "Vancouver, BC",
    source: "Handshake",
    status: "INTERVIEW",
    notes: "Recruiter call went well. First-round portfolio review scheduled; prepare the campus-app case study walkthrough.",
    skills: ["Figma", "Prototyping", "User research"],
    contact: "Marcus Lee, Design Manager",
    nextStep: "Portfolio review with the design team",
    nextStepDate: relativeDay(2),
    link: "https://example.com/harbor/design-intern",
    createdAt: daysAgo(20),
    updatedAt: daysAgo(2)
  },
  {
    id: 4,
    company: "Cedar Grove Health",
    role: "Backend Developer Intern",
    location: "Hybrid - Ottawa, ON",
    source: "LinkedIn",
    status: "INTERVIEW",
    notes: "Passed the online assessment. Technical interview is on the calendar; review REST design and basic system design.",
    skills: ["Java", "Spring", "REST APIs"],
    contact: "Dana Okoro, Engineering Lead",
    nextStep: "Technical interview (systems round)",
    nextStepDate: relativeDay(5),
    link: "https://example.com/cedargrove/backend-intern",
    createdAt: daysAgo(18),
    updatedAt: daysAgo(1)
  },
  {
    id: 5,
    company: "Atlas Freight",
    role: "Machine Learning Intern",
    location: "Montreal, QC",
    source: "Career fair",
    status: "OFFER",
    notes: "Offer received after three rounds. Deadline to respond is next week; comparing against the Harbor & Co. process.",
    skills: ["Python", "PyTorch", "NLP"],
    contact: "Sophie Tremblay, Talent Partner",
    link: "https://example.com/atlas/ml-intern",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(4)
  },
  {
    id: 6,
    company: "Brightwave Media",
    role: "Frontend Engineering Intern",
    location: "Remote",
    source: "Indeed",
    status: "REJECTED",
    notes: "Rejected after the first round. They asked a lot about accessibility; worth brushing up on ARIA for future interviews.",
    skills: ["JavaScript", "React", "CSS"],
    contact: "no-reply@brightwave.example",
    link: "https://example.com/brightwave/frontend-intern",
    createdAt: daysAgo(26),
    updatedAt: daysAgo(12)
  }
];

/**
 * The read-only reference dataset. Each entry is run through normalize() so it has exactly the
 * same shape as a real saved page (history, starred, etc.), which lets every existing view render
 * it with no special casing. Not exported for mutation: callers use buildDemoDataset().
 */
export const DEMO_SEED = Object.freeze({
  applications: SEED_ENTRIES.map(normalize),
  recentlyDeleted: [],
  nextId: Math.max(...SEED_ENTRIES.map(entry => entry.id)) + 1
});

/**
 * Returns a fresh, independent deep copy of the demo dataset, shaped exactly like browserApi.read()
 * output: { applications, recentlyDeleted, nextId }. Because the dates are computed at call time,
 * the two interviews always fall within the next week. Mutating the returned object never affects
 * DEMO_SEED or any other copy.
 */
export function buildDemoDataset() {
  const entries = SEED_ENTRIES.map(normalize);
  return {
    applications: structuredClone(entries),
    recentlyDeleted: [],
    nextId: Math.max(...entries.map(entry => entry.id)) + 1
  };
}
