/**
 * Build, pack, and install queue/channel plugins into OpenClaw E2E profile.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_SDK, PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { E2E_DIR, OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./utils.mjs";

const TOOL_PATH = `/opt/homebrew/bin:${process.env.PATH ?? ""}`;

/** @returns {NodeJS.ProcessEnv} */
function toolEnv() {
  return {
    ...process.env,
    PATH: TOOL_PATH,
    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://127.0.0.1:5672",
    ROCKETMQ_ENDPOINTS: process.env.ROCKETMQ_ENDPOINTS ?? "127.0.0.1:8081",
  };
}

/**
 * @param {string} cmd
 * @param {{ cwd?: string }} [opts]
 */
function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT, env: toolEnv(), ...opts });
}

/**
 * @param {string} tgzPath
 * @param {string} dest
 */
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

/** @param {string} extPath */
function installProductionDeps(extPath) {
  const pkgPath = join(extPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.devDependencies;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  run(`npm install --omit=dev --legacy-peer-deps --no-audit --no-fund`, { cwd: extPath });
}

/**
 * @param {string} pluginDir
 * @param {string} extPath
 */
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

/**
 * Build, pack, and install selected plugins.
 * @param {string[]|undefined} pluginIds
 * @returns {Array<{ id: string; path: string; version: string; tgz: string }>}
 */
export function installPlugins(pluginIds) {
  const ids = resolvePlugins(pluginIds);
  run("pnpm install");
  run(`pnpm --filter ${MESSAGE_SDK.filter} build`);

  /** @type {Array<{ id: string; path: string; version: string; tgz: string }>} */
  const installed = [];

  for (const def of PLUGIN_REGISTRY) {
    if (!ids.includes(def.id)) continue;

    run(`pnpm --filter ${def.filter} typecheck`);
    run(`pnpm --filter ${def.filter} test`);
    run(`pnpm --filter ${def.filter} build`);

    const pkgDir = join(REPO_ROOT, def.dir);
    run(`pnpm pack`, { cwd: pkgDir });
    const tgzName = readdirSync(pkgDir).find((n) => n.endsWith(".tgz"));
    if (!tgzName) throw new Error(`pack failed for ${def.filter} in ${pkgDir}`);
    const tgzPath = join(pkgDir, tgzName);

    const extPath = join(STATE_DIR, "extensions", def.extDir ?? def.id);
    extractTgz(tgzPath, extPath);
    overlayWorkspaceBuild(def.dir, extPath);

    const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
    installProductionDeps(extPath);
    installed.push({ id: def.id, path: extPath, version: pkg.version, tgz: tgzPath });
  }

  run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`);
  run(`node "${join(E2E_DIR, "install-message-sdk-deps.mjs")}"`);

  writeFileSync(join(STATE_DIR, ".e2e-installed.json"), JSON.stringify(installed, null, 2));
  console.log("\n[install] done:", installed.map((i) => `${i.id}@${i.version}`).join(", "));
  return installed;
}
