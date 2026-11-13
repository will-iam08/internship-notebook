import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { QUESTION_BANK, QUESTION_GROUPS, questionById, questionsFor } from "../../src/main/resources/public/js/interview.js";
import { SESSION_MODES, buildSession, analyzeAnswer, summarizeSession } from "../../src/main/resources/public/js/mock-interview.js";

const now = "2026-11-13T15:00:00.000Z";
const story = questionById("b-proud-project");
const storyText = "During a class project our team needed to help students find available study rooms. " +
  "My task was to build a useful prototype within a week. I interviewed classmates, tested the assumptions, " +
  "and decided to focus on one building because our time was limited. I built the prototype and worked " +
  "with a teammate to test it with students. As a result we reduced the time needed to find a room, " +
  "and I learned to test the smallest useful solution before adding more features.";

test("every question has complete, immutable guidance and a stable lookup", () => {
  const targets = { behavioral: 90, technical: 120, logistics: 60, ask: 45 };
  for (const question of QUESTION_BANK) {
    assert.equal(questionById(question.id), question);
    assert.equal(question.seconds, targets[question.group], question.id);
    assert.ok(question.keyPoints.length >= 3 && question.keyPoints.length <= 5, question.id);
    assert.ok(question.keyPoints.every(point => typeof point === "string" && point.trim().length > 5), question.id);
    assert.equal(new Set(question.keyPoints).size, question.keyPoints.length, question.id);
    assert.equal(typeof question.outline, "string", question.id);
    assert.ok(question.outline.length > 20, question.id);
    assert.ok(question.followUps.length >= 1 && question.followUps.length <= 3, question.id);
    assert.ok(question.followUps.every(followUp => typeof followUp === "string" && followUp.endsWith("?")), question.id);
    assert.ok(Object.isFrozen(question) && Object.isFrozen(question.keyPoints) && Object.isFrozen(question.followUps), question.id);
  }
  assert.equal(questionById("unknown"), null);
});

test("session modes keep their documented counts, mix, and relevant technical tracks", () => {
  assert.deepEqual(SESSION_MODES, { quick: "quick", full: "full", technical: "technical", behavioral: "behavioral" });
  assert.ok(Object.isFrozen(SESSION_MODES));
  const application = { role: "Software Engineering Intern", status: "INTERVIEW" };
  for (const [mode, expected] of Object.entries({
    quick: { behavioral: 1, technical: 1, logistics: 1, ask: 1 },
    full: { behavioral: 4, technical: 3, logistics: 2, ask: 1 },
    technical: { technical: 6 },
    behavioral: { behavioral: 6 }
  })) {
    const session = buildSession(application, { mode, now });
    assert.equal(session.mode, mode);
    assert.equal(session.startedAt, now);
    const counts = {};
    for (const question of session.questions) {
      counts[question.group] = (counts[question.group] || 0) + 1;
      assert.equal(questionById(question.id), question);
      if (question.group === "technical") assert.ok(question.tags.length === 0 || question.tags.includes("software"));
    }
    assert.deepEqual(counts, expected, mode);
    assert.equal(new Set(session.questions.map(question => question.id)).size, session.questions.length);
  }
  assert.equal(buildSession({ role: "Marketing Intern" }, { mode: "technical", now }).questions.length, 3);
  assert.equal(buildSession({}, { now }).mode, "quick");
});

test("session selection prefers unpracticed and stuck questions, then fills from practiced", () => {
  const application = { role: "Software Intern", status: "INTERVIEW" };
  const candidates = questionsFor(application).filter(question => question.group === "technical");
  const preferred = candidates.slice(-2);
  const interview = Object.fromEntries(candidates.map(question => [question.id, { status: "practiced" }]));
  interview[preferred[0].id] = { status: "new" };
  interview[preferred[1].id] = { status: "stuck" };
  const session = buildSession({ ...application, interview }, { mode: "technical", now });
  assert.equal(session.questions.length, 6);
  assert.deepEqual(session.questions.slice(0, 2).map(question => question.id), [preferred[1].id, preferred[0].id]);
  assert.ok(session.questions.slice(2).every(question => interview[question.id].status === "practiced"));
});

