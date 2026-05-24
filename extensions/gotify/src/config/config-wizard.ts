/**
 * @file Gotify Application 发现/创建向导核心逻辑。
 *
 * @description 通过 Client token 列举 Application，按 `bootstrap.applicationName` 命中复用；
 * 若不存在且允许 `autoCreateApplication` 则 `POST /application`。
 * **模块角色**：Channel Plugin · Interactive provisioning（非 Host shell UI 本身）。
 */

import { createApplication, listApplications } from "../transport/gotify-api.js";
import { GotifyConfigError, GotifyApiError } from "../shared/errors.js";
import type { ResolvedGotifyAccount } from "../types.js";

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
