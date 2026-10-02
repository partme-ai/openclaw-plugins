/**
 * Build, pack, and install queue/channel plugins into OpenClaw E2E profile.
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
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
  wecom: "5f931beaa49752e861897de417cc80dca79da3233c6cd0a0b194d1553f9a939a",
  "wechat-ipad": "229a6deb3bf60e25075c1a65b565b3fef470adbf782aff4941774db40254da3f",
  rednode: "1253223ebe4085d3f074e6dfb53cfc2d039ca86b217981aa3243c6fe5e120323",
  amap: "ef5e72eef1e401544881f31bb56fac351e6f57c55dba46c9e50527f3dccae28f",
  bridge: "f119e5bec01ad15dffef67f20d946693107c2cd69d70412fcad9ffe572c41cab",
  mtls: "68aace35229d6ab668f2fe449ee13d79b843c12dbb4dcd97220a4bc195ac6c96",
  oauth2: "49c1f72f5fe9a2b16ff601ac9dd6584aa915fb799d09f438c3d159d71a7b9635",
  knowledge: "84f8c0139c2e4f42af0da6b563423f0ad573b8bff6381721821b9638d1d16410",
  memory: "8b694af79213368ed7f0fe24b337b04e7ec20ebb1a3d23d12c941643932c4871",
  openmem: "dd6b117eec6d9d77981adc9724f736ab3bb114f7dbddcd22ed287af16d512013",
  router: "cb0227659f7ccf5fea203e6108940e4a829f30e3bd740ba4c6f856184afe22f8",
  gotify: "db887c22e60191a7d816b18207f874ad16095a17071b38ac4e46ed4af2c6a3c1",
  douyin: "69765cc9a2c1b609f1356d388e71396a48abcc11d82a46d2ff4bb0c8ae303ddd",
  "wecom-kf": "61ce66fb81683d6e8ea405a830ab76a50de1b147423d26239d77fda8fca4a6ca",
  tracing: "e79ed8d7ea1e9de75fc89c6232decc0562d457286e2717c925cac4df55568239",
  mqtt: "d9de7761611d413b190e93551d4e1898f8ae8be13f8f05c5d67df6e404e6fd18",
  "web-mqtt": "2b5d11032e2d2762c5d125a0a3b698655c4e3e64e9f691a852ec9486702ba6f3",
  "web-socket": "fe87dbc1e5015ae1d77990c790d14659a1870ae4a62b3b3c1cd1b2b04abe35f9",
  rabbitmq: "930b90d74ea1c4873ff6cd36e228ab2c37bbc0f4e69dacdb157c9ff1414e3d15",
  "redis-stream": "3c17b4ba23476cb98d338e20de7ced12878981f7d62073abb439acd202419c6e",
  rocketmq: "80274658024d632fe9cd9965b86f87c8d8f6427b9c0dad8411132b1e5c61b939",
  meituan: "df4f5e8a93215472913f54647f4e74974ced422e10d381a94848b027029231f7",
  prometheus: "1e2c1228fdfd30b4f736b37d94cac7fbb4392bc1b4dd8ca64a13d98914e6732f",
  nacos: "a07659e8045bb1bc5d0582559b69e7374172bf7cbc76b0c6c47b6cccca18eb38",
  stomp: "cf1b3b4898380d94f1607372b198f1fa5861c120e1a4c6f456fb56252726d2e3",
  "web-stomp": "6d0f4a68894529ff366e736196fd569df5ff84090e2198ca9765201fe23d327c",
  wechat: "f4f14b36610a9bc4fadd7c99e9b3c04cc6a2a29e2ac734074e889cb2128fe6d4",
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

/**
 * Build, pack, and install selected plugins.
 * @param {string[]|undefined} pluginIds
 * @returns {Array<{ id: string; path: string; version: string; tgz: string; artifactSha256: string }>}
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

  /** @type {Array<{ id: string; path: string; version: string; tgz: string; artifactSha256: string }>} */
  const installed = [];
  const candidateDir = join(REPO_ROOT, "scripts/e2e/reports/candidates");
  const candidateRunId = randomUUID();
  const candidates = [];

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
