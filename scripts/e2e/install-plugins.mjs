/**
 * Build, pack, and install queue/channel plugins into OpenClaw profile `queue-e2e`.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./lib/utils.mjs";

const TOOL_PATH = `/opt/homebrew/bin:${process.env.PATH ?? ""}`;
const toolEnv = {
  ...process.env,
  PATH: TOOL_PATH,
  RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://127.0.0.1:5672",
  ROCKETMQ_ENDPOINTS: process.env.ROCKETMQ_ENDPOINTS ?? "127.0.0.1:8081",
};

const PLUGINS = [
  { filter: "@partme.ai/openclaw-message-sdk", id: "message-sdk", dir: "extensions/message-sdk", skipChannel: true },
  { filter: "@partme.ai/openclaw-mqtt", id: "mqtt", dir: "extensions/mqtt", extDir: "openclaw-mqtt" },
  { filter: "@partme.ai/openclaw-rabbitmq", id: "rabbitmq", dir: "extensions/rabbitmq", extDir: "openclaw-rabbitmq" },
  { filter: "@partme.ai/openclaw-rocketmq", id: "rocketmq", dir: "extensions/rocketmq", extDir: "openclaw-rocketmq" },
  { filter: "@partme.ai/openclaw-gotify", id: "gotify", dir: "extensions/gotify", extDir: "openclaw-gotify" },
  { filter: "@partme.ai/openclaw-stomp", id: "stomp", dir: "extensions/stomp", extDir: "openclaw-stomp" },
  { filter: "@partme.ai/openclaw-web-mqtt", id: "web-mqtt", dir: "extensions/web-mqtt", extDir: "openclaw-web-mqtt" },
  { filter: "@partme.ai/openclaw-web-stomp", id: "web-stomp", dir: "extensions/web-stomp", extDir: "openclaw-web-stomp" },
];

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT, env: toolEnv, ...opts });
}

function extractTgz(tgzPath, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run(`tar -xzf "${tgzPath}" -C "${dest}"`);
  const pkgDir = readdirSync(dest).find((n) => n.startsWith("package"));
  if (!pkgDir) throw new Error(`No package dir in ${tgzPath}`);
  const inner = join(dest, pkgDir);
  for (const name of readdirSync(inner)) {
    cpSync(join(inner, name), join(dest, name), { recursive: true, force: true });
  }
  rmSync(join(dest, pkgDir), { recursive: true, force: true });
}

function installProductionDeps(extPath) {
  const pkgPath = join(extPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.devDependencies;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  run(`npm install --omit=dev --legacy-peer-deps --no-audit --no-fund`, { cwd: extPath });
}

/** Pack tgz may omit files; overlay workspace dist + setup-entry for runtime completeness. */
function overlayWorkspaceBuild(pluginDir, extPath) {
  const srcDist = join(REPO_ROOT, pluginDir, "dist");
  if (existsSync(srcDist)) {
    cpSync(srcDist, join(extPath, "dist"), { recursive: true, force: true });
  }
  for (const name of ["setup-entry.js", "setup-entry.d.ts"]) {
    const src = join(srcDist, name);
    if (existsSync(src)) {
      cpSync(src, join(extPath, "dist", name), { force: true });
    }
  }
}

function main() {
  run("pnpm install");
  run("pnpm --filter @partme.ai/openclaw-message-sdk build");

  const installed = [];

  for (const p of PLUGINS) {
    if (p.skipChannel) continue;
    run(`pnpm --filter ${p.filter} typecheck`);
    run(`pnpm --filter ${p.filter} test`);
    run(`pnpm --filter ${p.filter} build`);

    const pkgDir = join(REPO_ROOT, p.dir);
    run(`pnpm pack`, { cwd: pkgDir });
    const tgzName = readdirSync(pkgDir).find((n) => n.endsWith(".tgz"));
    if (!tgzName) throw new Error(`pack failed for ${p.filter} in ${pkgDir}`);
    const tgzPath = join(pkgDir, tgzName);

    const extPath = join(STATE_DIR, "extensions", p.extDir ?? p.id);
    extractTgz(tgzPath, extPath);
    overlayWorkspaceBuild(p.dir, extPath);

    const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
    installProductionDeps(extPath);

    installed.push({ id: p.id, path: extPath, version: pkg.version, tgz: tgzPath });
  }

  run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`);

  run(`node "${join(E2E_DIR, "install-message-sdk-deps.mjs")}"`);

  writeFileSync(join(STATE_DIR, ".e2e-installed.json"), JSON.stringify(installed, null, 2));
  console.log("\n[install] done:", installed.map((i) => `${i.id}@${i.version}`).join(", "));
}

main();
