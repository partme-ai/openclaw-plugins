import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_ID = "u3-auth-grant-fixture";
export const FIXTURE_PATH = "/u3-auth-grant-fixture";
export const GRANT_TTL_MS = 5 * 60 * 1000;

/** Decode only the untrusted metadata needed to select and time a server-signed cookie. */
export function selectFixtureGrant(setCookieHeaders, frameGrants, issuedAt) {
  if (!Array.isArray(frameGrants) || !frameGrants.some((grant) =>
    grant.pluginId === FIXTURE_ID && grant.path === FIXTURE_PATH && grant.match === "prefix")) {
    throw new Error("Gateway bootstrap omitted the fixture route grant");
  }
  for (const header of setCookieHeaders) {
    if (typeof header !== "string" || !header.includes(`Path=${FIXTURE_PATH};`)) continue;
    const pair = header.split(";", 1)[0];
    const match = pair.match(/^(__openclaw_plugin_tab_auth_[0-9a-f]{16}_[0-9a-f]{64})=v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if (!match) continue;
    let payload;
    try { payload = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8")); }
    catch { continue; }
    if (payload?.pluginId !== FIXTURE_ID || payload.path !== FIXTURE_PATH ||
        payload.match !== "prefix" || payload.scope !== "plugin-tab" ||
        !Array.isArray(payload.scopes) || !payload.scopes.includes("operator.read") ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp < issuedAt + GRANT_TTL_MS - 10_000 ||
        payload.exp > Date.now() + GRANT_TTL_MS + 10_000) continue;
    return { pair, expiresAt: payload.exp };
  }
  throw new Error("Gateway did not mint a valid signed fixture Cookie");
}

export function writeDisposableConfig({ stateDir, fixtureDir, routerDir, port, token }) {
  const ids = [FIXTURE_ID, ...(routerDir ? ["router"] : [])];
  const config = {
    gateway: {
      mode: "local",
      bind: "loopback",
      port,
      auth: { mode: "token", token },
    },
    plugins: {
      allow: ids,
      load: { paths: [fixtureDir, ...(routerDir ? [routerDir] : [])] },
      entries: {
        [FIXTURE_ID]: { enabled: true },
        ...(routerDir ? { router: { enabled: true, config: { enabled: true, rules: [], delivery: { stateDir: join(stateDir, "router") } } } } : {}),
      },
    },
  };
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, "openclaw.json");
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return path;
}

export function seedRouterDeadLetter(stateDir) {
  const routerStateDir = join(stateDir, "router");
  mkdirSync(routerStateDir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const id = `u3-grant-replay-${randomBytes(8).toString("hex")}`;
  const state = {
    version: 1,
    pending: {},
    delivered: {},
    deadLetters: [{
      id,
      dedupeKey: id,
      ruleId: "u3-auth-grant-test",
      actionType: "forward",
      payload: { channel: "missing-u3-fixture-channel", to: "e2e", content: "u3 replay must remain denied" },
      attempts: 1,
      createdAt: now,
      nextAttemptAt: now,
    }],
    audit: [],
  };
  writeFileSync(join(routerStateDir, "delivery-state.json"), JSON.stringify(state), { mode: 0o600 });
  return id;
}
