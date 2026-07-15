import { describe, expect, it } from "vitest";

import { mapScopesToPermissions, mapScopesToRole, parseScopeString } from "./scope-mapper.js";

describe("OAuth2 scope mapping", () => {
  it("selects the highest configured role", () => {
    expect(mapScopesToRole(["openclaw:viewer", "openclaw:admin"])).toBe("admin");
    expect(mapScopesToRole(["openclaw:viewer", "openclaw:operator"])).toBe("operator");
    expect(mapScopesToRole([])).toBe("viewer");
  });

  it("supports custom mappings", () => {
    const config = { scopeMapping: { "custom:admin": "admin", "custom:user": "operator" } };
    expect(mapScopesToRole(["custom:admin"], config)).toBe("admin");
    expect(mapScopesToRole(["custom:user"], config)).toBe("operator");
  });

  it("maps roles to OpenClaw permissions", () => {
    expect(mapScopesToPermissions(["openclaw:admin"])).toEqual(["read", "write", "admin"]);
    expect(mapScopesToPermissions(["openclaw:operator"])).toEqual(["read", "write"]);
    expect(mapScopesToPermissions(["openclaw:viewer"])).toEqual(["read"]);
  });

  it("parses whitespace-separated scopes", () => {
    expect(parseScopeString("  a   b c ")).toEqual(["a", "b", "c"]);
    expect(parseScopeString(undefined)).toEqual([]);
  });
});
