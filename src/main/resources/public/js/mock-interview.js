/* Local practice cues, not a judgment of an answer's correctness or a hiring prediction. */
import { QUESTION_GROUPS, questionById, questionsFor } from "./interview.js";

/** Answer-time targets, excluding reading and follow-ups: quick 4 / ~5 minutes,
 * full 10 / ~15 minutes, technical up to 6 / ~12 minutes, behavioral 6 / ~9 minutes.
 * Technical mode uses only applicable questions; an unmatched role has 3 / ~6 minutes. */
export const SESSION_MODES = Object.freeze({ quick: "quick", full: "full", technical: "technical", behavioral: "behavioral" });

const COUNTS = {
  quick: { behavioral: 1, technical: 1, logistics: 1, ask: 1 },
  full: { behavioral: 4, technical: 3, logistics: 2, ask: 1 },
  technical: { technical: 6 },
  behavioral: { behavioral: 6 }
};

function timestamp(now) {
  if (now == null || !["number", "string"].includes(typeof now) || (typeof now === "string" && !now.trim())) {
    throw new Error("now must be a valid timestamp (epoch milliseconds or an ISO date string).");
  }
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("now must be a valid timestamp.");
  return date.toISOString();
}

function resolveQuestion(value) {
  const id = typeof value === "string" ? value : value?.id;
  const question = questionById(id);
  if (!question) throw new Error(`Unknown interview question id: ${String(id)}`);
  return question;
}

/** Stage-ordered rounds preserve the mode's mix. Within each group: stuck, new, then practiced.
 * No randomness or clock reads; now is supplied by the caller and stored as ISO text. */
export function buildSession(application = {}, { mode = SESSION_MODES.quick, now } = {}) {
  if (!Object.values(SESSION_MODES).includes(mode)) throw new Error(`Unknown mock interview mode: ${String(mode)}`);
  const startedAt = timestamp(now);
  const all = questionsFor(application || {});
  const pending = questionsFor(application || {}, { toPractice: true });
  const pendingIds = new Set(pending.map(question => question.id));
  const candidates = [...pending, ...all.filter(question => !pendingIds.has(question.id))];
  const remaining = { ...COUNTS[mode] };
  const groups = [...new Set(all.map(question => question.group))];
  const queues = Object.fromEntries(groups.map(group => [group, candidates.filter(question => question.group === group)]));
  const questions = [];
  while (groups.some(group => remaining[group] > 0 && queues[group].length)) {
    for (const group of groups) {
      if (remaining[group] > 0 && queues[group].length) {
        questions.push(queues[group].shift());
        remaining[group]--;
      }
    }
  }
  return { mode, startedAt, questions };
}

const STOP_WORDS = new Set("a an and are as at be been by can did do for from has have how i in is it its me my of on or our that the their them there these they this to was we were what when which who why will with would you your own specific clear brief relevant".split(" "));
const ALIASES = { outcom: "result", lesson: "learn", learnt: "learn", collaborat: "team", teamwork: "team", cooperat: "team", prioritiz: "priority", priorit: "priority", measur: "metric", constraint: "limit", limitation: "limit" };

