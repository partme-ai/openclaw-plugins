import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readContainerHostBaseline, readHostBaseline } from "./host-baseline.mjs";

test("host baseline executes the selected CLI and captures its Node", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-host-baseline-"));
  const cli = join(dir, "openclaw");
  writeFileSync(cli, '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("2026.9.6"); else if (process.argv.includes("--e2e-node-version")) console.log(process.version);\n');
  chmodSync(cli, 0o755);
  const host = await readHostBaseline(cli);
  assert.equal(host.version, "2026.9.6");
  assert.equal(host.nodeVersion, process.version);
  assert.equal(host.cliPath, realpathSync(cli));
});

test("container baseline selects the CLI named by PID 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-container-baseline-"));
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("/proc/1/cmdline")) process.stdout.write("node\\0/workspace/node_modules/openclaw/openclaw.mjs\\0--profile\\0queue-e2e\\0");
else if (args.includes("--version") && args.some((arg) => arg.endsWith("openclaw.mjs"))) console.log("2026.9.6");
else if (args.includes("--version")) console.log("v24.18.0");
`);
  chmodSync(docker, 0o755);
  assert.deepEqual(await readContainerHostBaseline(docker), {
    version: "2026.9.6", nodeVersion: "v24.18.0", cliPath: "/workspace/node_modules/openclaw/openclaw.mjs",
  });
});

test("container baseline recognizes the configured entrypoint after PID 1 retitles itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-retitled-container-baseline-"));
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "inspect") console.log(JSON.stringify(["/bin/sh", "/entrypoint.sh"]));
else if (args.includes("/proc/1/cmdline")) process.stdout.write("openclaw-gateway\\0");
else if (args.includes("/proc/1/exe")) console.log("/usr/local/bin/node");
else if (args.includes("process.execPath")) console.log("/usr/local/bin/node");
else if (args.includes("--version") && args.some((arg) => arg.endsWith("openclaw.mjs"))) console.log("2026.9.6");
else if (args.includes("--version")) console.log("v24.18.0");
`);
  chmodSync(docker, 0o755);
  assert.deepEqual(await readContainerHostBaseline(docker), {
    version: "2026.9.6", nodeVersion: "v24.18.0", cliPath: "/workspace/node_modules/openclaw/openclaw.mjs",
  });
});

test("host baseline rejects a selected CLI different from the live Gateway PID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-pid-baseline-"));
  const launched = join(dir, "launched-openclaw.mjs");
  const selected = join(dir, "selected-openclaw.mjs");
  writeFileSync(launched, 'if (process.argv.includes("--version")) console.log("2026.9.6"); else setInterval(() => {}, 1000);\n');
  writeFileSync(selected, '#!/usr/bin/env node\nconsole.log("2026.9.6");\n');
  chmodSync(selected, 0o755);
  const child = spawn(process.execPath, [launched], { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const running = await readHostBaseline(launched, child.pid);
    assert.equal(running.version, "2026.9.6");
    assert.equal(running.nodeVersion, process.version);
    assert.equal(running.cliPath, realpathSync(launched));
    await assert.rejects(readHostBaseline(selected, child.pid), /started Gateway CLI mismatch/);
  } finally { child.kill(); }
});

test("host baseline accepts a live Node CLI whose command is hidden by process.title only for the recorded launch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-retitled-baseline-"));
  const launched = join(dir, "openclaw.mjs");
  writeFileSync(launched, 'if (process.argv.includes("--version")) console.log("2026.9.6"); else { process.title = "openclaw"; setInterval(() => {}, 1000); }\n');
  const spawnedAt = Date.now();
  const child = spawn(process.execPath, [launched], { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const launch = { spawnedAt, nodeExecutable: process.execPath };
    const baseline = await readHostBaseline(launched, child.pid, launch);
    assert.equal(baseline.cliPath, realpathSync(launched));
    await assert.rejects(readHostBaseline(launched, child.pid), /started Gateway CLI mismatch/);
    await assert.rejects(readHostBaseline(launched, child.pid, { ...launch, spawnedAt: spawnedAt - 60_000 }), /started Gateway launch time mismatch/);
  } finally { child.kill(); }
});
