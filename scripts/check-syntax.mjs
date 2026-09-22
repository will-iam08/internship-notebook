/*
 * Fails if any frontend script has a syntax error. The app has no build step,
 * so this is the quickest way to catch a typo before the browser does.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folders = ["src/main/resources/public", "scripts", "tests"];

function scripts(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return scripts(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

let failed = 0;
const files = folders.map(folder => path.join(root, folder)).filter(existsSync).flatMap(scripts);
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed++;
    console.error(`Syntax error in ${path.relative(root, file)}\n${error.stderr}`);
  }
}
console.log(failed ? `${failed} file(s) failed the syntax check.` : `Syntax check passed for ${files.length} files.`);
process.exit(failed ? 1 : 0);
