import { describe, expect, it } from "vitest";
import { expandEnvPlaceholdersInValue } from "./env-expand.js";

describe("expandEnvPlaceholdersInValue", () => {
  it("replaces ${VAR} and uses default for ${VAR:def}", () => {
    const env = { FOO: "bar", EMPTY: "" };
    expect(expandEnvPlaceholdersInValue("x-${FOO}-y", env)).toBe("x-bar-y");
    expect(expandEnvPlaceholdersInValue("a-${MISSING:default}", env)).toBe("a-default");
  });

  it("walks nested objects", () => {
    const env = { P: "1" };
    expect(
      expandEnvPlaceholdersInValue({ a: { b: "p-${P}" } }, env),
    ).toEqual({ a: { b: "p-1" } });
  });
});
