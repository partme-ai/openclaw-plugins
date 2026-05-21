import { resolveGotifyAccount } from "../src/config.js";
import { bootstrapGotifyAccount, doctorGotifyAccount } from "../src/setup.js";
import { sendGotifyMessage } from "../src/gotify-api.js";

/**
 * 简单的手动测试端：读取环境变量后执行 doctor、可选 bootstrap 与发送验证。
 */
async function main(): Promise<void> {
  const cfg = {
    channels: {
      gotify: {
        serverUrl: process.env.GOTIFY_SERVER_URL,
        appToken: process.env.GOTIFY_APP_TOKEN,
        clientToken: process.env.GOTIFY_CLIENT_TOKEN,
        bootstrap: {
          enabled: process.env.GOTIFY_BOOTSTRAP === "true",
          autoCreateApplication: process.env.GOTIFY_BOOTSTRAP_CREATE === "true",
          applicationName: process.env.GOTIFY_BOOTSTRAP_APP_NAME,
          applicationDescription: "Created by openclaw-gotify test client",
        },
      },
    },
  };
  const account = resolveGotifyAccount(cfg, "default");
  const report = await doctorGotifyAccount(account);
  console.log(JSON.stringify({ doctor: report }, null, 2));

  if (account.bootstrap.enabled) {
    const bootstrap = await bootstrapGotifyAccount(account);
    console.log(JSON.stringify({ bootstrap }, null, 2));
  }

  if (process.env.GOTIFY_TEST_MESSAGE) {
    const response = await sendGotifyMessage(account, {
      message: process.env.GOTIFY_TEST_MESSAGE,
      title: process.env.GOTIFY_TEST_TITLE || "openclaw-gotify test",
      priority: process.env.GOTIFY_TEST_PRIORITY ? Number(process.env.GOTIFY_TEST_PRIORITY) : undefined,
    });
    console.log(JSON.stringify({ response }, null, 2));
  }
}

main().catch((error) => {
  console.error("[openclaw-gotify:test-client] failed", error);
  process.exitCode = 1;
});
