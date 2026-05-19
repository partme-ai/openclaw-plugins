import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";

const ROOT = "/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins";
const EXT = resolve(ROOT, "extensions");

const VITEST_CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
`;

const TSCONFIG = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["index.ts", "src/**/*.ts"]
}
`;

function standardizePlugin(dir) {
  const name = dir;
  const path = join(EXT, dir);
  const changes = [];

  // 1. Root index.ts
  const rootIndex = join(path, "index.ts");
  const srcIndex = join(path, "src/index.ts");
  if (!existsSync(rootIndex) && existsSync(srcIndex)) {
    const content = readFileSync(srcIndex, "utf8");
    // Check if it's a default export register function
    if (content.includes("export default") || content.includes("register(")) {
      writeFileSync(rootIndex, `export { default } from "./src/index.js";\n`);
      changes.push("+index.ts");
    } else {
      writeFileSync(rootIndex, `export * from "./src/index.js";\n`);
      changes.push("+index.ts (re-export)");
    }
  } else if (!existsSync(rootIndex)) {
    // No src/index.ts either — generate a minimal entry
    writeFileSync(rootIndex, `import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  id: "${name}",
  register(api: OpenClawPluginApi) {
    api.logger.info("[${name}] Plugin registered");
  },
};

export default plugin;
`);
    changes.push("+index.ts (generated)");
  }

  // 2. vitest.config.ts
  const vitestConfig = join(path, "vitest.config.ts");
  if (!existsSync(vitestConfig)) {
    writeFileSync(vitestConfig, VITEST_CONFIG);
    changes.push("+vitest.config.ts");
  }

  // 3. Fix tsconfig.json
  const tsconfig = join(path, "tsconfig.json");
  if (existsSync(tsconfig)) {
    const content = readFileSync(tsconfig, "utf8");
    if (!content.includes("../../tsconfig.base.json")) {
      writeFileSync(tsconfig, TSCONFIG);
      changes.push("~tsconfig.json (→ extends base)");
    }
  } else {
    writeFileSync(tsconfig, TSCONFIG);
    changes.push("+tsconfig.json");
  }

  // 4. Remove .github/
  const ghDir = join(path, ".github");
  if (existsSync(ghDir)) {
    rmSync(ghDir, { recursive: true, force: true });
    changes.push("-rm .github/");
  }

  // 5. Remove package-lock.json
  const lockFile = join(path, "package-lock.json");
  if (existsSync(lockFile)) {
    rmSync(lockFile);
    changes.push("-rm package-lock.json");
  }

  // 6. Update openclaw.plugin.json — ensure channelConfigs
  const manifest = join(path, "openclaw.plugin.json");
  if (existsSync(manifest)) {
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      if (!m.channelConfigs && m.channels) {
        m.channelConfigs = {};
        for (const ch of m.channels) {
          m.channelConfigs[ch] = {
            label: m.name || ch,
            description: m.description || "",
            schema: { type: "object", additionalProperties: true, properties: {} }
          };
        }
        writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
        changes.push("~openclaw.plugin.json (+channelConfigs)");
      }
    } catch { /* skip invalid JSON */ }
  }

  // 7. Fix package.json — ensure exports + files + scripts
  const pkgFile = join(path, "package.json");
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      let modified = false;

      if (!pkg.exports) {
        pkg.exports = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
        modified = true;
      }
      if (!pkg.main || pkg.main === "src/index.ts") {
        pkg.main = "./dist/index.js";
        pkg.types = "./dist/index.d.ts";
        modified = true;
      }
      if (!pkg.files || pkg.files.length === 0) {
        pkg.files = ["dist", "openclaw.plugin.json", "README.md", "LICENSE"];
        modified = true;
      }
      if (!pkg.scripts || !pkg.scripts.prepublishOnly) {
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.prepublishOnly = "pnpm build";
        pkg.scripts.build = pkg.scripts.build || "tsup";
        pkg.scripts.typecheck = pkg.scripts.typecheck || "tsc --noEmit";
        pkg.scripts.test = pkg.scripts.test || "vitest run";
        pkg.scripts.clean = pkg.scripts.clean || "rm -rf dist";
        modified = true;
      }
      if (!pkg.peerDependencies || !pkg.peerDependencies.openclaw) {
        pkg.peerDependencies = pkg.peerDependencies || {};
        pkg.peerDependencies.openclaw = ">=2026.2.24";
        modified = true;
      }
      if (modified) {
        writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
        changes.push("~package.json");
      }
    } catch { /* skip */ }
  }

  if (changes.length > 0) {
    console.log(`${name.padEnd(15)} ${changes.join(", ")}`);
  } else {
    console.log(`${name.padEnd(15)} ✅ already standard`);
  }
}

// Main
const dirs = readdirSync(EXT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map(d => d.name)
  .sort();

console.log(`Standardizing ${dirs.length} plugins...\n`);

for (const dir of dirs) {
  standardizePlugin(dir);
}

console.log(`\nDone.`);
