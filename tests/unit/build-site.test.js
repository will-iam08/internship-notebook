import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("build rejects destructive destinations and their symlink aliases before deleting anything", async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "notebook-build-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "project");
  const source = path.join(project, "src/main/resources/public");
  await mkdir(source, { recursive: true });
  await mkdir(path.join(project, "scripts"));
  const script = path.join(project, "scripts/build-site.mjs");
  await cp(new URL("../../scripts/build-site.mjs", import.meta.url), script);
  await writeFile(path.join(source, "index.html"), "keep source");
  await writeFile(path.join(project, "keep.txt"), "keep project");
  await symlink(source, path.join(project, "source-alias"), "dir");
  await symlink(project, path.join(temporary, "project-alias"), "dir");

  for (const destination of [".", "..", "src", "src/main/resources/public", "src/main/resources/public/nested/output", "source-alias", "source-alias/nested/output", "../project-alias"]) {
    assert.throws(() => execFileSync(process.execPath, [script, destination], { cwd: project, stdio: "pipe" }), error => {
      assert.match(error.stderr.toString(), /Build output must be separate/);
      return true;
    }, destination);
    assert.equal(await readFile(path.join(source, "index.html"), "utf8"), "keep source");
    assert.equal(await readFile(path.join(project, "keep.txt"), "utf8"), "keep project");
  }

  execFileSync(process.execPath, [script, "_site"], { cwd: project, stdio: "pipe" });
  assert.equal(await readFile(path.join(project, "_site/index.html"), "utf8"), "keep source");
  assert.equal(await readFile(path.join(project, "_site/site-mode.js"), "utf8"), 'window.NOTEBOOK_STORAGE_MODE = "browser";\n');
});
