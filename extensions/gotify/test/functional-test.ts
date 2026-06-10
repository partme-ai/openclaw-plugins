/**
 * openclaw-gotify 功能测试端
 * 针对真实 Gotify 服务器 (localhost:8080) 运行完整的 API 验证。
 *
 * 用法:
 *   npx tsx scripts/functional-test.ts
 *
 * 环境变量（可选）:
 *   GOTIFY_SERVER_URL  默认 http://localhost:8080
 *   GOTIFY_APP_TOKEN   默认使用创建的测试应用
 *   GOTIFY_CLIENT_TOKEN 默认使用创建的测试客户端
 */

import {
  buildMessageRequest,
  sendGotifyMessage,
  getMessages,
  deleteAllMessages,
  deleteMessage,
  getApplicationMessages,
  deleteApplicationMessages,
  listApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  healthCheck,
  runGotifyDoctor,
  normalizeServerUrl,
} from '../src/transport/gotify-api.js';
import {
  resolveGotifyAccount,
  listGotifyAccountIds,
  resolveDefaultGotifyAccountId,
  describeGotifyAccountSnapshot,
} from '../src/config.js';
import { resolveGotifyPeerId } from '../src/dispatch/routing/peer-resolver.js';
import { mapGotifyToInbound, mapOutboundToGotify } from '../src/dispatch/routing/message-mapper.js';
import { selectAccountId } from '../src/outbound.js';
import type { GotifyMessagePayload, ResolvedGotifyAccount } from '../src/types.js';

// ── 配置 ──────────────────────────────────────────────────────────────────────
const SERVER_URL = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
const APP_TOKEN = process.env.GOTIFY_APP_TOKEN ?? '';
const CLIENT_TOKEN = process.env.GOTIFY_CLIENT_TOKEN ?? '';

