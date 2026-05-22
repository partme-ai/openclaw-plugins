import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  external: ["openclaw/plugin-sdk/plugin-entry", "openclaw/plugin-sdk/setup-runtime", "openclaw/plugin-sdk/core", "nacos", "yaml"],
  onSuccess: async () => {
    cpSync("src/uuid-shim.cjs", "dist/uuid-shim.cjs");
    cpSync("src/bootstrap.cjs", "dist/bootstrap.cjs");
  },
});
