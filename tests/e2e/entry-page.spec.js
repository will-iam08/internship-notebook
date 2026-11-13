// The application page: grouped layout, stage history rules, the single toast slot, date fields,
// and contrast in both themes.
import { expect, test } from "./fixtures.js";
import { openApp, sampleApplications, savedNotebook, seedNotebook } from "./helpers.js";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

const step = (page, name) => page.locator(".step", { hasText: name });
const history = async (page, id) => (await savedNotebook(page)).applications.find(entry => entry.id === id).history;

test("rapid stage clicks record exactly one history entry per real change", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/1"); // Northwind Labs, Saved
  for (const name of ["Applied", "Saved", "Applied", "Applied", "Applied"]) await step(page, name).click({ noWaitAfter: true });
  await expect.poll(async () => (await history(page, 1)).map(change => change.status)).toEqual(["SAVED", "APPLIED", "SAVED", "APPLIED"]);
  await expect(page.locator(".timeline li")).toHaveCount(4);
  await expect(page.locator(".timeline li strong")).toHaveText(["Moved to Applied", "Moved to Saved", "Moved to Applied", "Added as Saved"]);
  await expect(page.locator(".timeline time").first()).toHaveText("just now");
  // Clicking the current stage again is a no-op: no save, no history, no toast.
  const before = (await savedNotebook(page)).applications.find(entry => entry.id === 1).updatedAt;
  await page.locator("#toasts .toast").evaluate(element => element.remove());
  await step(page, "Applied").click();
  await page.waitForTimeout(300);
  expect((await savedNotebook(page)).applications.find(entry => entry.id === 1).updatedAt).toBe(before);
  expect(await history(page, 1)).toHaveLength(4);
  await expect(page.locator("#toasts .toast")).toHaveCount(0);
});

test("older pages with repeated history entries show a collapsed timeline", async ({ page }) => {
  const [first] = sampleApplications();
  const at = minute => `2026-03-01T12:0${minute}:00.000Z`;
  await seedNotebook(page, [{ ...first, status: "APPLIED", history: [
    { status: "SAVED", at: at(0) }, { status: "APPLIED", at: at(1) }, { status: "APPLIED", at: at(2) }, { status: "APPLIED", at: at(3) }
  ] }]);
  await openApp(page, "#/entry/1");
  await expect(page.locator(".timeline li strong")).toHaveText(["Moved to Applied", "Added as Saved"]);
});

test("only one toast is ever visible, it replaces the last one, and it pauses while hovered", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/1");
  await step(page, "Applied").click();
  await step(page, "Interview").click();
  await step(page, "Offer").click();
  const toasts = page.locator("#toasts .toast:not(.leaving)");
  await expect(toasts).toHaveCount(1);
  await expect(toasts).toContainText("Moved to Offer");
  await expect(toasts.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.locator("#toasts")).toHaveAttribute("aria-live", "polite");
  // Hovering holds it past its 6-second time; leaving lets it go.
  await toasts.hover();
  await page.waitForTimeout(6600);
  await expect(toasts).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(page.locator("#toasts .toast")).toHaveCount(0, { timeout: 8000 });
  // Undo inside the toast still works.
  await step(page, "Applied").click();
  await page.locator("#toasts .toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await savedNotebook(page)).applications.find(entry => entry.id === 1).status).toBe("OFFER");
});

test("on a laptop the toast sits in the bottom-right corner, beside the page", async ({ page }) => {
  test.skip(page.viewportSize().width < 1024, "desktop layout");
  await seedNotebook(page);
  await openApp(page, "#/entry/1");
  await step(page, "Applied").click();
  const box = await page.locator("#toasts .toast").boundingBox();
  const viewport = page.viewportSize();
  expect(viewport.width - (box.x + box.width)).toBeLessThanOrEqual(32);
  expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(32);
});