function normalize(text) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function stem(word) {
  if (word.length > 4) word = word.replace(/ies$/, "y").replace(/(ing|ed)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1");
  if (word.length > 3) word = word.replace(/s$/, "").replace(/e$/, "");
  return Object.hasOwn(ALIASES, word) ? ALIASES[word] : word;
}

const FILLERS = ["um", "uh", "like", "you know", "basically", "actually", "kind of", "sort of"];
const STAR = {
  situation: /\b(situation|context|during|at the time|when|our team|problem)\b/,
  task: /\b(task|goal|objective|responsibility|responsible|needed to|had to|my role|requirement)\b/,
  action: /\b(action|approach|i decided|i (built|made|created|tested|checked|asked|spoke|organized|organised|implemented|wrote|changed|helped)|we (built|tested|changed)|first|then)\b/,
  result: /\b(result|outcome|in the end|led to|reduced|increased|improved|learned|learnt|achieved|saved|delivered)\b/
};

/** question is a bank object or its id. Missing text/duration are treated as an unanswered attempt.
 * Coverage: a point is touched when at least half its distinct non-stopword stems match (max 2).
 * Common inflections and a small synonym list count; punctuation, case and accents do not matter.
 * shortcut: lexical cues cannot assess meaning or correctness, revisit if validated local scoring becomes available.
 * Score: coverage ratio * 50; timing 20 within inclusive 0.5–1.5x target, 10 long, 0 short;
 * STAR flags / 4 * 15; fillers 10 * max(0, 1 - count / max(1, words * 0.05));
 * pace 5 at 100–180 WPM, 2.5 at 70–220, otherwise 0. Missing/invalid duration earns no timing/pace.
 * Round the sum; empty answers score 0, answers under 20 words are capped at 25.
 * Filler counts are literal occurrences, including uses such as “I like”. */
export function analyzeAnswer({ question: value, text = "", durationMs } = {}) {
  const question = resolveQuestion(value);
  const normalized = normalize(typeof text === "string" ? text : "");
  const words = normalized ? normalized.split(" ") : [];
  const keywords = new Set(words.map(stem));
  const matched = [], missed = [];
  for (const point of question.keyPoints) {
    const terms = [...new Set(normalize(point).split(" ").filter(word => !STOP_WORDS.has(word)).map(stem))];
    const hits = terms.filter(term => keywords.has(term)).length;
    (terms.length && hits >= Math.min(2, Math.ceil(terms.length / 2)) ? matched : missed).push(point);
  }
  const coverage = { matched, missed, ratio: matched.length / question.keyPoints.length };
  const validDuration = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0;
  const seconds = validDuration ? durationMs / 1000 : 0;
  const timing = seconds < question.seconds * 0.5 ? "short" : seconds > question.seconds * 1.5 ? "long" : "good";
  const pace = words.length && validDuration ? Math.round(words.length * 60000 / durationMs) : NaN;
  const paceWpm = Number.isFinite(pace) ? pace : null;
  const fillers = Object.fromEntries(FILLERS.map(filler => [filler, (normalized.match(new RegExp(`\\b${filler === "um" ? "um+" : filler === "uh" ? "uh+" : filler}\\b`, "g")) || []).length]));
  const fillerCount = Object.values(fillers).reduce((sum, count) => sum + count, 0);
  const structure = Object.fromEntries(Object.entries(STAR).map(([part, pattern]) => [part, pattern.test(normalized)]));
  const structureCount = Object.values(structure).filter(Boolean).length;
  const pacePoints = paceWpm !== null && paceWpm >= 100 && paceWpm <= 180 ? 5 : paceWpm !== null && paceWpm >= 70 && paceWpm <= 220 ? 2.5 : 0;
  const rawScore = coverage.ratio * 50 + (validDuration ? timing === "good" ? 20 : timing === "long" ? 10 : 0 : 0)
    + structureCount / 4 * 15 + 10 * Math.max(0, 1 - fillerCount / Math.max(1, words.length * 0.05)) + pacePoints;
  const score = words.length ? Math.min(words.length < 20 ? 25 : 100, Math.round(rawScore)) : 0;
  const feedback = [];
  if (!words.length) feedback.push("Start with one concrete point, then add an example.");
  else {
    if (words.length < 20) feedback.push("Add a little more detail so there is an example to review.");
    if (missed.length) feedback.push(`Try covering: ${missed[0]}.`);
    else feedback.push("You touched all of the guide points.");
    if (timing === "short") feedback.push(`Aim for about ${question.seconds} seconds to leave room for detail.`);
    if (timing === "long") feedback.push(`Try keeping the main answer near ${question.seconds} seconds.`);
    if (question.group === "behavioral" && structureCount < 4) feedback.push("Try linking the situation, your task, your action, and the result.");
    if (fillerCount) feedback.push("A short pause can give you time to choose your next words.");
    if (paceWpm !== null && paceWpm > 180) feedback.push("Try a slower pace with a pause between ideas.");
    if (paceWpm !== null && paceWpm < 100) feedback.push("A brief outline may help you keep a steady pace.");
  }
  return { coverage, timing, paceWpm, fillers, structure, score, feedback: feedback.slice(0, 4) };
}

/** answers is an array of { questionId, text, durationMs }; the last attempt per id wins.
 * All session questions count toward averages, including unanswered ones (score 0).
 * nextPractice ranks the session's weakest scores first, breaking ties by session order. */
export function summarizeSession({ session, answers = [], now } = {}) {
  const finishedAt = timestamp(now);
  if (!Array.isArray(session?.questions)) throw new Error("session.questions must be an array.");
  if (!Array.isArray(answers)) throw new Error("answers must be an array.");
  const questions = session.questions.map(resolveQuestion);
  const attempts = new Map();
  for (const answer of answers) {
    const question = resolveQuestion(answer?.questionId);
    if (!questions.some(entry => entry.id === question.id)) throw new Error(`Question ${question.id} is not in this session.`);
    attempts.set(question.id, answer);
  }
  const results = questions.map(question => ({ questionId: question.id, group: question.group, ...analyzeAnswer({ ...attempts.get(question.id), question }) }));
  const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const score = average(results.map(result => result.score));
  const groupAverages = Object.fromEntries(QUESTION_GROUPS.flatMap(group => {
    const scores = results.filter(result => result.group === group.id).map(result => result.score);
    return scores.length ? [[group.id, average(scores)]] : [];
  }));
  const strengths = [], toImprove = [];
  const rankedGroups = QUESTION_GROUPS.filter(group => group.id in groupAverages).sort((a, b) => groupAverages[b.id] - groupAverages[a.id]);
  for (const group of rankedGroups) {
    if (groupAverages[group.id] >= 70) strengths.push(`${group.label} answers touched several useful practice cues.`);
  }
  if (results.some(result => result.coverage.missed.length)) toImprove.push("Use the missed guide points to add detail to your next answer.");
  if (results.some(result => result.timing !== "good" || result.score === 0)) toImprove.push("Practice one answer aloud near its target time.");
  if (results.some(result => result.group === "behavioral" && !Object.values(result.structure).every(Boolean))) toImprove.push("Link your behavioral example to your own action and its result.");
  if (results.some(result => Object.values(result.fillers).some(Boolean))) toImprove.push("Try a short pause in place of a filler phrase.");
  if (results.some(result => result.paceWpm !== null && (result.paceWpm < 100 || result.paceWpm > 180))) toImprove.push("Practice a steady pace with pauses between ideas.");
  const nextPractice = results.map((result, index) => ({ ...result, index })).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 3).map(result => result.questionId);
  return { results, score, groupAverages, strengths: strengths.slice(0, 3), toImprove: toImprove.slice(0, 3), nextPractice, finishedAt };
}
