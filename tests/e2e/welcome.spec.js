// The welcome page: a product landing page for brand-new visitors, in front of the live demo.
// Hero, an on-demand video, value cards, how it works, an optional closer look, and a final CTA.
import { expect, test } from "./fixtures.js";
import { openApp, openWelcome, seedNotebook, seedStarted } from "./helpers.js";

const VIDEO = "**/media/demo-tour.mp4";

/** Counts requests for the video and, where the engine allows it, holds them open so no load or
 *  decode error fires (Playwright's Chromium and WebKit ship without H.264). Counting uses the
 *  request event because WebKit sends media requests without passing them through page.route. */
async function watchVideo(page) {
  const seen = { requests: 0 };
  page.on("request", request => { if (request.url().endsWith("/media/demo-tour.mp4")) seen.requests++; });
  await page.route(VIDEO, () => {});
  return seen;
}

/** Opens "A closer look", where the tour and the mini interactions live. */
async function openCloserLook(page) {
  await page.locator(".welcome-closer > summary").click();
  await expect(page.locator(".welcome-closer")).toHaveAttribute("open", "");
}

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test.describe("landing", () => {
  test("a new visitor lands on #/welcome, with the demo active behind it", async ({ page }) => {
    await watchVideo(page);
    await openWelcome(page);
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page).toHaveTitle(/^Welcome · /);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = "#/board"; });
    await expect(page).toHaveURL(/#\/board$/);
    await expect(page.locator(".demo-banner")).toBeVisible();
    await expect(page.locator("#view")).toContainText("Northwind Robotics");
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

test.describe("page structure", () => {
  test.beforeEach(async ({ page }) => { await watchVideo(page); await openWelcome(page); });

  test("the sections run hero, video, value, how it works, a closer look, then the final CTA", async ({ page }) => {
    const order = await page.locator(".welcome-page > *").evaluateAll(sections => sections.map(section =>
      ["welcome-hero", "welcome-video", "welcome-values", "welcome-how", "welcome-closer", "welcome-final"]
        .find(name => section.classList.contains(name) || section.querySelector(`.${name}`)) || section.className));
    expect(order).toEqual(["welcome-hero", "welcome-video", "welcome-values", "welcome-how", "welcome-closer", "welcome-final"]);
  });

  test("the hero has one headline, one sentence, and two calls to action, with no video", async ({ page }) => {
    const hero = page.locator(".welcome-hero");
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText("Your internship search, on paper.");
    await expect(hero.locator(".welcome-sub")).toHaveText(/^[^.]+\.$/); // a single sentence
    await expect(hero.getByRole("link", { name: "Build my notebook" })).toHaveAttribute("href", "#/build");
    await expect(hero.getByRole("link", { name: "Explore the demo" })).toHaveAttribute("href", "#/today");
    await expect(hero.locator("video")).toHaveCount(0);
  });

  test("four value cards, each tied to a feature and linking into the demo", async ({ page }) => {
    const cards = page.locator(".value-card");
    await expect(cards.locator("h3")).toHaveText(["Never miss a deadline", "One page per application", "Your whole search at a glance", "Walk into interviews prepared"]);
    const links = await cards.locator("a").evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")));
    expect(links).toEqual(["#/today", "#/entry/2", "#/board", "#/entry/3"]);
    await page.getByRole("link", { name: "Try interview prep in the demo" }).click();
    await expect(page).toHaveURL(/#\/entry\/3$/);
    await expect(page.locator("#prep")).toBeVisible();
    await expect(page.locator(".entry-role")).toHaveValue("Product Design Intern");
  });

  test("how it works shows three numbered steps", async ({ page }) => {
    await expect(page.locator(".how-step h3")).toHaveText(["Tell us how you work", "We build your notebook", "Track it from Today"]);
    await expect(page.locator(".how-step .how-mock").first()).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".welcome-how a, .welcome-how button").filter({ hasNotText: /Build my notebook|Explore the demo/ })).toHaveCount(0);
  });

  test("the closer look starts folded away and holds the tour and the mini interactions", async ({ page }) => {
    const closer = page.locator(".welcome-closer");
    await expect(closer).not.toHaveAttribute("open", "");
    await expect(page.getByRole("tablist", { name: "Product tour" })).toBeHidden();
    await openCloserLook(page);
    await expect(page.getByRole("tablist", { name: "Product tour" })).toBeVisible();
    await expect(closer.locator(".welcome-board")).toBeVisible();
    await expect(closer.locator(".welcome-chaos")).toBeVisible();
  });

  test("the final band repeats the main call to action with the trust line", async ({ page }) => {
    const final = page.locator(".welcome-final");
    await expect(final.getByRole("link", { name: "Build my notebook" })).toHaveAttribute("href", "#/build");
    await expect(final).toContainText("No sign-up needed. Private to your browser.");
  });
});

test.describe("video", () => {
  test("shows the poster and a play button, and loads nothing until played", async ({ page }) => {
    const seen = await watchVideo(page);
    await openWelcome(page);
    const video = page.locator("video.tour-video");
    await expect(video).toHaveAttribute("poster", "media/demo-tour-poster.jpg");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).not.toHaveAttribute("src");
    await expect(video).not.toHaveAttribute("autoplay");
    for (const attribute of ["muted", "loop", "playsinline"]) await expect(video).toHaveAttribute(attribute, "");
    await expect(page.locator(".tour-video-toggle")).toHaveAttribute("aria-label", "Play the tour video");
    await expect(page.locator(".video-chapters li")).toHaveText(["Today", "The Board", "An application page", "Insights"]);
    await page.waitForTimeout(500);
    expect(seen.requests).toBe(0);
    const poster = await page.evaluate(async () => {
      const response = await fetch("media/demo-tour-poster.jpg");
      return { status: response.status, type: response.headers.get("content-type") };
    });
    expect(poster).toMatchObject({ status: 200, type: expect.stringContaining("image/jpeg") });
  });

  test("pressing play loads the clip and the button switches between play and pause", async ({ page }) => {
    const seen = await watchVideo(page);
    await openWelcome(page);
    // Stand in for playback (no codec dependence): play()/pause() fire the media events the button
    // follows. The real load still runs, so the request below is real. WebKit's media request can't
    // be held open, and with no H.264 in the test browser it ends in a decode error that a real
    // Safari would not raise; stop only that error before the app sees it.
    await page.evaluate(() => {
      window.addEventListener("error", event => { if (event.target?.matches?.("video.tour-video")) event.stopImmediatePropagation(); }, true);
      const video = document.querySelector("video.tour-video");
      let paused = true;
      Object.defineProperty(video, "paused", { get: () => paused });
      video.play = () => { paused = false; video.dispatchEvent(new Event("play")); return Promise.resolve(); };
      video.pause = () => { paused = true; video.dispatchEvent(new Event("pause")); };
    });
    const toggle = page.locator(".tour-video-toggle");
    await toggle.click();
    await expect(page.locator("video.tour-video")).toHaveAttribute("src", "media/demo-tour.mp4");
    await expect.poll(() => seen.requests).toBeGreaterThan(0);
    await expect(toggle).toHaveAttribute("aria-label", "Pause the tour video");
    await expect(page.locator("[data-video-frame]")).toHaveClass(/is-playing/);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Play the tour video");
  });

  test("if the clip cannot load, the poster and caption still stand", async ({ page }) => {
    await page.route(VIDEO, route => route.fulfill({ status: 404, body: "Not found" }));
    await openWelcome(page);
    await page.locator(".tour-video-toggle").click();
    await expect(page.locator("[data-video-frame]")).toHaveClass(/is-failed/);
    await expect(page.locator(".tour-video-toggle")).toBeHidden();
    await expect(page.locator(".welcome-video-figure figcaption")).toBeVisible();
    await expect(page.locator("[data-video-frame]")).toHaveCSS("background-image", /demo-tour-poster\.jpg/);
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("nothing plays on its own", async ({ page }) => {
      const seen = await watchVideo(page);
      await openWelcome(page);
      expect(await page.locator("video.tour-video").evaluate(element => element.paused)).toBe(true);
      await expect(page.locator(".tour-video-toggle")).toBeVisible();
      expect(seen.requests).toBe(0);
    });
  });
});

