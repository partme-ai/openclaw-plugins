/**
 * KF 意图分类器
 *
 * 基于关键词和模式匹配进行客户意图分类。
 * 轻量级实现，不依赖额外的模型调用，通过 Agent 提示注入增强分类效果。
 */

import type { KfIntent } from "./dialogue-state.js";

type IntentPattern = {
  intent: KfIntent;
  keywords: string[];
  patterns: RegExp[];
  weight: number;
};

const PRESALE_KEYWORDS = [
  "多少钱", "价格", "费用", "收费", "报价", "费用多少",
  "功能", "支持", "能做什么", "有什么用", "有什么用",
  "对比", "区别", "哪个好", "比较", "优缺点",
  "套餐", "版本", "规格", "配置",
  "试用", "演示", "demo", "试用期",
  "询价", "咨询", "了解", "介绍一下",
  "price", "cost", "pricing", "features",
];

const AFTERSALE_KEYWORDS = [
  "坏了", "不能用", "出问题", "报错", "错误", "故障",
  "退", "换", "退款", "退货", "换货",
  "投诉", "差评",
  "bug", "Bug", "BUG",
  "打不开", "登录不了", "连接不上",
  "卡", "慢", "超时", "没反应",
  "投诉", "举报",
  "不是这样的", "不对", "不应该",
  "破损", "损坏", "丢了",
];

const TECH_SUPPORT_KEYWORDS = [
  "怎么", "如何", "怎样", "方法", "教程",
  "安装", "配置", "设置", "部署",
  "文档", "说明", "指南", "手册",
  "接口", "API", "api", "参数",
  "不明白", "不懂", "看不懂", "不理解",
  "help", "how to", "guide",
];

const HUMAN_REQUEST_KEYWORDS = [
  "转人工", "人工客服", "人工", "人工服务",
  "找人工", "转人工客服", "我要人工",
  "真人", "不是机器人", "人工接",
  "电话", "打电话", "联系你们",
];

const INTENT_PATTERNS: IntentPattern[] = [
  { intent: "human_request", keywords: HUMAN_REQUEST_KEYWORDS, patterns: [/转[人工人]/, /人工[客服服务]/, /真人/, /打电话/], weight: 100 },
  { intent: "aftersale_issue", keywords: AFTERSALE_KEYWORDS, patterns: [/(坏了|不能|不行|不好使|出问题|报错|错误|故障)/, /退(款|货|换)/], weight: 10 },
  { intent: "technical_support", keywords: TECH_SUPPORT_KEYWORDS, patterns: [/(怎么|如何|怎样).*(安装|配置|设置|部署|使用)/, /(安装|配置|设置|部署).*(方法|教程|指南)/], weight: 8 },
  { intent: "presale_inquiry", keywords: PRESALE_KEYWORDS, patterns: [/(多少钱|价格|费用|收费|报价)/, /(功能|支持).*(什么|哪些)/], weight: 6 },
  { intent: "general_question", keywords: [], patterns: [], weight: 0 },
];

export type IntentResult = {
  intent: KfIntent;
  confidence: number;
  matchedKeywords: string[];
};

export function classifyIntent(text: string): IntentResult {
  const normalized = text.toLowerCase().trim();
  const scores: Map<KfIntent, { score: number; matchedKeywords: string[] }> = new Map();

  for (const pattern of INTENT_PATTERNS) {
    const matched: string[] = [];
    let score = 0;

    // Keyword matching
    for (const keyword of pattern.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        matched.push(keyword);
        score += pattern.weight;
      }
    }

    // Regex matching
    for (const regex of pattern.patterns) {
      if (regex.test(text)) {
        score += pattern.weight * 1.5; // Regex matches get higher weight
      }
    }

    if (score > 0) {
      scores.set(pattern.intent, { score, matchedKeywords: matched });
    }
  }

  // Find the highest scoring intent
  let bestIntent: KfIntent = "general_question";
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const [intent, { score, matchedKeywords }] of scores) {
    if (score > bestScore) {
      bestIntent = intent;
      bestScore = score;
      bestMatched = matchedKeywords;
    }
  }

  // Calculate confidence: 0-1 range
  const maxPossibleScore = 200;
  const confidence = Math.min(bestScore / maxPossibleScore, 0.95);

  return {
    intent: bestIntent,
    confidence: confidence > 0 ? confidence : 0.1, // Minimum confidence for general_question
    matchedKeywords: bestMatched,
  };
}

/** Check if text explicitly requests human transfer */
export function isHumanTransferRequest(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return HUMAN_REQUEST_KEYWORDS.some((kw) => normalized.includes(kw.toLowerCase()));
}

/** Check if text looks like a greeting */
export function isGreeting(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const greetings = ["你好", "hi", "hello", "嗨", "在吗", "在不在", "您好"];
  return greetings.some((g) => normalized.startsWith(g)) && normalized.length < 20;
}
