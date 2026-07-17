import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const failures = [];

for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
  const defaultTarget = typeof target === "string" ? target : target?.default;
  const typesTarget = typeof target === "object" ? target?.types : undefined;
  if (typeof defaultTarget !== "string") {
    failures.push(`${subpath}: missing default export target`);
    continue;
  }
  if (defaultTarget.endsWith(".ts")) {
    failures.push(`${subpath}: runtime export points to TypeScript source (${defaultTarget})`);
    continue;
  }
  const absoluteTarget = resolve(packageRoot, defaultTarget);
  if (!existsSync(absoluteTarget)) {
    failures.push(`${subpath}: runtime export does not exist (${defaultTarget})`);
    continue;
  }
  try {
    await import(pathToFileURL(absoluteTarget).href);
  } catch (error) {
    failures.push(`${subpath}: import failed (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof typesTarget !== "string") {
    failures.push(`${subpath}: missing types export target`);
  } else if (typesTarget.endsWith(".ts") && !typesTarget.endsWith(".d.ts")) {
    failures.push(`${subpath}: types export points to implementation source (${typesTarget})`);
  } else if (!existsSync(resolve(packageRoot, typesTarget))) {
    failures.push(`${subpath}: types export does not exist (${typesTarget})`);
  }
}

if (failures.length > 0) {
  console.error(`message-sdk package export verification failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`message-sdk package export verification passed (${Object.keys(packageJson.exports).length} entrypoints)`);
}
