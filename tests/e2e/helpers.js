// Shared helpers for the end-to-end tests.
export const DATA_KEY = "my-internship-notebook-browser-data-v1";

const daysFromNow = days => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const isoDaysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString();

/** A small, made-up notebook used by the tests and the screenshots. */
export function sampleApplications() {
  const entry = (id, company, role, status, extra = {}) => {
    const createdAt = isoDaysAgo(20 - id);
    const history = [{ status: "SAVED", at: createdAt }];
    if (status !== "SAVED") history.push({ status: status === "REJECTED" ? "APPLIED" : "APPLIED", at: isoDaysAgo(15 - id) });
    if (["INTERVIEW", "OFFER"].includes(status)) history.push({ status: "INTERVIEW", at: isoDaysAgo(8 - Math.min(id, 7)) });
    if (status === "OFFER" || status === "REJECTED") history.push({ status, at: isoDaysAgo(2) });
    return {
      id, company, role, status, createdAt, updatedAt: isoDaysAgo(Math.max(0, 6 - id)),
      location: "", source: "", deadline: "", notes: "", skills: [], link: "", contact: "", nextStep: "", nextStepDate: "",
      starred: false, history, ...extra
    };
  };
  return [
    entry(1, "Northwind Labs", "Backend Developer Intern", "SAVED", { deadline: daysFromNow(2), location: "Toronto", source: "LinkedIn", skills: ["Java", "SQL", "Docker"], link: "https://example.com/jobs/northwind" }),
    entry(2, "Maple Robotics", "Embedded Software Intern", "APPLIED", { location: "Waterloo", source: "WaterlooWorks", skills: ["C", "RTOS"] }),
    entry(3, "Harbour Health", "Data Analyst Co-op", "INTERVIEW", { location: "Remote", source: "Referral", nextStep: "Technical interview", nextStepDate: daysFromNow(3), skills: ["Python", "SQL"] }),
    entry(4, "Cedar Finance", "QA Automation Intern", "OFFER", { location: "Montreal", source: "Company website", skills: ["Selenium"] }),
    entry(5, "Lumen Games", "Gameplay Programmer Intern", "REJECTED", { location: "Vancouver", source: "Handshake" }),
    entry(6, "Blue Fjord Energy", "Controls Engineering Intern", "APPLIED", { location: "Calgary", source: "LinkedIn", starred: true, notes: "Met the hiring manager at the career fair." })
  ];
}

/** Stores a notebook in the browser before the app starts (only on the first load of the test). */
export async function seedNotebook(page, applications = sampleApplications(), extra = {}) {
  const data = { nextId: Math.max(0, ...applications.map(entry => entry.id)) + 1, applications, recentlyDeleted: [], ...extra };
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, value);
      sessionStorage.setItem("seeded", "1");
    }
  }, [DATA_KEY, JSON.stringify(data)]);
}

/** Reads the saved notebook straight from browser storage. */
export async function savedNotebook(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), DATA_KEY);
}

/** Opens the app at a route and waits until the notebook has loaded. */
export async function openApp(page, route = "#/today") {
  await page.goto(`/${route}`);
  await page.locator("#view .view-head, #view .entry, #view .recovery").first().waitFor();
}