test("session selection and analysis are deterministic and leave inputs unchanged", () => {
  const application = { role: "Data Analyst", status: "INTERVIEW", interview: { "t-data-ab": { status: "stuck" } } };
  const before = JSON.stringify(application);
  const first = buildSession(application, { mode: "full", now });
  assert.deepEqual(buildSession(application, { mode: "full", now: Date.parse(now) }), first);
  assert.equal(JSON.stringify(application), before);
  const input = { question: story, text: storyText, durationMs: 90_000 };
  assert.deepEqual(analyzeAnswer(input), analyzeAnswer(input));
});

test("coverage ignores case and punctuation and lists exactly the missed guidance", () => {
  const allPoints = story.keyPoints.join("; ").toUpperCase().replaceAll(" ", "... ");
  const analysis = analyzeAnswer({ question: story.id, text: allPoints, durationMs: 90_000 });
  assert.deepEqual(analysis.coverage.matched, story.keyPoints);
  assert.deepEqual(analysis.coverage.missed, []);
  assert.equal(analysis.coverage.ratio, 1);
  const unrelated = analyzeAnswer({ question: story, text: "Blue umbrellas beside orange bicycles.", durationMs: 90_000 });
  assert.deepEqual(unrelated.coverage.matched, []);
  assert.deepEqual(unrelated.coverage.missed, story.keyPoints);
  assert.equal(unrelated.coverage.ratio, 0);
});

test("coverage matches singular forms, inflections, accents, and common keyword alternatives", () => {
  const text = "The projéct had a goal and a constraint. My specific action and decision led to an outcome, and I learnt a lesson.";
  const analysis = analyzeAnswer({ question: story, text, durationMs: 90_000 });
  assert.deepEqual(analysis.coverage.matched, story.keyPoints);
  assert.deepEqual(analysis.coverage.missed, []);
});

test("timing uses inclusive half-to-one-and-a-half target bounds", () => {
  for (const question of QUESTION_GROUPS.map(group => QUESTION_BANK.find(item => item.group === group.id))) {
    const target = question.seconds * 1000;
    for (const [durationMs, expected] of [[target / 2 - 1, "short"], [target / 2, "good"], [target, "good"], [target * 1.5, "good"], [target * 1.5 + 1, "long"]]) {
      assert.equal(analyzeAnswer({ question, text: storyText, durationMs }).timing, expected, `${question.id}: ${durationMs}`);
    }
  }
});

test("filler counts use whole words and phrases despite case and punctuation", () => {
  const analysis = analyzeAnswer({ question: story, text: "UM, um. Uh! Like, like; you know, YOU KNOW. Basically actually kind-of sort of. " +
    "Unlike a costume, a thumbnail is useful. A likeness is not another match.", durationMs: 90_000 });
  assert.deepEqual(analysis.fillers, { um: 2, uh: 1, like: 2, "you know": 2, basically: 1, actually: 1, "kind of": 1, "sort of": 1 });
});

test("STAR detection recognizes explicit labels and natural narrative cues", () => {
  const explicit = analyzeAnswer({ question: story, text: "Situation: a deadline. Task: ship it. Action: test it. Result: success.", durationMs: 90_000 });
  assert.deepEqual(explicit.structure, { situation: true, task: true, action: true, result: true });
  const natural = analyzeAnswer({ question: story, text: storyText, durationMs: 90_000 });
  assert.deepEqual(natural.structure, { situation: true, task: true, action: true, result: true });
  assert.deepEqual(analyzeAnswer({ question: story, text: "Blue umbrellas.", durationMs: 90_000 }).structure,
    { situation: false, task: false, action: false, result: false });
});

