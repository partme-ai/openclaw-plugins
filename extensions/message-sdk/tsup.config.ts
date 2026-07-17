import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "asr/index": "src/asr/index.ts",
    "media/index": "src/media/index.ts",
    "http/index": "src/http/index.ts",
    "file/index": "src/file/index.ts",
    "ocr/index": "src/ocr/index.ts",
    "tts/index": "src/tts/index.ts",
    "bridge/index": "src/bridge/index.ts",
    "dispatch/index": "src/dispatch/index.ts",
    "ingress/index": "src/ingress/index.ts",
    "dedup/index": "src/dedup/index.ts",
    "queue/index": "src/queue/index.ts",
    "metadata/index": "src/metadata/index.ts",
    "util/index": "src/util/index.ts",
    "transcript/index": "src/transcript/index.ts",
    "routing/index": "src/routing/index.ts",
    "config/index": "src/config/index.ts",
    "openclaw/index": "src/openclaw/index.ts",
    "text/index": "src/text/index.ts",
    "transport/index": "src/transport/index.ts",
    "transport/metrics": "src/transport/metrics.ts",
    "types/index": "src/types/index.ts",
    "lifecycle/index": "src/lifecycle/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: {
    resolve: false,
    // Public declarations expose Buffer, NodeJS.Timeout and node:* modules.
    // Make that ambient dependency explicit so pnpm-isolated consumers can
    // resolve the required @types/node peer from the package's peer context.
    banner: '/// <reference types="node" />',
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
});
