#!/usr/bin/env node
/**
 * check-plugin-structure.mjs — OpenClaw plugin structure standard checker.
 *
 * Standard reference: doc/OpenClaw-Plugin-Structure-Standard.md v1.0
 * Profiles (doc §1.2): channel-base | channel-extended | channel-legacy |
 *   capability-memory | capability | capability-cluster | infra | sdk-rag | sdk | utility-minimal
 *
 * Modes:
 *   default       — Profile-aware rules; Tier A / _template channel-base MUST → error
 *   --strict-base — all channel-base Base Profile MUST violations → exit 1
 *   --strict-new  — channel-extended (wecom-kf/wecom) Extended thresholds → exit 1
 *   --json        — machine-readable report (includes profile per plugin)
 *   --plugin <id> — single plugin filter
 *   --help        — usage
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const STANDARD_VERSION = "1.0";
const ROOT = new URL("..", import.meta.url).pathname;
const EXTENSIONS_DIR = join(ROOT, "extensions");
const BASE_TEMPLATE_ID = "_template";

/** @typedef {'channel-base'|'channel-extended'|'channel-legacy'|'capability-memory'|'capability'|'capability-cluster'|'infra'|'sdk-rag'|'sdk'|'utility-minimal'} PluginProfile */

/** Explicit plugin → profile mapping (doc §10.1.1). Overrides manifest/heuristic. */
const PLUGIN_PROFILE_OVERRIDE = Object.freeze({
  _template: "channel-base",
  wecom: "channel-extended",
  "wecom-kf": "channel-extended",
  bridge: "channel-base",
  memory: "capability-memory",
  openmem: "capability-memory",
  mtls: "capability",
  oauth2: "capability",
  cluster: "capability-cluster",
  nacos: "infra",
  tracing: "infra",
  prometheus: "infra",
  knowledge: "sdk-rag",
  "message-sdk": "sdk",
  router: "utility-minimal",
});

/** Plugins that MUST satisfy Extended Profile under --strict-new */
const EXTENDED_STRICT_PLUGINS = new Set(["wecom-kf", "wecom"]);

/** channel-base plugins enforced at error level in default mode (Tier A) */
const BASE_STRICT_PLUGINS = new Set([
  "amap",
  "douyin",
  "gotify",
  "meituan",
  "mqtt",
  "rabbitmq",
  "redis-stream",
  "rednode",
  "rocketmq",
  "stomp",
  "web-mqtt",
  "web-stomp",
]);

/** Profiles that require Channel Base flat src/ files (doc §5.1) */
const CHANNEL_PROFILES = new Set([
  "channel-base",
  "channel-extended",
  "channel-legacy",
]);

/** Root MUST files for capability / infra / sdk-rag plugins */
const CAPABILITY_ROOT_MUST = [
  "openclaw.plugin.json",
  "package.json",
  "README.md",
  ".gitignore",
  "LICENSE",
];

/** Minimal root MUST for shared SDK packages */
const SDK_ROOT_MUST = ["package.json", "README.md", ".gitignore", "LICENSE"];

/** Minimal root MUST for utility plugins */
const UTILITY_ROOT_MUST = ["openclaw.plugin.json", "package.json", "README.md"];

/** Base Profile — plugin root MUST (doc §4.1–§4.2, channel profiles) */
const BASE_ROOT_MUST = [
  "openclaw.plugin.json",
  "package.json",
  "tsconfig.json",
  "README.md",
  ".gitignore",
  "LICENSE",
  "tsup.config.ts",
  "vitest.config.ts",
];

/** Base Profile — plugin root SHOULD (doc §4.1) */
const BASE_ROOT_SHOULD = ["README.zh-CN.md"];

/** Base Profile — src/ MUST (doc §5.1) */
const BASE_SRC_MUST = [
  "index.ts",
  "channel.ts",
  "channel-setup-factory.ts",
  "runtime.ts",
  "inbound.ts",
  "outbound.ts",
  "onboarding.ts",
  "setup-entry.ts",
  "types.ts",
  "config.ts",
  "transport/server.ts",
];

/** Base flat src files allowed at src/ root (for drift counting) */
const BASE_SRC_FLAT = new Set([
  "index.ts",
  "channel.ts",
  "channel-setup-factory.ts",
  "runtime.ts",
  "inbound.ts",
  "outbound.ts",
  "onboarding.ts",
  "setup-entry.ts",
  "types.ts",
  "config.ts",
]);

/** Known legacy runtime filenames at plugin root — MUST NOT (doc §4.2) */
const LEGACY_ROOT_RUNTIME_TS = new Set([
  "index.ts",
  "api.ts",
  "runtime-api.ts",
  "channel-plugin-api.ts",
  "setup-entry.ts",
  "setup-api.ts",
  "secret-contract-api.ts",
]);

/** Build/config TS allowed at plugin root */
const ALLOWED_ROOT_TS = new Set(["tsup.config.ts", "vitest.config.ts"]);

/** Compat manifests — MAY; warn when present (doc §4.2) */
const COMPAT_MANIFESTS = new Set(["clawdbot.plugin.json", "moltbot.plugin.json"]);

/** Forbidden vague stems (doc §8.1) */
const VAGUE_NAMES = new Set(["utils", "helper", "helpers", "common", "misc", "temp"]);

