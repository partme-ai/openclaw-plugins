import { createApplication, listApplications } from './gotify-api.js';
import { GotifyConfigError, GotifyApiError } from './errors.js';
import type { ResolvedGotifyAccount } from './types.js';

/**
 * 运行配置向导，查找或创建同名 Gotify Application 并返回 appToken。
 */
export async function runConfigWizard(account: ResolvedGotifyAccount): Promise<string> {
  const applications = await listApplications(account);
  const existing = applications.find((item) => item.name === account.bootstrap.applicationName);
  if (existing?.token) {
    return existing.token;
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
  if (!created.token) {
    throw new GotifyApiError(
      'Gotify application token is missing from createApplication response.',
      500
    );
  }
  return created.token;
}
