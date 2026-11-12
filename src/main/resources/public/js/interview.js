/*
 * Interview prep: a question bank and the pure logic around it.
 *
 * Questions are grouped (behavioral, technical, internship logistics, questions to ask them) and
 * have stable ids, because a page's progress is stored by id in its optional `interview` field
 * ({ [id]: { status, note? } }, cleaned by domain.cleanInterview). Never reuse or rename an id:
 * add a new question instead, so saved progress keeps pointing at the right text. Nothing here
 * touches the DOM or storage; it imports only domain.js.
 */
import { INTERVIEW_STATUSES, cleanInterview } from "./domain.js";

export const QUESTION_GROUPS = Object.freeze([
  { id: "behavioral", label: "Behavioral", hint: "Stories about how you work. Answer with situation, action, result." },
  { id: "technical", label: "Technical", hint: "Matched to the role's field." },
  { id: "logistics", label: "Internship logistics", hint: "Dates, location, pay, and paperwork. Have answers ready." },
  { id: "ask", label: "Questions to ask them", hint: "Pick two or three for the end of the interview." }
]);

const q = (id, group, text, tags = []) => Object.freeze({ id, group, text, tags: Object.freeze(tags) });

export const QUESTION_BANK = Object.freeze([
  // Behavioral
  q("b-about-you", "behavioral", "Tell me about yourself."),
  q("b-why-company", "behavioral", "Why do you want to work here?"),
  q("b-why-role", "behavioral", "Why this role?"),
  q("b-proud-project", "behavioral", "Tell me about a project you're proud of."),
  q("b-team-conflict", "behavioral", "Describe a disagreement with a teammate and how you handled it."),
  q("b-failure", "behavioral", "Tell me about a time something went wrong. What did you learn?"),
  q("b-deadline", "behavioral", "Tell me about a time you had a tight deadline."),
  q("b-learn-fast", "behavioral", "Describe a time you had to learn something quickly."),
  q("b-feedback", "behavioral", "Tell me about feedback that changed how you work."),
  q("b-lead", "behavioral", "Tell me about a time you took the lead without being asked."),
  q("b-ambiguity", "behavioral", "Describe a time the goal was unclear. What did you do?"),
  q("b-strength", "behavioral", "What's your biggest strength?"),
  q("b-improve", "behavioral", "What's something you're working to improve?"),
  q("b-prioritize", "behavioral", "How do you prioritize when everything feels urgent?"),
  q("b-helped", "behavioral", "Tell me about a time you helped someone else succeed."),
  q("b-after", "behavioral", "Where do you see yourself after this internship?"),
  // Technical: software
  q("t-sw-walkthrough", "technical", "Walk me through how a project you built is put together.", ["software"]),
  q("t-sw-debug", "technical", "How do you debug a problem you can't reproduce?", ["software"]),
  q("t-sw-hashmap", "technical", "When would you use a hash map instead of a list?", ["software"]),
  q("t-sw-complexity", "technical", "What is Big-O notation? Give an example from code you've written.", ["software"]),
  q("t-sw-testing", "technical", "How do you decide what to test?", ["software"]),
  q("t-sw-git", "technical", "How do you use Git on a team: branches, reviews, and conflicts?", ["software"]),
  q("t-sw-api", "technical", "Design a simple API for a to-do list app.", ["software"]),
  // Technical: data
  q("t-data-joins", "technical", "What's the difference between an inner join and a left join?", ["data"]),
  q("t-data-messy", "technical", "How do you handle missing or messy data?", ["data"]),
  q("t-data-metric", "technical", "How would you pick a metric to measure a feature's success?", ["data"]),
  q("t-data-ab", "technical", "How does an A/B test work, and what can go wrong?", ["data"]),
  q("t-data-explain", "technical", "Explain an analysis you did to someone non-technical.", ["data"]),
  q("t-data-overfit", "technical", "What is overfitting, and how do you spot it?", ["data"]),
  // Technical: design
  q("t-design-process", "technical", "Walk me through your design process on one project.", ["design"]),
  q("t-design-research", "technical", "How do you find out what users need?", ["design"]),
  q("t-design-critique", "technical", "How do you respond to critique of your work?", ["design"]),
  q("t-design-redo", "technical", "Tell me about a design decision you'd make differently now.", ["design"]),
  q("t-design-access", "technical", "How do you make a design accessible?", ["design"]),
  // Technical: product
  q("t-pm-backlog", "technical", "How would you prioritize a long list of feature requests?", ["product"]),
  q("t-pm-improve", "technical", "What's a product you love, and how would you improve it?", ["product"]),
  q("t-pm-measure", "technical", "How would you know whether a new feature worked?", ["product"]),
  q("t-pm-tradeoff", "technical", "Engineering and design disagree. How do you help them decide?", ["product"]),
  // Technical: any field
  q("t-gen-tools", "technical", "Which tools from the job posting have you used, and how?"),
  q("t-gen-explain", "technical", "Explain a concept from your coursework in simple words."),
  q("t-gen-new", "technical", "How would you approach a problem you've never seen before?"),
  // Internship logistics
  q("l-dates", "logistics", "Which dates are you available, and for how long?"),
  q("l-start", "logistics", "When could you start?"),
  q("l-place", "logistics", "Are you open to on-site, hybrid, or remote work?"),
  q("l-hours", "logistics", "How many hours a week could you work during the term?"),
  q("l-pay", "logistics", "What pay are you expecting? Look up typical rates for the role first."),
  q("l-authorization", "logistics", "Do you have the work authorization this role needs?"),
  q("l-school", "logistics", "Does your school need this for credit or a co-op term? What paperwork is involved?"),
  q("l-relocation", "logistics", "Would you need help with relocation or housing?"),
  q("l-other-offers", "logistics", "Are you interviewing elsewhere? It's fine to say yes."),
  q("l-references", "logistics", "Who could you list as references?"),
  // Questions to ask them
  q("a-typical-day", "ask", "What does a typical day look like for an intern here?"),
  q("a-success", "ask", "What would a great internship look like by the end?"),
  q("a-mentor", "ask", "Who would I work with most, and how often would we meet?"),
  q("a-project", "ask", "What kind of project might I work on?"),
  q("a-feedback", "ask", "How does the team share feedback?"),
  q("a-past-interns", "ask", "What have past interns gone on to do?"),
  q("a-challenge", "ask", "What's the biggest challenge the team is working on?"),
  q("a-enjoy", "ask", "What do you enjoy most about working here?"),
  q("a-return", "ask", "Do interns sometimes get return offers?"),
  q("a-next", "ask", "What are the next steps, and when should I expect to hear back?"),
  q("a-tools", "ask", "Which tools and languages does the team use day to day?"),
  q("a-new-people", "ask", "How does the team help people who are new to the field?")
]);