/** Forbidden top-level src subdirs (doc §8.1) */
const FORBIDDEN_SRC_DIRS = new Set(["utils", "helpers", "helper", "common", "misc"]);

/** Extended semantic dirs (doc §7.2) — checked on EXTENDED_STRICT_PLUGINS */
const EXTENDED_SEMANTIC_DIRS = [
  "channel",
  "config",
  "runtime",
  "webhook",
  "dispatch",
  "outbound",
  "agent",
  "tools",
  "mcp",
  "media",
  "types",
];

/** Default src-root drift threshold for non-strict plugins (doc §7.1 uses >15 to enable; checker warns earlier) */
const SRC_ROOT_DRIFT_THRESHOLD_DEFAULT = 5;

/** Strict plugins (--strict-base / BASE_STRICT_PLUGINS / --strict-new extended): allowlist-only at src/ root */
const SRC_ROOT_DRIFT_THRESHOLD_STRICT = 0;

/** Extended index.ts line threshold (doc §7.1) */
const EXTENDED_INDEX_LINE_THRESHOLD = 150;

const SKIP_WALK_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Base flat files checked for pointless / mis-aimed re-export shims */
const BASE_SHIM_FILES = [
  "outbound.ts",
  "inbound.ts",
  "channel.ts",
  "runtime.ts",
  "onboarding.ts",
  "config.ts",
  "types.ts",
  "setup-entry.ts",
  "channel-setup-factory.ts",
];

/** Max lines for a file to be treated as a thin shim (warn-only heuristic) */
const BASE_SHIM_LINE_THRESHOLD = 15;

/** Base core files checked for substantive exports / logic (doc §5.1, §6) */
const BASE_CORE_SUBSTANCE_FILES = BASE_SRC_MUST.filter((rel) => rel !== "index.ts");

/**
 * Whether file content exports a public symbol (function, const, type, or re-export).
 * @param {string} content
 */
function hasExportSurface(content) {
  return (
    /\bexport\s+(async\s+)?function\b/.test(content) ||
    /\bexport\s+(const|let|var|class|interface|type|enum)\b/.test(content) ||
    /\bexport\s+\{[^}]+\}\s+from\s+['"]/.test(content) ||
    /\bexport\s+\*\s+from\s+['"]/.test(content) ||
    /\bexport\s+default\b/.test(content) ||
    /\bexport\s+\{/.test(content)
  );
}

/**
 * Strip block/line comments for stub detection.
 * @param {string} content
 */
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
}

/**
 * True when a Base core file is an empty stub (version-only runtime, no exports, etc.).
 * Extended plugins MAY use thin semantic barrels — those still export symbols.
 * @param {string} rel e.g. runtime.ts
 * @param {string} content
 */
function isEmptyCoreStub(rel, content) {
  const code = stripComments(content);
  if (!code) return true;

  if (!hasExportSurface(content)) return true;

  /** Semantic barrel re-exports are substantive for Extended plugins */
  if (/\bexport\s+\*\s+from\s+['"]/.test(code)) return false;
  if (/\bexport\s+\{[^}]+\}\s+from\s+['"]/.test(code)) return false;

  if (rel === "runtime.ts") {
    const hasRuntimeApi =
      /\bsetRuntime\b/.test(code) ||
      /\bset[A-Z]\w*Runtime\b/.test(code) ||
      /\bcreatePluginRuntimeStore\b/.test(code);
    if (!hasRuntimeApi) return true;
  }

  const nonEmptyLines = content
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith("//") && !t.startsWith("*") && t !== "*/" && !t.startsWith("/**");
    });

  if (nonEmptyLines.length < 3 && !/\bexport\s+\{[^}]+\}\s+from/.test(code)) {
    return !/\bexport\s+(async\s+)?function\b/.test(code);
  }

  return false;
}

/**
 * Warn/error when Base core src files are missing substance (doc §5.1, §6).
 * @param {string} pluginDir
 * @param {string} pluginId
 * @param {Issue[]} issues
 * @param {ReturnType<typeof parseArgs>} flags
 */
function checkBaseCoreSubstance(pluginDir, pluginId, profile, issues, flags) {
  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) return;

  const indexPath = join(srcDir, "index.ts");
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, "utf8");
    const hasOrchestration =
      /\bdefineChannelPluginEntry\b/.test(indexContent) ||
      /\bregister\s*\(\s*api\b/.test(indexContent) ||
      /\bregister\s*:\s*\w+/.test(indexContent);
    if (!hasOrchestration) {
      addIssue(issues, {
        rule: "base-core-substance",
        path: indexPath,
        message:
          "src/index.ts MUST orchestrate via defineChannelPluginEntry or register(api); move business logic to semantic modules",
        pluginId,
        profile,
        category: "base-should",
        flags,
      });
    }
  }

  for (const rel of BASE_CORE_SUBSTANCE_FILES) {
    const path = join(srcDir, rel);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    const lines = content.split("\n").length;
    const baseStem = basename(rel, ".ts");

    if (isEmptyCoreStub(rel, content)) {
      addIssue(issues, {
        rule: "base-core-substance",
        path,
        message: `src/${rel} MUST contain real logic or a semantic barrel with exports (${lines} lines); see extensions/_template`,
        pluginId,
        profile,
        category: "base-should",
        flags,
      });
      continue;
    }

    if (lines <= BASE_SHIM_LINE_THRESHOLD) {
      const reExportTargets = [
        ...content.matchAll(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['"](\.\/[^'"]+)['"]/g),
      ].map((match) => match[1]);

      for (const target of reExportTargets) {
        if (isRootBaseFlatReExport(target)) continue;
        if (isMisaimedBaseShimTarget(baseStem, target)) {
          addIssue(issues, {
            rule: "base-core-substance",
            path,
            message: `${rel} re-exports from unrelated module ${target}; use ./${baseStem}/ or inline logic`,
            pluginId,
            profile,
            category: "base-should",
            flags,
          });
        }
      }
    }
  }
}

