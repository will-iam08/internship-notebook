// Standalone marketing & onboarding landing page E2E verification.
// Covers: decoupled entry point & auth gate, exact vertical scroll order (Hero -> Features -> Signup -> Footer),
// Hero 16:9 demo video + H1/subhead character budgets, 6 value-ordered Features with annotated visuals,
// Signup validation + password strength + Sign In mode + 2-second animated redirect, responsive breakpoints
// (360px, 768px, 1024px, 1440px, 1920px), semantic landmarks, and <3MB total page weight budget.
import { expect, test } from "./fixtures.js";
import { openApp, openWelcome, savedNotebook, savedPrefs, seedNotebook, seedStarted } from "./helpers.js";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test.describe("entry gate and decoupling from notebook", () => {
  test("unauthenticated visitors always land on the standalone landing page and never load directly into #app", async ({ page }) => {
    await openWelcome(page);
    await expect(page.locator("#landing-shell")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    await expect(page).toHaveTitle(/My Internship Notebook/);

    // Attempting to navigate directly to notebook routes while unauthenticated stays gated on the landing page
    for (const hash of ["#/today", "#/board", "#/notebook", "#/insights", "#/settings"]) {
      await page.evaluate(target => { window.location.hash = target; }, hash);
      await expect(page.locator("#landing-shell")).toBeVisible();
      await expect(page.locator("#app")).toBeHidden();
    }
  });

  test("authenticated or returning visitors bypass the landing page and open their notebook directly", async ({ page }) => {
    await seedNotebook(page);
    await page.goto("/");
    await page.locator("#view .view-head").waitFor();
    await expect(page.locator("#landing-shell")).toBeHidden();
    await expect(page.locator("#app")).toBeVisible();
  });

  test("a started visitor with an empty notebook opens Today directly without seeing the landing page", async ({ page }) => {
    await seedStarted(page);
    await openApp(page, "#/today");
    await expect(page.locator("#landing-shell")).toBeHidden();
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.getByText("Every internship application, one tidy notebook.")).toBeVisible();
  });
});

test.describe("vertical scroll order and semantic landmarks", () => {
  test.beforeEach(async ({ page }) => {
    await openWelcome(page);
  });

  test("renders semantic HTML5 landmarks (header, nav, main, section, footer) and a working skip-to-content link", async ({ page }) => {
    await expect(page.locator("#landing-shell > header.landing-header")).toBeVisible();
    await expect(page.locator("#landing-shell header nav[aria-label='Landing page navigation']")).toBeVisible();
    await expect(page.locator("main#landing-main")).toBeVisible();
    await expect(page.locator("#landing-shell > footer.landing-footer")).toBeVisible();

    const skipLink = page.locator("a.skip-link");
    await expect(skipLink).toHaveAttribute("href", "#landing-main");
  });

  test("enforces exact vertical scroll order: 1. Hero -> 2. Features -> 3. Signup -> Footer", async ({ page }) => {
    const sections = await page.locator("main#landing-main > section").evaluateAll(nodes =>
      nodes.map(node => node.id)
    );
    expect(sections).toEqual(["hero", "features", "signup"]);

    // Verify Signup is immediately before Footer and vertical geometry strictly increases
    const geometry = await page.evaluate(() => {
      const hero = document.getElementById("hero").getBoundingClientRect();
      const features = document.getElementById("features").getBoundingClientRect();
      const signup = document.getElementById("signup").getBoundingClientRect();
      const footer = document.querySelector(".landing-footer").getBoundingClientRect();
      return {
        heroTop: hero.top,
        featuresTop: features.top,
        signupTop: signup.top,
        footerTop: footer.top
      };
    });

    expect(geometry.heroTop).toBeLessThan(geometry.featuresTop);
    expect(geometry.featuresTop).toBeLessThan(geometry.signupTop);
    expect(geometry.signupTop).toBeLessThan(geometry.footerTop);
  });
});

