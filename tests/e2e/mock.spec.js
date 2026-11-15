// Local interview practice: application-scoped rounds, honest feedback, and compact saved results.
import { expect, test } from "./fixtures.js";
import { openApp, sampleApplications, savedNotebook, seedNotebook } from "./helpers.js";
import { buildSession } from "../../src/main/resources/public/js/mock-interview.js";

const application = sampleApplications().find(entry => entry.id === 3);
const quick = buildSession(application, { mode: "quick", now: "2026-11-13T15:00:00Z" });
const answerFor = question => `${question.keyPoints.join(". ")}. During our project the situation needed attention. My task was clear. First I tested the approach, then I built an example. The result improved our work and I learned from the outcome.`;
const score = async scope => Number.parseInt(await scope.locator("[data-mock-score]").textContent(), 10);
const savedSessions = async page => (await savedNotebook(page)).applications.find(entry => entry.id === 3).mock;

async function start(page, route = "#/mock/3") {
  await openApp(page, route);
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.locator("#mock-question")).toBeVisible();
}

async function review(page, text) {
  await page.getByRole("textbox", { name: "Your answer", exact: true }).fill(text);
  await page.getByRole("button", { name: "Review answer", exact: true }).click();
  await expect(page.locator("#mock-analysis")).toBeVisible();
}

async function completeQuick(page) {
  for (let index = 0; index < quick.questions.length; index++) {
    await review(page, index === 0 ? answerFor(quick.questions[index]) : "Blue umbrellas beside orange bicycles.");
    await page.getByRole("button", { name: index === quick.questions.length - 1 ? "Finish practice" : "Next question", exact: true }).click();
  }
  await expect(page.locator("#mock-summary")).toBeVisible();
}

async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const small = await page.locator(".mock-page button:visible, .mock-page a:visible, .mock-page .build-option:visible")
    .evaluateAll(elements => elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.textContent.trim()));
  expect(small).toEqual([]);
}