/**
 * First path segment after `./` for a relative import target.
 * @param {string} target
 */
function shimTargetDir(target) {
  const normalized = target.replace(/^\.\//, "");
  const slash = normalized.indexOf("/");
  return slash === -1 ? normalized.replace(/\.js$/, "") : normalized.slice(0, slash);
}

/**
 * Whether a Base flat file re-exports from an unrelated semantic directory.
 * @param {string} baseStem e.g. outbound
 * @param {string} target e.g. ./channel/onboarding.js
 */
function isMisaimedBaseShimTarget(baseStem, target) {
  const dir = shimTargetDir(target);

  /** @type {Record<string, string[]>} */
  const allowedFirstSegment = {
    outbound: ["outbound"],
    inbound: ["inbound", "dispatch", "webhook"],
    channel: ["channel"],
    runtime: ["runtime"],
    onboarding: ["onboarding", "channel"],
    config: ["config"],
    types: ["types", "config"],
    "setup-entry": ["channel", "setup"],
    "channel-setup-factory": ["channel-setup-factory", "onboarding", "channel"],
  };

  const allowed = allowedFirstSegment[baseStem];
  if (!allowed) return false;
  if (allowed.includes(dir)) return false;

  /** Cross-semantic hops that are always suspicious */
  /** @type {Record<string, string[]>} */
  const forbidden = {
    outbound: ["channel", "onboarding", "config", "inbound", "runtime", "types", "dispatch", "webhook"],
    inbound: ["onboarding", "outbound", "channel-setup-factory", "config", "runtime"],
    runtime: ["onboarding", "outbound", "inbound", "config", "channel"],
    onboarding: ["outbound", "inbound", "runtime", "webhook", "dispatch"],
    config: ["outbound", "inbound", "onboarding", "runtime", "webhook", "dispatch"],
    types: ["onboarding", "runtime", "outbound", "inbound", "webhook", "dispatch"],
    channel: ["onboarding", "config", "inbound", "outbound", "runtime"],
  };

  const bad = forbidden[baseStem];
  return Boolean(bad?.includes(dir));
}

/**
 * True when target is a root-level Base flat re-export (e.g. ./onboarding.js), not ./outbound/index.js.
 * @param {string} target
 */
function isRootBaseFlatReExport(target) {
  const normalized = target.replace(/^\.\//, "").replace(/\.js$/, "");
  if (normalized.includes("/")) return false;
  return BASE_SRC_FLAT.has(`${normalized}.ts`);
}

/**
 * Warn on thin Base shims that re-export from wrong semantics or another Base flat file.
 * @param {string} pluginDir
 * @param {string} pluginId
 * @param {Issue[]} issues
 * @param {ReturnType<typeof parseArgs>} flags
 */
function checkBaseShimSemantics(pluginDir, pluginId, profile, issues, flags) {
  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) return;

  for (const fileName of BASE_SHIM_FILES) {
    const path = join(srcDir, fileName);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    const lines = content.split("\n").length;
    if (lines > BASE_SHIM_LINE_THRESHOLD) continue;

    const baseStem = fileName.replace(/\.ts$/, "");
    const reExportTargets = [
      ...content.matchAll(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['"](\.\/[^'"]+)['"]/g),
    ].map((match) => match[1]);

    for (const target of reExportTargets) {
      const targetFile = target.replace(/^\.\//, "").replace(/\.js$/, ".ts");
      const targetBase = basename(targetFile);
      const isSetupPairHop =
        (baseStem === "channel-setup-factory" && targetBase === "onboarding.ts") ||
        (baseStem === "onboarding" && targetBase === "channel-setup-factory.ts");

      if (isRootBaseFlatReExport(target) && !isSetupPairHop) {
        addIssue(issues, {
          rule: "base-shim-chain",
          path,
          message: `${fileName} re-exports from Base flat ${target} (collapse to semantic module or import directly)`,
          pluginId,
          profile,
          category: "base-should",
          flags,
        });
        continue;
      }

      if (isMisaimedBaseShimTarget(baseStem, target)) {
        addIssue(issues, {
          rule: "base-shim-semantics",
          path,
          message: `${fileName} (${lines} lines) re-exports from unrelated module ${target}; use ./${baseStem}/ or documented Migration.md target`,
          pluginId,
          profile,
          category: "base-should",
          flags,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    strictBase: false,
    strictNew: false,
    json: false,
    help: false,
    plugin: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--strict" || arg === "--strict-base") {
      flags.strictBase = true;
    } else if (arg === "--strict-new") {
      flags.strictNew = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--plugin") {
      flags.plugin = args[++i] ?? null;
      if (!flags.plugin) {
        console.error("Error: --plugin requires a plugin id");
        process.exit(2);
      }
    } else if (arg.startsWith("-")) {
      console.error(`Error: unknown flag ${arg}`);
      process.exit(2);
    } else {
      console.error(`Error: unexpected argument ${arg}`);
      process.exit(2);
    }
  }

  return flags;
}

function printHelp() {
  console.log(`OpenClaw plugin structure checker (standard v${STANDARD_VERSION})

Usage:
  node scripts/check-plugin-structure.mjs [options]

Options:
  --plugin <id>     Check a single extension (e.g. wecom-kf, memory, message-sdk)
  --strict-base     channel-base Base Profile MUST violations fail the run (alias: --strict)
  --strict-new      channel-extended drift thresholds fail for wecom-kf and wecom
  --json            Emit JSON report on stdout (includes profile per plugin)
  --help, -h        Show this help

Profiles (doc §1.2):
  channel-base      Tier A channels + _template — full Base flat src/
  channel-extended  wecom, wecom-kf — Base + Extended semantic dirs
  channel-legacy    bridge — Phase 2 migration target
  capability-*      memory, mtls, oauth2, cluster — no channel.ts/inbound.ts
  infra             nacos, tracing, prometheus
  sdk / sdk-rag     message-sdk, knowledge
  utility-minimal   router

Tier A (channel-base, default error on MUST gaps):
  amap, douyin, gotify, meituan, mqtt, rabbitmq, redis-stream,
  rednode, rocketmq, stomp, web-mqtt, web-stomp

Reference: doc/OpenClaw-Plugin-Structure-Standard.md
`);
}

// ---------------------------------------------------------------------------
// Profile detection (doc §1.2)
// ---------------------------------------------------------------------------

/**
 * Whether the profile requires Channel Base flat src/ files.
 * @param {PluginProfile} profile
 */
function isChannelProfile(profile) {
  return CHANNEL_PROFILES.has(profile);
}

/**
 * Resolve checker profile for a plugin directory.
 * Priority: override map → manifest kind/channels → heuristics.
 * @param {string} pluginId
 * @param {string} pluginDir
 * @returns {{ profile: PluginProfile, source: 'override'|'manifest'|'heuristic' }}
 */
function detectProfile(pluginId, pluginDir) {
  if (PLUGIN_PROFILE_OVERRIDE[pluginId]) {
    return { profile: PLUGIN_PROFILE_OVERRIDE[pluginId], source: "override" };
  }

  const manifest = readJson(join(pluginDir, "openclaw.plugin.json"));

  if (manifest?.kind === "memory") {
    return { profile: "capability-memory", source: "manifest" };
  }

  if (manifest?.kind === "channel") {
    return { profile: "channel-base", source: "manifest" };
  }

  if (pluginId === "message-sdk" || pluginId.endsWith("-sdk")) {
    return { profile: "sdk", source: "heuristic" };
  }

  const channels = manifest?.channels;
  if (Array.isArray(channels) && channels.length > 0) {
    return { profile: "channel-base", source: "heuristic" };
  }

  if (manifest && Array.isArray(channels) && channels.length === 0) {
    return { profile: "capability", source: "heuristic" };
  }

  if (manifest) {
    return { profile: "capability", source: "heuristic" };
  }

  if (pluginId === "message-sdk") {
    return { profile: "sdk", source: "heuristic" };
  }

  return { profile: "channel-base", source: "heuristic" };
}

/**
 * Root MUST file list for a given profile.
 * @param {PluginProfile} profile
 */
function rootMustForProfile(profile) {
  if (isChannelProfile(profile)) return BASE_ROOT_MUST;
  if (profile === "sdk") return SDK_ROOT_MUST;
  if (profile === "utility-minimal") return UTILITY_ROOT_MUST;
  return CAPABILITY_ROOT_MUST;
}

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true });
}

function walk(dir, acc = []) {
  for (const entry of listDir(dir)) {
    if (SKIP_WALK_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    acc.push(path);
    if (entry.isDirectory()) walk(path, acc);
  }
  return acc;
}

function hasReadme(dir) {
  return existsSync(join(dir, "README.md")) || existsSync(join(dir, "README.zh-CN.md"));
}

function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, "utf8").split("\n").length;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Git-tracked paths under plugin dir (empty if not a git repo). */
function gitTrackedUnder(pluginDir) {
  try {
    const prefix = relative(ROOT, pluginDir).replace(/\\/g, "/");
    const out = execSync(`git ls-files -- "${prefix}"`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => join(ROOT, line));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Issue model
// ---------------------------------------------------------------------------

/**
 * @typedef {{ level: 'error'|'warn', rule: string, path: string, message: string }} Issue
 */

function pushIssue(issues, issue) {
  issues.push(issue);
}

/**
 * Resolve severity for a rule given plugin id, profile, and CLI mode (doc §10.2).
 */
function levelFor({ rule, pluginId, profile, category, flags }) {
  const isTemplate = pluginId === BASE_TEMPLATE_ID;
  const isExtendedStrict = EXTENDED_STRICT_PLUGINS.has(pluginId);
  const isBaseStrict = BASE_STRICT_PLUGINS.has(pluginId);
  const isChannel = isChannelProfile(profile);

  // Always error — committed artifacts (doc §4.2, §10.2)
  if (rule === "committed-dist" || rule === "committed-tgz") {
    return "error";
  }

  // Extended Profile — channel-extended only
  if (category === "extended") {
    if (flags.strictNew && isExtendedStrict) return "error";
    return "warn";
  }

  // Forbidden naming — channel profiles; strict-new on extended
  if (category === "naming") {
    if (flags.strictNew && isExtendedStrict && rule === "forbidden-src-dir") {
      return "error";
    }
    if (flags.strictNew && isExtendedStrict && rule === "store-state-coexist") {
      return "error";
    }
    return "warn";
  }

  // Capability / infra / sdk root MUST
  if (category === "capability-must") {
    if (flags.strictBase && isChannel) return "error";
    return "warn";
  }

  // Plugin entry / extensions for non-channel profiles
  if (category === "capability-manifest") {
    return "warn";
  }

  // Base MUST — channel profiles: _template + Tier A always error; --strict-base → all channel-base
  if (category === "base-must") {
    if (!isChannel) return "warn";
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Base SHOULD — channel profiles
  if (category === "base-should") {
    if (!isChannel) return "warn";
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Package / manifest MUST — channel profiles
  if (category === "manifest-must") {
    if (!isChannel) return "warn";
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Root MUST NOT runtime ts — warn in all modes (doc §10.2)
  if (category === "root-must-not") {
    return "warn";
  }

  // Profile migration advisory
  if (category === "profile-advisory") {
    return "warn";
  }

  return "warn";
}

function addIssue(issues, ctx) {
  const level = levelFor(ctx);
  pushIssue(issues, {
    level,
    rule: ctx.rule,
    path: ctx.path,
    message: ctx.message,
  });
}

/**
 * Resolve plugin runtime entry path from package.json or manifest.
 * @param {string} pluginDir
 */
function resolvePluginEntry(pluginDir) {
  const pkg = readJson(join(pluginDir, "package.json"));
  const manifest = readJson(join(pluginDir, "openclaw.plugin.json"));

  const candidates = [
    pkg?.openclaw?.extensions?.[0],
    pkg?.main,
    manifest?.main,
    "src/index.ts",
    "index.ts",
  ].filter(Boolean);

  for (const rel of candidates) {
    const normalized = rel.replace(/^\.\//, "").replace(/\.js$/, ".ts");
    const path = join(pluginDir, normalized);
    if (existsSync(path)) return path;
    const jsPath = join(pluginDir, rel.replace(/^\.\//, ""));
    if (existsSync(jsPath)) return jsPath;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkBaseRootMust(pluginDir, pluginId, profile, issues, flags) {
  for (const file of rootMustForProfile(profile)) {
    const path = join(pluginDir, file);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: isChannelProfile(profile) ? "base-root-must" : "capability-root-must",
        path,
        message: `${profile} MUST: missing ${file}`,
        pluginId,
        profile,
        category: isChannelProfile(profile) ? "base-must" : "capability-must",
        flags,
      });
    }
  }
}

function checkBaseRootShould(pluginDir, pluginId, profile, issues, flags) {
  if (!isChannelProfile(profile)) return;

  for (const file of BASE_ROOT_SHOULD) {
    const path = join(pluginDir, file);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: "base-root-should",
        path,
        message: `Base Profile SHOULD: missing ${file}`,
        pluginId,
        profile,
        category: "base-should",
        flags,
      });
    }
  }
}

/**
 * Capability / infra / sdk-rag / utility: entry point and openclaw.extensions.
 * @param {string} pluginDir
 * @param {string} pluginId
 * @param {PluginProfile} profile
 * @param {Issue[]} issues
 * @param {ReturnType<typeof parseArgs>} flags
 */
function checkCapabilityEntry(pluginDir, pluginId, profile, issues, flags) {
  if (isChannelProfile(profile) || profile === "sdk") return;

  const entry = resolvePluginEntry(pluginDir);
  if (!entry) {
    addIssue(issues, {
      rule: "capability-entry",
      path: join(pluginDir, "src/index.ts"),
      message: `${profile} MUST: missing plugin entry (src/index.ts, root index.ts, or manifest main)`,
      pluginId,
      profile,
      category: "capability-manifest",
      flags,
    });
  }

  const pkgPath = join(pluginDir, "package.json");
  const pkg = readJson(pkgPath);
  const extensions = pkg?.openclaw?.extensions;

  if (profile !== "utility-minimal" && profile !== "capability-memory") {
    if (!Array.isArray(extensions) || extensions.length === 0) {
      addIssue(issues, {
        rule: "openclaw-extensions",
        path: pkgPath,
        message: `${profile} SHOULD: package.json#openclaw.extensions[]`,
        pluginId,
        profile,
        category: "capability-manifest",
        flags,
      });
    }
  }
}

/**
 * SDK profile: require src/ and forbid Channel flat files at src root.
 * @param {string} pluginDir
 * @param {string} pluginId
 * @param {PluginProfile} profile
 * @param {Issue[]} issues
 * @param {ReturnType<typeof parseArgs>} flags
 */
function checkSdkProfile(pluginDir, pluginId, profile, issues, flags) {
  if (profile !== "sdk") return;

  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) {
    addIssue(issues, {
      rule: "sdk-src-dir",
      path: srcDir,
      message: "sdk profile MUST: plugin must contain src/",
      pluginId,
      profile,
      category: "capability-must",
      flags,
    });
    return;
  }

  for (const rel of BASE_SRC_MUST) {
    if (rel === "index.ts") continue;
    const path = join(srcDir, rel);
    if (existsSync(path)) {
      addIssue(issues, {
        rule: "sdk-no-channel-flat",
        path,
        message: `sdk profile MUST NOT: Channel flat file src/${rel}`,
        pluginId,
        profile,
        category: "capability-must",
        flags,
      });
    }
  }
}

/**
 * Advisory for channel-legacy plugins pending Phase 2 migration.
 * @param {string} pluginDir
 * @param {string} pluginId
 * @param {PluginProfile} profile
 * @param {Issue[]} issues
 * @param {ReturnType<typeof parseArgs>} flags
 */
function checkProfileAdvisory(pluginDir, pluginId, profile, issues, flags) {
  if (profile === "channel-legacy") {
    addIssue(issues, {
      rule: "profile-migration",
      path: pluginDir,
      message:
        "Profile channel-legacy: MUST migrate to channel-base in Phase 2 (full Base flat src/ skeleton)",
      pluginId,
      profile,
      category: "profile-advisory",
      flags,
    });
  }
}

function checkManifestAndPackage(pluginDir, pluginId, profile, issues, flags) {
  const manifestPath = join(pluginDir, "openclaw.plugin.json");
  const pkgPath = join(pluginDir, "package.json");

  const manifest = readJson(manifestPath);
  // _template keeps TEMPLATE_NAME placeholders until new-plugin.mjs materializes a real id
  if (
    isChannelProfile(profile) &&
    pluginId !== BASE_TEMPLATE_ID &&
    manifest?.id &&
    manifest.id !== pluginId
  ) {
    addIssue(issues, {
      rule: "manifest-id-match",
      path: manifestPath,
      message: `Manifest id "${manifest.id}" MUST match plugin directory "${pluginId}"`,
      pluginId,
      profile,
      category: "manifest-must",
      flags,
    });
  }

  const pkg = readJson(pkgPath);
  const extensions = pkg?.openclaw?.extensions;

  if (isChannelProfile(profile)) {
    if (!Array.isArray(extensions) || extensions.length === 0) {
      addIssue(issues, {
        rule: "openclaw-extensions",
        path: pkgPath,
        message: "Base Profile MUST: package.json#openclaw.extensions[]",
        pluginId,
        profile,
        category: "manifest-must",
        flags,
      });
    }

    const setupEntry = pkg?.openclaw?.setupEntry;
    if (!setupEntry || typeof setupEntry !== "string" || setupEntry.trim() === "") {
      addIssue(issues, {
        rule: "openclaw-setup-entry",
        path: pkgPath,
        message: "Base Profile MUST: package.json#openclaw.setupEntry (MUST NOT reuse runtime entry)",
        pluginId,
        profile,
        category: "manifest-must",
        flags,
      });
    }
  }
}

function checkSrcMust(pluginDir, pluginId, profile, issues, flags) {
  if (!isChannelProfile(profile)) {
    const srcDir = join(pluginDir, "src");
    if (
      profile !== "utility-minimal" &&
      profile !== "capability-memory" &&
      profile !== "sdk" &&
      !existsSync(srcDir) &&
      !existsSync(join(pluginDir, "index.ts"))
    ) {
      addIssue(issues, {
        rule: "capability-src-or-entry",
        path: srcDir,
        message: `${profile} SHOULD: src/ directory or documented root entry`,
        pluginId,
        profile,
        category: "capability-manifest",
        flags,
      });
    }
    return existsSync(srcDir) ? srcDir : null;
  }

  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) {
    addIssue(issues, {
      rule: "base-src-dir",
      path: srcDir,
      message: "Base Profile MUST: plugin must contain src/",
      pluginId,
      profile,
      category: "base-must",
      flags,
    });
    return null;
  }

  for (const rel of BASE_SRC_MUST) {
    const path = join(srcDir, rel);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: "base-src-must",
        path,
        message: `Base Profile MUST: missing src/${rel}`,
        pluginId,
        profile,
        category: "base-must",
        flags,
      });
    }
  }

  return srcDir;
}

function checkTestDir(pluginDir, pluginId, profile, issues, flags) {
  if (!isChannelProfile(profile)) return;

  const testDir = join(pluginDir, "test");
  if (!existsSync(testDir)) {
    addIssue(issues, {
      rule: "base-test-dir",
      path: testDir,
      message: "Base Profile SHOULD: test/ directory with at least one *.test.ts",
      pluginId,
      category: "base-should",
      flags,
    });
    return;
  }

  const testFiles = listDir(testDir).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".test.ts"),
  );
  if (testFiles.length === 0) {
    addIssue(issues, {
      rule: "base-test-file",
      path: testDir,
      message: "Base Profile SHOULD: at least one test/*.test.ts",
      pluginId,
      category: "base-should",
      flags,
    });
  }
}

