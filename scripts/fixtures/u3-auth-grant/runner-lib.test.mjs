import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_ID, FIXTURE_PATH, GRANT_TTL_MS, selectFixtureGrant, selectPluginGrant } from "./runner-lib.mjs";

function grant({ pluginId = FIXTURE_ID, exp = Date.now() + GRANT_TTL_MS, path = FIXTURE_PATH, match = "prefix" } = {}) {
  const payload = Buffer.from(JSON.stringify({
    scope: "plugin-tab", pluginId, path, match, scopes: ["operator.read"], exp,
  })).toString("base64url");
  return `__openclaw_plugin_tab_auth_${"a".repeat(16)}_${"b".repeat(64)}=v1.${payload}.signature; Path=${path}; HttpOnly; Secure; SameSite=None; Max-Age=300`;
}

test("selects the exact Gateway fixture grant without altering the Cookie bytes", () => {
  const issuedAt = Date.now();
  const header = grant({ exp: issuedAt + GRANT_TTL_MS });
  const selected = selectFixtureGrant([grant({ pluginId: "another-plugin" }), header],
    [{ pluginId: FIXTURE_ID, path: FIXTURE_PATH, match: "prefix" }], issuedAt);
  assert.equal(selected.pair, header.split(";", 1)[0]);
  assert.equal(selected.expiresAt, issuedAt + GRANT_TTL_MS);
});

test("rejects a missing descriptor grant, wrong plugin, and implausible expiry", () => {
  const issuedAt = Date.now();
  const frameGrants = [{ pluginId: FIXTURE_ID, path: FIXTURE_PATH, match: "prefix" }];
  assert.throws(() => selectFixtureGrant([grant()], [], issuedAt));
  assert.throws(() => selectFixtureGrant([grant({ pluginId: "another-plugin" })], frameGrants, issuedAt));
  assert.throws(() => selectFixtureGrant([grant({ exp: issuedAt - 1 })], frameGrants, issuedAt));
});

test("selects an exact same-plugin management grant", () => {
  const issuedAt = Date.now();
  const header = grant({ pluginId: "router", path: "/router/status", match: "exact", exp: issuedAt + GRANT_TTL_MS });
  const selected = selectPluginGrant([header], [{ pluginId: "router", path: "/router/status", match: "exact" }],
    issuedAt, { pluginId: "router", path: "/router/status", match: "exact" });
  assert.equal(selected.pair, header.split(";", 1)[0]);
});
