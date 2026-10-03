import { test } from "node:test";
import { execFileSync } from "node:child_process";

test("built Router imports in native ESM without CJS shims", () => {
  execFileSync(process.execPath, ["--input-type=module", "-e", 'await import("./dist/index.js")'], {
    cwd: new URL("../", import.meta.url), stdio: "pipe",
  });
});