function checkRootMustNot(pluginDir, pluginId, profile, issues, flags) {
  const allowRootEntry =
    !isChannelProfile(profile) &&
    (profile === "capability-memory" ||
      profile === "utility-minimal" ||
      profile === "sdk" ||
      resolvePluginEntry(pluginDir) === join(pluginDir, "index.ts"));

  for (const entry of listDir(pluginDir)) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const path = join(pluginDir, name);

    if (name === "pnpm-lock.yaml") {
      addIssue(issues, {
        rule: "plugin-pnpm-lock",
        path,
        message:
          "plugin-level pnpm-lock.yaml SHOULD NOT be committed; monorepo uses root pnpm-lock.yaml",
        pluginId,
        category: "root-must-not",
        flags,
      });
    }

    if (COMPAT_MANIFESTS.has(name)) {
      addIssue(issues, {
        rule: "compat-manifest",
        path,
        message: `${name} is a MAY compat alias; prefer openclaw.plugin.json as canonical manifest`,
        pluginId,
        category: "root-must-not",
        flags,
      });
    }

    if (name.endsWith(".ts") && !ALLOWED_ROOT_TS.has(name)) {
      if (allowRootEntry && (name === "index.ts" || name === "index.test.ts")) {
        continue;
      }
      const rule = LEGACY_ROOT_RUNTIME_TS.has(name) ? "root-runtime-ts" : "root-ts";
      addIssue(issues, {
        rule,
        path,
        message: `plugin root MUST NOT contain runtime TypeScript; move ${name} under src/`,
        pluginId,
        category: "root-must-not",
        flags,
      });
    }
  }
}

