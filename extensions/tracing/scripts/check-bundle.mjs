import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundle = readFileSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), "utf8");
if (!/from ["']node:sqlite["']/.test(bundle) || /from ["']sqlite["']/.test(bundle)) {
  throw new Error("Tracing bundle must preserve the node:sqlite builtin import");
}
