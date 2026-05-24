/**
 * Install remaining plugins (skip build/test if dist exists). Used to resume partial install.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./lib/utils.mjs";

const toolEnv = {
  ...process.env,
  PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`,
  RABBITMQ_URL: "amqp://127.0.0.1:5672",
  ROCKETMQ_ENDPOINTS: "127.0.0.1:8081",
};

const PLUGINS = [
  { filter: "@partme.ai/openclaw-rocketmq", id: "rocketmq", dir: "extensions/rocketmq", extDir: "openclaw-rocketmq" },
  { filter: "@partme.ai/openclaw-gotify", id: "gotify", dir: "extensions/gotify", extDir: "openclaw-gotify" },
  { filter: "@partme.ai/openclaw-stomp", id: "stomp", dir: "extensions/stomp", extDir: "openclaw-stomp" },
  { filter: "@partme.ai/openclaw-web-mqtt", id: "web-mqtt", dir: "extensions/web-mqtt", extDir: "web-mqtt" },
  { filter: "@partme.ai/openclaw-web-stomp", id: "web-stomp", dir: "extensions/web-stomp", extDir: "web-stomp" },
];

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
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

const installed = existsSync(`${STATE_DIR}/.e2e-installed.json`)
  ? JSON.parse(readFileSync(`${STATE_DIR}/.e2e-installed.json`, "utf8"))
  : [];

for (const p of PLUGINS) {
  run(`pnpm --filter ${p.filter} typecheck`);
  run(`pnpm --filter ${p.filter} test`);
  run(`pnpm --filter ${p.filter} build`);
  const pkgDir = join(REPO_ROOT, p.dir);
  run(`pnpm pack`, { cwd: pkgDir });
  const tgzName = readdirSync(pkgDir).find((n) => n.endsWith(".tgz"));
  const extPath = join(STATE_DIR, "extensions", p.extDir ?? p.id);
  extractTgz(join(pkgDir, tgzName), extPath);
  const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
  installProductionDeps(extPath);
  installed.push({ id: p.id, path: extPath, version: pkg.version });
}

writeFileSync(`${STATE_DIR}/.e2e-installed.json`, JSON.stringify(installed, null, 2));
run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`);