function checkCommittedArtifacts(pluginDir, pluginId, issues, flags) {
  const tracked = gitTrackedUnder(pluginDir);
  if (tracked.length === 0) return;

  for (const path of tracked) {
    const rel = relative(pluginDir, path).replace(/\\/g, "/");
    const name = basename(path);

    if (rel === "dist" || rel.startsWith("dist/")) {
      addIssue(issues, {
        rule: "committed-dist",
        path,
        message: "MUST NOT commit dist/ build output (doc §4.2)",
        pluginId,
        category: "base-must",
        flags,
      });
    }

    if (name.endsWith(".tgz")) {
      addIssue(issues, {
        rule: "committed-tgz",
        path,
        message: "MUST NOT commit plugin *.tgz packages (doc §4.2)",
        pluginId,
        category: "base-must",
        flags,
      });
    }
  }
}

function checkNaming(pluginDir, pluginId, issues, flags) {
  const srcDir = join(pluginDir, "src");

  for (const path of walk(pluginDir)) {
    const name = basename(path);
    const stem = name.replace(/\.(test\.)?tsx?$/, "").replace(/\.[cm]?js$/, "");

    if (VAGUE_NAMES.has(stem) || VAGUE_NAMES.has(name)) {
      addIssue(issues, {
        rule: "vague-name",
        path,
        message: `forbidden vague name for new code: ${name} (doc §8.1)`,
        pluginId,
        category: "naming",
        flags,
      });
    }

    if (statSync(path).isDirectory() && name === "legacy" && !hasReadme(path)) {
      addIssue(issues, {
        rule: "legacy-readme",
        path,
        message: "legacy/ MUST contain README.md with owner and deletion window (doc §8.1)",
        pluginId,
        category: "naming",
        flags,
      });
    }
  }

  if (!existsSync(srcDir)) return;

  for (const entry of listDir(srcDir)) {
    if (!entry.isDirectory()) continue;
    if (FORBIDDEN_SRC_DIRS.has(entry.name)) {
      addIssue(issues, {
        rule: "forbidden-src-dir",
        path: join(srcDir, entry.name),
        message: `src/${entry.name}/ MUST NOT exist; use semantic directories (doc §8.1)`,
        pluginId,
        category: "naming",
        flags,
      });
    }
  }

  const hasStore = existsSync(join(srcDir, "store"));
  const hasState = existsSync(join(srcDir, "state"));
  if (hasStore && hasState) {
    addIssue(issues, {
      rule: "store-state-coexist",
      path: srcDir,
      message: "MUST NOT have both src/store/ and src/state/; pick one persistence module (doc §8.1)",
      pluginId,
      category: "naming",
      flags,
    });
  }
}

