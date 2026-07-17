/**
 * 启动工作区中的真实 OpenMem Server，而不是用内存 HTTP stub 模拟协议。
 *
 * E2E 会先编译 OpenMem core/server，再给服务分配独立数据目录；关闭时等待进程退出，
 * 保证下一次测试不会误连上一次残留的 Sidecar。
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { E2E_PORTS, REPO_ROOT, STATE_DIR, tcpReachable, waitFor } from "../lib/utils.mjs";

const DEFAULT_OPENMEM_REPO = resolve(REPO_ROOT, "../OpenMem");

/** 编译并启动真实 OpenMem REST Server。 */
export async function startOpenMemSidecar() {
  const repo = process.env.OPENMEM_E2E_REPO ?? DEFAULT_OPENMEM_REPO;
  if (!existsSync(resolve(repo, "apps/server/package.json"))) {
    throw new Error(`OpenMem source repository not found: ${repo}`);
  }
  if (await tcpReachable(E2E_PORTS.openmem)) {
    throw new Error(`OpenMem E2E port ${E2E_PORTS.openmem} is already in use`);
  }

  const toolEnv = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` };
  execFileSync("pnpm", ["--filter", "@openmem/core", "build"], { cwd: repo, env: toolEnv, stdio: "inherit" });
  execFileSync("pnpm", ["--filter", "@openmem/server", "build"], { cwd: repo, env: toolEnv, stdio: "inherit" });

  const dataDir = resolve(STATE_DIR, "openmem-e2e-data");
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: repo,
    env: {
      ...toolEnv,
      OPENMEM_PORT: String(E2E_PORTS.openmem),
      OPENMEM_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk) => { output = `${output}${chunk}`.slice(-8_000); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`OpenMem exited during startup (${child.exitCode}): ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${E2E_PORTS.openmem}/healthz`);
        return response.ok && (await response.json()).status === "ok";
      } catch {
        return false;
      }
    }, { label: "real OpenMem /healthz", timeoutMs: 60_000 });
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  return {
    repo,
    dataDir,
    baseUrl: `http://127.0.0.1:${E2E_PORTS.openmem}`,
    output: () => output,
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
