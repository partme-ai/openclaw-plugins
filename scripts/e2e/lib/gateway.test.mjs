import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stopGatewayByPidFile } from "./gateway.mjs";

test("E2E Gateway stop confirms ownership and exit before clearing its PID file", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-stop-e2e-"));
  const pidFile = join(root, "gateway.pid");
  try {
    writeFileSync(pidFile, "12345");
    let live = true;
    let owned = false;
    const signals = [];
    const deps = {
      isAlive: () => live,
      ownsPort: () => owned,
      signal: (_pid, signal) => { signals.push(signal); if (signal === "SIGKILL") live = false; },
      pause: () => {},
    };
    assert.throws(() => stopGatewayByPidFile(pidFile, 19789, deps, 0));
    assert.deepEqual(signals, []);
    assert.equal(existsSync(pidFile), true);

    owned = true;
    stopGatewayByPidFile(pidFile, 19789, deps, 0);
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(existsSync(pidFile), false);

    writeFileSync(pidFile, "12345");
    live = true;
    deps.signal = (_pid, signal) => { signals.push(signal); };
    assert.throws(() => stopGatewayByPidFile(pidFile, 19789, deps, 0));
    assert.equal(existsSync(pidFile), true);

    let checks = 0;
    deps.isAlive = () => ++checks < 2;
    deps.ownsPort = () => false;
    stopGatewayByPidFile(pidFile, 19789, deps, 0);
    assert.equal(existsSync(pidFile), false);

    writeFileSync(pidFile, "12345");
    checks = 0;
    let portChecks = 0;
    deps.isAlive = () => ++checks < 6;
    deps.ownsPort = () => ++portChecks === 1;
    deps.signal = (_pid, signal) => { signals.push(signal); };
    stopGatewayByPidFile(pidFile, 19789, deps, 0);
    assert.equal(existsSync(pidFile), false);
    assert.equal(signals.at(-1), "SIGTERM");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
