// End-to-end tests run against the built website edition (the same files GitHub Pages serves).
import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure"
  },
  // With PW_ROUTE_FILES=1 the fixtures answer requests from _site directly (see tests/e2e/fixtures.js).
  webServer: process.env.PW_ROUTE_FILES === "1" ? undefined : {
    command: `node scripts/build-site.mjs _site && node scripts/serve.mjs _site ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI
  },
  globalSetup: "./tests/e2e/global-setup.js",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // WebKit with an iPhone 13 profile (390px wide, touch, mobile Safari user agent).
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } }
  ]
});
