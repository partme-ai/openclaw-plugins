/**
 * Gotify Config Wizard — 交互式配置向导。
 *
 * 查找或创建同名 Gotify Application，返回 appToken 供后续配置使用。
 * 支持首次配置和已有应用复用两种场景。
 */

import { createApplication, listApplications } from "./transport/gotify-api.js";
import { GotifyConfigError, GotifyApiError } from "./errors.js";
import type { ResolvedGotifyAccount } from "./types.js";

/**
 * 运行配置向导中的 Gotify Application 发现/创建流程。
 *
 * 该函数只处理 Gotify 服务端侧的 Application 准备工作，不直接写入 OpenClaw 配置。
 * 调用方拿到返回的 appToken 后，再由 setup adapter 决定如何保存到
 * `channels.gotify.appToken` 或多账号配置中。
 *
 * @param account - 已解析的 Gotify 账号配置，必须具备 serverUrl/clientToken。
 * @returns 可用于 `POST /message` 的 Gotify Application token。
 * @throws GotifyConfigError 当目标 Application 不存在且禁止自动创建时抛出。
 * @throws GotifyApiError 当 Gotify 创建响应没有返回 token 时抛出。
 */
export async function runConfigWizard(
  account: ResolvedGotifyAccount,
): Promise<string> {
  const applications = await listApplications(account);
  const existing = applications.find(
    (item) => item.name === account.bootstrap.applicationName,
  );
  if (existing?.token) {
    return existing.token;
  }
  if (!account.bootstrap.autoCreateApplication) {
    throw new GotifyConfigError(
      "autoCreateApplication",
      `Application ${account.bootstrap.applicationName} not found and auto-create is disabled.`,
    );
  }
  const created = await createApplication(account, {
    name: account.bootstrap.applicationName,
    description: account.bootstrap.applicationDescription,
  });
  if (!created.token) {
    throw new GotifyApiError(
      "Gotify application token is missing from createApplication response.",
      500,
    );
  }
  return created.token;
}
