/**
 * state-dir 单元测试
 */
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveOpenClawStateDir } from "./state-dir.js";

describe("resolveOpenClawStateDir", () => {
  const originalOpenClaw = process.env.OPENCLAW_STATE_DIR;
  const originalClawdbot = process.env.CLAWDBOT_STATE_DIR;

  afterEach(() => {
    if (originalOpenClaw === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalOpenClaw;
    }
    if (originalClawdbot === undefined) {
      delete process.env.CLAWDBOT_STATE_DIR;
    } else {
      process.env.CLAWDBOT_STATE_DIR = originalClawdbot;
    }
  });

  it("优先使用 OPENCLAW_STATE_DIR", () => {
    process.env.OPENCLAW_STATE_DIR = "/custom/openclaw";
    delete process.env.CLAWDBOT_STATE_DIR;
    expect(resolveOpenClawStateDir()).toBe("/custom/openclaw");
  });

  it("回退到 CLAWDBOT_STATE_DIR", () => {
    delete process.env.OPENCLAW_STATE_DIR;
    process.env.CLAWDBOT_STATE_DIR = "/legacy/clawdbot";
    expect(resolveOpenClawStateDir()).toBe("/legacy/clawdbot");
  });

  it("未配置时回退到 ~/.openclaw", () => {
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.CLAWDBOT_STATE_DIR;
    expect(resolveOpenClawStateDir()).toBe(path.join(os.homedir(), ".openclaw"));
  });
});
