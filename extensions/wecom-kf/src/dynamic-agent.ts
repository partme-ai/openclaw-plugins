/**
 * @module dynamic-agent
 *
 * 动态 Agent 路由（通用逻辑见 message-sdk routing）。
 *
 * **KF 主路径说明**：`handleCustomerMessage` 使用 OpenClaw bindings（channel=wecom-kf）
 * 固定 agentId 映射，不走本模块的动态 peer 注入。本模块仅服务 wecom-cs Bot/Agent 入站路径。
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  readDynamicAgentsFromChannelConfig,
  sanitizeDynamicIdPart,
  shouldUseDynamicPeerAgent,
  type DynamicPeerAgentConfig,
} from "@partme.ai/openclaw-message-sdk/routing";

/** 动态 Agent 配置（与 message-sdk DynamicPeerAgentConfig 一致） */
export interface DynamicAgentConfig extends DynamicPeerAgentConfig {}

const CHANNEL_CONFIG_KEY = "wecom-cs";

/**
 * 读取 `channels.wecom-cs.dynamicAgents` 配置。
 */
export function getDynamicAgentConfig(config: OpenClawConfig): DynamicAgentConfig {
  return readDynamicAgentsFromChannelConfig(
    config as { channels?: Record<string, { dynamicAgents?: Partial<DynamicAgentConfig> }> },
    CHANNEL_CONFIG_KEY,
  );
}

export { sanitizeDynamicIdPart };

/**
 * 生成动态 Agent ID（格式：`wecom-cs-{accountId}-{chatType}-{sanitizedPeerId}`）。
 */
export function generateAgentId(
  chatType: "dm" | "group",
  peerId: string,
  accountId?: string,
): string {
  const sanitizedPeer = sanitizeDynamicIdPart(peerId) || "unknown";
  const sanitizedAccountId = sanitizeDynamicIdPart(accountId ?? "default") || "default";
  return `wecom-cs-${sanitizedAccountId}-${chatType}-${sanitizedPeer}`;
}

/**
 * 检查当前消息是否应使用动态 Agent。
 */
export function shouldUseDynamicAgent(params: {
  chatType: "dm" | "group";
  senderId: string;
  config: OpenClawConfig;
}): boolean {
  return shouldUseDynamicPeerAgent({
    chatType: params.chatType,
    senderId: params.senderId,
    dynamicConfig: getDynamicAgentConfig(params.config),
  });
}

const ensuredDynamicAgentIds = new Set<string>();
let ensureDynamicAgentWriteQueue: Promise<void> = Promise.resolve();

function upsertAgentIdOnlyEntry(cfg: Record<string, unknown>, agentId: string): boolean {
  if (!cfg.agents || typeof cfg.agents !== "object") {
    cfg.agents = {};
  }

  const agentsObj = cfg.agents as Record<string, unknown>;
  const currentList: Array<{ id: string }> = Array.isArray(agentsObj.list)
    ? (agentsObj.list as Array<{ id: string }>)
    : [];
  const existingIds = new Set(
    currentList
      .map((entry) => entry?.id?.trim().toLowerCase())
      .filter((id): id is string => Boolean(id)),
  );

  let changed = false;
  const nextList = [...currentList];

  if (nextList.length === 0) {
    nextList.push({ id: "main" });
    existingIds.add("main");
    changed = true;
  }

  if (!existingIds.has(agentId.toLowerCase())) {
    nextList.push({ id: agentId });
    changed = true;
  }

  if (changed) {
    agentsObj.list = nextList;
  }

  return changed;
}

/**
 * 确保动态 Agent ID 已写入 agents.list（幂等、串行）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureDynamicAgentListed(agentId: string, runtime: any): Promise<void> {
  const normalizedId = String(agentId).trim().toLowerCase();
  if (!normalizedId) return;
  if (ensuredDynamicAgentIds.has(normalizedId)) return;

  const configRuntime = runtime?.config;
  if (!configRuntime?.loadConfig || !configRuntime?.writeConfigFile) return;

  ensureDynamicAgentWriteQueue = ensureDynamicAgentWriteQueue
    .then(async () => {
      if (ensuredDynamicAgentIds.has(normalizedId)) return;

      const latestConfig = configRuntime.loadConfig!();
      if (!latestConfig || typeof latestConfig !== "object") return;

      const changed = upsertAgentIdOnlyEntry(latestConfig as Record<string, unknown>, normalizedId);
      if (changed) {
        await configRuntime.writeConfigFile!(latestConfig as unknown);
      }

      ensuredDynamicAgentIds.add(normalizedId);
    })
    .catch((err) => {
      console.warn(`[wecom-kf] 动态 Agent 添加失败: ${normalizedId}`, err);
    });

  await ensureDynamicAgentWriteQueue;
}

/** 重置内存缓存（测试用） */
export function resetEnsuredCache(): void {
  ensuredDynamicAgentIds.clear();
}
