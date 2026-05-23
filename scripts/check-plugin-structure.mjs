#!/usr/bin/env node
/**
 * check-plugin-structure.mjs — OpenClaw plugin structure standard checker.
 *
 * Standard reference: doc/OpenClaw-Plugin-Structure-Standard.md v1.0
 * Profiles: Base Profile (MUST for all plugins) + Extended Profile (complex Channel plugins)
 *
 * Modes:
 *   default       — Base MUST drift → warn; _template Base MUST/SHOULD → error
 *   --strict-base — all Base Profile MUST violations → exit 1
 *   --strict-new  — Extended Profile violations on wecom-kf/wecom → exit 1
 *   --json        — machine-readable report
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

/** Plugins that MUST satisfy Extended Profile under --strict-new */
const EXTENDED_STRICT_PLUGINS = new Set(["wecom-kf", "wecom"]);

/** Base Profile plugins enforced at error level (default + --strict-base) */
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

/** Base Profile — plugin root MUST (doc §4.1–§4.2, elevated from SHOULD where noted in checker) */
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

/** Extended src-root drift threshold (doc §7.1 uses >15 to enable; checker warns earlier) */
const EXTENDED_SRC_ROOT_DRIFT_THRESHOLD = 5;

/** Extended index.ts line threshold (doc §7.1) */
const EXTENDED_INDEX_LINE_THRESHOLD = 150;

const SKIP_WALK_DIRS = new Set(["node_modules", "dist", ".git"]);

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
  --plugin <id>     Check a single extension (e.g. wecom-kf, _template)
  --strict-base     Base Profile MUST violations fail the run (alias: --strict)
  --strict-new      Extended Profile violations fail for wecom-kf and wecom

Enforced plugin sets:
  Base strict: amap, douyin, gotify, meituan, mqtt, rabbitmq, redis-stream,
               rednode, rocketmq, stomp, web-mqtt, web-stomp
  Extended strict (--strict-new): wecom, wecom-kf
  --json            Emit JSON report on stdout
  --help, -h        Show this help

Modes (doc §10.1):
  default           Base MUST missing → warn; _template Base gaps → error
  --strict-base     All plugins: Base MUST → exit 1
  --strict-new      Sample Extended plugins: Extended rules → exit 1