test("a fuller structured answer beats a thin one and avoidable fillers lower its score", () => {
  const text = `${storyText} ${story.keyPoints.join(". ")}`;
  const full = analyzeAnswer({ question: story, text, durationMs: 90_000 });
  const thin = analyzeAnswer({ question: story, text: "Um, I did a project.", durationMs: 5_000 });
  const fillerHeavy = analyzeAnswer({ question: story, text: `${text} ${"um uh like ".repeat(10)}`, durationMs: 90_000 });
  assert.ok(full.score > thin.score, `${full.score} > ${thin.score}`);
  assert.ok(full.score > fillerHeavy.score, `${full.score} > ${fillerHeavy.score}`);
  for (const analysis of [full, thin, fillerHeavy]) {
    assert.ok(Number.isInteger(analysis.score) && analysis.score >= 0 && analysis.score <= 100);
    assert.ok(analysis.feedback.length > 0 && analysis.feedback.length <= 4);
    assert.ok(analysis.feedback.every(sentence => typeof sentence === "string" && sentence.length < 200));
  }
});

test("score applies the documented timing, structure, filler, and pacing weights", () => {
  const words = Array(120).fill("practice");
  const analyze = (text, durationMs) => analyzeAnswer({ question: story, text, durationMs });
  assert.equal(analyze(words.join(" "), 60_000).score, 35, "20 timing + 10 fillers + 5 pace");
  assert.equal(analyze(words.join(" "), 30_000).score, 10, "short and too fast: only 10 filler points");
  assert.equal(analyze(words.join(" "), 180_000).score, 20, "10 long timing + 10 fillers");
  assert.equal(analyze(["situation", ...words.slice(1)].join(" "), 60_000).score, 39, "one STAR marker adds 15 / 4, rounded");
  assert.equal(analyze(["um", ...words.slice(1)].join(" "), 60_000).score, 33, "one filler out of six allowance loses 10 / 6");
  const complete = `${story.keyPoints.join(" ")} situation task action result`.split(" ");
  assert.equal(analyze([...complete, ...Array(120 - complete.length).fill("practice")].join(" "), 60_000).score, 100);
});

test("pace uses words per elapsed minute and unavailable duration produces no pace", () => {
  const text = Array(120).fill("practice").join(" ");
  assert.equal(analyzeAnswer({ question: story, text, durationMs: 60_000 }).paceWpm, 120);
  assert.equal(analyzeAnswer({ question: story, text, durationMs: 120_000 }).paceWpm, 60);
  assert.equal(analyzeAnswer({ question: story, text, durationMs: 30_000 }).paceWpm, 240);
  assert.equal(analyzeAnswer({ question: story, text: "I've practiced", durationMs: 60_000 }).paceWpm, 2);
  for (const durationMs of [undefined, 0, -1, NaN, Infinity, Number.MIN_VALUE]) {
    assert.equal(analyzeAnswer({ question: story, text, durationMs }).paceWpm, null);
  }
});

test("empty and very short answers remain low even with good timing and keyword labels", () => {
  for (const text of [undefined, null, "", "   ", "...!", 42]) {
    const analysis = analyzeAnswer({ question: story, text, durationMs: 90_000 });
    assert.equal(analysis.score, 0);
    assert.equal(analysis.paceWpm, null);
    assert.deepEqual(analysis.coverage.missed, story.keyPoints);
  }
  const short = analyzeAnswer({ question: story, text: "Situation task action result project constraints contribution outcome", durationMs: 90_000 });
  assert.ok(short.score <= 25);
});

