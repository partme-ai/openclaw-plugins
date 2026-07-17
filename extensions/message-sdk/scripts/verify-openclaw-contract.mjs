/**
 * 校验 message-sdk 实际依赖的 OpenClaw 运行时契约。
 *
 * 版本下限只是声明，真正的兼容性还取决于 Hook Runtime 导出是否存在。发布前同时验证版本与
 * 符号，避免包能安装但在首次回复时才因内部入口漂移而失败。
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

const require = createRequire(import.meta.url);
let packageRoot = dirname(require.resolve("openclaw"));
const filesystemRoot = parse(packageRoot).root;
let packageJson;
while (packageRoot !== filesystemRoot) {
  const candidate = resolve(packageRoot, "package.json");
  if (existsSync(candidate)) {
    const parsed = JSON.parse(readFileSync(candidate, "utf8"));
    if (parsed.name === "openclaw") {
      packageJson = parsed;
      break;
    }
  }
  packageRoot = dirname(packageRoot);
}
if (!packageJson)
  throw new Error("Unable to locate the resolved openclaw package root");
const minimum = [2026, 7, 1];
const actual = String(packageJson.version ?? "0.0.0")
  .split(/[.-]/u)
  .slice(0, 3)
  .map((part) => Number(part));

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

const failures = [];
if (
  actual.some((part) => !Number.isSafeInteger(part)) ||
  compareVersion(actual, minimum) < 0
) {
  failures.push(
    `openclaw ${packageJson.version ?? "unknown"} is below required 2026.7.1`,
  );
}

const hookRuntime = await import("openclaw/plugin-sdk/hook-runtime");
const pluginRuntime = await import("openclaw/plugin-sdk/plugin-runtime");
const requiredHookRuntimeFunctions = [
  "buildCanonicalSentMessageHookContext",
  "fireAndForgetHook",
  "toPluginMessageContext",
  "toPluginMessageSentEvent",
];
for (const name of requiredHookRuntimeFunctions) {
  if (typeof hookRuntime[name] !== "function") {
    failures.push(`openclaw/plugin-sdk/hook-runtime.${name} is unavailable`);
  }
}
if (typeof pluginRuntime.getGlobalHookRunner !== "function") {
  failures.push(
    "openclaw/plugin-sdk/plugin-runtime.getGlobalHookRunner is unavailable",
  );
}

if (failures.length > 0) {
  console.error(
    `message-sdk OpenClaw contract verification failed:\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `message-sdk OpenClaw contract verification passed (openclaw ${packageJson.version}, 5 runtime symbols)`,
  );
}
