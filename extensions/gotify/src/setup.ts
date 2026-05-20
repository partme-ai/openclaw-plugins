import { createApplication, listApplications, runGotifyDoctor } from './gotify-api.js';
import { GotifyConfigError } from './errors.js';
import type { GotifyDoctorReport, ResolvedGotifyAccount } from './types.js';

/**
 * 执行 bootstrap：如果目标应用不存在则按需创建。
 */
export async function bootstrapGotifyAccount(account: ResolvedGotifyAccount): Promise<{
  created: boolean;
  applicationName: string;
  applicationToken?: string;
}> {
  if (!account.bootstrap.enabled) {
    throw new GotifyConfigError('bootstrap', `Bootstrap is disabled for account ${account.accountId}.`);
  }

  const applications = await listApplications(account);
  const existing = applications.find((item) => item.name === account.bootstrap.applicationName);
  if (existing) {
    return {
      created: false,
      applicationName: existing.name,
      applicationToken: existing.token,
    };
  }

  if (!account.bootstrap.autoCreateApplication) {
    throw new GotifyConfigError(
      'autoCreateApplication',
      `Application ${account.bootstrap.applicationName} not found and auto-create is disabled.`
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
 */
export async function doctorGotifyAccount(
  account: ResolvedGotifyAccount
): Promise<GotifyDoctorReport> {
  return runGotifyDoctor(account);
}
