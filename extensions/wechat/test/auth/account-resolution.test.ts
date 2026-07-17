import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { resolveWeixinAccount } from "../../src/auth/accounts.js";

let stateDir = "";
const previousStateDir = process.env.OPENCLAW_STATE_DIR;

beforeAll(async () => {
  stateDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "weixin-account-resolution-"),
  );
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterAll(async () => {
  if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousStateDir;
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("resolveWeixinAccount", () => {
  it("inherits top-level defaults and applies account-level overrides", () => {
    const cfg = {
      channels: {
        "openclaw-weixin": {
          routeTag: "global-route",
          mediaLocalRoots: ["/data/shared-media"],
          allowFrom: ["global-user"],
          accounts: {
            acc1: { name: "Account One", routeTag: "account-route" },
            acc2: { name: "Account Two" },
          },
        },
      },
    } as unknown as OpenClawConfig;

    const overridden = resolveWeixinAccount(cfg, "acc1");
    expect(overridden.routeTag).toBe("account-route");
    expect(overridden.mediaLocalRoots).toEqual(["/data/shared-media"]);
    expect(overridden.allowFrom).toEqual(["global-user"]);

    const inherited = resolveWeixinAccount(cfg, "acc2");
    expect(inherited.routeTag).toBe("global-route");
    expect(inherited.mediaLocalRoots).toEqual(["/data/shared-media"]);
  });
});