function srcRootDriftThreshold(pluginId, flags) {
  if (flags.strictNew && EXTENDED_STRICT_PLUGINS.has(pluginId)) {
    return SRC_ROOT_DRIFT_THRESHOLD_STRICT;
  }
  if (flags.strictBase || BASE_STRICT_PLUGINS.has(pluginId)) {
    return SRC_ROOT_DRIFT_THRESHOLD_STRICT;
  }
  return SRC_ROOT_DRIFT_THRESHOLD_DEFAULT;
}
function listSrcRootBusinessFiles(srcDir) {
  return listDir(srcDir)
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !BASE_SRC_FLAT.has(entry.name),
    )
    .map((entry) => entry.name);
}

function checkExtendedProfile(pluginDir, pluginId, issues, flags) {
  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) return;

  // Extended semantic dirs are optional per plugin (doc §5.2, §7.2). _template keeps
  // .gitkeep placeholders for new-plugin.mjs; migrated plugins MAY omit unused dirs.
  // strict-new checks drift thresholds and index size — not missing empty placeholders.

  const indexPath = join(srcDir, "index.ts");
  const lines = countLines(indexPath);
  if (lines > EXTENDED_INDEX_LINE_THRESHOLD) {
    addIssue(issues, {
      rule: "extended-index-lines",
      path: indexPath,
      message: `Extended Profile SHOULD: src/index.ts <= ${EXTENDED_INDEX_LINE_THRESHOLD} lines (current ${lines}, doc §7.1)`,
      pluginId,
      category: "extended",
      flags,
    });
  }

  const driftFiles = listSrcRootBusinessFiles(srcDir);
  const driftThreshold = srcRootDriftThreshold(pluginId, flags);
  if (driftFiles.length > driftThreshold) {
    addIssue(issues, {
      rule: "extended-src-root-drift",
      path: srcDir,
      message: `Extended Profile SHOULD: src/ root has ${driftFiles.length} non-Base .ts files (> ${driftThreshold}); move into semantic dirs: ${driftFiles.join(", ")}`,
      pluginId,
      category: "extended",
      flags,
    });
  }
}