const BY_ID = new Map(QUESTION_BANK.map(question => [question.id, question]));
export const questionById = id => BY_ID.get(id) || null;

/* Keywords that tie a role to a technical track. A role can match more than one ("Data Engineer"). */
const ROLE_TAGS = [
  ["software", /\b(software|developer|engineer(ing)?|swe|back-?end|front-?end|full[- ]?stack|web|mobile|devops|qa|test(ing)?|programmer|embedded|firmware)\b/i],
  ["data", /\b(data|analyst|analytics|machine learning|ml|scien(ce|tist)|statistic(s|al)?|ai|bi)\b/i],
  ["design", /\b(design(er)?|ux|ui|figma|graphic|interaction)\b/i],
  ["product", /\b(product (manager|management|owner|analyst)|pm|apm)\b/i]
];

/** The technical tracks a role title points to, e.g. "Data Engineering Intern" -> ["software", "data"]. */
export function roleTags(role) {
  const title = String(role ?? "");
  return ROLE_TAGS.filter(([, pattern]) => pattern.test(title)).map(([tag]) => tag);
}

/* Which kinds of question matter most at each stage. Earlier groups are drawn from first. */
const STAGE_GROUPS = {
  SAVED: ["behavioral", "logistics", "technical", "ask"],
  APPLIED: ["behavioral", "technical", "ask", "logistics"],
  INTERVIEW: ["technical", "behavioral", "ask", "logistics"],
  OFFER: ["logistics", "ask", "behavioral", "technical"],
  REJECTED: ["behavioral", "technical", "ask", "logistics"]
};

