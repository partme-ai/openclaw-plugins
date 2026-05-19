/**
 * Intent Gate — 检索前意图判断
 *
 * 核心逻辑：收到用户消息后，先判断"这次需不需要查知识库"。
 * 不需要即跳过整个 RAG 流水线，从根本上避免无关注入导致的上下文腐败。
 *
 * 两种模式：
 * - 'rule'（默认）: 关键词匹配，零外部调用，≈0ms
 * - 'strict'：规则门 + reranker 低分兜底，更严格但需要 reranker 配合
 *
 * 规则门判断依据：
 * - 正向触发词（需要查的）：含"？"、"什么"、"如何"、"为什么"等事实查询
 * - 反向跳过词（不需要查的）：闲聊、创作、翻译、总结等自由任务
 *
 * 设计参考业界成熟方案：
 * - LangChain RouterChain / LlamaIndex RouterQueryEngine
 * - Cohere Command-R Tool-Use Gating
 * - Self-RAG / Adaptive RAG 的检索决策层
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
 * 判断一条用户消息是否需要触发知识库检索
 *
 * @param message 用户消息
 * @param config 意图门配置（可选）
 * @returns 'pass' = 需要查知识库，'skip' = 跳过
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
 * 规则判断：命中触发词 → pass，命中跳过词 → skip
 * 触发词优先——如果同时命中触发词和跳过词，视为需要查
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
