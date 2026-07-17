import { describe, expect, it } from "vitest";
import { redactGotifyError } from "../src/shared/redact.js";

describe("redactGotifyError", () => {
  it("masks configured and URL/query tokens before diagnostics", () => {
    const result = redactGotifyError(
      new Error(
        "GET /stream?token=client-prod X-Gotify-Key: app-prod clientToken=client-prod\nnext",
      ),
      { appToken: "app-prod", clientToken: "client-prod" },
    );
    expect(result).not.toContain("app-prod");
    expect(result).not.toContain("client-prod");
    expect(result).not.toContain("\n");
    expect(result).toContain("***");
  });
});