async function contrast(locator) {
  return locator.evaluate(element => {
    const rgb = value => {
      const channels = (value.match(/[\d.]+/g) || []).map(Number);
      return value.startsWith("color(srgb ") ? channels.map((channel, index) => index < 3 ? channel * 255 : channel) : channels;
    };
    const lum = ([r, g, b]) => [r, g, b].map(c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
      .reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
    let node = element;
    let background = [255, 255, 255];
    while (node) {
      const value = rgb(getComputedStyle(node).backgroundColor);
      if (value.length >= 3 && (value[3] === undefined || value[3] === 1)) { background = value; break; }
      node = node.parentElement;
    }
    const [a, b] = [lum(rgb(getComputedStyle(element).color)), lum(background)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  });
}

let errors;
test.beforeEach(async ({ page }, testInfo) => {
  // Headless shell crashes in the native speech probe; dedicated tests below cover both capability paths.
  if (!testInfo.title.includes("speech")) await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  });
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test("application and Today entry points keep practice scoped to that application", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  const link = page.locator("#prep").getByRole("link", { name: "Practice interview", exact: true });
  await expect(link).toHaveAttribute("href", "#/mock/3");
  await link.click();
  await expect(page).toHaveURL(/#\/mock\/3$/);
  await expect(page.locator(".mock-page")).toContainText("Harbour Health");
  await page.reload();
  await expect(page.locator("#mock-start-form")).toBeVisible();
  await expect(page.locator(".mock-page")).toContainText("Harbour Health");
  await openApp(page, "#/today");
  await page.locator(".practice-card").getByRole("link", { name: "Practice interview", exact: true }).click();
  await expect(page).toHaveURL(/#\/mock\/3$/);
});

test("all four modes show core question counts and target minutes with the scoring limitation", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/mock/3");
  const form = page.locator("#mock-start-form");
  await expect(form.getByRole("radio")).toHaveCount(4);
  for (const mode of ["quick", "full", "technical", "behavioral"]) {
    const session = buildSession(application, { mode, now: "2026-11-13T15:00:00Z" });
    const minutes = Math.round(session.questions.reduce((sum, question) => sum + question.seconds, 0) / 60);
    const option = form.locator(`label:has(input[value="${mode}"])`);
    await expect(option).toContainText(`${session.questions.length} questions`);
    await expect(option).toContainText(new RegExp(`${minutes}\\s*(?:min|minute)`));
  }
  await expect(form.locator('input[value="quick"]')).toBeChecked();
  await expect(page.locator(".mock-page")).toContainText(/coverage.*timing.*structure.*filler words/i);
  await expect(page.locator(".mock-page")).toContainText(/not (?:the )?(?:correctness of facts|whether.*factually correct)/i);
});

test("a quick round reviews coverage, scores stronger answers higher, and saves a reloadable summary", async ({ page }, testInfo) => {
  await seedNotebook(page);
  await start(page);
  const scores = [];
  for (let index = 0; index < quick.questions.length; index++) {
    await expect(page.locator(".mock-page")).toContainText(`Question ${index + 1} of ${quick.questions.length}`);
    await expect(page.locator("#mock-question")).toHaveText(quick.questions[index].text);
    await review(page, index === 0 ? answerFor(quick.questions[index]) : "Blue umbrellas beside orange bicycles.");
    const analysis = page.locator("#mock-analysis");
    scores.push(await score(analysis));
    for (const label of ["Key points hit", "Key points missed", "Timing", "Pace", "Filler words", "Structure", "Follow-up questions"]) {
      await expect(analysis.getByText(label, { exact: true })).toBeVisible();
    }
    for (const point of quick.questions[index].keyPoints) await expect(analysis.getByText(point, { exact: true })).toBeVisible();
    for (const followUp of quick.questions[index].followUps) await expect(analysis.getByText(followUp, { exact: true })).toBeVisible();
    await expect(analysis.locator(".mock-review-columns > section").nth(index === 0 ? 0 : 1).locator("li")).toHaveText(quick.questions[index].keyPoints);
    if (index === 0) {
      await expect(analysis.locator(".mock-review-columns > section").nth(1)).toContainText("All guide points touched.");
      await page.screenshot({ path: testInfo.outputPath("mock-analysis.png"), fullPage: true });
    }
    await page.getByRole("button", { name: index === quick.questions.length - 1 ? "Finish practice" : "Next question", exact: true }).click();
  }
  expect(scores[0]).toBeGreaterThan(scores[1]);
  const summary = page.locator("#mock-summary");
  await expect(summary).toBeVisible();
  const overall = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  expect(await score(summary)).toBe(overall);
  await expect(summary).toContainText(/Strengths/);
  await expect(summary).toContainText(/To improve/i);
  await expect(summary).toContainText(/Next practice/i);
  await expect(summary.locator('a[href^="#/mock/3/focus/"]')).toHaveCount(3);
  await expect.poll(async () => (await savedSessions(page))?.length).toBe(1);
  const saved = (await savedSessions(page))[0];
  expect(Object.keys(saved).sort()).toEqual(["at", "groupScores", "mode", "score"]);
  expect(saved.mode).toBe("quick");
  expect(saved.score).toBe(overall);
  expect(Object.values(saved.groupScores).sort((a, b) => a - b)).toEqual([...scores].sort((a, b) => a - b));
  await expect(page).toHaveURL(/#\/mock\/3\/summary$/);
  await page.screenshot({ path: testInfo.outputPath("mock-summary.png"), fullPage: true });
  await page.reload();
  await expect(page.locator("#mock-summary")).toBeVisible();
  expect(await score(page.locator("#mock-summary"))).toBe(overall);
  for (const label of ["Strengths", "To improve", "Next practice"]) await expect(page.locator("#mock-summary")).toContainText(label);
  await expect(page.locator('#mock-summary a[href^="#/mock/3/focus/"]')).toHaveCount(3);
  expect(await savedSessions(page)).toHaveLength(1);
  await openApp(page, "#/entry/3");
  await expect(page.locator(".mock-trend")).toContainText(String(overall));
  await page.reload();
  await expect(page.locator(".mock-trend")).toContainText(String(overall));
  expect((await savedNotebook(page)).applications.filter(entry => entry.id !== 3).every(entry => !entry.mock)).toBe(true);
});

test("next practice links start a round focused on the recommended question", async ({ page }) => {
  await seedNotebook(page);
  await start(page);
  await completeQuick(page);
  const link = page.locator('#mock-summary a[href^="#/mock/3/focus/"]').first();
  const questionId = (await link.getAttribute("href")).split("/").at(-1);
  const question = quick.questions.find(question => question.id === questionId);
  await link.click();
  await expect(page.locator("#mock-start-form")).toContainText(question.text);
  await expect(page.locator("#mock-start-form")).toContainText("1 question");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.locator("#mock-question")).toHaveText(question.text);
  await expect(page.locator(".mock-page")).toContainText("Question 1 of 1");
  await review(page, answerFor(question));
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await expect(page.locator("#mock-summary")).toContainText("Strengths");
  await expect(page.locator("#mock-summary")).toContainText("Next practice");
  await page.locator(`#mock-summary a[href="#/mock/3/focus/${questionId}"]`).click();
  await expect(page.locator("#mock-start-form")).toContainText(question.text);
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your answer", exact: true })).toHaveValue("");
  await review(page, "Blue umbrellas beside orange bicycles.");
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await expect(page.locator("#mock-summary")).toContainText("Next practice");
  await openApp(page, "#/entry/3");
  await page.locator("#prep").getByRole("link", { name: "Practice interview", exact: true }).click();
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.locator(".mock-page")).toContainText("Question 1 of 4");
  await expect(page.getByRole("textbox", { name: "Your answer", exact: true })).toHaveValue("");
});

test("keyboard alone can enter, answer, review, and finish a quick round", async ({ page, browserName }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  await page.locator("#prep").getByRole("link", { name: "Practice interview", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mock-start-form")).toBeVisible();
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  const reach = async locator => {
    for (let count = 0; count < 25; count++) {
      if (await locator.evaluate(element => element === document.activeElement)) return;
      await page.keyboard.press(tab);
    }
    await expect(locator).toBeFocused();
  };
  await reach(page.locator('#mock-start-form input[value="quick"]'));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('#mock-start-form input[value="full"]')).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('#mock-start-form input[value="quick"]')).toBeChecked();
  await reach(page.getByRole("button", { name: "Start practice", exact: true }));
  await page.keyboard.press("Enter");
  for (let index = 0; index < quick.questions.length; index++) {
    await reach(page.getByRole("textbox", { name: "Your answer", exact: true }));
    await page.keyboard.type("During a project my task was testing. First I built an example and the result improved our work.");
    await reach(page.getByRole("button", { name: "Review answer", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.locator("#mock-analysis")).toBeVisible();
    await reach(page.getByRole("button", { name: index === quick.questions.length - 1 ? "Finish practice" : "Next question", exact: true }));
    await page.keyboard.press("Enter");
  }
  await expect(page.locator("#mock-summary")).toBeVisible();
  await expect.poll(async () => (await savedSessions(page))?.length).toBe(1);
});

for (const colorScheme of ["light", "dark"]) {
  test(`390px ${colorScheme}: every practice screen fits, has AA text and 44px controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await seedNotebook(page);
    await openApp(page, "#/mock/3");
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await fits(page);
    for (const selector of [".view-sub", ".build-option-text small"]) {
      expect(await contrast(page.locator(selector).first()), `${selector} in ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: testInfo.outputPath(`mock-start-390-${colorScheme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Start practice", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`mock-question-390-${colorScheme}.png`), fullPage: true });
    await review(page, answerFor(quick.questions[0]));
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`mock-analysis-390-${colorScheme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    for (let index = 1; index < quick.questions.length; index++) {
      await review(page, "Blue umbrellas beside orange bicycles.");
      await page.getByRole("button", { name: index === quick.questions.length - 1 ? "Finish practice" : "Next question", exact: true }).click();
    }
    await expect(page.locator("#mock-summary")).toBeVisible();
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`mock-summary-390-${colorScheme}.png`), fullPage: true });
  });
}

test("speech capture is absent when the browser has no local recognition support", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  });
  await seedNotebook(page);
  await start(page);
  await expect(page.getByRole("button", { name: /(?:voice|dictat|microphone)/i })).toHaveCount(0);
  await review(page, answerFor(quick.questions[0]));
  await expect(page.locator("#mock-analysis")).toBeVisible();
});

