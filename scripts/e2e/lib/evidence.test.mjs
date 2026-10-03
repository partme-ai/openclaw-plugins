import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sourceFingerprint } from "./evidence.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openclaw-e2e-evidence-"));
  for (const dir of [
    "extensions/mqtt/src",
    "extensions/message-sdk/src",
    "scripts/e2e/plugins",
    "scripts/e2e/config/plugins",
    "test-web",
  ]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "extensions/mqtt/src/index.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "extensions/mqtt/package.json"), "{}\n");
  writeFileSync(join(root, "extensions/message-sdk/src/index.ts"), "export const sdk = 1;\n");
  writeFileSync(join(root, "scripts/e2e/plugins/mqtt.mjs"), "export default {};\n");
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

test("sourceFingerprint is stable and changes with plugin runtime source", () => {
  const repoRoot = fixture();
  const first = sourceFingerprint("mqtt", { repoRoot });
  assert.equal(sourceFingerprint("mqtt", { repoRoot }), first);

  writeFileSync(join(repoRoot, "extensions/mqtt/src/index.ts"), "export const value = 2;\n");
  assert.notEqual(sourceFingerprint("mqtt", { repoRoot }), first);
});

test("sourceFingerprint changes when shared message-sdk changes", () => {
  const repoRoot = fixture();
  const first = sourceFingerprint("mqtt", { repoRoot });

  writeFileSync(join(repoRoot, "extensions/message-sdk/src/index.ts"), "export const sdk = 2;\n");
  assert.notEqual(sourceFingerprint("mqtt", { repoRoot }), first);
});

test("sourceFingerprint changes when browser test inputs change", () => {
  const repoRoot = fixture();
  const first = sourceFingerprint("mqtt", { repoRoot });
  writeFileSync(join(repoRoot, "test-web/flow.js"), "browser flow changed");
  assert.notEqual(sourceFingerprint("mqtt", { repoRoot }), first);
});

test("sourceFingerprint includes shared adapter context, index and datasets", () => {
  const repoRoot = fixture();
  for (const path of ["scripts/e2e/plugins/_context.mjs", "scripts/e2e/plugins/index.mjs", "scripts/e2e/datasets/sample.json"]) {
    mkdirSync(join(repoRoot, path, ".."), { recursive: true });
    const before = sourceFingerprint("mqtt", { repoRoot });
    writeFileSync(join(repoRoot, path), "new test input");
    assert.notEqual(sourceFingerprint("mqtt", { repoRoot }), before, path);
  }
});
