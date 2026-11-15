import { buildSession, SESSION_MODES, analyzeAnswer, summarizeSession } from "./mock-interview.js";
import { QUESTION_GROUPS, questionById, questionsFor } from "./interview.js";

const MODES = {
  quick: ["Quick", "A short round across the interview's main topics."],
  full: ["Full", "A longer round with room for stories and technical answers."],
  technical: ["Technical", "Questions matched to the kind of role on this page."],
  behavioral: ["Behavioral", "Practice examples of how you work, learn, and collaborate."]
};
const LIMITATION = "The score checks coverage of key points, timing, structure and filler words, not whether your answer is factually correct.";
const ANSWER_LIMIT = 12000;

export function countdownLabel(seconds, elapsedMs) {
  const remaining = seconds - Math.floor(Math.max(0, elapsedMs) / 1000);
  const duration = value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  return remaining > 0 ? `${duration(remaining)} remaining` : `Target reached · ${duration(-remaining)} over. Take your time.`;
}

export function savedSummaryDetails(entry, record) {
  const groups = QUESTION_GROUPS.filter(group => group.id in record.groupScores);
  return {
    strengths: groups.filter(group => record.groupScores[group.id] >= 70).map(group => `${group.label} answers touched several useful practice cues.`).slice(0, 3),
    toImprove: groups.filter(group => record.groupScores[group.id] < 70).map(group => `Revisit the guide points for ${group.label.toLowerCase()} and practice near the target time.`).slice(0, 3),
    nextPractice: questionsFor(entry).filter(question => question.group in record.groupScores)
      .sort((left, right) => record.groupScores[left.group] - record.groupScores[right.group]).slice(0, 3).map(question => question.id)
  };
}

