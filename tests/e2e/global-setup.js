// Builds the website edition once before the tests, so they always run against fresh files.
import { execFileSync } from "node:child_process";

export default function globalSetup() {
  execFileSync(process.execPath, ["scripts/build-site.mjs", "_site"], { stdio: "inherit" });
}
