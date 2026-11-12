/*
 * Reminders and exports ("never miss it"), the pure half.
 *
 * The website edition has no server, so it cannot send email or wake a phone on its own. What it
 * can do is hand the job to apps that can: a calendar file (real reminders on any phone or
 * desktop), a Markdown copy, and a prefilled email the visitor sends from their own mail app. This
 * module builds all of that as plain text. It imports only domain.js (also pure) and never touches
 * the DOM, storage, or the network, so node --test covers it directly. Every function takes `now`
 * so the output is deterministic in tests and correct around midnight in the app.
 */
import { DAY_MS, LABELS, LIMITS, STAGES, isValidDate, parseDay, sentAt, stageSince, startOfWeek } from "./domain.js";

/** An Applied page with no reply for longer than this gets a follow-up reminder. (The Board's
 *  gentler "no reply" nudge waits FOLLOW_UP_DAYS, two weeks; a reminder is meant to come sooner.) */
export const QUIET_DAYS = 7;
/** How far ahead the digest looks for deadlines and interviews. */
export const DIGEST_DAYS = 14;
/** Items per digest section, so the prefilled email stays short enough for every mail app. */
export const DIGEST_SECTION_LIMIT = 5;

const KIND_ORDER = ["interview", "deadline", "next-step", "follow-up"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------- Dates ---------- */

const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayToDate = day => midnight(parseDay(day));
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const wholeDaysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
/** A fixed English date ("Fri Nov 14") so exports read the same on every device and in tests. */
export const shortDate = date => `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`;

/* ---------- Next actions ---------- */

const text = value => (value == null ? "" : String(value)).trim();

/**
 * Every upcoming action on one application, soonest first. Kinds:
 * - "deadline": the application deadline, while the page is Saved or Applied
 * - "interview": the next-step date while the page is in the Interview stage
 * - "next-step": any other dated next step (Saved, Applied, or an Offer's "reply by")
 * - "follow-up": an Applied page quiet for more than QUIET_DAYS with nothing else scheduled; due today
 * Nothing in the past is returned, and Rejected pages have no actions.
 */
export function upcomingActions(application, { now = new Date() } = {}) {
  if (!application || !STAGES.includes(application.status) || application.status === "REJECTED") return [];
  const today = midnight(now);
  const company = text(application.company);
  const status = application.status;
  const actions = [];
  const upcoming = day => isValidDate(day) && dayToDate(day) >= today;
  if ((status === "SAVED" || status === "APPLIED") && upcoming(application.deadline)) {
    actions.push({ at: dayToDate(application.deadline), kind: "deadline", label: status === "SAVED" ? `Apply to ${company}` : `Application deadline: ${company}` });
  }
  if (upcoming(application.nextStepDate)) {
    const step = text(application.nextStep);
    actions.push(status === "INTERVIEW"
      ? { at: dayToDate(application.nextStepDate), kind: "interview", label: `${step || "Interview"}: ${company}` }
      : { at: dayToDate(application.nextStepDate), kind: "next-step", label: `${step || "Next step"}: ${company}` });
  }
  if (status === "APPLIED" && !actions.some(action => action.kind === "next-step")) {
    const since = new Date(stageSince(application));
    if (!Number.isNaN(since.getTime()) && wholeDaysBetween(since, now) > QUIET_DAYS) {
      actions.push({ at: today, kind: "follow-up", label: `Follow up with ${company}` });
    }
  }
  return actions
    .map(action => ({ ...action, day: localDay(action.at) }))
    .sort((left, right) => left.at - right.at || KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind));
}

/** The soonest meaningful action on an application, as { at, kind, label, day }, or null. */
export function nextActionFor(application, { now = new Date() } = {}) {
  return upcomingActions(application, { now })[0] || null;
}

