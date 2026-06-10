/**
 * @fileoverview Intent Gate — **检索前轻量级路由**：判断是否应为本次对话拉起向量检索。
 *
 * @description
 * 处于整条链路的上游闸门前：**早于 Embedding/Web‑hook**。可减少上下文漂移和低相关知识段落混入，
 * 也可在非 QA/small-talk 场景节省端到尾链路开销。
 *
 * @module knowledge/runtime/intent-gate
 */

export type IntentGateMode = 'rule' | 'strict';
export type IntentGateResult = 'pass' | 'skip';

/** Intent Gate 配置 */
export interface IntentGateConfig {
  /** 门控模式，默认 'rule' */
  mode?: IntentGateMode;
  /** 自定义触发关键词（无表时会使用默认规则） */
  triggers?: string[];
  /** 自定义跳过关键词 */
  skips?: string[];
}

/** 默认触发词 — 需要查知识库的典型表达 */
const DEFAULT_TRIGGERS = [
  '?', '？', '什么', '怎么', '如何', '为什么', '何时', '哪里', '哪个',
  '是多少', '怎么做', '怎么回事', '是什么意思', '区别', '对比',
  '定义', '解释', '说明', '介绍', '详情', '规范', '标准', '规定',
  '文档', '文档里', '知识库', '查一下', '找一下', '搜索',
  'what', 'how', 'why', 'when', 'where', 'which',
  'define', 'explain', 'describe', 'detail',
];

/** 默认跳过词 — 不需要查知识库的典型表达 */
const DEFAULT_SKIPS = [
  '写一首', '创作', '编一个', '编个', '讲个', '讲个故事',
  '翻译', '译成', '翻译成',
  '总结', '归纳', '概括',
  '闲聊', '聊天', '随便聊聊',
  '笑话', '段子', '梗',
  '你好', '嗨', '嗨咯', 'hello', 'hi',
  '帮我', '我要', '我想', '能不能',
  '画', '设计', '作曲', '代码',
  'write a', 'create a', 'translate', 'summarize',
  'joke', 'story', 'poem',
];

/**
 * @description 对给定用户 utterance 执行布尔门控：**pass** 表示仍需进入检索路径；**skip** 表示整条 RAG 提前中止。
 *
 * @param message - 本轮用户文本（已由上游渠道清洗）
 * @param config - 可选自定义触发词/跳过词列表及模式切换
 * @returns `'pass' | 'skip'` 判别结果
 */
export function evaluateIntent(
  message: string,
  config?: IntentGateConfig,
): IntentGateResult {
  if (!message || message.trim().length === 0) return 'skip';

  const mode = config?.mode ?? 'rule';
  const triggers = config?.triggers ?? DEFAULT_TRIGGERS;
  const skips = config?.skips ?? DEFAULT_SKIPS;

  if (mode === 'rule') {
    return evaluateByRule(message, triggers, skips);
  }

  // 'strict' mode = 规则门基础上要求更高
  // 需要同时命中触发词且不命中跳过词，如果都模棱两可则跳过
  // 对于 short query（<5 字符）严格处理
  if (message.trim().length < 5) {
    // 短消息除非明确疑问句，否则跳过
    const isQuestion = triggers.some((t) => message.includes(t));
    return isQuestion ? 'pass' : 'skip';
  }

  return evaluateByRule(message, triggers, skips);
}

/**
 * @description **触发词优先**的子规则引擎：任一触发词命中即 pass；否则若命中跳过词则为 skip；
 *              中性消息默认 pass（兼容历史行为）。
 *
 * @param message - 判别样本全文（会做 `.toLowerCase()`）
 * @param triggers - 正向短语词典（中英文可按 substring）
 * @param skips - 反向短语词典
 */
function evaluateByRule(
  message: string,
  triggers: string[],
  skips: string[],
): IntentGateResult {
  const lowerMsg = message.toLowerCase();

  // 检查跳过词
  const matchedSkip = skips.some((skip) => {
    const lower = skip.toLowerCase();
    return lowerMsg.includes(lower);
  });

  // 检查触发词
  const matchedTrigger = triggers.some((trigger) => {
    const lower = trigger.toLowerCase();
    return lowerMsg.includes(lower);
  });

  // 触发词优先
  if (matchedTrigger) return 'pass';
  // 命中跳过词 → 跳过
  if (matchedSkip) return 'skip';

  // 都没有命中：中性消息。规则门模式下默认 pass（向后兼容）
  return 'pass';
}
