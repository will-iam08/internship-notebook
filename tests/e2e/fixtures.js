/*
 * Test fixtures. Normally the tests talk to the static server that playwright.config.js starts.
 * Set PW_ROUTE_FILES=1 to answer every request straight from the _site folder instead, for
 * machines where tests may not open a network port (for example a sandboxed shell).
 */
import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../_site");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
export const ROUTE_FILES = process.env.PW_ROUTE_FILES === "1";

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (ROUTE_FILES) {
      await context.route(`${baseURL}/**`, async route => {
        const { pathname } = new URL(route.request().url());
        const file = path.join(site, pathname.endsWith("/") ? `${pathname}index.html` : pathname);
        try {
          const body = await readFile(file);
          await route.fulfill({ status: 200, body, headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" } });
        } catch {
          await route.fulfill({ status: 404, body: "Not found" });
        }
      });
    }
    await use(context);
  }
});

export { expect };
