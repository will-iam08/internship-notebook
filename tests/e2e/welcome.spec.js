// The welcome page: a brand-new visitor's front door, rendered in front of the live demo.
import { expect, test } from "./fixtures.js";
import { openApp, openWelcome, seedNotebook, seedStarted } from "./helpers.js";

const VIDEO = "**/media/demo-tour.mp4";

/** Holds the video request open so no load or decode error fires. Playwright's Chromium ships
 *  without H.264, so a real fetch would trip the "video failed" fallback in some browsers. */
async function parkVideo(page) {
  await page.route(VIDEO, () => {});
}

test.describe("landing", () => {
  test("a new visitor lands on #/welcome, with the demo active behind it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await parkVideo(page);
    await openWelcome(page);
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page).toHaveTitle(/^Welcome · /);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your internship search, on paper.");
    await expect(page.getByText("No sign-up needed. Private to your browser.")).toBeVisible();
    // The welcome page carries its own calls to action, so the demo banner is not stacked on top.
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    // Demo_Mode is on behind it: Board shows the demo notebook with its banner.
    // In-page hash navigation, as the nav does (page.goto would also wait on the parked video).
    await page.evaluate(() => { window.location.hash = "#/board"; });
    await expect(page).toHaveURL(/#\/board$/);
    await expect(page.locator(".demo-banner")).toBeVisible();
    await expect(page.locator("#view")).toContainText("Northwind Robotics");
    expect(errors).toEqual([]);
  });

  test("a deep link is respected: a new visitor opening #/board stays on the board", async ({ page }) => {
    await openApp(page, "#/board");
    await expect(page).toHaveURL(/#\/board$/);
    await expect(page.locator(".welcome-page")).toHaveCount(0);
    await expect(page.locator(".demo-banner")).toBeVisible();
  });

  test("returning visitors never see the welcome page, even when they ask for it", async ({ page }) => {
    await seedNotebook(page);
    await page.goto("/");
    await page.locator("#view .view-head").waitFor();
    await expect(page.locator(".welcome-page")).toHaveCount(0);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await page.goto("/#/welcome");
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.locator(".welcome-page")).toHaveCount(0);
  });

  test("a started visitor with an empty notebook is not sent to the welcome page", async ({ page }) => {
    await seedStarted(page);
    await openApp(page, "#/welcome");
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.getByText("Every internship application, one tidy notebook.")).toBeVisible();
  });
});

test.describe("tour video", () => {
  test("the video is muted, looping, inline, autoplaying, and has the poster", async ({ page }) => {
    await parkVideo(page);
    await openWelcome(page);
    const video = page.locator("video.tour-video");
    await expect(video).toHaveAttribute("poster", "media/demo-tour-poster.jpg");
    await expect(video).toHaveAttribute("src", "media/demo-tour.mp4");
    await expect(video).toHaveAttribute("aria-label", /.+/);
    for (const attribute of ["muted", "loop", "playsinline", "autoplay"]) await expect(video).toHaveAttribute(attribute, "");
    await expect(page.locator(".welcome-video figcaption")).toContainText("18-second tour");
    // The poster really is served, as a JPEG.
    const poster = await page.evaluate(async () => {
      const response = await fetch("media/demo-tour-poster.jpg");
      return { status: response.status, type: response.headers.get("content-type") };
    });
    expect(poster.status).toBe(200);
    expect(poster.type).toContain("image/jpeg");
  });

  test("the custom button plays and pauses the video and says which it will do", async ({ page }) => {
    await parkVideo(page);
    await openWelcome(page);
    // Stand in for real playback (no codec dependence): play()/pause() flip `paused` and fire the
    // same media events a real video does, which is what the button listens to.
    await page.evaluate(() => {
      const video = document.querySelector("video.tour-video");
      let paused = true;
      Object.defineProperty(video, "paused", { get: () => paused });
      video.play = () => { paused = false; video.dispatchEvent(new Event("play")); return Promise.resolve(); };
      video.pause = () => { paused = true; video.dispatchEvent(new Event("pause")); };
      video.pause();
    });
    const toggle = page.locator(".tour-video-toggle");
    await expect(toggle).toHaveAttribute("aria-label", "Play the tour video");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Pause the tour video");
    await expect(page.locator("[data-video-frame]")).toHaveClass(/is-playing/);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Play the tour video");
    await expect(page.locator("[data-video-frame]")).not.toHaveClass(/is-playing/);
  });

  test("if the video cannot load, the poster frame and caption still stand", async ({ page }) => {
    await page.route(VIDEO, route => route.fulfill({ status: 404, body: "Not found" }));
    await openWelcome(page);
    await expect(page.locator("[data-video-frame]")).toHaveClass(/is-failed/);
    await expect(page.locator(".tour-video-toggle")).toBeHidden();
    await expect(page.locator(".welcome-video figcaption")).toBeVisible();
    await expect(page.locator("[data-video-frame]")).toHaveCSS("background-image", /demo-tour-poster\.jpg/);
  });
});

