/**
 * Install built message-sdk into each queue/channel extension for runtime resolution.
 */
import { existsSync } from "node:fs";
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
  "web-mqtt",
  "web-stomp",
];

const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` };

execSync("pnpm build", { cwd: SDK_SRC, stdio: "inherit", env });

for (const dir of EXT_DIRS) {
  const extPath = join(STATE_DIR, "extensions", dir);
  if (!existsSync(extPath)) continue;
  execSync(`npm install "${SDK_SRC}" --omit=dev --legacy-peer-deps --no-audit --no-fund`, {
    cwd: extPath,
    stdio: "inherit",
    env,
  });
  console.log("[message-sdk] npm linked into", dir);
}