if (!APP_TOKEN || !CLIENT_TOKEN) {
  console.error('Error: GOTIFY_APP_TOKEN and GOTIFY_CLIENT_TOKEN are required.');
  console.error('Usage: GOTIFY_APP_TOKEN=<token> GOTIFY_CLIENT_TOKEN=<token> npx tsx scripts/functional-test.ts');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ FAIL: ${label}`;
    failures.push(msg);
    console.log(msg);
  }
}

async function assertRejects(promise: Promise<unknown>, label: string): Promise<void> {
  try {
    await promise;
    failed++;
    const msg = `  ✗ FAIL: ${label} — expected rejection but resolved`;
    failures.push(msg);
    console.log(msg);
  } catch {
    passed++;
    console.log(`  ✓ ${label}`);
  }
}

function createAccount(overrides: Record<string, unknown> = {}): ResolvedGotifyAccount {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: SERVER_URL,
          appToken: APP_TOKEN,
          clientToken: CLIENT_TOKEN,
          ...overrides,
        },
      },
    },
    'default'
  );
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

async function main() {
  const account = createAccount();

  console.log('══════════════════════════════════════════════');
  console.log('  openclaw-gotify Functional Test Suite');
  console.log(`  Server: ${SERVER_URL}`);
  console.log('══════════════════════════════════════════════\n');

  // ── Health ─────────────────────────────────────────────────────────────────
  console.log('── Health ──');
  const health = await healthCheck(account);
  assert(health.ok, 'healthCheck returns ok');
  assert(health.latencyMs >= 0, `healthCheck latency: ${health.latencyMs}ms`);
  console.log('');

  // ── Doctor ────────────────────────────────────────────────────────────────
  console.log('── Doctor ──');
  const doctor = await runGotifyDoctor(account);
  assert(doctor.ok, 'runGotifyDoctor returns ok');
  assert(doctor.hasAppToken, 'doctor reports hasAppToken');
  assert(doctor.hasClientToken, 'doctor reports hasClientToken');
  assert(doctor.healthOk, 'doctor reports healthOk');
  assert(doctor.applicationsChecked, 'doctor reports applicationsChecked');
  assert(doctor.clientsChecked, 'doctor reports clientsChecked');
  assert(doctor.errors.length === 0, `doctor has no errors (${doctor.errors.join(', ')})`);
  console.log('');

  // ── Message API — 发送 ─────────────────────────────────────────────────────
  console.log('── Message API (Send) ──');

  const msg1 = await sendGotifyMessage(account, {
    message: 'Hello from functional test!',
    title: 'Test Message 1',
    priority: 5,
  });
  assert(typeof msg1.id === 'number' && msg1.id > 0, `Message sent (id=${msg1.id})`);
  assert(msg1.appid === 1 || typeof msg1.appid === 'number', `Message has appid=${msg1.appid}`);

  const msg2 = await sendGotifyMessage(account, {
    message: '**Markdown** message with [link](https://gotify.net)',
    title: 'Test Markdown',
    priority: 7,
    extras: {
      'client::display': { contentType: 'text/markdown' },
      'client::notification': { click: { url: 'https://gotify.net' } },
    },
  });
  assert(typeof msg2.id === 'number', `Markdown message sent (id=${msg2.id})`);

  const msg3 = await sendGotifyMessage(account, {
    message: 'Priority 10 urgent message',
    priority: 10,
  });
  assert(msg3.priority === 10, `Priority 10 message sent (priority=${msg3.priority})`);
  console.log('');

  // ── Message API — 获取 ─────────────────────────────────────────────────────
  console.log('── Message API (Get) ──');

  const allMessages = await getMessages(account, { limit: 10 });
  assert(allMessages.messages.length >= 3, `getMessages returns >= 3 messages (got ${allMessages.messages.length})`);
  assert(allMessages.paging.limit === 10, 'paging.limit = 10');
  assert(typeof allMessages.paging.size === 'number', `paging.size = ${allMessages.paging.size}`);

  const fewMessages = await getMessages(account, { limit: 1 });
  assert(fewMessages.messages.length <= 1, `getMessages limit=1 returns <= 1 message (got ${fewMessages.messages.length})`);
  console.log('');

  // ── Message API — 按 Application 获取 ───────────────────────────────────────
  console.log('── Message API (Application Messages) ──');

  const appMessages = await getApplicationMessages(account, 1, { limit: 10 });
  assert(appMessages.messages.length >= 3, `getApplicationMessages returns >= 3 messages (got ${appMessages.messages.length})`);
  console.log('');

  // ── Message API — 删除 ─────────────────────────────────────────────────────
  console.log('── Message API (Delete) ──');

  // 删除单条消息
  const delMsg = await sendGotifyMessage(account, { message: 'to be deleted', title: 'Delete me' });
  await deleteMessage(account, Number(delMsg.id));
  const afterDelete = await getMessages(account, { limit: 1 });
  assert(afterDelete.messages[0]?.id !== delMsg.id, 'deleteMessage removes the message');

  // 按 Application 删除消息
  const tempApp = await createApplication(account, { name: 'temp-cleanup-test', description: 'temp' });
  await sendGotifyMessage(createAccount({ appToken: tempApp.token }), { message: 'temp msg' });
  await deleteApplicationMessages(account, tempApp.id);
  const afterAppDelete = await getApplicationMessages(account, tempApp.id, { limit: 10 });
  assert(afterAppDelete.messages.length === 0, 'deleteApplicationMessages clears all app messages');
  await deleteApplication(account, tempApp.id);
  console.log('');

  // ── Application API — CRUD ─────────────────────────────────────────────────
  console.log('── Application API (CRUD) ──');

  // 创建
  const newApp = await createApplication(account, {
    name: 'func-test-app',
    description: 'Created during functional test',
    defaultPriority: 3,
  });
  assert(newApp.name === 'func-test-app', `createApplication: name=${newApp.name}`);
  assert(newApp.token!.startsWith('A'), `createApplication: token starts with A (${newApp.token!.substring(0, 3)}...)`);
  assert(newApp.internal === false, 'createApplication: internal=false');

  // 列出
  const apps = await listApplications(account);
  assert(apps.some((a) => a.name === 'func-test-app'), 'listApplications includes created app');

  // 更新
  const updated = await updateApplication(account, newApp.id, {
    name: 'func-test-app-updated',
    description: 'Updated during test',
    defaultPriority: 8,
  });
  assert(updated.name === 'func-test-app-updated', `updateApplication: name changed to ${updated.name}`);

  // 删除
  await deleteApplication(account, newApp.id);
  const afterDel = await listApplications(account);
  assert(!afterDel.some((a) => a.id === newApp.id), 'deleteApplication removes app from list');
  console.log('');

  // ── Client API — CRUD ──────────────────────────────────────────────────────
  console.log('── Client API (CRUD) ──');

  // 创建
  const newClient = await createClient(account, { name: 'func-test-client' });
  assert(newClient.name === 'func-test-client', `createClient: name=${newClient.name}`);
  assert(newClient.token!.startsWith('C'), `createClient: token starts with C (${newClient.token!.substring(0, 3)}...)`);

  // 列出
  const clients = await listClients(account);
  assert(clients.some((c) => c.name === 'func-test-client'), 'listClients includes created client');

  // 更新
  const updatedClient = await updateClient(account, newClient.id, { name: 'func-test-client-renamed' });
  assert(updatedClient.name === 'func-test-client-renamed', `updateClient: name changed`);

  // 删除
  await deleteClient(account, newClient.id);
  const afterClientDel = await listClients(account);
  assert(!afterClientDel.some((c) => c.id === newClient.id), 'deleteClient removes client from list');
  console.log('');

  // ── 错误处理 ───────────────────────────────────────────────────────────────
  console.log('── Error Handling ──');

  // 无效的 serverUrl
  const badAccount = createAccount({ serverUrl: 'http://nonexistent-host.internal:99999' });
  const badHealth = await healthCheck(badAccount);
  assert(!badHealth.ok, 'healthCheck fails for unreachable server');

  // 缺少 appToken → 无法构建请求
  const noTokenAccount = createAccount({ appToken: undefined });
  try {
    buildMessageRequest(noTokenAccount, { message: 'test' });
    assert(false, 'buildMessageRequest should throw without appToken');
  } catch (error) {
    assert(String(error).includes('not configured'), `buildMessageRequest throws: ${String(error).substring(0, 60)}`);
  }

  // 缺少 clientToken → 拒绝管理操作
  const noClientAccount = createAccount({ clientToken: undefined });
  await assertRejects(listApplications(noClientAccount), 'listApplications rejects without clientToken');
  console.log('');

  // ── 配置解析 ───────────────────────────────────────────────────────────────
  console.log('── Config Resolution ──');

  const accountIds = listGotifyAccountIds({ channels: { gotify: { serverUrl: SERVER_URL, appToken: APP_TOKEN } } });
  assert(accountIds.includes('default'), 'listGotifyAccountIds includes default');

  const defaultId = resolveDefaultGotifyAccountId({ channels: { gotify: { serverUrl: SERVER_URL } } });
  assert(defaultId === 'default', 'resolveDefaultGotifyAccountId returns default');

  const snapshot = describeGotifyAccountSnapshot(account);
  assert(snapshot.accountId === 'default', 'describeGotifyAccountSnapshot includes accountId');
  assert(snapshot.configured === true, 'describeGotifyAccountSnapshot: configured=true');
  // verify no token leak
  assert(!('appToken' in snapshot), 'describeGotifyAccountSnapshot does NOT leak appToken');
  assert(!('clientToken' in snapshot), 'describeGotifyAccountSnapshot does NOT leak clientToken');
  console.log('');

  // ── Peer ID 解析（会话键由 resolveAgentRoute 负责）────────────────────────
  console.log('── Peer ID Resolution ──');

  const fromExtras = resolveGotifyPeerId({
    id: 1, appid: 10,
    extras: { openclaw: { peerId: 'custom-peer' } },
  });
  assert(fromExtras === 'custom-peer', 'peerId from extras.openclaw.peerId');

  const fromAppId = resolveGotifyPeerId({ id: 2, appid: 42 });
  assert(fromAppId === '42', 'peerId from appid');

  const fromTitle = resolveGotifyPeerId({ id: 3, title: 'AlertBot' });
  assert(fromTitle === 'alertbot', 'peerId from title (lowercase)');

  const fallback = resolveGotifyPeerId({ id: 4 });
  assert(fallback === 'gotify', 'peerId fallback to "gotify"');
  console.log('');

  // ── 消息映射 ───────────────────────────────────────────────────────────────
  console.log('── Message Mapping ──');

  const outbound = mapOutboundToGotify({
    cfg: {}, to: 'default',
    text: 'Hello Agent',
    title: 'Response',
    priority: 5,
    extras: { openclaw: { traceId: 't1' } },
    metadata: { url: 'https://example.com/issue/1', contentType: 'text/markdown' },
  } as never);
  assert(outbound.message === 'Hello Agent', 'mapOutboundToGotify: message');
  assert(outbound.title === 'Response', 'mapOutboundToGotify: title');
  assert(outbound.extras?.['client::notification'] != null, 'mapOutboundToGotify: click.url extras');
  assert(outbound.extras?.['client::display'] != null, 'mapOutboundToGotify: contentType extras');

  const inbound = mapGotifyToInbound({
    id: 99, appid: 88, message: 'inbound text', title: 'alert', priority: 3,
    extras: { key: 'val' }, date: '2026-05-18T00:00:00Z',
  });
  assert(inbound.text === 'inbound text', 'mapGotifyToInbound: text');
  assert(inbound.metadata.id === 99, 'mapGotifyToInbound: metadata.id');
  assert(inbound.metadata.appid === 88, 'mapGotifyToInbound: metadata.appid');
  console.log('');

  // ── 出站账号选择 ───────────────────────────────────────────────────────────
  console.log('── Outbound Account Selection ──');

  assert(selectAccountId({ cfg: {}, accountId: 'ops', to: 'default' }) === 'ops', 'selectAccountId prefers explicit accountId');
  assert(selectAccountId({ cfg: {}, accountId: '', to: 'gotify:alerts' }) === 'alerts', 'selectAccountId from target');
  assert(selectAccountId({ cfg: {}, accountId: '', to: '' }) === 'default', 'selectAccountId default fallback');
  console.log('');

  // ── URL 规范化 ─────────────────────────────────────────────────────────────
  console.log('── URL Normalization ──');

  assert(normalizeServerUrl('https://gotify.example.com/') === 'https://gotify.example.com', 'strips trailing slash');
  assert(normalizeServerUrl('http://localhost:8080') === 'http://localhost:8080', 'no trailing slash unchanged');
  console.log('');

  // ── 消息历史清理 ───────────────────────────────────────────────────────────
  console.log('── Clean Up Test Messages ──');

  await deleteAllMessages(account);
  const remaining = await getMessages(account, { limit: 1 });
  assert(remaining.messages.length === 0, `deleteAllMessages: no messages remaining (got ${remaining.messages.length})`);
  console.log('');

  // ── 结果 ───────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════');
  const total = passed + failed;
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.log(`  ${failed} FAILURES:`);
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  } else {
    console.log('  All functional tests passed! ✓');
  }
  console.log('══════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Functional test suite crashed:', error);
  process.exitCode = 1;
});