test.describe("tour video with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows the poster and a play button instead of autoplaying", async ({ page }) => {
    await parkVideo(page);
    await openWelcome(page);
    const video = page.locator("video.tour-video");
    await expect(video).not.toHaveAttribute("autoplay");
    await expect(video).toHaveAttribute("poster", "media/demo-tour-poster.jpg");
    expect(await video.evaluate(element => element.paused)).toBe(true);
    await expect(page.locator(".tour-video-toggle")).toBeVisible();
    await expect(page.locator(".tour-video-toggle")).toHaveAttribute("aria-label", "Play the tour video");
    await expect(page.locator("[data-video-frame]")).not.toHaveClass(/is-playing/);
  });
});

test.describe("interactive tour", () => {
  test.beforeEach(async ({ page }) => {
    await parkVideo(page);
    await openWelcome(page);
  });

  test("tour tabs switch the framed preview and its caption", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "Product tour" });
    await expect(tablist.getByRole("tab")).toHaveText(["Today", "Board", "All pages", "Insights"]);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.locator("#tour-panel-today")).toBeVisible();
    await expect(page.locator("#tour-panel-today .tour-caption")).toContainText("weekly goal");

    await tablist.getByRole("tab", { name: "Board" }).click();
    await expect(tablist.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
    await expect(tablist.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#tour-panel-board")).toBeVisible();
    await expect(page.locator("#tour-panel-today")).toBeHidden();
    await expect(page.getByRole("tabpanel")).toContainText("by stage");
    // The preview is built from the demo dataset in HTML, not a screenshot.
    await expect(page.locator("#tour-panel-board .mock-column")).toHaveCount(4);
    await expect(page.locator("#tour-panel-board .mock")).toHaveAttribute("role", "img");

    await tablist.getByRole("tab", { name: "Insights" }).click();
    await expect(page.locator("#tour-panel-insights")).toBeVisible();
    await expect(page.getByRole("tabpanel")).toContainText("response rates");
  });

  test("tour tabs follow the ARIA pattern: arrows, Home, End, and a roving tab stop", async ({ page }) => {
    const tab = name => page.getByRole("tab", { name, exact: true });
    await tab("Today").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Board")).toBeFocused();
    await expect(tab("Board")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tour-panel-board")).toBeVisible();
    // Only the selected tab is in the Tab order.
    await expect(tab("Board")).toHaveAttribute("tabindex", "0");
    await expect(tab("Today")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("End");
    await expect(tab("Insights")).toBeFocused();
    await page.keyboard.press("ArrowRight"); // wraps around
    await expect(tab("Today")).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // and back
    await expect(tab("Insights")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab("Today")).toBeFocused();
    await expect(page.locator("#tour-panel-today")).toBeVisible();
    // Tab moves on from the tablist into the panel, not to the next tab.
    await page.keyboard.press("Tab");
    await expect(page.locator("#tour-panel-today")).toBeFocused();
  });

  test("stage chips filter the mini board and update the count", async ({ page }) => {
    const board = page.locator(".welcome-board");
    const cards = board.locator(".welcome-card:visible");
    const chip = name => board.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(cards).toHaveCount(4);
    await expect(chip("All")).toHaveAttribute("aria-pressed", "true");

    await chip("Interview").click();
    await expect(chip("Interview")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    await expect(cards).toHaveCount(2);
    await expect(board.locator("[data-welcome-count]")).toHaveText("2");
    await expect(cards.first()).toContainText("Interview");

    await chip("Saved").click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Northwind Robotics");
    await expect(board.locator(".welcome-count")).toHaveText("Showing 1 of 4 applications");

    // Keyboard works too: the chips are real buttons.
    await chip("All").focus();
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(4);
  });

  test("the Chaos/Notebook toggle sorts the scraps into board columns and back", async ({ page }) => {
    const chaos = page.locator(".welcome-chaos");
    const stage = chaos.locator("[data-chaos]");
    await expect(stage).not.toHaveClass(/is-organized/);
    await expect(chaos.getByRole("button", { name: "Chaos" })).toHaveAttribute("aria-pressed", "true");
    await expect(chaos.locator("[data-chaos-caption]")).toContainText("Before:");

    await chaos.getByRole("button", { name: "Notebook" }).click();
    await expect(stage).toHaveClass(/is-organized/);
    await expect(chaos.getByRole("button", { name: "Notebook" })).toHaveAttribute("aria-pressed", "true");
    await expect(chaos.getByRole("button", { name: "Chaos" })).toHaveAttribute("aria-pressed", "false");
    await expect(chaos.locator("[data-chaos-caption]")).toContainText("After:");

    await chaos.getByRole("button", { name: "Chaos" }).focus();
    await page.keyboard.press("Space");
    await expect(stage).not.toHaveClass(/is-organized/);
  });

  test("choices survive a re-render, such as returning to the page", async ({ page }) => {
    await page.getByRole("tab", { name: "Insights" }).click();
    await page.locator(".welcome-board").getByRole("button", { name: /^Applied/ }).click();
    await page.locator(".welcome-chaos").getByRole("button", { name: "Notebook" }).click();
    await page.getByRole("link", { name: "Explore the demo", exact: true }).click();
    await expect(page).toHaveURL(/#\/today$/);
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.locator("#tour-panel-insights")).toBeVisible();
    await expect(page.locator(".welcome-card:visible")).toHaveCount(1);
    await expect(page.locator("[data-chaos]")).toHaveClass(/is-organized/);
  });
});

test.describe("calls to action", () => {
  test.beforeEach(async ({ page }) => {
    await parkVideo(page);
    await openWelcome(page);
  });

  test("Explore the demo opens the interactive demo on Today", async ({ page }) => {
    await page.getByRole("link", { name: "Explore the demo", exact: true }).click();
    await expect(page).toHaveURL(/#\/today$/);
    const banner = page.locator(".demo-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Build my notebook" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "#/signup");
  });

  test("Build my notebook leaves the demo for guided setup", async ({ page }) => {
    await page.getByRole("button", { name: "Build my notebook" }).first().click();
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page.locator(".setup-card")).toBeVisible();
    await expect(page.locator(".demo-banner")).toHaveCount(0);
  });

  test("the closing Build my notebook button goes to setup too", async ({ page }) => {
    await page.locator(".welcome-final").getByRole("button", { name: "Build my notebook" }).click();
    await expect(page).toHaveURL(/#\/setup$/);
  });

  test("the demo banner's Build my notebook goes to setup", async ({ page }) => {
    await page.getByRole("link", { name: "Explore the demo", exact: true }).click();
    await page.locator(".demo-banner").getByRole("button", { name: "Build my notebook" }).click();
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
  });
});

test.describe("layout", () => {
  test("390px wide: no sideways scroll and 44px touch targets on every control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await parkVideo(page);
    await openWelcome(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Rounded: WebKit reports a 44px box at a fractional offset as 43.9999px.
    const small = await page.locator(".welcome-page button:visible, .welcome-page a:visible").evaluateAll(elements =>
      elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.textContent.trim()));
    expect(small).toEqual([]);
  });

  test("dark mode renders the welcome page without errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "dark" });
    await parkVideo(page);
    await openWelcome(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
