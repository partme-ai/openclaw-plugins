import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeReport } from "./report.mjs";

test("sanitizeReport redacts nested credentials without mutating evidence", () => {
  const report = {
    gotify: { appToken: "app", outboundAppToken: "outbound", client_token: "client", allowedAppId: 7 },
    config: { password: "secret", auth: { mode: "none" } },
  };

  assert.deepEqual(sanitizeReport(report), {
    gotify: { appToken: "[REDACTED]", outboundAppToken: "[REDACTED]", client_token: "[REDACTED]", allowedAppId: 7 },
    config: { password: "[REDACTED]", auth: { mode: "none" } },
  });
  assert.equal(report.gotify.appToken, "app");
});
