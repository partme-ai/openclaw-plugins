import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSIONS = join(ROOT, "extensions");

/** 少数插件从语义子模块重新导出默认插件对象。 */
const RUNTIME_ID_SOURCE_OVERRIDES = Object.freeze({
  bridge: "src/bridge/plugin-entry.ts",
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveStringExpression(source, expression) {
  const literal = expression.trim().match(/^(["'])([^"']+)\1$/);
  if (literal) return literal[2];
  const identifier = expression.trim().match(/^[A-Za-z_$][\w$]*$/)?.[0];
  if (!identifier) return null;
  const declaration = source.match(
    new RegExp(`(?:const|let)\\s+${escapeRegExp(identifier)}(?:\\s*:[^=;]+)?\\s*=\\s*(["'])([^"']+)\\1`),
  );
  return declaration?.[2] ?? null;
}

function idFromObjectTail(source, objectTail) {
  const property = objectTail.match(/\bid\s*:\s*([^,\n}]+)/);
  return property ? resolveStringExpression(source, property[1]) : null;
}

export function readRuntimePluginId(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const directDefault = source.match(
    /export\s+default\s+(?:define[A-Za-z0-9_$]*\s*\(\s*)?\{([\s\S]*)$/,
  );
  if (directDefault) return idFromObjectTail(source, directDefault[1]);

  const exportedIdentifier = source.match(
    /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/,
  )?.[1];
  if (!exportedIdentifier) return null;
  const declaration = source.match(
    new RegExp(
      `const\\s+${escapeRegExp(exportedIdentifier)}(?:\\s*:[^=]+)?\\s*=\\s*` +
      `(?:define[A-Za-z0-9_$]*\\s*\\(\\s*)?\\{([\\s\\S]*)$`,
    ),
  );
  return declaration ? idFromObjectTail(source, declaration[1]) : null;
}

/** 无副作用地校验 manifest id 与运行时默认导出的插件 id。 */
export function checkRuntimePluginIds() {
  const failures = [];
  let checked = 0;
  for (const id of readdirSync(EXTENSIONS).sort()) {
    if (id.startsWith("_") || id === "message-sdk") continue;
    const root = join(EXTENSIONS, id);
    const manifestPath = join(root, "openclaw.plugin.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sourcePath = join(root, RUNTIME_ID_SOURCE_OVERRIDES[id] ?? "src/index.ts");
    const runtimeId = readRuntimePluginId(sourcePath);
    checked += 1;
    if (runtimeId !== manifest.id) {
      failures.push(`${id}: manifest.id=${manifest.id}, runtime id=${String(runtimeId)}`);
    }
  }
  return { checked, failures };
}
