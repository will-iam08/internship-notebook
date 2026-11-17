/*
 * Builds the browser extension into _extension/ (load this folder unpacked in Chrome, Edge or
 * Firefox) and packs it as _extension.zip for the Chrome Web Store and Firefox Add-ons.
 *
 * The extension reads job pages with the notebook's own job clipper, so instead of keeping a
 * second copy in extension/, this copies js/clipper.js and js/domain.js into _extension/lib/.
 * See docs/browser-extension.md.
 */
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const output = path.join(root, "_extension");
const zipFile = path.join(root, "_extension.zip");
const notebookJs = path.join(root, "src", "main", "resources", "public", "js");

await rm(output, { recursive: true, force: true });
await rm(zipFile, { force: true });
await cp(source, output, { recursive: true, filter: file => path.basename(file) !== ".DS_Store" });
for (const module of ["clipper.js", "domain.js"]) {
  await cp(path.join(notebookJs, module), path.join(output, "lib", module));
}

// manifest.json is the one place the version lives; parsing it here stops a broken file being packed.
const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

try {
  // -X leaves out macOS extra attributes; the stores want manifest.json at the top of the zip.
  execFileSync("zip", ["-r", "-X", "-q", zipFile, "."], { cwd: output });
  console.log(`Built the extension ${manifest.version} in _extension/ and _extension.zip`);
} catch {
  console.log(`Built the extension ${manifest.version} in _extension/ (zip was not available, so no _extension.zip)`);
}
