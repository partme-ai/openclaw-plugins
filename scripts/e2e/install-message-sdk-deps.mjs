/**
 * Install built message-sdk into each queue/channel extension for runtime resolution.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { REPO_ROOT, STATE_DIR } from "./lib/utils.mjs";

const SDK_SRC = join(REPO_ROOT, "extensions/message-sdk");
const EXT_DIRS = [
  "openclaw-mqtt",
  "openclaw-rabbitmq",
  "openclaw-rocketmq",
  "openclaw-gotify",
  "openclaw-stomp",
  "openclaw-web-mqtt",
  "openclaw-web-stomp",
];

const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` };

execSync("pnpm build", { cwd: SDK_SRC, stdio: "inherit", env });

const packDir = mkdtempSync(join(tmpdir(), "openclaw-message-sdk-e2e-"));
const packOutput = execSync(`npm pack --pack-destination "${packDir}" --json`, {
  cwd: SDK_SRC,
  encoding: "utf8",
  env,
});
const [{ filename }] = JSON.parse(packOutput);
const sdkArchive = join(packDir, filename);

try {
  for (const dir of EXT_DIRS) {
    const extPath = join(STATE_DIR, "extensions", dir);
    if (!existsSync(extPath)) continue;
    execSync(`npm install "${sdkArchive}" --omit=dev --legacy-peer-deps --no-audit --no-fund`, {
      cwd: extPath,
      stdio: "inherit",
      env,
    });
    const installedPackage = JSON.parse(
      readFileSync(join(extPath, "node_modules", "@partme.ai", "openclaw-message-sdk", "package.json"), "utf8"),
    );
    console.log(`[message-sdk] installed ${installedPackage.version} archive into ${dir}`);
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}
