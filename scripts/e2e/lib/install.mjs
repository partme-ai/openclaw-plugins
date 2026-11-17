/**
 * Build, pack, and install queue/channel plugins into OpenClaw E2E profile.
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { MESSAGE_SDK, PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "./utils.mjs";

const TOOL_PATH = `/opt/homebrew/bin:${process.env.PATH ?? ""}`;
const APPROVED_E2E_CAPABILITIES = {
  amap: { amapWebService: true },
  mtls: { security: true, mtls: true, tls: true, authentication: true, reverseProxy: true, websocketProxy: true },
  oauth2: { authentication: true, reverseProxy: true, websocketProxy: true, oidcDiscovery: true, authorizationCode: true, pkce: true, refreshToken: true, tokenRevocation: true, tokenIntrospection: true },
  knowledge: { knowledgeRAG: true },
  tracing: { distributedTracing: true },
  mqtt: { protocolBridge: true, iot: true },
  "web-mqtt": { protocolBridge: true, websocket: true },
  "web-socket": { protocolBridge: true },
  rabbitmq: {},
  meituan: {},
  prometheus: { metricsExport: true },
  nacos: {},
  stomp: { protocolBridge: true, tcp: true, tls: true, transactions: true },
  "web-stomp": { protocolBridge: true, websocket: true, wss: true },
  "wecom-kf": { humanTransfer: true, satisfactionSurvey: true, sessionManagement: true },
  wechat: {},
};
// Exact reviewed E2E package snapshots. Update only after reviewing the changed
// package, including dist; this does not claim a complete runtime surface list.
const APPROVED_E2E_ARTIFACT_SHA256 = {
  wecom: "9744411162131e888ded53f95742aaf1b69340b13daae914393ed02f10be6790",
  "wechat-ipad": "db2202c04bd8b6f3d155f6232e6147ca785a91e33f4e1be27b583cd7c461cd23",
  rednode: "4d459de8cb1793ce46de2616c84dfa6762d0af2b653ed6fe5b004a2b611e5e15",
  amap: "c27e9ab7f25e8c768274d3249a4fef2b5c56cfa9d2008c845c11f2904684ba4b",
  bridge: "58c94421683e7c2d1998df5d3a9d8dbe4f555f2bacffe54546eb8a0166a7c048",
  mtls: "c8d393078854081b0cc95d8aa6f139cea013ebe33ffa04acaac9847786fa9b92",
  oauth2: "ac4fb2c3531ecd49db92e8fe1a9f8644d105eabc85ce1cf8ac073126035dc299",
  knowledge: "7c5eb7d82954f6decd8e4cf64d0f5052edc884597d424807c51424ef510a2c99",
  memory: "7432bfb1a77b396a3bdc0f2f6da69efef4669b76d5e0ce78f823b99d0349eee9",
  openmem: "55b42dac4b1c41e4e3bbba0a71d8d1326fa2501e3ecbe7305d00049951954e65",
  router: "e9db8c85bc21a1c5688945d4f44f27ee2b4ccd72319997ddb144bb9230dee68e",
  gotify: "62963360712ed5f70763a037140ed16f3d8468945fc92a1d5b32802958928a94",
  douyin: "918f544f4561c6ade824dd3f1378dd0be9afa46fdccef9e87d6dd9022ccd39f2",
  "wecom-kf": "bb2df1376a2d4bcaa0394d9a60b396636b0f5e4237fa194e5c2ce55e0f0b6105",
  tracing: "5aa9277bfb657deb6c3d34880d038a8ad2cb5255af9b49d232e5374a94939b6e",
  mqtt: "38de2b6f5a82f3b07888c5dbf552dac588fe3d003e853c40218992e1279ff115",
  "web-mqtt": "ffbcf96f7bfe1a396c846016ba3c3ad8849c7dd1536a1268f0cd26ef7794d856",
  "web-socket": "f561511859b2c259ee90244c0c04979d34d8dab66331988970e373ec38a4735e",
  rabbitmq: "5d173ea4d78d8d13b8a30c080ab50526e60d761f8f5d1f7dd7a7e9cc996fb4c3",
  "redis-stream": "bc517ab8b3c0b6badc1cb258ef3b5fdbc9e5dc1b2d08963b94bb187e097d4e19",
  rocketmq: "cefaa0c7e69a8ae86647e04079c61b2268987ac1b5ab1d9428f828a2f4aafe25",
  meituan: "9f4966f98a8d2a270a4af784876edefe83695afab09c02b18d570ffb0fd898b3",
  prometheus: "b95ac64670a43e44df8b2d5d9f9d174c4cb9a389589684461b4604e7f9fc0e40",
  nacos: "645767de464adb965faa0c84e51c41e6a5974a5edea8a2bb4881a265f6c81bfe",
  stomp: "833186ccd1fa69d97876275fd035be9df83538626a3b212900d3fbd36cccd90f",
  "web-stomp": "a48ea7a75d7cda9d2453677dfd792f7c8375f220092475b7a96b972d25081aba",
  wechat: "ba71780054f6315bebcd53a4a3b0616467df538ba08633f0c033c5aa3dd758f6",
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
      const actualCapabilities = actual === undefined ? {} : actual;
      if (manifest.id !== pluginId || pkg.name !== definition.filter) {
        throw new Error(`Refusing install for changed ${pluginId} package identity`);
      }
      if (approvedCapabilities && (typeof actualCapabilities !== "object" || actualCapabilities === null ||
          Object.keys(actualCapabilities).length !== Object.keys(approvedCapabilities).length ||
          Object.entries(approvedCapabilities).some(([key, value]) => actualCapabilities[key] !== value))) {
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
  // --omit=dev 仍会解析根包的开发依赖；纯插件归档在宿主提供 peer 时没有待安装项。
  const hasRuntimeDeps = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).length > 0;
  const hasInstallHook = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"]
    .some((hook) => pkg.scripts?.[hook]);
  if (!hasRuntimeDeps && !hasInstallHook) return;
  const consumesMessageSdk = ["dependencies", "peerDependencies", "optionalDependencies"]
    .some((section) => pkg[section]?.["@partme.ai/openclaw-message-sdk"]);
  const sdkArg = consumesMessageSdk ? ` --no-save "${messageSdkArchive}"` : "";
  run(`npm install --omit=dev --legacy-peer-deps --no-audit --no-fund${sdkArg}`, { cwd: extPath });
}

/** Extract a packed plugin and record the package content before dependency installation. */
export function preparePackedCandidate(tgzPath, extPath) {
  extractTgz(tgzPath, extPath);
  return reviewedArtifactDigest(extPath);
}

