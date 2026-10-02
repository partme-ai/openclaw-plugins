import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/** Read the selected CLI and its Node runtime. */
export async function readHostBaseline(cliPath, startedPid, recordedLaunch) {
  const resolvedCli = realpathSync(cliPath);
  let nodeExecutable = "node";
  if (startedPid !== undefined) {
    if (!Number.isSafeInteger(startedPid) || startedPid <= 0) throw new Error("Invalid started Gateway PID");
    const command = execFileSync("ps", ["-p", String(startedPid), "-o", "command="], { encoding: "utf8" }).trim();
    const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
    const commandContainsCli = tokens.some((token) => {
      try { return realpathSync(token) === resolvedCli; }
      catch { return false; }
    });
    if (commandContainsCli) {
      nodeExecutable = tokens[0];
      if (!nodeExecutable || !nodeExecutable.includes("/") || realpathSync(nodeExecutable) !== realpathSync(process.execPath)) {
        throw new Error("started Gateway Node executable mismatch");
      }
    } else {
      if (!recordedLaunch) throw new Error("started Gateway CLI mismatch");
      const startedAt = Date.parse(execFileSync("ps", ["-p", String(startedPid), "-o", "lstart="], { encoding: "utf8" }).trim());
      if (!Number.isFinite(startedAt) || !Number.isSafeInteger(recordedLaunch.spawnedAt) ||
          startedAt < recordedLaunch.spawnedAt - 1_000 || startedAt > recordedLaunch.spawnedAt + 5_000) {
        throw new Error("started Gateway launch time mismatch");
      }
      nodeExecutable = recordedLaunch.nodeExecutable;
      if (!nodeExecutable || realpathSync(nodeExecutable) !== realpathSync(process.execPath)) {
        throw new Error("started Gateway Node executable mismatch");
      }
    }
  }
  const cliCommand = startedPid === undefined ? [cliPath] : [nodeExecutable, resolvedCli];
  const version = execFileSync(cliCommand[0], [...cliCommand.slice(1), "--version"], { encoding: "utf8" }).trim().match(/\b\d{4}\.\d+\.\d+(?:[-.][\w.]+)?\b/)?.[0];
  const nodeVersion = execFileSync(nodeExecutable, ["--version"], { encoding: "utf8" }).trim();
  if (!version || !/^v\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error("Unable to read selected OpenClaw CLI and Node baseline");
  return { version, nodeVersion, cliPath: resolvedCli };
}

/** Inspect PID 1 in the running container, then query the exact CLI it launched. */
export async function readContainerHostBaseline(dockerCommand = "docker", container = "openclaw-e2e-gateway") {
  const args = ["exec", container];
  const cmdline = execFileSync(dockerCommand, [...args, "cat", "/proc/1/cmdline"]).toString("utf8").split("\0").filter(Boolean);
  let cliPath = cmdline.find((part) => part.endsWith("/openclaw.mjs")) ??
    cmdline.find((part) => part.endsWith("/openclaw") || part === "openclaw");
  if (!cliPath && cmdline[0] === "openclaw-gateway") {
    // OpenClaw changes process.title after the configured entrypoint execs Node.
    // Bind this fallback to that exact entrypoint and PID 1's Node executable.
    const entrypoint = JSON.parse(execFileSync(dockerCommand, ["inspect", "--format", "{{json .Config.Entrypoint}}", container], { encoding: "utf8" }));
    if (JSON.stringify(entrypoint) !== JSON.stringify(["/bin/sh", "/entrypoint.sh"])) {
      throw new Error("Container Gateway entrypoint mismatch");
    }
    const pidNode = execFileSync(dockerCommand, [...args, "readlink", "-f", "/proc/1/exe"], { encoding: "utf8" }).trim();
    const selectedNode = execFileSync(dockerCommand, [...args, "node", "-p", "process.execPath"], { encoding: "utf8" }).trim();
    if (!pidNode || pidNode !== selectedNode) throw new Error("Container Gateway PID 1 Node mismatch");
    cliPath = "/workspace/node_modules/openclaw/openclaw.mjs";
    execFileSync(dockerCommand, [...args, "test", "-f", cliPath]);
  }
  if (!cliPath) throw new Error("Unable to identify started container OpenClaw CLI");
  const cliCommand = cliPath.endsWith(".mjs") ? ["node", cliPath] : [cliPath];
  const version = execFileSync(dockerCommand, [...args, ...cliCommand, "--version"], { encoding: "utf8" }).trim().match(/\b\d{4}\.\d+\.\d+(?:[-.][\w.]+)?\b/)?.[0];
  const nodeVersion = execFileSync(dockerCommand, [...args, "node", "--version"], { encoding: "utf8" }).trim();
  if (!version || !/^v\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error("Unable to read running container baseline");
  return { version, nodeVersion, cliPath };
}
