/**
 * Gotify Bootstrap — 自动创建 Application 和 Doctor 诊断。
 *
 * 在账号首次配置时，自动检测目标 Application 是否存在，
 * 按需创建并返回其 token。doctor 命令提供操作员可读的诊断报告。
 */

import {
  createApplication,
  listApplications,
  runGotifyDoctor,
} from "./transport/gotify-api.js";
import { GotifyConfigError } from "./errors.js";
import type { GotifyDoctorReport, ResolvedGotifyAccount } from "./types.js";

/**
 * 执行 Gotify Application bootstrap。
 *
 * 该流程要求账号已配置 clientToken，因为 Gotify Application API 不能使用 appToken。
 * 当 `bootstrap.enabled=false` 时直接抛出配置错误，避免调用方误以为它会隐式修改配置。
 * 当目标 Application 已存在时复用现有 token；不存在时仅在
 * `autoCreateApplication=true` 时创建。
 *
 * @param account - 已解析的 Gotify 账号配置。
 * @returns bootstrap 结果，包含是否创建新 Application、应用名以及可用 appToken。
 */
export async function bootstrapGotifyAccount(
  account: ResolvedGotifyAccount,
): Promise<{
  created: boolean;
  applicationName: string;
  applicationToken?: string;
}> {
  if (!account.bootstrap.enabled) {
    throw new GotifyConfigError(
      "bootstrap",
      `Bootstrap is disabled for account ${account.accountId}.`,
    );
  }

  const applications = await listApplications(account);
  const existing = applications.find(
    (item) => item.name === account.bootstrap.applicationName,
  );
  if (existing) {
    return {
      created: false,
      applicationName: existing.name,
      applicationToken: existing.token,
    };
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

  return {
    created: true,
    applicationName: created.name,
    applicationToken: created.token,
  };
}

/**
 * 生成 operator 可读的 doctor 结果。
 *
 * @param account - 已解析的 Gotify 账号配置。
 * @returns Gotify 连通性、token 配置和管理 API 可用性报告。
 */
export async function doctorGotifyAccount(
  account: ResolvedGotifyAccount,
): Promise<GotifyDoctorReport> {
  return runGotifyDoctor(account);
}
