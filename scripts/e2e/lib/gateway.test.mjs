import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isGatewayProcessAlive, recordHostGatewayLaunch, resolveHostGatewayCli, stopGatewayByPidFile } from "./gateway.mjs";

test("launch identity failure kills the new child before it can detach", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-launch-"));
  const pidFile = join(root, "gateway.pid");
  const signals = [];
  const child = { pid: 12345, exitCode: null, signalCode: null,
    kill: (signal) => { signals.push(signal); return true; }, once: (_event, listener) => listener(),
    unref: () => { throw new Error("unref must not run"); } };
  try {
    assert.throws(() => recordHostGatewayLaunch(child, pidFile,
      { identity: () => undefined, pause: () => {} }, () => {}, 0), /process identity/);
    assert.deepEqual(signals, ["SIGKILL"]);
    assert.equal(existsSync(pidFile), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PID file write failure kills the child and removes partial launch state", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-launch-"));
  const pidFile = join(root, "gateway.pid");
  const signals = [];
  const child = { pid: 12345, exitCode: null, signalCode: null,
    kill: (signal) => { signals.push(signal); return true; }, once: (_event, listener) => listener(),
    unref: () => { throw new Error("unref must not run"); } };
  try {
    assert.throws(() => recordHostGatewayLaunch(child, pidFile,
      { identity: () => "born-now", pause: () => {} }, (path) => { writeFileSync(path, "partial"); throw new Error("disk full"); }), /disk full/);
    assert.deepEqual(signals, ["SIGKILL"]);
    assert.equal(existsSync(pidFile), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed SIGKILL keeps a diagnostic PID record and reports the child PID", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-launch-"));
  const pidFile = join(root, "gateway.pid");
  const child = { pid: 12345, exitCode: null, signalCode: null,
    kill: () => false, once: () => { throw new Error("must not register exit cleanup"); },
    unref: () => { throw new Error("unref must not run"); } };
  try {
    assert.throws(() => recordHostGatewayLaunch(child, pidFile,
      { identity: () => "born-now", pause: () => {} }, (path) => { writeFileSync(path, "partial"); throw new Error("disk full"); }),
    /cleanup failed for PID 12345/);
    assert.equal(existsSync(pidFile), true);
    assert.deepEqual(JSON.parse(readFileSync(pidFile, "utf8")), { pid: 12345, status: "unverified-launch" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed PID write leaves a parseable record until the child exit is observed", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-launch-"));
  const pidFile = join(root, "gateway.pid");
  let onExit;
  const child = { pid: 12345, exitCode: null, signalCode: null,
    kill: () => true, once: (_event, listener) => { onExit = listener; },
    unref: () => { throw new Error("unref must not run"); } };
  try {
    assert.throws(() => recordHostGatewayLaunch(child, pidFile,
      { identity: () => "born-now", pause: () => {} }, (path) => { writeFileSync(path, "partial"); throw new Error("disk full"); }), /disk full/);
    assert.deepEqual(JSON.parse(readFileSync(pidFile, "utf8")), { pid: 12345, status: "unverified-launch" });
    onExit();
    assert.equal(existsSync(pidFile), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("host Gateway launches the package's JavaScript bin instead of a pnpm shell shim", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-cli-"));
  try {
    const binDir = join(root, "node_modules", ".bin");
    const packageDir = join(root, "node_modules", "openclaw");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(packageDir, { recursive: true });
    const shim = join(binDir, "openclaw");
    const entry = join(packageDir, "openclaw.mjs");
    writeFileSync(shim, "#!/bin/sh\nexec node ../openclaw/openclaw.mjs \"$@\"\n");
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "openclaw", bin: { openclaw: "openclaw.mjs" } }));
    writeFileSync(entry, "#!/usr/bin/env node\nconsole.log('2026.9.6')\n");
    assert.equal(resolveHostGatewayCli(shim), realpathSync(entry));
    assert.equal(resolveHostGatewayCli(entry), realpathSync(entry));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PID is retained when ps fails and kill still finds a live process", () => {
  const alive = () => {};
  const brokenPs = () => { throw new Error("ps unavailable"); };
  assert.throws(() => isGatewayProcessAlive(12345, alive, brokenPs), /ps unavailable/);
  assert.equal(isGatewayProcessAlive(12345, alive, () => "Z+\n"), false);
  assert.equal(isGatewayProcessAlive(12345, alive, () => "S+\n"), true);
  const gone = () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; };
  assert.equal(isGatewayProcessAlive(12345, gone, brokenPs), false);
});

test("E2E Gateway stop confirms ownership and exit before clearing its PID file", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-stop-e2e-"));
  const pidFile = join(root, "gateway.pid");
  try {
    writeFileSync(pidFile, JSON.stringify({ pid: 12345, birthTime: "original" }));
    let live = true;
    let owned = false;
    const signals = [];
    const deps = {
      isAlive: () => live,
      identity: () => "original",
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

    writeFileSync(pidFile, JSON.stringify({ pid: 12345, birthTime: "original" }));
    live = true;
    deps.signal = (_pid, signal) => { signals.push(signal); };
    assert.throws(() => stopGatewayByPidFile(pidFile, 19789, deps, 0));
    assert.equal(existsSync(pidFile), true);

    let checks = 0;
    deps.isAlive = () => ++checks < 2;
    deps.ownsPort = () => false;
    stopGatewayByPidFile(pidFile, 19789, deps, 0);
    assert.equal(existsSync(pidFile), false);

    writeFileSync(pidFile, JSON.stringify({ pid: 12345, birthTime: "original" }));
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

test("PID reuse on the same port cannot authorize Gateway shutdown", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-pid-reuse-"));
  const pidFile = join(root, "gateway.pid");
  try {
    writeFileSync(pidFile, JSON.stringify({ pid: 12345, birthTime: "old" }));
    const signals = [];
    const lifecycle = {
      isAlive: () => true,
      identity: () => "new",
      ownsPort: () => true,
      signal: (_pid, signal) => signals.push(signal),
      pause: () => {},
    };
    assert.throws(() => stopGatewayByPidFile(pidFile, 19789, lifecycle, 0), /identity mismatch/);
    assert.deepEqual(signals, []);
    assert.equal(existsSync(pidFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy PID files never authorize signaling a live process", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-gateway-legacy-pid-"));
  const pidFile = join(root, "gateway.pid");
  try {
    writeFileSync(pidFile, "12345");
    const signals = [];
    const lifecycle = {
      isAlive: () => true,
      identity: () => "unknown",
      ownsPort: () => true,
      signal: (_pid, signal) => signals.push(signal),
      pause: () => {},
    };
    assert.throws(() => stopGatewayByPidFile(pidFile, 19789, lifecycle, 0), /Unverified legacy PID/);
    assert.deepEqual(signals, []);
    assert.equal(existsSync(pidFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
