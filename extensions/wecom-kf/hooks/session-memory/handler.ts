/**
 * Session Memory Hook Handler
 *
 * 监听 command:new 事件，在会话重置时持久化客户上下文到 Agent 记忆。
 * 确保跨会话的客户信息可以被 Agent 在未来的对话中召回。
 *
 * 触发时机：
 * - 客户新建会话（首次进入 / 空闲超时重置后再次进入）
 * - 手动重置会话
 *
 * 存储位置：
 * - {agentWorkspace}/memory/YYYY-MM-DD.md（追加写入）
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Hook 上下文接口
 */
interface HookContext {
  /** 触发事件名 */
  event: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** Agent 工作区路径 */
  workspace: string;
  /** 渠道名 */
  channel?: string;
  /** 对方标识 */
  peerId?: string;
  /** 之前的会话消息（如果可用） */
  previousMessages?: Array<{
    role: string;
    content: string;
    timestamp?: string;
  }>;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Hook 处理入口
 * 当 command:new 事件触发时被 Gateway 调用
 *
 * @param ctx - Hook 上下文
 */
export default async function handler(ctx: HookContext): Promise<void> {
  // 仅处理 wecom-kf 渠道的会话
  if (ctx.channel !== "wecom-kf") {
    return;
  }

  // 仅在有历史消息时执行（首次进入时无历史）
  if (!ctx.previousMessages || ctx.previousMessages.length === 0) {
    return;
  }

  try {
    // 构建记忆条目
    const entry = buildMemoryEntry(ctx);

    // 写入 Agent 记忆文件
    await writeMemoryEntry(ctx.workspace, entry);

    console.log(
      `[wecom_kf:session-memory] Saved session memory for peer ${ctx.peerId} (agent: ${ctx.agentId})`
    );
  } catch (error) {
    console.error(
      `[wecom_kf:session-memory] Failed to save session memory:`,
      error
    );
  }
}

/**
 * 构建结构化记忆条目
 * 从会话历史中提取关键信息生成 Markdown 格式的记忆
 *
 * @param ctx - Hook 上下文
 * @returns Markdown 格式的记忆条目
 */
function buildMemoryEntry(ctx: HookContext): string {
  const now = new Date();
  const peerId = ctx.peerId ?? "unknown";
  const metadata = ctx.metadata ?? {};

  // 提取客户信息（如果有）
  const nickname = (metadata.customerNickname as string) ?? peerId;
  const kfAccountName = (metadata.kfAccountName as string) ?? "unknown";

  // 统计对话信息
  const messages = ctx.previousMessages ?? [];
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  // 获取首尾时间
  const firstMsg = messages[0]?.timestamp ?? now.toISOString();
  const lastMsg = messages[messages.length - 1]?.timestamp ?? now.toISOString();

  // 提取主要话题（用户的前几条消息）
  const topicSnippets = userMessages
    .slice(0, 3)
    .map((m) => m.content.slice(0, 100))
    .join("; ");

  // 判断是否转人工
  const transferred = messages.some(
    (m) =>
      m.content.includes("转人工") ||
      m.content.includes("transfer") ||
      (metadata.transferred as boolean) === true
  );

  const resolution = transferred ? "transferred" : "resolved";

  return [
    ``,
    `## Customer Session: ${nickname} (${peerId})`,
    ``,
    `- **Time**: ${firstMsg} - ${lastMsg}`,
    `- **Channel**: wecom-kf / ${kfAccountName}`,
    `- **Messages**: ${userMessages.length} user, ${assistantMessages.length} assistant`,
    `- **Topic**: ${topicSnippets || "No messages"}`,
    `- **Resolution**: ${resolution}`,
    ``,
  ].join("\n");
}

/**
 * 将记忆条目追加写入 Agent 的每日记忆文件
 *
 * @param workspace - Agent 工作区路径
 * @param entry - Markdown 格式的记忆条目
 */
async function writeMemoryEntry(
  workspace: string,
  entry: string
): Promise<void> {
  // 确保 memory 目录存在
  const memoryDir = path.join(workspace, "memory");
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  // 按日期分文件
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(memoryDir, `${today}.md`);

  // 追加写入（如果文件不存在，先写标题）
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Session Memory - ${today}\n`, "utf-8");
  }

  fs.appendFileSync(filePath, entry, "utf-8");
}
