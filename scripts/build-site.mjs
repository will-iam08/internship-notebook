/*
 * Builds the browser-only website edition into _site (or the folder given as the first argument).
 *
 * It copies the frontend and switches site-mode.js to "browser", so every visitor's pages stay
 * in their own browser. GitHub Pages publishes this folder, and the end-to-end tests run against
 * the same output, so what we test is exactly what we deploy.
 */
import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "main", "resources", "public");
const output = path.resolve(root, process.argv[2] || "_site");

// testing.html holds demo data and is kept out of the public site on purpose.
const excluded = new Set(["testing.html", ".DS_Store"]);

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true, filter: file => !excluded.has(path.basename(file)) });
await writeFile(path.join(output, "site-mode.js"), 'window.NOTEBOOK_STORAGE_MODE = "browser";\n');
console.log(`Built the website edition in ${path.relative(root, output) || "."}`);