test.describe("1. Hero section", () => {
  test("fills viewport height, displays <=60 char H1 and <=180 char value prop, and embeds 16:9 autoplay muted loop video with poster", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWelcome(page);

    const hero = page.locator("#hero");
    const heroBox = await hero.boundingBox();
    // Header is 72px tall, so #hero + header fills the 900px viewport height
    expect(heroBox.height).toBeGreaterThanOrEqual(800);

    const h1 = hero.getByRole("heading", { level: 1 });
    const h1Text = (await h1.textContent()).trim();
    expect(h1Text).toBe("Every internship application, one calm notebook.");
    expect(h1Text.length).toBeLessThanOrEqual(60);

    const subheadText = (await hero.locator("#hero-sub").textContent()).trim();
    expect(subheadText.length).toBeGreaterThan(40);
    expect(subheadText.length).toBeLessThanOrEqual(180);

    const video = hero.locator("video#hero-video");
    await expect(video).toHaveAttribute("poster", "media/demo-tour-poster.jpg");
    for (const attr of ["autoplay", "muted", "loop", "playsinline"]) {
      await expect(video).toHaveAttribute(attr, "");
    }

    const sources = await video.locator("source").evaluateAll(els =>
      els.map(el => ({ src: el.getAttribute("src"), type: el.getAttribute("type") }))
    );
    expect(sources).toEqual([
      { src: "media/demo-tour.webm", type: "video/webm" },
      { src: "media/demo-tour.mp4", type: "video/mp4" }
    ]);

    // Verify 16:9 aspect ratio on the video container
    const frameBox = await hero.locator(".hero-video-viewport").boundingBox();
    const ratio = frameBox.width / frameBox.height;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(1.85);
  });

  test("falls back cleanly to the poster image if video media fails to load", async ({ page }) => {
    await page.route("**/media/demo-tour.*", route => route.fulfill({ status: 404, body: "Not found" }));
    await openWelcome(page);
    await page.locator("video#hero-video").evaluate(video => video.dispatchEvent(new Event("error")));
    await expect(page.locator("[data-hero-video-frame]")).toHaveClass(/is-failed/);
    await expect(page.locator("[data-hero-video-frame]")).toHaveCSS("background-image", /demo-tour-poster\.jpg/);
  });
});

test.describe("2. Features section", () => {
  test("presents 6 distinct features ordered by user-perceived value with title, 2-3 sentence description, icon, and annotated visual", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWelcome(page);

    const cards = page.locator("#features .feature-card");
    await expect(cards).toHaveCount(6);

    const titles = await cards.locator(".feature-title").allTextContents();
    expect(titles).toEqual([
      "One-Click Job Clipper and Paste Autofill",
      "Kanban Pipeline and Dated Stage History",
      "Universal Spreadsheet and Backup Import",
      "Role-Matched Interview Prep and Timed Mock Sessions",
      "Deadline Radar and Calendar Reminders",
      "Offline-First Notebook and Search Analytics"
    ]);

    for (let i = 0; i < 6; i++) {
      const card = cards.nth(i);
      await expect(card.locator(".feature-icon svg")).toBeVisible();
      await expect(card.locator(".feature-visual[role='img']")).toHaveAttribute("aria-label", /.+/);
      const desc = (await card.locator(".feature-description").textContent()).trim();
      const sentences = desc.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.length).toBeLessThanOrEqual(3);
    }
  });
});

