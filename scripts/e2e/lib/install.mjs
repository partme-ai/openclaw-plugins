/**
 * Build, pack, and install queue/channel plugins into OpenClaw E2E profile.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MESSAGE_SDK, PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./utils.mjs";

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
function installProductionDeps(extPath, messageSdkArchive) {
  const pkgPath = join(extPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const consumesMessageSdk = ["dependencies", "peerDependencies", "optionalDependencies"]
    .some((section) => pkg[section]?.["@partme.ai/openclaw-message-sdk"]);
  delete pkg.devDependencies;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  const sdkArg = consumesMessageSdk ? ` --no-save "${messageSdkArchive}"` : "";
  run(`npm install --omit=dev --legacy-peer-deps --no-audit --no-fund${sdkArg}`, { cwd: extPath });
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
  const packRoot = mkdtempSync(join(tmpdir(), "openclaw-e2e-packs-"));
  const sdkPackDir = join(packRoot, MESSAGE_SDK.id);
  mkdirSync(sdkPackDir, { recursive: true });
  run(`pnpm pack --pack-destination "${sdkPackDir}"`, { cwd: join(REPO_ROOT, MESSAGE_SDK.dir) });
  const sdkArchives = readdirSync(sdkPackDir).filter((name) => name.endsWith(".tgz"));
  if (sdkArchives.length !== 1) {
    rmSync(packRoot, { recursive: true, force: true });
    throw new Error(`message-sdk pack produced ${sdkArchives.length} archives`);
  }
  const messageSdkArchive = join(sdkPackDir, sdkArchives[0]);

  /** @type {Array<{ id: string; path: string; version: string; tgz: string }>} */
  const installed = [];

  try {
    for (const def of PLUGIN_REGISTRY) {
      if (!ids.includes(def.id)) continue;

      run(`pnpm --filter ${def.filter} typecheck`);
      run(`pnpm --filter ${def.filter} test`);
      run(`pnpm --filter ${def.filter} build`);

      const pkgDir = join(REPO_ROOT, def.dir);
      const pluginPackDir = join(packRoot, def.id);
      mkdirSync(pluginPackDir, { recursive: true });
      run(`pnpm pack --pack-destination "${pluginPackDir}"`, { cwd: pkgDir });
      const archives = readdirSync(pluginPackDir).filter((name) => name.endsWith(".tgz"));
      if (archives.length !== 1) {
        throw new Error(`pack produced ${archives.length} archives for ${def.filter}`);
      }
      const [tgzName] = archives;
      const tgzPath = join(pluginPackDir, tgzName);

      const extPath = join(STATE_DIR, "extensions", def.extDir ?? def.id);
      extractTgz(tgzPath, extPath);
      overlayWorkspaceBuild(def.dir, extPath);

      const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
      installProductionDeps(extPath, messageSdkArchive);
      // Register the extracted local tarball with OpenClaw's installed-plugin
      // index. Merely adding plugins.load.paths is insufficient on 2026.7.1:
      // startup migrations may otherwise treat an unpublished configured
      // plugin as missing and attempt an npm repair before Gateway startup.
      run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins install --link "${extPath}"`);
      installed.push({ id: def.id, path: extPath, version: pkg.version, tgz: tgzName });
    }

    run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`);

    writeFileSync(join(STATE_DIR, ".e2e-installed.json"), JSON.stringify(installed, null, 2));
    console.log("\n[install] done:", installed.map((i) => `${i.id}@${i.version}`).join(", "));
    return installed;
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
}
