import { describe, expect, it } from "vitest";
import { resolveSubagentOutcome } from "./agent-helpers.js";

describe("resolveSubagentOutcome", () => {
  it.each([
    [{ status: "ok", terminalReply: { disposition: "visible", text: "answer" } }, { kind: "visible", text: "answer" }],
    [{ status: "ok", terminalReply: { disposition: "silent" } }, { kind: "silent" }],
    [{ status: "ok", terminalReply: { disposition: "empty" } }, { kind: "empty" }],
    [{ status: "ok", terminalReply: { disposition: "visible", text: "  " } }, { kind: "empty" }],
    [{ status: "pending" }, { kind: "pending" }],
    [{ status: "timeout" }, { kind: "failed", status: "timeout" }],
    [{ status: "error", error: "provider failed" }, { kind: "failed", status: "error" }],
    [{ status: "ok" }, { kind: "failed", status: "invalid" }],
    [{ status: "ok", terminalReply: { disposition: "unknown", text: "answer" } }, { kind: "failed", status: "invalid" }],
    [{ text: "legacy answer" }, { kind: "failed", status: "invalid" }],
    [null, { kind: "failed", status: "invalid" }],
  ] as const)("classifies %j without serializing state as a reply", (result, expected) => {
    expect(resolveSubagentOutcome(result)).toEqual(expected);
  });
});
