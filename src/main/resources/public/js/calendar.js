function escapeIcs(value = "") {
  return String(value).replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function nextDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function compactDay(day) { return day.replaceAll("-", ""); }

export function entryCalendar(entry) {
  const events = [
    entry.deadline && { day: entry.deadline, label: `Application deadline: ${entry.company} — ${entry.role}` },
    entry.nextStepDate && { day: entry.nextStepDate, label: `${entry.nextStep || "Application next step"}: ${entry.company} — ${entry.role}` }
  ].filter(Boolean);
  if (!events.length) return "";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const blocks = events.map((event, index) => [
    "BEGIN:VEVENT",
    `UID:${entry.id}-${index}@my-internship-notebook`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDay(event.day)}`,
    `DTEND;VALUE=DATE:${compactDay(nextDay(event.day))}`,
    `SUMMARY:${escapeIcs(event.label)}`,
    entry.link ? `URL:${escapeIcs(entry.link)}` : "",
    entry.notes ? `DESCRIPTION:${escapeIcs(entry.notes)}` : "",
    "END:VEVENT"
  ].filter(Boolean).join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//My Internship Notebook//EN", "CALSCALE:GREGORIAN", ...blocks, "END:VCALENDAR", ""].join("\r\n");
}
