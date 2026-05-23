import { defineConfig } from "tsup";

/**
 * Gotify plugin — bundle runtime deps; OpenClaw stays external.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["@partme.ai/openclaw-message-sdk", "ws", "zod"],
});
