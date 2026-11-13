import assert from "node:assert/strict";
import test from "node:test";
import { readCloudConfig } from "../../src/main/resources/public/js/cloud-config.js";

test("cloud config is empty by default and reads only the runtime window config", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  });
  delete globalThis.window;
  assert.deepEqual(readCloudConfig(), { url: "", anonKey: "" });
  for (const config of [null, {}, { url: 123, anonKey: false }, { url: "  ", anonKey: "" }]) {
    globalThis.window = { __SUPABASE__: config };
    assert.deepEqual(readCloudConfig(), { url: "", anonKey: "" });
  }
  globalThis.window = { __SUPABASE__: { url: " https://test.supabase.co/ ", anonKey: " public-key " } };
  assert.deepEqual(readCloudConfig(), { url: "https://test.supabase.co/", anonKey: "public-key" });
});