test.describe("a closer look: the tour", () => {
  test.beforeEach(async ({ page }) => {
    await watchVideo(page);
    await openWelcome(page);
    await openCloserLook(page);
  });

  test("tour tabs switch the preview and its caption", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "Product tour" });
    await expect(tablist.getByRole("tab")).toHaveText(["Today", "Board", "All pages", "Insights"]);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await tablist.getByRole("tab", { name: "Board" }).click();
    await expect(tablist.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tour-panel-board")).toBeVisible();
    await expect(page.locator("#tour-panel-today")).toBeHidden();
    await expect(page.getByRole("tabpanel")).toContainText("by stage");
    await expect(page.locator("#tour-panel-board .mock-column")).toHaveCount(4);
    // The shown preview's own sidebar marks the same page.
    await expect(page.locator('#tour-panel-board .mock-nav[aria-current="page"]')).toHaveAttribute("data-tab", "board");
  });

  test("the preview's sidebar switches the tour like the tabs, and keeps focus", async ({ page }) => {
    const today = page.locator("#tour-panel-today");
    await expect(today.locator('.mock-nav[aria-current="page"]')).toHaveAttribute("data-tab", "today");
    await today.getByRole("button", { name: "Show the Insights preview" }).click();
    await expect(page.getByRole("tab", { name: "Insights" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tour-panel-insights")).toBeVisible();
    await expect(today).toBeHidden();
    const current = page.locator('#tour-panel-insights .mock-nav[aria-current="page"]');
    await expect(current).toHaveAttribute("data-tab", "insights");
    await expect(current).toBeFocused();
    // From the keyboard too.
    await page.locator("#tour-panel-insights").getByRole("button", { name: "Show the All pages preview" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "All pages" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('#tour-panel-notebook .mock-nav[aria-current="page"]')).toBeFocused();
  });

  test("tour tabs follow the ARIA pattern: arrows, Home, End, a roving tab stop, then into the panel", async ({ page, browserName }) => {
    const tab = name => page.getByRole("tab", { name, exact: true });
    await tab("Today").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Board")).toBeFocused();
    await expect(tab("Board")).toHaveAttribute("aria-selected", "true");
    await expect(tab("Board")).toHaveAttribute("tabindex", "0");
    await expect(tab("Today")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("End");
    await expect(tab("Insights")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Today")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab("Today")).toBeFocused();
    // Tab leaves the tablist for the first control in the panel: the preview's sidebar.
    // WebKit, like Safari by default, moves Tab only between fields; Option+Tab reaches buttons too.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(page.locator('#tour-panel-today .mock-nav[data-tab="today"]')).toBeFocused();
  });

  test("cards and rows in each preview open that page in the demo", async ({ page }) => {
    const targets = [
      ["today", /^Open Today in the demo: /, /#\/today$/],
      ["board", /^Open the Board in the demo: /, /#\/board$/],
      ["notebook", /^Open All pages in the demo: /, /#\/notebook$/],
      ["insights", /^Open Insights in the demo: /, /#\/insights$/]
    ];
    for (const [key, name, url] of targets) {
      await page.goto("/#/welcome");
      await page.locator(".welcome-page").waitFor();
      if (!(await page.locator(".welcome-closer").getAttribute("open") !== null)) await openCloserLook(page);
      await page.locator(`.tour-tab[data-tab="${key}"]`).click();
      const link = page.locator(`#tour-panel-${key}`).getByRole("link", { name }).first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.locator(".demo-banner")).toBeVisible(); // the demo, not a real notebook
    }
  });

  test("each panel has an 'Open this view in the demo' link, and links work from the keyboard", async ({ page }) => {
    for (const key of ["today", "board", "notebook", "insights"]) {
      await page.locator(`.tour-tab[data-tab="${key}"]`).click();
      await expect(page.locator(`#tour-panel-${key}`).getByRole("link", { name: "Open this view in the demo" }))
        .toHaveAttribute("href", { today: "#/today", board: "#/board", notebook: "#/notebook", insights: "#/insights" }[key]);
    }
    await page.locator('#tour-panel-insights').getByRole("link", { name: "Open this view in the demo" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/insights$/);
  });

  test("no control in a preview sits inside another button or link", async ({ page }) => {
    const nested = await page.locator(".welcome-tour").evaluate(root =>
      [...root.querySelectorAll("a, button")].filter(element => element.parentElement.closest("a, button")).length);
    expect(nested).toBe(0);
    expect(await page.locator(".welcome-tour [aria-hidden='true'] a, .welcome-tour [aria-hidden='true'] button").count()).toBe(0);
  });

  test("stage chips filter the mini board and update the count", async ({ page }) => {
    const board = page.locator(".welcome-board");
    const cards = board.locator(".welcome-card:visible");
    const chip = name => board.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(cards).toHaveCount(4);
    await chip("Interview").click();
    await expect(cards).toHaveCount(2);
    await expect(board.locator("[data-welcome-count]")).toHaveText("2");
    await chip("Saved").click();
    await expect(cards).toHaveCount(1);
    await chip("All").focus();
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(4);
  });

  test("the Chaos/Notebook toggle sorts the scraps and back", async ({ page }) => {
    const chaos = page.locator(".welcome-chaos");
    const stage = chaos.locator("[data-chaos]");
    await chaos.getByRole("button", { name: "Notebook" }).click();
    await expect(stage).toHaveClass(/is-organized/);
    await expect(chaos.locator("[data-chaos-caption]")).toContainText("After:");
    await chaos.getByRole("button", { name: "Chaos" }).focus();
    await page.keyboard.press("Space");
    await expect(stage).not.toHaveClass(/is-organized/);
  });

  test("choices and the open closer look survive leaving and coming back", async ({ page }) => {
    await page.getByRole("tab", { name: "Insights" }).click();
    await page.locator(".welcome-board").getByRole("button", { name: /^Applied/ }).click();
    await page.locator(".welcome-hero").getByRole("link", { name: "Explore the demo" }).click();
    await expect(page).toHaveURL(/#\/today$/);
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.locator(".welcome-closer")).toHaveAttribute("open", "");
    await expect(page.locator("#tour-panel-insights")).toBeVisible();
    await expect(page.locator(".welcome-card:visible")).toHaveCount(1);
  });
});

test.describe("calls to action", () => {
  test.beforeEach(async ({ page }) => { await watchVideo(page); await openWelcome(page); });

  test("Explore the demo opens the demo on Today, with Build my notebook in its banner", async ({ page }) => {
    await page.locator(".welcome-hero").getByRole("link", { name: "Explore the demo" }).click();
    await expect(page).toHaveURL(/#\/today$/);
    const banner = page.locator(".demo-banner");
    await expect(banner.getByRole("button", { name: "Build my notebook" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "#/signup");
    await banner.getByRole("button", { name: "Build my notebook" }).click();
    await expect(page).toHaveURL(/#\/build$/);
  });

  test("every Build my notebook opens the builder, with the demo still running behind it", async ({ page }) => {
    for (const scope of [".welcome-hero", ".welcome-how", ".welcome-final"]) {
      await page.goto("/#/welcome");
      await page.locator(".welcome-page").waitFor();
      await page.locator(scope).getByRole("link", { name: "Build my notebook" }).click();
      await expect(page).toHaveURL(/#\/build$/);
      await expect(page.locator("#build-form")).toBeVisible();
      await expect(page.getByRole("link", { name: "Not now, back to the demo" })).toBeVisible();
    }
  });
});

test.describe("layout", () => {
  for (const colorScheme of ["light", "dark"]) {
    test(`390px ${colorScheme}: no sideways scroll and 44px targets, with the closer look open`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme });
      await watchVideo(page);
      await openWelcome(page);
      await openCloserLook(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      for (const key of ["today", "board", "notebook", "insights"]) {
        await page.locator(`.tour-tab[data-tab="${key}"]`).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), key).toBeLessThanOrEqual(1);
      }
      // Rounded: WebKit reports a 44px box at a fractional offset as 43.9999px.
      const small = await page.locator(".welcome-page button:visible, .welcome-page a:visible, .welcome-page summary:visible").evaluateAll(elements =>
        elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.getAttribute("aria-label") || element.textContent.trim()));
      expect(small).toEqual([]);
    });
  }
});
