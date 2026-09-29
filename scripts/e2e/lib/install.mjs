/**
 * Build, pack, and install queue/channel plugins into OpenClaw E2E profile.
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { MESSAGE_SDK, PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./utils.mjs";

const TOOL_PATH = `/opt/homebrew/bin:${process.env.PATH ?? ""}`;
const APPROVED_E2E_CAPABILITIES = {
  tracing: { distributedTracing: true },
  mqtt: { protocolBridge: true, iot: true },
  "wecom-kf": { humanTransfer: true, satisfactionSurvey: true, sessionManagement: true },
};
// Exact reviewed E2E package snapshots. Update only after reviewing the changed
// package, including dist; this does not claim a complete runtime surface list.
const APPROVED_E2E_ARTIFACT_SHA256 = {
  router: "5eb633c4bb60e27964f90820bd457d49ea848b733cc9c6556556189acb57a5dd",
  gotify: "f996d1931270e0e79ef5521f04b165d06a805eedbcc0a80b98b0f5f50301626d",
  douyin: "2f48eb5b1e436da390c8240c053abba4b0a3c75f746a4067b3b34bdb63888057",
  "wecom-kf": "12f9e8d27daff605cefad17e1214b38fcf028ba3979ed7d4af548776eb45f2b9",
  tracing: "603e57996443a8eff0fc3cc7364579fa0a66dfef000f4ecb062a7487983bf895",
  mqtt: "9a1d7af3ca8ee0f652c4bf695072377aae9b161a2cb510ba9cf0afba12c1a917",
};
const REVIEWED_CONSENT_IDS = new Set(Object.keys(APPROVED_E2E_ARTIFACT_SHA256));

function isChildOf(parent, child) {
  const suffix = relative(parent, child);
  return suffix.length > 0 && !suffix.startsWith("..") && !isAbsolute(suffix);
}

/** npm may create these later; they must not be hidden in a packed candidate. */
export function assertCleanPackedArtifact(root) {
  for (const name of ["node_modules", "package-lock.json"]) {
    if (existsSync(join(root, name))) throw new Error(`Refusing packed artifact with ${name}`);
  }
}

/** Hash every packaged file that can affect plugin behavior after npm adds dependencies. */
export function reviewedArtifactDigest(root) {
  const hash = createHash("sha256");
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (prefix === "" && ["node_modules", "package-lock.json"].includes(entry.name)) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, name);
      } else if (entry.isFile()) {
        hash.update(name).update("\0").update(readFileSync(path)).update("\0");
      } else {
        throw new Error(`Refusing unsupported artifact entry: ${name}`);
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

/** Confirm --force only for a packed plugin from this checkout in a disposable E2E profile. */
export function trustedE2ELinkArgs(pluginDir, extPath, repoRoot = REPO_ROOT, stateDir = STATE_DIR, pluginId, approvedArtifacts = APPROVED_E2E_ARTIFACT_SHA256) {
  const realRepo = realpathSync(repoRoot);
  const realSource = realpathSync(join(repoRoot, pluginDir));
  const realState = realpathSync(stateDir);
  const realDestination = realpathSync(extPath);
  if (!basename(realState).toLowerCase().includes("e2e") ||
      !isChildOf(realRepo, realSource) ||
      !isChildOf(join(realState, "extensions"), realDestination)) {
    throw new Error("Refusing forced install outside this checkout's disposable E2E plugin directories");
  }
  const args = ["--profile", PROFILE, "plugins", "install", "--link", "--force"];
  const approvedCapabilities = APPROVED_E2E_CAPABILITIES[pluginId];
  const consentRequired = REVIEWED_CONSENT_IDS.has(pluginId);
  if (pluginId) {
    const definition = PLUGIN_REGISTRY.find((entry) => entry.id === pluginId);
    if (!definition || pluginDir !== definition.dir) {
      throw new Error(`Refusing install for unregistered ${pluginId} source`);
    }
    for (const path of [realSource, realDestination]) {
      const manifest = JSON.parse(readFileSync(join(path, "openclaw.plugin.json"), "utf8"));
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      const actual = manifest.capabilities;
      if (manifest.id !== pluginId || pkg.name !== definition.filter) {
        throw new Error(`Refusing install for changed ${pluginId} package identity`);
      }
      if (approvedCapabilities && (typeof actual !== "object" || actual === null ||
          Object.keys(actual).length !== Object.keys(approvedCapabilities).length ||
          Object.entries(approvedCapabilities).some(([key, value]) => actual[key] !== value))) {
        throw new Error(`Refusing capability consent for changed ${pluginId} manifest`);
      }
      if (!approvedCapabilities && Object.keys(actual ?? {}).length > 0) {
        throw new Error(`Refusing unlisted capability consent for ${pluginId}`);
      }
    }
  }
  if (consentRequired) {
    const expected = approvedArtifacts[pluginId];
    if (!expected || reviewedArtifactDigest(realDestination) !== expected) {
      throw new Error(`Refusing capability consent for changed ${pluginId} package artifact`);
    }
    args.push("--accept-capabilities");
  }
  return [...args, realDestination];
}

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
      if (REVIEWED_CONSENT_IDS.has(def.id)) assertCleanPackedArtifact(extPath);

      const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
      installProductionDeps(extPath, messageSdkArchive);
      // Register the extracted local tarball with OpenClaw's installed-plugin
      // index. Merely adding plugins.load.paths is insufficient on 2026.7.1:
      // startup migrations may otherwise treat an unpublished configured
      // plugin as missing and attempt an npm repair before Gateway startup.
      const installArgs = trustedE2ELinkArgs(def.dir, extPath, REPO_ROOT, STATE_DIR, def.id);
      console.log(`\n$ ${OPENCLAW_BIN} ${installArgs.slice(0, -1).join(" ")} "${extPath}"`);
      execFileSync(OPENCLAW_BIN, installArgs, { stdio: "inherit", cwd: REPO_ROOT, env: toolEnv() });
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
