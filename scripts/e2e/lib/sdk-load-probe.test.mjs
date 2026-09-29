import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { probeInstalledPlugin } from "./sdk-load-probe.mjs";

const fixtureRoot = await mkdtemp(join(import.meta.dirname, ".sdk-probe-"));

async function fixture(name, source) {
  const entry = join(fixtureRoot, name);
  await writeFile(entry, source);
  return entry;
}

test.after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("installed probe rejects deleted SDK subpaths", async () => {
  const entry = await fixture("deleted.mjs", 'import "openclaw/plugin-sdk";');
  await assert.rejects(probeInstalledPlugin(entry), /plugin-sdk/);
});

test("installed probe rejects missing named SDK exports", async () => {
  const entry = await fixture("missing.mjs", 'import { missingSdkSymbol } from "openclaw/plugin-sdk/channel-outbound";');
  await assert.rejects(probeInstalledPlugin(entry), (error) => {
    assert.match(error.message, /missingSdkSymbol/);
    assert.match(error.message, /missing\.mjs/);
    return true;
  });
});

test("installed probe accepts a public SDK export", async () => {
  const entry = await fixture("valid.mjs", 'import { sanitizeForPlainText } from "openclaw/plugin-sdk/channel-outbound"; export default sanitizeForPlainText;');
  await assert.doesNotReject(probeInstalledPlugin(entry));
});

test("installed probe also loads CommonJS entries", async () => {
  const entry = await fixture("valid.cjs", 'module.exports = { register() {} };');
  await assert.doesNotReject(probeInstalledPlugin(entry));
});
