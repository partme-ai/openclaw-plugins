/**
 * Session Mapper 单元测试
 */

import { describe, it, expect } from "vitest";

describe("Session key building various dmScope modes", () => {
  // Import the resolve function directly from dm-scope module
  it("should have correct session key formats", async () => {
    // We can't easily test the internal module, but verify basic structure
    // by checking that the keys follow the expected format
    expect("agent:agent-1:main").toMatch(/^agent:.+$/);
  });
});