Reference: doc/OpenClaw-Plugin-Structure-Standard.md
`);
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
 * Resolve severity for a rule given plugin id and CLI mode (doc §10.2).
 */
function levelFor({ rule, pluginId, category, flags }) {
  const isTemplate = pluginId === BASE_TEMPLATE_ID;
  const isExtendedStrict = EXTENDED_STRICT_PLUGINS.has(pluginId);
  const isBaseStrict = BASE_STRICT_PLUGINS.has(pluginId);

  // Always error — committed artifacts (doc §4.2, §10.2)
  if (rule === "committed-dist" || rule === "committed-tgz") {
    return "error";
  }

  // Extended Profile
  if (category === "extended") {
    if (flags.strictNew && isExtendedStrict) return "error";
    return "warn";
  }

  // Forbidden naming — always warn unless strict-new on extended plugins
  if (category === "naming") {
    if (flags.strictNew && isExtendedStrict && rule === "forbidden-src-dir") {
      return "error";
    }
    if (flags.strictNew && isExtendedStrict && rule === "store-state-coexist") {
      return "error";
    }
    return "warn";
  }

  // Base MUST — _template + BASE_STRICT_PLUGINS always error; all plugins under --strict-base
  if (category === "base-must") {
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Base SHOULD — _template + BASE_STRICT_PLUGINS treated as reference/enforced skeleton
  if (category === "base-should") {
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Package / manifest MUST
  if (category === "manifest-must") {
    if (flags.strictBase) return "error";
    if (isTemplate || isBaseStrict) return "error";
    return "warn";
  }

  // Root MUST NOT runtime ts — warn in all modes (doc §10.2)
  if (category === "root-must-not") {
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

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkBaseRootMust(pluginDir, pluginId, issues, flags) {
  for (const file of BASE_ROOT_MUST) {
    const path = join(pluginDir, file);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: "base-root-must",
        path,
        message: `Base Profile MUST: missing ${file}`,
        pluginId,
        category: "base-must",
        flags,
      });
    }
  }
}

function checkBaseRootShould(pluginDir, pluginId, issues, flags) {
  for (const file of BASE_ROOT_SHOULD) {
    const path = join(pluginDir, file);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: "base-root-should",
        path,
        message: `Base Profile SHOULD: missing ${file}`,
        pluginId,
        category: "base-should",
        flags,
      });
    }
  }
}

function checkManifestAndPackage(pluginDir, pluginId, issues, flags) {
  const manifestPath = join(pluginDir, "openclaw.plugin.json");
  const pkgPath = join(pluginDir, "package.json");

  const manifest = readJson(manifestPath);
  // _template keeps TEMPLATE_NAME placeholders until new-plugin.mjs materializes a real id
  if (
    pluginId !== BASE_TEMPLATE_ID &&
    manifest?.id &&
    manifest.id !== pluginId
  ) {
    addIssue(issues, {
      rule: "manifest-id-match",
      path: manifestPath,
      message: `Manifest id "${manifest.id}" MUST match plugin directory "${pluginId}"`,
      pluginId,
      category: "manifest-must",
      flags,
    });
  }

  const pkg = readJson(pkgPath);
  const extensions = pkg?.openclaw?.extensions;
  if (!Array.isArray(extensions) || extensions.length === 0) {
    addIssue(issues, {
      rule: "openclaw-extensions",
      path: pkgPath,
      message: "Base Profile MUST: package.json#openclaw.extensions[]",
      pluginId,
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
      category: "manifest-must",
      flags,
    });
  }
}

function checkSrcMust(pluginDir, pluginId, issues, flags) {
  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) {
    addIssue(issues, {
      rule: "base-src-dir",
      path: srcDir,
      message: "Base Profile MUST: plugin must contain src/",
      pluginId,
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
        category: "base-must",
        flags,
      });
    }
  }

  return srcDir;
}

function checkTestDir(pluginDir, pluginId, issues, flags) {
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

function checkRootMustNot(pluginDir, pluginId, issues, flags) {
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

  for (const dir of EXTENDED_SEMANTIC_DIRS) {
    const path = join(srcDir, dir);
    if (!existsSync(path)) {
      addIssue(issues, {
        rule: "extended-semantic-dir",
        path,
        message: `Extended Profile SHOULD: missing src/${dir}/ (doc §7.2)`,
        pluginId,
        category: "extended",
        flags,
      });
    }
  }

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
  if (driftFiles.length > EXTENDED_SRC_ROOT_DRIFT_THRESHOLD) {
    addIssue(issues, {
      rule: "extended-src-root-drift",
      path: srcDir,
      message: `Extended Profile SHOULD: src/ root has ${driftFiles.length} non-Base .ts files (> ${EXTENDED_SRC_ROOT_DRIFT_THRESHOLD}); move into semantic dirs: ${driftFiles.join(", ")}`,
      pluginId,
      category: "extended",
      flags,
    });
  }
}

function checkPlugin(pluginDir, flags) {
  const pluginId = basename(pluginDir);
  /** @type {Issue[]} */
  const issues = [];

  checkBaseRootMust(pluginDir, pluginId, issues, flags);
  checkBaseRootShould(pluginDir, pluginId, issues, flags);
  checkManifestAndPackage(pluginDir, pluginId, issues, flags);
  const srcDir = checkSrcMust(pluginDir, pluginId, issues, flags);
  checkTestDir(pluginDir, pluginId, issues, flags);
  checkRootMustNot(pluginDir, pluginId, issues, flags);
  checkCommittedArtifacts(pluginDir, pluginId, issues, flags);
  checkNaming(pluginDir, pluginId, issues, flags);

  if (EXTENDED_STRICT_PLUGINS.has(pluginId)) {
    checkExtendedProfile(pluginDir, pluginId, issues, flags);
  } else if (srcDir) {
    // Non-extended plugins: lighter drift hint when src root is crowded (doc §7.1 threshold 15)
    const srcRootTs = listDir(srcDir).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
    );
    if (pluginId !== BASE_TEMPLATE_ID && srcRootTs.length > 15) {
      addIssue(issues, {
        rule: "src-root-drift",
        path: srcDir,
        message: `src/ root has ${srcRootTs.length} non-test TS files; consider Extended Profile semantic dirs (doc §7.1)`,
        pluginId,
        category: "extended",
        flags,
      });
    }
  }

  return { pluginId, issues };
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
  const summary = {
    standardVersion: STANDARD_VERSION,
    mode: {
      strictBase: flags.strictBase,
      strictNew: flags.strictNew,
    },
    pluginCount: results.length,
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
      console.log(`\n${result.pluginId}`);
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
