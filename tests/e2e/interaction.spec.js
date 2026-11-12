// One interaction language: every clickable control has a hover and a press state, presses use
// transform-only properties (no layout shift), and reduced motion keeps colour but drops movement.
import { expect, test } from "./fixtures.js";
import { openApp, seedNotebook } from "./helpers.js";

/** The clickable selectors that must all have a press (:active) and a hover state. */
const CLICKABLE = [
  ".icon-button", ".tab", ".text-button", ".filter-chip", ".tour-tab", ".welcome-filter", ".agenda-item", ".attention-item",
  ".card-mini-button", ".toc-row", ".step", ".build-option", ".filter-select", ".goal-stepper button", ".menu button",
  ".skill-chip button", ".news-item", ".app-card", ".cover-search", ".cover-label", ".bottom-new", "summary", "a:not([class])"
];

/** Every style rule in the app's stylesheet, with the media condition it sits under (if any). */
async function styleRules(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (rules, media) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText || rule.media.mediaText);
        else if (rule instanceof CSSStyleRule) {
          out.push({
            selector: rule.selectorText, media,
            transition: rule.style.getPropertyValue("transition"),
            transitionProperty: rule.style.getPropertyValue("transition-property"),
            scale: rule.style.getPropertyValue("scale"), translate: rule.style.getPropertyValue("translate"),
            transform: rule.style.getPropertyValue("transform")
          });
        }
      }
    };
    for (const sheet of document.styleSheets) {
      if (!sheet.href?.endsWith("styles.css")) continue;
      walk(sheet.cssRules, "");
    }
    return out;
  });
}

/** True when `selectorText` names `target` as a whole selector (".tab" must not match ".tour-tab"). */
function names(selectorText, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,(])${escaped}(?![\\w-])`).test(selectorText);
}

test("every clickable selector has a press state that moves only by transform, and a hover state", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  const rules = await styleRules(page);
  const screen = rules.filter(rule => !/print/.test(rule.media) && !/prefers-reduced-motion/.test(rule.media));
  for (const target of CLICKABLE) {
    const press = screen.filter(rule => rule.selector.includes(":active") && names(rule.selector, target));
    expect(press.length, `${target} has an :active rule`).toBeGreaterThan(0);
    for (const rule of press) {
      // Only layout-free properties are declared in a press rule.
      expect(rule.scale || rule.translate || rule.transform || rule.selector.includes("a:not([class])"), `${target} press is a transform`).toBeTruthy();
    }
    const hover = screen.filter(rule => rule.selector.includes(":hover") && names(rule.selector, target));
    expect(hover.length, `${target} has a :hover rule`).toBeGreaterThan(0);
  }
  // Press transitions sit in the 150-180ms range.
  const shared = screen.find(rule => names(rule.selector, ".filter-chip") && /scale/.test(rule.transition));
  expect(shared.transition).toMatch(/scale 0?\.16s/);
  expect(shared.transition).toMatch(/translate 0?\.16s/);
  // Focus outlines stay where they were.
  expect(rules.some(rule => rule.selector === ":focus-visible")).toBe(true);
});

test("reduced motion declares no transform, translate, or scale transition", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  const reduced = (await styleRules(page)).filter(rule => /prefers-reduced-motion:\s*reduce/.test(rule.media));
  expect(reduced.length).toBeGreaterThan(0);
  for (const rule of reduced) {
    expect(`${rule.transition} ${rule.transitionProperty}`, rule.selector).not.toMatch(/\b(transform|translate|scale)\b/);
  }
  const still = reduced.find(rule => rule.selector.includes(":active") && names(rule.selector, ".toc-row"));
  expect(still?.scale).toBe("none");
  expect(still?.translate).toBe("none");
});

/** Holds the mouse down on an element and reads its computed press, plus a neighbour's position. */
async function pressAndMeasure(page, locator, neighbour) {
  const box = await locator.boundingBox();
  const before = await neighbour.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250); // let the 160ms press transition finish
  const pressed = await locator.evaluate(element => ({ scale: getComputedStyle(element).scale, translate: getComputedStyle(element).translate }));
  const during = await neighbour.boundingBox();
  await page.mouse.up();
  return { pressed, shifted: Math.abs(during.x - before.x) + Math.abs(during.y - before.y) };
}

test("pressing a control scales it down without moving anything around it", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/notebook");
  const chips = page.locator(".filter-chip");
  const chip = await pressAndMeasure(page, chips.nth(1), chips.nth(2));
  expect(chip.pressed).toEqual({ scale: "0.98", translate: "0px 1px" });
  expect(chip.shifted).toBe(0);
  // A list row, whose entrance animation holds `transform: none`, still presses.
  const rows = page.locator(".toc-row");
  const row = await pressAndMeasure(page, rows.first(), rows.nth(1));
  expect(row.pressed.scale).toBe("0.98");
  expect(row.shifted).toBe(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("pressing changes nothing's size or position", async ({ page }) => {
    await seedNotebook(page);
    await openApp(page, "#/notebook");
    const chips = page.locator(".filter-chip");
    const chip = await pressAndMeasure(page, chips.nth(1), chips.nth(2));
    expect(chip.pressed).toEqual({ scale: "none", translate: "none" });
    expect(chip.shifted).toBe(0);
  });
});

test("390px wide: no sideways scroll on the main pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedNotebook(page);
  for (const route of ["#/today", "#/board", "#/notebook", "#/insights", "#/settings", "#/export", "#/entry/3"]) {
    await openApp(page, route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(1);
  }
});