function checkPlugin(pluginDir, flags) {
  const pluginId = basename(pluginDir);
  const { profile, source: profileSource } = detectProfile(pluginId, pluginDir);
  /** @type {Issue[]} */
  const issues = [];

  checkBaseRootMust(pluginDir, pluginId, profile, issues, flags);
  checkBaseRootShould(pluginDir, pluginId, profile, issues, flags);
  checkManifestAndPackage(pluginDir, pluginId, profile, issues, flags);
  const srcDir = checkSrcMust(pluginDir, pluginId, profile, issues, flags);
  checkCapabilityEntry(pluginDir, pluginId, profile, issues, flags);
  checkSdkProfile(pluginDir, pluginId, profile, issues, flags);
  checkProfileAdvisory(pluginDir, pluginId, profile, issues, flags);
  checkTestDir(pluginDir, pluginId, profile, issues, flags);
  checkRootMustNot(pluginDir, pluginId, profile, issues, flags);
  checkCommittedArtifacts(pluginDir, pluginId, issues, flags);
  checkNaming(pluginDir, pluginId, issues, flags);

  if (isChannelProfile(profile)) {
    checkBaseShimSemantics(pluginDir, pluginId, profile, issues, flags);
    checkBaseCoreSubstance(pluginDir, pluginId, profile, issues, flags);
  }

  if (profile === "channel-extended" || EXTENDED_STRICT_PLUGINS.has(pluginId)) {
    checkExtendedProfile(pluginDir, pluginId, issues, flags);
  } else if (srcDir && isChannelProfile(profile)) {
    // channel-base / channel-legacy: warn on src/ root drift only
    const driftFiles = listSrcRootBusinessFiles(srcDir);
    const driftThreshold = srcRootDriftThreshold(pluginId, flags);
    if (pluginId !== BASE_TEMPLATE_ID && driftFiles.length > driftThreshold) {
      addIssue(issues, {
        rule: "src-root-drift",
        path: srcDir,
        message: `Base Profile: src/ root has ${driftFiles.length} non-Base .ts files (> ${driftThreshold}); consider moving into semantic dirs (doc §7.1): ${driftFiles.join(", ")}`,
        pluginId,
        profile,
        category: "extended",
        flags,
      });
    }
  }

  return { pluginId, profile, profileSource, issues };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function isFailure(issue) {
  return issue.level === "error";
}

function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  let pluginDirs = listDir(EXTENSIONS_DIR)
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(EXTENSIONS_DIR, entry.name));

  if (flags.plugin) {
    const target = join(EXTENSIONS_DIR, flags.plugin);
    if (!existsSync(target)) {
      console.error(`Error: plugin not found: extensions/${flags.plugin}`);
      process.exit(2);
    }
    pluginDirs = [target];
  }

  const results = pluginDirs.map((dir) => checkPlugin(dir, flags));
  const issueCount = results.reduce((sum, result) => sum + result.issues.length, 0);
  const failures = results.flatMap((result) => result.issues.filter(isFailure));
  /** @type {Record<string, PluginProfile>} */
  const profiles = Object.fromEntries(results.map((r) => [r.pluginId, r.profile]));
  const summary = {
    standardVersion: STANDARD_VERSION,
    mode: {
      strictBase: flags.strictBase,
      strictNew: flags.strictNew,
    },
    pluginCount: results.length,
    profiles,
    issueCount,
    errorCount: failures.length,
    warnCount: issueCount - failures.length,
    results,
  };

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `OpenClaw plugin structure check (v${STANDARD_VERSION}): ${issueCount} issue(s)` +
        ` (${summary.errorCount} error, ${summary.warnCount} warn)` +
        (flags.strictBase ? " [strict-base]" : "") +
        (flags.strictNew ? " [strict-new]" : ""),
    );
    for (const result of results) {
      if (result.issues.length === 0) continue;
      console.log(`\n${result.pluginId} [${result.profile}]`);
      for (const issue of result.issues) {
        console.log(
          `  [${issue.level}] ${issue.rule}: ${relative(ROOT, issue.path)} — ${issue.message}`,
        );
      }
    }
    if (results.every((r) => r.issues.length === 0)) {
      console.log("\nAll checked plugins passed with 0 issues.");
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