/** Actions due today or within `withinDays` days, across the notebook, soonest first. */
export function dueSoon(applications, { now = new Date(), withinDays = 1 } = {}) {
  const limit = addDays(midnight(now), withinDays);
  return (Array.isArray(applications) ? applications : [])
    .flatMap(application => upcomingActions(application, { now }).map(action => ({ ...action, application })))
    .filter(action => action.at <= limit)
    .sort((left, right) => left.at - right.at || KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind));
}

/** The title and body of the "due soon" notification, or null when nothing is due. */
export function dueSoonMessage(items, { now = new Date() } = {}) {
  if (!items?.length) return null;
  const when = item => {
    const days = wholeDaysBetween(now, item.at);
    return days <= 0 ? "today" : days === 1 ? "tomorrow" : shortDate(item.at);
  };
  const shown = items.slice(0, 3).map(item => `${item.label} (${when(item)})`);
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
  return { title: items.length === 1 ? "1 thing due soon" : `${items.length} things due soon`, body: `${shown.join(", ")}${more}.` };
}

/* ---------- Calendar file (RFC 5545) ---------- */

/** Escapes a TEXT value: backslash, semicolon, comma, and newlines (RFC 5545 section 3.3.11). */
export function escapeIcsText(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds one content line so no line is longer than 75 octets (UTF-8 bytes, not characters), as
 * RFC 5545 section 3.1 requires. Continuation lines start with one space, which counts toward the
 * 75. A multi-byte character is never split across lines.
 */
export function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    const limit = parts.length ? 74 : 75; // later lines spend one octet on the leading space
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const icsStamp = date => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const icsDay = date => localDay(date).replaceAll("-", "");

/**
 * Builds a calendar file of every upcoming action in the notebook: one all-day event per
 * application and kind, each with reminders a day before and two hours before. The UID depends only
 * on the application id and the kind, so a fresh download describes the same events, not new ones.
 * Lines end with CRLF and are folded at 75 octets.
 */
export function buildIcs(applications, { now = new Date(), calendarName = "My Internship Notebook" } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Internship Notebook//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`
  ];
  const stamp = icsStamp(now);
  for (const application of Array.isArray(applications) ? applications : []) {
    for (const action of upcomingActions(application, { now })) {
      const role = text(application.role);
      const description = [
        `${text(application.company)}: ${role}`,
        `Stage: ${LABELS[application.status]}`,
        text(application.nextStep) && `Next step: ${text(application.nextStep)}`,
        text(application.contact) && `Contact: ${text(application.contact)}`,
        text(application.link)
      ].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${Number(application.id) || 0}-${action.kind}@internshipnotebook.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDay(action.at)}`,
        `DTEND;VALUE=DATE:${icsDay(addDays(action.at, 1))}`,
        `SUMMARY:${escapeIcsText(`${action.label} (${role})`)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        "TRANSP:TRANSPARENT",
        ...[["-P1D", "Tomorrow"], ["-PT2H", "Soon"]].flatMap(([trigger, when]) => [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(`${when}: ${action.label}`)}`,
          `TRIGGER:${trigger}`,
          "END:VALARM"
        ]),
        "END:VEVENT"
      );
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/* ---------- Markdown copy ---------- */

/** Inline text that cannot start a heading, list, quote, or table, or open emphasis, code, links,
 *  or HTML. Newlines become spaces (use mdBlock for multi-line text). */
export function mdInline(value, limit = Infinity) {
  return String(value ?? "")
    .slice(0, limit)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[\\`*_[\]<>|]/g, character => `\\${character}`)
    // A line-start marker is escaped the CommonMark way: "\#", "\-", but "1\." (a backslash before
    // a digit is not an escape and would show up as a literal backslash).
    .replace(/^(\s*)(?:([#+\-=>])|(\d+)([.)]))/, (_, space, marker, digits, dot) => (marker ? `${space}\\${marker}` : `${space}${digits}\\${dot}`))
    .trim();
}

/** Multi-line text (notes) as a blockquote, each line made safe with mdInline, blank lines kept. */
function mdBlock(value, limit) {
  return String(value ?? "").slice(0, limit).replace(/\r\n?/g, "\n").split("\n")
    .map(line => (line.trim() ? `> ${mdInline(line)}` : ">"))
    .join("\n");
}

/** Only http(s) links ever reach a page (cleanLink), but %-encode the characters that would end
 *  a Markdown link early, in case an older record slipped through. */
const URL_ESCAPES = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E", " ": "%20" }; // encodeURIComponent keeps ( and )
const mdUrl = url => String(url).replace(/[()<> ]/g, character => URL_ESCAPES[character]);

/** "3 practiced, 1 stuck" from a page's optional interview map (no question text needed). */
function interviewCounts(interview) {
  const records = interview && typeof interview === "object" ? Object.values(interview) : [];
  const practiced = records.filter(record => record?.status === "practiced").length;
  const stuck = records.filter(record => record?.status === "stuck").length;
  return practiced || stuck ? [practiced && `${practiced} practiced`, stuck && `${stuck} stuck`].filter(Boolean).join(", ") : "";
}

/**
 * A readable Markdown copy of the notebook: a title, a summary table, then one "##" section per
 * application with its stage, dates, contact, skills, next step, and notes. Every field is cut to
 * the limit the app enforces on a typed entry. `prefs` supplies the name for the title; `now` the
 * export date.
 */
export function buildMarkdownNotebook(applications, prefs = {}, { now = new Date() } = {}) {
  const pages = [...(Array.isArray(applications) ? applications : [])]
    .filter(entry => entry && STAGES.includes(entry.status))
    .sort((left, right) => STAGES.indexOf(left.status) - STAGES.indexOf(right.status) || text(left.company).localeCompare(text(right.company)));
  const name = mdInline(prefs.name, 40);
  const lines = [`# ${name ? `${name}'s internship notebook` : "My internship notebook"}`, "", `Exported ${localDay(now)}. ${pages.length} ${pages.length === 1 ? "application" : "applications"}.`, ""];
  if (pages.length) {
    lines.push("| Company | Role | Stage | Deadline | Next step |", "| --- | --- | --- | --- | --- |");
    for (const entry of pages) {
      const next = [mdInline(entry.nextStep, LIMITS.nextStep), isValidDate(entry.nextStepDate) ? entry.nextStepDate : ""].filter(Boolean).join(", ");
      lines.push(`| ${mdInline(entry.company, LIMITS.company)} | ${mdInline(entry.role, LIMITS.role)} | ${LABELS[entry.status]} | ${isValidDate(entry.deadline) ? entry.deadline : ""} | ${next} |`);
    }
    lines.push("");
  }
  for (const entry of pages) {
    lines.push(`## ${mdInline(entry.company, LIMITS.company)}: ${mdInline(entry.role, LIMITS.role)}`, "");
    const since = new Date(stageSince(entry));
    const facts = [
      ["Stage", `${LABELS[entry.status]}${Number.isNaN(since.getTime()) ? "" : ` since ${localDay(since)}`}`],
      ["Deadline", isValidDate(entry.deadline) ? entry.deadline : ""],
      ["Next step", [mdInline(entry.nextStep, LIMITS.nextStep), isValidDate(entry.nextStepDate) ? entry.nextStepDate : ""].filter(Boolean).join(", ")],
      ["Location", mdInline(entry.location, LIMITS.location)],
      ["Source", mdInline(entry.source, LIMITS.source)],
      ["Contact", mdInline(entry.contact, LIMITS.contact)],
      ["Skills", (Array.isArray(entry.skills) ? entry.skills : []).slice(0, 12).map(skill => mdInline(skill, 40)).join(", ")],
      ["Interview prep", interviewCounts(entry.interview)],
      ["Posting", /^https?:\/\//i.test(text(entry.link)) ? `[Open the posting](${mdUrl(text(entry.link).slice(0, LIMITS.link))})` : ""]
    ];
    for (const [label, value] of facts) if (value) lines.push(`- **${label}:** ${value}`);
    if (text(entry.notes)) lines.push("", "Notes:", "", mdBlock(entry.notes, LIMITS.notes));
    lines.push("");
  }
  return lines.join("\n");
}

/* ---------- Email digest ---------- */

/** A loose, honest check: something@something.something, no spaces. The mail app does the rest. */
export function isPlausibleEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * A plain-text weekly digest the visitor emails to themselves: this week's progress, deadlines and
 * interviews in the next DIGEST_DAYS, follow-ups due, and a prep hint for the next interview.
 * Returns { subject, body }. Each list is capped at DIGEST_SECTION_LIMIT to keep the email short.
 */
export function buildEmailDigest(applications, prefs = {}, { now = new Date() } = {}) {
  const pages = (Array.isArray(applications) ? applications : []).filter(entry => entry && STAGES.includes(entry.status));
  const weekStart = startOfWeek(now);
  const sentThisWeek = pages.filter(entry => { const at = sentAt(entry); return at && new Date(at) >= weekStart && new Date(at) <= now; }).length;
  const open = pages.filter(entry => ["SAVED", "APPLIED", "INTERVIEW"].includes(entry.status)).length;
  const goal = Number.isInteger(prefs.goal) && prefs.goal > 0 ? prefs.goal : 5;
  const horizon = addDays(midnight(now), DIGEST_DAYS);
  const actions = pages.flatMap(entry => upcomingActions(entry, { now }).map(action => ({ ...action, entry })));
  const within = action => action.at <= horizon;
  const line = action => `- ${shortDate(action.at)}: ${action.label} (${text(action.entry.role)})`;
  const section = (title, items, empty) => [title, ...(items.length ? items.slice(0, DIGEST_SECTION_LIMIT).map(line) : [`- ${empty}`]),
    ...(items.length > DIGEST_SECTION_LIMIT ? [`- and ${items.length - DIGEST_SECTION_LIMIT} more in the notebook`] : []), ""];
  const deadlines = actions.filter(action => action.kind === "deadline" && within(action));
  const followUps = actions.filter(action => action.kind === "follow-up");
  const interviews = actions.filter(action => action.kind === "interview" && within(action));
  const name = text(prefs.name).slice(0, 40);
  const body = [
    name ? `Hi ${name},` : "Hi,",
    "",
    "This week",
    `- ${sentThisWeek} of ${goal} applications sent since Monday`,
    `- ${open} open ${open === 1 ? "application" : "applications"}`,
    "",
    ...section(`Deadlines in the next ${DIGEST_DAYS} days`, deadlines, "None. A good week to save a few new roles."),
    ...section("Follow-ups", followUps, "Nothing waiting more than a week."),
    ...section("Interviews", interviews, "None scheduled."),
    "Interview prep",
    interviews.length
      ? `- Before ${text(interviews[0].entry.company)}: prepare two stories about projects you are proud of and three questions to ask them.`
      : "- When an interview is booked, add its date as the page's next step and it will show up here.",
    "",
    "Written by My Internship Notebook in your browser. You sent this from your own mail app; the site does not send email."
  ].join("\n");
  return { subject: `Internship notebook: week of ${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}`, body };
}

/**
 * A mailto: link that opens the visitor's mail app with the digest filled in. Subject and body are
 * percent-encoded, with line breaks as %0D%0A (RFC 6068). The address keeps a literal "@", which
 * some mail apps require. Returns "" for an address that does not look like one.
 */
export function digestMailto({ to, digest }) {
  if (!isPlausibleEmail(to)) return "";
  const address = encodeURIComponent(to.trim()).replace(/%40/g, "@");
  const encode = value => encodeURIComponent(String(value ?? "").replace(/\r\n|\r|\n/g, "\r\n"));
  return `mailto:${address}?subject=${encode(digest?.subject)}&body=${encode(digest?.body)}`;
}
