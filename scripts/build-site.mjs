/*
 * Builds the browser-only website edition into _site (or the folder given as the first argument).
 *
 * It copies the frontend and switches site-mode.js to "browser", so every visitor's pages stay
 * in their own browser. GitHub Pages publishes this folder, and the end-to-end tests run against
 * the same output, so what we test is exactly what we deploy.
 */
import { cp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await realpath(path.join(root, "src", "main", "resources", "public"));
const output = path.resolve(root, process.argv[2] || "_site");

async function realDestination(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return path.join(await realDestination(path.dirname(file)), path.basename(file));
  }
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

const resolvedOutput = await realDestination(output);
if (contains(resolvedOutput, source) || contains(source, resolvedOutput)) {
  throw new Error("Build output must be separate from the website source and cannot be the project folder or an ancestor.");
}

// testing.html holds demo data and is kept out of the public site on purpose.
const excluded = new Set(["testing.html", ".DS_Store"]);

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true, filter: file => !excluded.has(path.basename(file)) });
await writeFile(path.join(output, "site-mode.js"), 'window.NOTEBOOK_STORAGE_MODE = "browser";\n');
console.log(`Built the website edition in ${path.relative(root, output) || "."}`);
