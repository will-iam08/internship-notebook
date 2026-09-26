import test from "node:test";
import assert from "node:assert/strict";
import { decideSync, notebookHash } from "../../src/main/resources/public/js/sync.js";

test("sync chooses the only changed copy and stops on divergence", () => {
  assert.equal(decideSync("same", "same", "old"), "synced");
  assert.equal(decideSync("local", "", ""), "upload-local");
  assert.equal(decideSync("base", "remote", "base"), "use-remote");
  assert.equal(decideSync("local", "base", "base"), "upload-local");
  assert.equal(decideSync("local", "remote", "base"), "conflict");
  assert.equal(decideSync("local", "remote", ""), "conflict");
});

test("notebook hash is stable and changes with content", async () => {
  const record = { nextId: 2, applications: [{ id: 1 }], recentlyDeleted: [] };
  assert.equal(await notebookHash(record), await notebookHash(structuredClone(record)));
  assert.notEqual(await notebookHash(record), await notebookHash({ ...record, nextId: 3 }));
});