test("summary aggregates every session question and recommends the weakest answers first", () => {
  const questions = [story, questionById("b-failure"), questionById("t-sw-testing"), questionById("l-dates")];
  const session = { mode: "full", startedAt: now, questions };
  const answers = [
    { questionId: questions[2].id, text: "I test things.", durationMs: 7_000 },
    { questionId: questions[0].id, text: `${storyText} ${story.keyPoints.join(". ")}`, durationMs: 90_000 },
    { questionId: questions[1].id, text: storyText, durationMs: 90_000 }
  ];
  const before = JSON.stringify({ session, answers });
  const finished = "2026-11-13T15:15:00.000Z";
  const summary = summarizeSession({ session, answers, now: finished });
  assert.equal(summary.finishedAt, finished);
  assert.deepEqual(summary.results.map(result => result.questionId), questions.map(question => question.id));
  const expected = questions.map(question => analyzeAnswer({ question, ...answers.find(answer => answer.questionId === question.id) }));
  for (let index = 0; index < questions.length; index++) {
    assert.equal(summary.results[index].group, questions[index].group);
    assert.equal(summary.results[index].score, expected[index].score);
  }
  const mean = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  assert.equal(summary.score, mean(expected.map(result => result.score)));
  assert.deepEqual(summary.groupAverages, { behavioral: mean(expected.slice(0, 2).map(result => result.score)), technical: expected[2].score, logistics: 0 });
  const weakest = questions.map((question, index) => ({ id: question.id, score: expected[index].score })).sort((left, right) => left.score - right.score).slice(0, 3).map(question => question.id);
  assert.deepEqual(summary.nextPractice, weakest);
  assert.ok(summary.strengths.length > 0);
  assert.ok(summary.toImprove.length > 0);
  assert.ok([...summary.strengths, ...summary.toImprove].every(sentence => typeof sentence === "string" && sentence.length < 200));
  assert.equal(JSON.stringify({ session, answers }), before);
  assert.deepEqual(summarizeSession({ session, answers, now: finished }), summary);
});

test("unanswered and empty sessions aggregate safely with stable practice ties", () => {
  const session = buildSession({}, { now });
  const summary = summarizeSession({ session, now });
  assert.equal(summary.score, 0);
  assert.ok(summary.results.every(result => result.score === 0));
  assert.deepEqual(summary.nextPractice, session.questions.slice(0, 3).map(question => question.id));
  const empty = summarizeSession({ session: { ...session, questions: [] }, answers: [], now });
  assert.deepEqual(empty.results, []);
  assert.equal(empty.score, 0);
  assert.deepEqual(empty.groupAverages, {});
  assert.deepEqual(empty.nextPractice, []);
});

test("summary uses the latest attempt and rejects answers outside the session", () => {
  const session = { mode: "behavioral", startedAt: now, questions: [story] };
  const latest = { questionId: story.id, text: storyText, durationMs: 90_000 };
  const summary = summarizeSession({ session, answers: [{ questionId: story.id, text: "", durationMs: 1_000 }, latest], now });
  assert.equal(summary.results[0].score, analyzeAnswer({ ...latest, question: story }).score);
  assert.equal(summary.results.length, 1);
  assert.throws(() => summarizeSession({ session, answers: [{ questionId: "b-failure", text: storyText }], now }), /b-failure.*not.*session/i);
});

test("unknown ids and invalid required inputs fail clearly", () => {
  assert.throws(() => analyzeAnswer({ question: "unknown", text: "Answer", durationMs: 1_000 }), /unknown.*question.*unknown/i);
  assert.throws(() => analyzeAnswer({ question: { id: "unknown" } }), /unknown.*question.*unknown/i);
  assert.throws(() => buildSession({}, { mode: "unexpected", now }), /mode/i);
  for (const invalidNow of [undefined, null, "not-a-date", Infinity]) {
    assert.throws(() => buildSession({}, { now: invalidNow }), /now|timestamp/i);
    assert.throws(() => summarizeSession({ session: { questions: [] }, now: invalidNow }), /now|timestamp/i);
  }
  const session = buildSession({}, { now });
  assert.throws(() => summarizeSession({ session, answers: [{ questionId: "unknown" }], now }), /unknown.*question.*unknown/i);
  assert.throws(() => summarizeSession({ session: { ...session, questions: [{ id: "unknown" }] }, now }), /unknown.*question.*unknown/i);
});

test("both modules have only pure imports and never access browser state or the clock", async () => {
  for (const [file, imports] of [["interview.js", ["./domain.js"]], ["mock-interview.js", ["./interview.js"]]]) {
    const source = await readFile(new URL(`../../src/main/resources/public/js/${file}`, import.meta.url), "utf8");
    assert.deepEqual([...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]), imports);
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|window|document)\b|\bfetch\s*\(/, file);
    if (file === "mock-interview.js") assert.doesNotMatch(source, /Date\.now\s*\(|new Date\(\s*\)/);
  }
});
