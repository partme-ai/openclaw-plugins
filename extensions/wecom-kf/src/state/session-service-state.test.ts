/**
 * session-service-state 单元测试
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  buildKfSessionKey,
  getKfSessionServiceState,
  isKfAgentReplyBlocked,
  resetKfSessionServiceStateForTests,
  setKfSessionServiceState,
} from "../state/session-service-state.js";

afterEach(async () => {
  await resetKfSessionServiceStateForTests();
});

describe("session-service-state", () => {
  it("buildKfSessionKey 应规范化空白", () => {
    expect(buildKfSessionKey(" wk1 ", " u1 ")).toBe("wk1:u1");
  });

  it("service_state=3/4 应阻止 Agent 自动回复", () => {
    expect(isKfAgentReplyBlocked(3)).toBe(true);
    expect(isKfAgentReplyBlocked(4)).toBe(true);
    expect(isKfAgentReplyBlocked(1)).toBe(false);
  });

  it("set/get 应持久化 service_state", async () => {
    await setKfSessionServiceState({
      openKfId: "wk1",
      externalUserId: "u1",
      serviceState: 3,
      servicerUserId: "zhangsan",
    });

    const state = await getKfSessionServiceState("wk1", "u1");
    expect(state?.serviceState).toBe(3);
    expect(state?.servicerUserId).toBe("zhangsan");
  });
});
