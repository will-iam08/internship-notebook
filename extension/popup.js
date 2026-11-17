/*
 * The toolbar popup. When it opens it reads the job page in the current tab (readJobPage),
 * works out the notebook fields (jobFromPage, using the notebook's own job clipper), shows what
 * it found, and on "Save to Notebook" opens the notebook's new-application sheet in a new tab.
 *
 * lib/clipper.js and lib/domain.js are copies of the notebook's modules that
 * scripts/build-extension.mjs puts in the built extension (_extension/), so there is one source.
 */
import * as clipper from "./lib/clipper.js";
import { readJobPage } from "./page-reader.js";
import { DEFAULT_NOTEBOOK, cleanNotebookAddress, jobFromPage, notebookNewUrl } from "./job-from-page.js";

// Firefox names the extension API `browser`; Chrome, Edge and Firefox all also offer `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;
const $ = selector => document.querySelector(selector);
const SETTINGS = { notebookUrl: DEFAULT_NOTEBOOK, keepDescription: true };

let settings = { ...SETTINGS };
let job = null;

// Settings are a convenience: if sync storage is off or unavailable (some Firefox profiles,
// Safari), fall back to local storage, and if that fails too, keep going with the defaults.
async function readSettings() {
  for (const area of [ext.storage?.sync, ext.storage?.local]) {
    try { if (area) return { ...SETTINGS, ...(await area.get(SETTINGS)) }; } catch { /* try the next one */ }
  }
  return { ...SETTINGS };
}

async function writeSettings(values) {
  for (const area of [ext.storage?.sync, ext.storage?.local]) {
    try { if (area) { await area.set(values); return true; } } catch { /* try the next one */ }
  }
  return false;
}

function showStatus(text, { error = false } = {}) {
  const status = $("#status");
  status.textContent = text;
  status.classList.toggle("error", error);
  status.hidden = !text;
}

function formatDay(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function render() {
  for (const element of document.querySelectorAll("[data-field]")) {
    const name = element.dataset.field;
    const value = name === "skills" ? job.skills.join(", ") : name === "deadline" && job.deadline ? formatDay(job.deadline) : job[name];
    element.textContent = value || "Not found";
    element.classList.toggle("missing", !value);
  }
  $("#found").hidden = false;
  $("#keep-description-row").hidden = !job.description;
  $("#keep-description").checked = settings.keepDescription;
  showStatus(!job.company && !job.role
    ? "Couldn't find the company or role on this page. Save anyway and fill them in in your notebook."
    : job.fromPosting ? "" : "Read from the page title and address. Check the details in your notebook.");
  $("#save").disabled = false;
}

async function readCurrentTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || "")) {
    showStatus("Open a job posting in this tab, then click the button again.");
    return;
  }
  let snapshot;
  try {
    const [result] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: readJobPage });
    snapshot = result?.result;
  } catch {
    // Some pages refuse extensions (browser stores, built-in viewers). The address and title still help.
  }
  job = jobFromPage(snapshot || { url: tab.url, title: tab.title || "", structured: [] }, clipper);
  job.savedOn = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  render();
}

async function save() {
  const includeDescription = !$("#keep-description-row").hidden && $("#keep-description").checked;
  if (includeDescription !== settings.keepDescription) {
    settings.keepDescription = includeDescription;
    await writeSettings({ keepDescription: includeDescription });
  }
  const url = notebookNewUrl(settings.notebookUrl, job, { includeDescription });
  if (!url) {
    showStatus("The notebook address in settings isn't a web address. Fix it below.", { error: true });
    $(".settings").open = true;
    return;
  }
  $("#save").disabled = true;
  await ext.tabs.create({ url });
  window.close();
}

function showSettingsStatus(text, tone = "") {
  const status = $("#settings-status");
  status.textContent = text;
  status.className = `settings-status ${tone}`.trim();
}

async function saveAddress(value) {
  const address = cleanNotebookAddress(value);
  if (!address) { showSettingsStatus("Enter a web address starting with https:// (or http:// for a local copy).", "error"); return; }
  settings.notebookUrl = address;
  $("#notebook-url").value = address;
  showSettingsStatus(await writeSettings({ notebookUrl: address })
    ? "Saved. Jobs will open in this notebook."
    : "Using this address for now, but the browser wouldn't save it for next time.", "good");
}

async function start() {
  settings = await readSettings();
  $("#notebook-url").value = settings.notebookUrl;
  $("#save").addEventListener("click", () => save().catch(() => showStatus("Couldn't open your notebook. Try again.", { error: true })));
  $("#settings-form").addEventListener("submit", event => { event.preventDefault(); saveAddress($("#notebook-url").value); });
  $("#reset-url").addEventListener("click", () => saveAddress(DEFAULT_NOTEBOOK));
  await readCurrentTab();
}

start().catch(() => showStatus("Something went wrong reading this page. Try again.", { error: true }));