test.describe("3. Signup section and authentication flow", () => {
  test.beforeEach(async ({ page }) => {
    await openWelcome(page);
  });

  test("validates required fields inline, updates live password strength, and preserves entered values on failure", async ({ page }) => {
    const nameInput = page.locator("#signup-name");
    const emailInput = page.locator("#signup-email");
    const passwordInput = page.locator("#signup-password");
    const submitBtn = page.locator("#signup-submit");

    await expect(submitBtn).toHaveText("Create Account");
    await expect(page.locator("#toggle-signin")).toHaveText("Sign In");

    // Submit invalid values and verify inline errors + value preservation
    await nameInput.fill("J");
    await emailInput.fill("not-an-email");
    await passwordInput.fill("short");
    await submitBtn.click();

    await expect(page.locator("#error-fullName")).toContainText("at least 2 characters");
    await expect(page.locator("#error-email")).toContainText("valid email address");
    await expect(page.locator("#error-password")).toContainText("at least 8 characters");

    // Entered values are preserved on failure
    await expect(nameInput).toHaveValue("J");
    await expect(emailInput).toHaveValue("not-an-email");
    await expect(passwordInput).toHaveValue("short");

    // Password strength indicator updates live as requirements are met
    await passwordInput.fill("Intern2026!Strong");
    await expect(page.locator("#password-strength-text")).toHaveText("Strong");
    await expect(page.locator("#password-strength")).toHaveAttribute("data-strength-level", "4");
    await expect(page.locator("[data-rule='length']")).toHaveClass(/is-met/);
    await expect(page.locator("[data-rule='letter']")).toHaveClass(/is-met/);
    await expect(page.locator("[data-rule='number']")).toHaveClass(/is-met/);
  });

  test("creates an account, displays animated success state, and redirects to the notebook after 2 seconds", async ({ page }) => {
    await page.locator("#signup-name").fill("Jordan Rivera");
    await page.locator("#signup-email").fill("jordan@waterloo.ca");
    await page.locator("#signup-password").fill("CoopSearch2026");

    await page.locator("#signup-submit").click();

    // Animated success state appears immediately while still on the landing page
    const successState = page.locator("#signup-success");
    await expect(successState).toBeVisible();
    await expect(successState).toHaveClass(/is-visible/);
    await expect(page.locator("#signup-success-title")).toHaveText("Account created!");
    await expect(page.locator("#signup-success-copy")).toContainText("Jordan Rivera");

    // After the 2-second delay, redirects to the notebook interface (#/today)
    await expect(page).toHaveURL(/#\/today$/, { timeout: 5000 });
    await expect(page.locator("#landing-shell")).toBeHidden();
    await expect(page.locator("#app")).toBeVisible();

    const prefs = await savedPrefs(page);
    expect(prefs.started).toBe(true);
    expect(prefs.name).toBe("Jordan Rivera");
    const notebook = await savedNotebook(page);
    expect(notebook.applications).toEqual([]);
  });

  test("supports Sign In mode for existing users and preserves values on wrong password", async ({ page }) => {
    // First register an account in storage
    await page.evaluate(() => {
      localStorage.setItem("my-internship-notebook-accounts-v1", JSON.stringify({
        "alex@stanford.edu": {
          fullName: "Alex Chen",
          email: "alex@stanford.edu",
          passwordHash: "v1:invalidhash",
          createdAt: new Date().toISOString()
        }
      }));
    });

    await page.locator("#toggle-signin").click();
    await expect(page.locator("#signup-submit")).toHaveText("Sign In");
    await expect(page.locator("#signup-name-group")).toBeHidden();

    await page.locator("#signup-email").fill("alex@stanford.edu");
    await page.locator("#signup-password").fill("WrongPass123");
    await page.locator("#signup-submit").click();

    await expect(page.locator("#signup-form-error")).toContainText("Incorrect password");
    await expect(page.locator("#signup-email")).toHaveValue("alex@stanford.edu");
    await expect(page.locator("#signup-password")).toHaveValue("WrongPass123");
  });
});

test.describe("responsive breakpoints, typography, and performance budget", () => {
  const breakpoints = [
    { width: 360, height: 780 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ];

  for (const bp of breakpoints) {
    test(`responsive layout at ${bp.width}x${bp.height}: no horizontal overflow, >=16px base font, and >=44px touch targets`, async ({ page }) => {
      await page.setViewportSize(bp);
      await openWelcome(page);

      const metrics = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const baseFontPx = parseFloat(window.getComputedStyle(document.querySelector("#landing-shell")).fontSize);
        const bodyFontPx = parseFloat(window.getComputedStyle(document.querySelector(".landing-hero-sub")).fontSize);
        return { overflow, baseFontPx, bodyFontPx };
      });

      expect(metrics.overflow, `horizontal overflow at ${bp.width}px`).toBeLessThanOrEqual(1);
      expect(metrics.baseFontPx).toBeGreaterThanOrEqual(16);
      expect(metrics.bodyFontPx).toBeGreaterThanOrEqual(16);

      const undersized = await page.locator("#landing-shell button:visible, #landing-shell a.button:visible, #landing-shell input:visible").evaluateAll(elements =>
        elements
          .filter(el => Math.round(el.getBoundingClientRect().height) < 44)
          .map(el => el.id || el.textContent.trim())
      );
      expect(undersized, `touch targets at ${bp.width}px`).toEqual([]);
    });
  }

  test("total transferred page weight is well under the 3MB performance budget with zero third-party scripts", async ({ page }) => {
    let totalBytes = 0;
    const thirdPartyScripts = [];

    page.on("response", async response => {
      try {
        const url = new URL(response.url());
        if (url.origin !== new URL(page.url() || "http://localhost").origin && response.request().resourceType() === "script") {
          thirdPartyScripts.push(response.url());
        }
        const body = await response.body().catch(() => Buffer.alloc(0));
        totalBytes += body.byteLength;
      } catch {
        // Ignore aborted responses
      }
    });

    await openWelcome(page);
    expect(thirdPartyScripts).toEqual([]);
    expect(totalBytes).toBeLessThan(3 * 1024 * 1024);
  });
});
