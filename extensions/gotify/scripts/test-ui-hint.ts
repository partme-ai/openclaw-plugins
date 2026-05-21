/**
 * 标准 / E2E 测试结束后，提示用户在 OpenClaw Control UI 中查看会话的位置。
 * Gotify 入站会话键由 openclaw.json 的 session.dmScope 决定（常见为 per-account-channel-peer：
 * agent:{agentId}:gotify:{accountId}:direct:{peerId}），不会出现在默认 agent:main:main。
 */

export type GotifyDmScopeHint =
  | 'main'
  | 'per-peer'
  | 'per-channel-peer'
  | 'per-account-channel-peer';

/**
 * 根据 OpenClaw session.dmScope 推断 Gotify 测试会话的 sessionKey（与 core 路由一致的最常见形式）。
 */
export function resolveGotifySessionKey(params: {
  agentId: string;
  peerId: string;
  accountId?: string;
  dmScope?: GotifyDmScopeHint;
}): string {
  const agentId = params.agentId.trim() || 'main';
  const peerId = params.peerId.trim().toLowerCase() || 'gotify';
  const accountId = (params.accountId ?? 'default').trim() || 'default';
  const dmScope = params.dmScope ?? 'per-account-channel-peer';

  switch (dmScope) {
    case 'main':
      return `agent:${agentId}:main`;
    case 'per-peer':
      return `agent:${agentId}:direct:${peerId}`;
    case 'per-account-channel-peer':
      return `agent:${agentId}:gotify:${accountId}:direct:${peerId}`;
    case 'per-channel-peer':
    default:
      return `agent:${agentId}:gotify:direct:${peerId}`;
  }
}

/**
 * 标准测试可见模式：runner 跳过 adapter cleanup；插件侧仍按 deleteAfterConsume 消费即删。
 */
export function isGotifyTestVisibleMode(): boolean {
  return process.env.OPENCLAW_TEST_VISIBLE === '1';
}

/**
 * 向终端打印 Control UI 查看指引（中文 + 关键英文 sessionKey）。
 */
export function printGotifyControlUiHint(params: {
  peerId: string;
  agentId?: string;
  accountId?: string;
  dmScope?: GotifyDmScopeHint;
  gatewayUrl?: string;
  sessionLabelHint?: string;
}): void {
  const gatewayUrl =
    (params.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789').replace(
      /\/+$/,
      ''
    );
  const agentId = params.agentId ?? process.env.OPENCLAW_TEST_AGENT_ID ?? 'main';
  const accountId = params.accountId ?? process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
  const dmScope =
    (process.env.OPENCLAW_TEST_DM_SCOPE as GotifyDmScopeHint | undefined) ??
    params.dmScope ??
    'per-account-channel-peer';
  const sessionKey = resolveGotifySessionKey({
    agentId,
    peerId: params.peerId,
    accountId,
    dmScope,
  });
  const label =
    params.sessionLabelHint ??
    `gotify:{appName}:${accountId}:direct:${params.peerId} (e.g. gotify:e2e-user:${accountId}:direct:4)`;

  console.log('');
  console.log('  ┌─ OpenClaw Control UI — 查看本条测试对话 ─────────────');
  console.log(`  │  ${gatewayUrl}`);
  console.log('  │  左侧 Sessions → 不要选默认 main，请选择：');
  console.log(`  │    • sessionKey: ${sessionKey}`);
  console.log(`  │    • 或标签类似: ${label}`);
  if (isGotifyTestVisibleMode()) {
    console.log('  │  OPENCLAW_TEST_VISIBLE=1：runner 不删测试残留；完整历史见本 Session');
  } else {
    console.log('  │  提示: 完整多轮历史在 Control UI；Gotify 端消费即删属预期');
    console.log('  │        需对照 Gotify 列表时可设 deleteAfterConsume: false');
  }
  console.log('  └────────────────────────────────────────────────────');
  console.log('');
}