test("the advisory countdown calmly overruns without submitting or moving the answer field", async ({ page }) => {
  await page.clock.install();
  await seedNotebook(page);
  await start(page);
  const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
  await answer.fill("An answer I am still working on.");
  const before = await answer.boundingBox();
  await page.clock.fastForward((quick.questions[0].seconds + 3) * 1000);
  await expect(page.locator("#mock-countdown")).toContainText(/Target reached.*Take your time/i);
  await expect(answer).toHaveValue("An answer I am still working on.");
  await expect(page.locator("#mock-analysis")).toHaveCount(0);
  const after = await answer.boundingBox();
  expect(after.y).toBe(before.y);
  await review(page, answerFor(quick.questions[0]));
  await expect(page.locator("#mock-analysis")).toContainText("Near the target");
});

test("remote-only speech recognition stays absent", async ({ page }) => {
  await page.addInitScript(() => {
    class RemoteRecognition { start() { throw new Error("Remote recognition must never start"); } }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: RemoteRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  });
  await seedNotebook(page);
  await start(page);
  await expect(page.getByRole("button", { name: "Use voice", exact: true })).toHaveCount(0);
});

test("available on-device speech appends text and the edited answer remains the source of truth", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    class LocalRecognition {
      static async available(options) { window.mockVoiceAvailability = options; return "available"; }
      start() { window.mockVoiceCapture = this; }
      abort() { window.mockVoiceAborted = true; }
    }
    Object.defineProperty(LocalRecognition.prototype, "processLocally", { configurable: true, writable: true, value: false });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: LocalRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  });
  await seedNotebook(page);
  await start(page);
  const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
  await answer.fill("My typed introduction.");
  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  expect(await page.evaluate(() => window.mockVoiceCapture.processLocally)).toBe(true);
  expect(await page.evaluate(() => window.mockVoiceAvailability)).toEqual({ langs: ["en-US"], processLocally: true });
  await page.getByRole("button", { name: "Stop voice", exact: true }).focus();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "Stop voice", exact: true })).toBeFocused();
  expect(await page.evaluate(() => Boolean(window.mockVoiceAborted))).toBe(false);
  const dictate = transcript => page.evaluate(text => {
    const result = [{ transcript: text }];
    result.isFinal = true;
    window.mockVoiceCapture.onresult({ resultIndex: 0, results: [result] });
  }, transcript);
  await dictate("My spoken words.");
  await expect(answer).toHaveValue("My typed introduction. My spoken words. ");
  const almostFull = `${"a".repeat(11980)} Keep this end.`;
  await answer.fill(almostFull);
  await answer.evaluate(input => input.setSelectionRange(6000, 6000));
  await dictate("More words than fit in this answer.");
  await expect(answer).toHaveValue(`${almostFull.slice(0, 6000)} More${almostFull.slice(6000)}`);
  expect((await answer.inputValue()).length).toBe(12000);
  const edited = answerFor(quick.questions[0]);
  await review(page, edited);
  expect(await page.evaluate(() => window.mockVoiceAborted)).toBe(true);
  await page.locator(".mock-answer-copy summary").click();
  await expect(page.locator(".mock-answer-copy p")).toHaveText(edited);
});