/** Only compact summaries are persisted. Answer text stays in this visit's memory. */
export function createMockInterviewView({ esc, icon, viewHead, redraw, saveSummary, go }) {
  let practice = null;
  let timer = null;
  let recognition = null;
  let mounted = 0;
  let lastScreen = "";
  const list = (items, empty) => items.length ? `<ul class="mock-list">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="card-note">${empty}</p>`;
  const heading = title => `<h2 class="build-title" id="mock-question" tabindex="-1">${esc(title)}</h2>`;
  const focusHeading = () => document.querySelector("#mock-question")?.focus();

  function stopVoice() {
    const active = recognition;
    recognition = null;
    if (active) {
      active.onresult = active.onerror = active.onend = null;
      active.abort();
    }
  }

  function unmount() {
    mounted++;
    window.clearInterval(timer);
    timer = null;
    stopVoice();
  }

  function reviewMarkup(question, result) {
    const fillers = Object.entries(result.fillers).filter(([, count]) => count).map(([word, count]) => `${word}: ${count}`);
    return `<section id="mock-analysis" aria-labelledby="mock-analysis-title">
      <h3 id="mock-analysis-title" tabindex="-1">Answer review</h3>
      <p class="mock-score"><strong data-mock-score>${result.score}</strong><span>/ 100 <small>Delivery &amp; coverage</small></span></p>
      <div class="mock-review-columns">
        <section><h4>Key points hit</h4>${list(result.coverage.matched, "No key points picked up yet.")}</section>
        <section><h4>Key points missed</h4>${list(result.coverage.missed, "All guide points touched.")}</section>
      </div>
      <dl class="mock-facts">
        <div><dt>Timing</dt><dd>${{ short: "Shorter than the target", good: "Near the target", long: "Longer than the target" }[result.timing]}</dd></div>
        <div><dt>Pace</dt><dd>${result.paceWpm === null ? "Not available" : `${result.paceWpm} words/min (estimated)`}</dd></div>
        <div><dt>Filler words</dt><dd>${fillers.length ? fillers.map(esc).join(" · ") : "None picked up"}</dd></div>
        <div><dt>Structure</dt><dd>${Object.entries(result.structure).map(([part, found]) => `${esc(part[0].toUpperCase() + part.slice(1))}: ${found ? "present" : "not picked up"}`).join(" · ")}</dd></div>
      </dl>
      <p class="card-note">Pace uses the text and elapsed answer time, including time spent typing.</p>
      ${list(result.feedback, "Keep practicing with a concrete example.")}
      <h4>Follow-up questions</h4>${list(question.followUps, "No follow-up questions.")}
    </section>`;
  }

  function summaryMarkup(entry, summary, saved = false) {
    const groups = summary.groupAverages || summary.groupScores;
    const details = saved ? savedSummaryDetails(entry, summary) : summary;
    return `<section class="sheet-page" id="mock-summary" aria-labelledby="mock-question">
      ${heading("Practice summary")}
      <p class="mock-score"><strong data-mock-score>${summary.score}</strong><span>/ 100 <small>Delivery &amp; coverage</small></span></p>
      <h3>By question group</h3>
      <dl class="mock-facts">${QUESTION_GROUPS.filter(group => group.id in groups).map(group => `<div><dt>${esc(group.label)}</dt><dd>${groups[group.id]} / 100</dd></div>`).join("")}</dl>
      ${saved ? `<p class="mock-note">Saved ${esc(new Date(summary.at).toLocaleDateString())} · ${esc(MODES[summary.mode][0])}. Suggestions below use the saved group scores; individual answer reviews stay in the current visit.</p>` : ""}
        <div class="mock-review-columns">
          <section><h3>Strengths</h3>${list(details.strengths, "Keep going: another round will help you build consistency.")}</section>
          <section><h3>To improve</h3>${list(details.toImprove, "Keep using concrete examples and checking the guide points.")}</section>
        </div>
        <h3>Next practice</h3>
        <p class="card-note">Try these again in a focused, one-question session.</p>
        <ul class="mock-next">${details.nextPractice.map(id => {
          const question = questionById(id);
          return `<li><a href="#/mock/${entry.id}/focus/${id}">${esc(question.text)}${icon("forward")}</a></li>`;
        }).join("")}</ul>
        ${saved ? "" : `<p class="mock-save" role="status">${practice.saving ? "Saving summary…" : practice.error ? esc(practice.error) : "Summary saved to this application. Answers are kept only for this visit."}</p>
        ${practice.error ? '<button class="button" type="button" id="mock-retry">Retry saving summary</button>' : ""}`}
      <p class="mock-note">${LIMITATION}</p>
      <div class="build-nav"><a class="button ghost" href="#/entry/${entry.id}">${icon("back")}Back to application</a><a class="button primary" href="#/mock/${entry.id}" id="mock-again">Practice again</a></div>
    </section>`;
  }

  function render(entry, { focus = "", summary = false } = {}) {
    if (!summary && lastScreen === "summary") practice = null;
    lastScreen = summary ? "summary" : "practice";
    if (!practice || (practice.key !== `${entry.id}:${focus}` && !(summary && practice.entryId === entry.id))) practice = { entryId: entry.id, key: `${entry.id}:${focus}`, mode: "quick", session: null, answers: [], index: 0, text: "", analysis: null, summary: null, saving: false, error: "" };
    const focused = focus ? questionsFor(entry).find(question => question.id === focus) : null;
    const header = viewHead({ eyebrow: "Interview prep", title: "Practice interview<span class=\"dot\">.</span>", sub: `${esc(entry.company)} · ${esc(entry.role)}` });
    const back = `<a class="back" href="#/entry/${entry.id}">${icon("back")}Back to application</a>`;
    if (focus && !focused) return `<div class="entry mock-page">${back}${header}<div class="card"><p>This question isn't available for this role.</p><a class="button" href="#/mock/${entry.id}">Choose a practice round</a></div></div>`;
    if ((summary || practice.summary) && (practice.summary || entry.mock?.length)) return `<div class="entry mock-page">${header}${summaryMarkup(entry, practice.summary || entry.mock.at(-1), !practice.summary)}</div>`;
    if (practice.session && !practice.summary) {
      const question = practice.session.questions[practice.index];
      return `<div class="entry mock-page">${back}${header}
        <section class="sheet-page" aria-labelledby="mock-question">
          <div class="build-progress"><p class="build-count">Question ${practice.index + 1} of ${practice.session.questions.length}</p><span class="card-note">${esc(QUESTION_GROUPS.find(group => group.id === question.group).label)}</span></div>
          ${heading(question.text)}
          <div class="mock-clock"><p>Target: ${question.seconds} seconds · advisory</p><p id="mock-countdown" role="timer" aria-live="off">${esc(countdownLabel(question.seconds, (practice.answeredAt || Date.now()) - practice.questionAt))}</p></div>
          ${practice.analysis ? `<details class="mock-answer-copy"><summary>Your answer</summary><p>${esc(practice.text || "No answer entered.")}</p></details>${reviewMarkup(question, practice.analysis)}
            <div class="build-nav"><span class="card-note">Review at your own pace.</span><button class="button primary" id="mock-next" type="button">${practice.index === practice.session.questions.length - 1 ? "Finish practice" : "Next question"}${icon("forward")}</button></div>` : `
            <form id="mock-answer-form">
              <label class="field-caption" for="mock-answer">Your answer</label>
              <p class="card-note" id="mock-answer-help">Type your answer, or say it aloud and write down what you said. The timer never submits for you.</p>
              <textarea class="notes-area" id="mock-answer" rows="9" maxlength="${ANSWER_LIMIT}" aria-describedby="mock-answer-help">${esc(practice.text)}</textarea>
              <div class="mock-voice-slot"><button class="button ghost" type="button" id="mock-voice" hidden>Use voice</button><span id="mock-voice-status" class="card-note" role="status"></span></div>
              <div class="build-nav"><span class="card-note">${ANSWER_LIMIT.toLocaleString()} characters max</span><button class="button primary" type="submit">Review answer${icon("check")}</button></div>
            </form>`}
          <p class="mock-note">${LIMITATION}</p>
        </section></div>`;
    }
    return `<div class="entry mock-page">${back}${header}
      <form class="card build-card" id="mock-start-form">
        ${heading(focused ? "One question, another try" : "Choose your practice round")}
        <p class="build-sub">${focused ? esc(focused.text) : "A little rehearsal, at your own pace. No recording is saved."}</p>
        ${focused ? `<p class="mock-note">1 question · about ${Math.round(focused.seconds / 60)} minutes</p>` : `
          <fieldset class="build-options" aria-labelledby="mock-question">${Object.values(SESSION_MODES).map(mode => {
            const session = buildSession(entry, { mode, now: Date.now() });
            const minutes = Math.round(session.questions.reduce((sum, question) => sum + question.seconds, 0) / 60);
            return `<label class="build-option"><input type="radio" name="mode" value="${mode}"${practice.mode === mode ? " checked" : ""} /><span class="build-option-mark" aria-hidden="true">${icon(mode === "quick" ? "clock" : "notebook")}</span><span class="build-option-text"><strong>${MODES[mode][0]} <small>${session.questions.length} questions · about ${minutes} minutes</small></strong><small>${MODES[mode][1]}</small></span></label>`;
          }).join("")}</fieldset>`}
        <p class="mock-note">${LIMITATION}</p>
        <p class="card-note">Text stays the source of truth. Only your last five session scores are saved to this application. An unfinished round isn't saved; leaving this screen or reloading starts it over.</p>
        <div class="build-nav"><a class="text-button" href="#/entry/${entry.id}">Back to application</a><button class="button primary" type="submit">Start practice${icon("forward")}</button></div>
      </form>
      ${entry.mock?.length ? `<a class="text-button mock-history-link" href="#/mock/${entry.id}/summary">View latest saved summary</a>` : ""}</div>`;
  }

  async function finish(entry) {
    if (practice.saving) return;
    practice.summary ||= summarizeSession({ session: practice.session, answers: practice.answers, now: Date.now() });
    const current = practice;
    current.saving = true;
    current.error = "";
    go(`#/mock/${entry.id}/summary`);
    redraw();
    try {
      await saveSummary(entry.id, { at: current.summary.finishedAt, mode: current.session.mode, score: current.summary.score, groupScores: current.summary.groupAverages });
    } catch (error) {
      current.error = `Couldn't save the summary: ${error.message}`;
    } finally {
      current.saving = false;
      if (practice === current && document.querySelector("#mock-summary")) { redraw(); focusHeading(); }
    }
  }

  async function enableVoice(button, version) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition?.available || !("processLocally" in Recognition.prototype)) return;
    const lang = "en-US";
    try {
      if (await Recognition.available({ langs: [lang], processLocally: true }) !== "available" || version !== mounted) return;
    } catch { return; }
    button.hidden = false;
    button.addEventListener("click", () => {
      const status = document.querySelector("#mock-voice-status");
      if (recognition) { stopVoice(); button.textContent = "Use voice"; status.textContent = "Voice stopped. You can edit the text."; return; }
      const capture = new Recognition();
      capture.processLocally = true;
      capture.lang = lang;
      capture.continuous = true;
      capture.interimResults = false;
      capture.onresult = event => {
        if (version !== mounted || recognition !== capture) return;
        const input = document.querySelector("#mock-answer");
        for (let index = event.resultIndex; index < event.results.length; index++) {
          if (!event.results[index].isFinal) continue;
          const text = event.results[index][0].transcript;
          const capacity = ANSWER_LIMIT - input.value.length + input.selectionEnd - input.selectionStart;
          const insertion = `${input.selectionStart && !/\s$/.test(input.value.slice(0, input.selectionStart)) ? " " : ""}${text} `.slice(0, Math.max(0, capacity));
          input.setRangeText(insertion, input.selectionStart, input.selectionEnd, "end");
        }
        practice.text = input.value;
      };
      capture.onerror = () => { status.textContent = "Voice isn't available right now. Keep typing your answer."; };
      capture.onend = () => { if (recognition === capture) { recognition = null; button.textContent = "Use voice"; if (status.textContent.startsWith("Listening")) status.textContent = "Voice stopped. You can edit the text."; } };
      try {
        recognition = capture;
        capture.start();
        button.textContent = "Stop voice";
        status.textContent = "Listening on this device. You can edit the text.";
      } catch { recognition = null; status.textContent = "Voice isn't available right now. Keep typing your answer."; }
    });
  }

  function mount(entry, { focus = "" } = {}) {
    const version = mounted;
    const start = document.querySelector("#mock-start-form");
    start?.addEventListener("change", event => { if (event.target.name === "mode") practice.mode = event.target.value; });
    start?.addEventListener("submit", event => {
      event.preventDefault();
      const session = buildSession(entry, { mode: practice.mode, now: Date.now() });
      if (focus) session.questions = session.questions.filter(question => question.id === focus);
      if (focus && !session.questions.length) session.questions = questionsFor(entry).filter(question => question.id === focus);
      if (!session.questions.length) return;
      practice.session = session;
      practice.summary = null;
      practice.answers = [];
      practice.index = 0;
      practice.text = "";
      practice.analysis = null;
      practice.answeredAt = null;
      practice.error = "";
      practice.questionAt = Date.now();
      redraw(); focusHeading();
    });
    const answer = document.querySelector("#mock-answer-form");
    answer?.querySelector("textarea").addEventListener("input", event => { practice.text = event.target.value; });
    answer?.addEventListener("submit", event => {
      event.preventDefault();
      stopVoice();
      practice.answeredAt = Date.now();
      const question = practice.session.questions[practice.index];
      const attempt = { questionId: question.id, text: practice.text, durationMs: Math.max(1, practice.answeredAt - practice.questionAt) };
      practice.answers.push(attempt);
      practice.analysis = analyzeAnswer({ ...attempt, question });
      redraw(); document.querySelector("#mock-analysis-title")?.focus();
    });
    if (answer) {
      const question = practice.session.questions[practice.index];
      timer = window.setInterval(() => {
        const label = document.querySelector("#mock-countdown");
        if (label) label.textContent = countdownLabel(question.seconds, Date.now() - practice.questionAt);
      }, 1000);
      enableVoice(document.querySelector("#mock-voice"), version);
    }
    document.querySelector("#mock-next")?.addEventListener("click", () => {
      if (practice.index === practice.session.questions.length - 1) { finish(entry); return; }
      practice.index++;
      practice.text = "";
      practice.analysis = null;
      practice.answeredAt = null;
      practice.questionAt = Date.now();
      redraw(); focusHeading();
    });
    document.querySelector("#mock-retry")?.addEventListener("click", () => finish(entry));
    document.querySelector("#mock-again")?.addEventListener("click", () => { practice = null; });
  }

  return { render, mount, unmount, reset: () => { unmount(); practice = null; } };
}