test("Mark rejected lives in the More menu, and a rejected page offers to reopen", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/2"); // Maple Robotics, Applied
  await expect(page.getByRole("button", { name: "Mark rejected" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Mark rejected" }).click();
  await expect.poll(async () => (await savedNotebook(page)).applications.find(entry => entry.id === 2).status).toBe("REJECTED");
  await expect(page.locator(".entry-rejected")).toContainText("This application was rejected.");
  await page.getByRole("button", { name: "Reopen as Applied" }).click();
  await expect.poll(async () => (await savedNotebook(page)).applications.find(entry => entry.id === 2).status).toBe("APPLIED");
  await expect(page.locator(".entry-rejected")).toHaveCount(0);
});

test("the page is grouped into the role, dates, and notes, with the timeline beside or below", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  await expect(page.locator(".entry-group h2")).toHaveText(["The role", "Dates", "Notes"]);
  const role = page.locator(".entry-group").nth(0);
  for (const label of ["Location", "Found on", "Job posting", "Contact"]) await expect(role.getByText(label, { exact: true })).toBeVisible();
  const dates = page.locator(".entry-group").nth(1);
  for (const label of ["Deadline", "Next step date", "Next step"]) await expect(dates.getByText(label, { exact: true })).toBeVisible();
  await expect(page.locator(".entry-group").nth(2).locator("#entry-notes")).toBeVisible();
  const main = await page.locator(".entry-main").boundingBox();
  const rail = await page.locator(".entry-rail").boundingBox();
  if (page.viewportSize().width >= 900) expect(rail.x).toBeGreaterThan(main.x + main.width - 1); // beside
  else expect(rail.y).toBeGreaterThanOrEqual(main.y + main.height - 1); // below
});

test("date fields show a placeholder when empty, a clear button when set, and clearing saves", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/1"); // has a deadline, no next-step date
  const deadline = page.locator(".date-field").filter({ has: page.locator("#entry-deadline") });
  const nextDate = page.locator(".date-field").filter({ has: page.locator("#entry-nextStepDate") });
  await expect(page.locator(".entry").getByLabel("Deadline", { exact: true })).toHaveAttribute("type", "date");
  await expect(nextDate.locator(".date-placeholder")).toBeVisible();
  await expect(nextDate.locator(".date-placeholder")).toHaveText("Set a date");
  await expect(nextDate.getByRole("button", { name: "Clear next step date" })).toBeHidden();
  await expect(deadline.locator(".date-placeholder")).toBeHidden();
  const clear = deadline.getByRole("button", { name: "Clear deadline" });
  await expect(clear).toBeVisible();
  expect(Math.round((await clear.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect(page.locator("#entry-deadline")).toHaveValue("");
  await expect(page.locator("#entry-deadline")).toBeFocused();
  await expect.poll(async () => (await savedNotebook(page)).applications.find(entry => entry.id === 1).deadline).toBe("");
  await page.locator("#entry-nextStepDate").fill("2026-12-01");
  await page.locator("#entry-nextStepDate").press("Tab");
  await expect(nextDate).toHaveClass(/has-value/);
  await expect.poll(async () => (await savedNotebook(page)).applications.find(entry => entry.id === 1).nextStepDate).toBe("2026-12-01");
});

/** WCAG contrast of an element's text against the nearest opaque background behind it. */
async function contrast(locator) {
  return locator.evaluate(element => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const [R, G, B] = [r, g, b].map(c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      return .2126 * R + .7152 * G + .0722 * B;
    };
    let node = element;
    let bg = [255, 255, 255];
    while (node) {
      const value = rgb(getComputedStyle(node).backgroundColor);
      if (value.length >= 3 && (value[3] === undefined || value[3] === 1)) { bg = value; break; }
      node = node.parentElement;
    }
    const [a, b] = [lum(rgb(getComputedStyle(element).color)), lum(bg)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  });
}

for (const colorScheme of ["light", "dark"]) {
  for (const width of [1280, 390]) {
    test(`${colorScheme} at ${width}px: AA labels and placeholders, no sideways scroll, styled dates`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await seedNotebook(page);
      await openApp(page, "#/entry/1");
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      for (const selector of [".line-field > span", ".line-label", ".entry-group > .section-label", ".field-caption", ".date-placeholder", ".timeline time"]) {
        const ratio = await contrast(page.locator(selector).first());
        expect(ratio, `${selector} contrast in ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
      }
      // Placeholder text (--faint) on the paper card, measured from the theme's own tokens.
      const faintOnCard = await page.locator(".sheet-page").evaluate(card => {
        const probe = document.createElement("span");
        probe.style.color = "var(--faint)";
        card.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return { color, background: getComputedStyle(card).backgroundColor };
      });
      const probeRatio = await page.evaluate(({ color, background }) => {
        const rgb = value => value.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map(c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
          .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        const [a, b] = [lum(rgb(color)), lum(rgb(background))].sort((x, y) => y - x);
        return (a + .05) / (b + .05);
      }, faintOnCard);
      expect(probeRatio, `placeholder contrast in ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
      // The native date picker follows the theme.
      expect(await page.locator("#entry-deadline").evaluate(element => getComputedStyle(element).colorScheme)).toContain(colorScheme);
      const small = await page.locator(".entry .step:visible, .entry .icon-button:visible, .entry .back:visible")
        .evaluateAll(elements => elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.outerHTML.slice(0, 60)));
      expect(small).toEqual([]);
    });
  }
}