/** 测试已校验的发行包时保留原归档字节；常规开发仍从工作区构建。 */
function resolveCandidate(def, packRoot, releaseDir) {
  const pkgDir = join(REPO_ROOT, def.dir);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const filename = `${pkg.name.replace(/^@/u, "").replace("/", "-")}-${pkg.version}.tgz`;
  if (releaseDir) return join(releaseDir, filename);
  if (def.id !== MESSAGE_SDK.id) run(`pnpm --filter ${def.filter} typecheck`);
  run(`pnpm --filter ${def.filter} build`);
  if (def.id !== MESSAGE_SDK.id) run(`pnpm --filter ${def.filter} test`);
  const packDir = join(packRoot, def.id);
  mkdirSync(packDir, { recursive: true });
  execFileSync("pnpm", ["pack", "--pack-destination", packDir], { cwd: pkgDir, env: toolEnv(), stdio: "inherit" });
  return join(packDir, filename);
}

/**
 * Build, pack, and install selected plugins.
 * @param {string[]|undefined} pluginIds
 * @returns {Array<{ id: string; path: string; version: string; tgz: string; artifactSha256: string }>}
 */
export function installPlugins(pluginIds) {
  const ids = resolvePlugins(pluginIds);
  const releaseDir = process.env.OPENCLAW_E2E_ARCHIVES ? realpathSync(resolve(process.env.OPENCLAW_E2E_ARCHIVES)) : undefined;
  if (!releaseDir) run("pnpm install --frozen-lockfile");
  const packRoot = mkdtempSync(join(tmpdir(), "openclaw-e2e-packs-"));

  /** @type {Array<{ id: string; path: string; version: string; tgz: string; artifactSha256: string }>} */
  const installed = [];
  const candidateDir = join(REPO_ROOT, "scripts/e2e/reports/candidates");
  const candidateRunId = randomUUID();
  const candidates = [];

  try {
    const messageSdkArchive = resolveCandidate(MESSAGE_SDK, packRoot, releaseDir);
    for (const def of PLUGIN_REGISTRY) {
      if (!ids.includes(def.id)) continue;

      const tgzPath = resolveCandidate(def, packRoot, releaseDir);
      const tgzName = basename(tgzPath);
      const artifactSha256 = createHash("sha256").update(readFileSync(tgzPath)).digest("hex");
      mkdirSync(candidateDir, { recursive: true });
      const archivePath = join(candidateDir, `${candidateRunId}-${def.id}.tgz`);
      cpSync(tgzPath, archivePath, { errorOnExist: true, force: false });

      const extPath = join(STATE_DIR, "extensions", def.extDir ?? def.id);
      const packedContentDigest = preparePackedCandidate(tgzPath, extPath);
      if (REVIEWED_CONSENT_IDS.has(def.id)) assertCleanPackedArtifact(extPath);

      const pkg = JSON.parse(readFileSync(join(extPath, "package.json"), "utf8"));
      installProductionDeps(extPath, messageSdkArchive);
      if (reviewedArtifactDigest(extPath) !== packedContentDigest) {
        throw new Error(`${def.id}: installed package content differs from packed tarball`);
      }
      // Register the extracted local tarball with OpenClaw's installed-plugin
      // index. Merely adding plugins.load.paths is insufficient on 2026.7.1:
      // startup migrations may otherwise treat an unpublished configured
      // plugin as missing and attempt an npm repair before Gateway startup.
      const installArgs = trustedE2ELinkArgs(def.dir, extPath, REPO_ROOT, STATE_DIR, def.id);
      console.log(`\n$ ${OPENCLAW_BIN} ${installArgs.slice(0, -1).join(" ")} "${extPath}"`);
      execFileSync(OPENCLAW_BIN, installArgs, { stdio: "inherit", cwd: REPO_ROOT, env: toolEnv() });
      installed.push({ id: def.id, path: extPath, version: pkg.version, tgz: tgzName, artifactSha256 });
      candidates.push({ id: def.id, version: pkg.version, artifactSha256, archivePath });
    }

    run(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`);

    writeFileSync(join(STATE_DIR, ".e2e-installed.json"), JSON.stringify(installed, null, 2));
    const candidateManifest = join(candidateDir, `${candidateRunId}.json`);
    writeFileSync(candidateManifest, JSON.stringify({ candidates }, null, 2), { flag: "wx" });
    Object.defineProperty(installed, "candidateManifest", { value: candidateManifest });
    console.log("\n[install] done:", installed.map((i) => `${i.id}@${i.version}`).join(", "));
    return installed;
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
}