/** Every question that applies to the role, by group: technical questions for the role's tracks
 *  (tagged ones first), plus the any-field ones. No track matched means only the any-field ones. */
export function questionsByGroup(role) {
  const tags = roleTags(role);
  const groups = Object.fromEntries(QUESTION_GROUPS.map(group => [group.id, []]));
  for (const question of QUESTION_BANK) {
    if (question.group === "technical" && question.tags.length && !question.tags.some(tag => tags.includes(tag))) continue;
    groups[question.group].push(question);
  }
  groups.technical.sort((left, right) => (right.tags.length > 0) - (left.tags.length > 0));
  return groups;
}

/**
 * Questions for one application, most useful first. The stage decides which groups lead (technical
 * before an interview, logistics once there's an offer); groups take turns so a short list is
 * still mixed. With `toPractice`, practiced questions are left out and "stuck" ones come first.
 * `limit` caps the list (default: all of them).
 */
export function questionsFor({ role, status, interview } = {}, { limit = Infinity, toPractice = false } = {}) {
  const groups = questionsByGroup(role);
  const order = STAGE_GROUPS[status] || STAGE_GROUPS.APPLIED;
  const progress = cleanInterview(interview);
  const state = question => progress[question.id]?.status || "new";
  const queues = order.map(group => groups[group].filter(question => !toPractice || state(question) !== "practiced"));
  const picked = [];
  while (queues.some(queue => queue.length)) {
    for (const queue of queues) if (queue.length) picked.push(queue.shift());
  }
  const ranked = toPractice
    ? [...picked.filter(question => state(question) === "stuck"), ...picked.filter(question => state(question) !== "stuck")]
    : picked;
  return ranked.slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined);
}

/**
 * Counts for a set of progress records (one per question in scope; a missing record is "new").
 * Returns { total, practiced, stuck, fresh, toPractice, percent } where percent is practiced/total.
 */
export function interviewProgress(entries) {
  const records = Array.isArray(entries) ? entries : [];
  const count = status => records.filter(record => (INTERVIEW_STATUSES.includes(record?.status) ? record.status : "new") === status).length;
  const total = records.length;
  const practiced = count("practiced");
  const stuck = count("stuck");
  return { total, practiced, stuck, fresh: total - practiced - stuck, toPractice: total - practiced, percent: total ? Math.round((practiced * 100) / total) : 0 };
}

/**
 * One application's prep at a glance: the progress over every question that applies to it, the
 * next question to practice (stuck first), and a one-line summary like "4 of 40 practiced, 1 stuck".
 */
export function interviewSummary(application) {
  const progress = cleanInterview(application?.interview);
  const scope = questionsFor(application || {});
  const counts = interviewProgress(scope.map(question => progress[question.id] || { status: "new" }));
  const [next = null] = questionsFor(application || {}, { limit: 1, toPractice: true });
  const notes = Object.values(progress).filter(record => record.note).length;
  const text = `${counts.practiced} of ${counts.total} practiced${counts.stuck ? `, ${counts.stuck} stuck` : ""}`;
  return { ...counts, notes, next, text };
}

/** The progress map after marking one question. Choosing the status it already has clears it back
 *  to "new" (so the buttons toggle). The result is cleaned, ready to save. */
export function withQuestionStatus(interview, questionId, status) {
  if (!BY_ID.has(questionId) || !INTERVIEW_STATUSES.includes(status)) return cleanInterview(interview);
  const current = cleanInterview(interview);
  const record = current[questionId] || { status: "new" };
  return cleanInterview({ ...current, [questionId]: { ...record, status: record.status === status ? "new" : status } });
}

/** The progress map after editing one question's note (an empty note removes it). */
export function withQuestionNote(interview, questionId, note) {
  if (!BY_ID.has(questionId)) return cleanInterview(interview);
  const current = cleanInterview(interview);
  const record = current[questionId] || { status: "new" };
  return cleanInterview({ ...current, [questionId]: { ...record, note: typeof note === "string" ? note : "" } });
}
