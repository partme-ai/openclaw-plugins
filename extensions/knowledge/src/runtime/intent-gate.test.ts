/**
 * Intent Gate 测试
 *
 * 覆盖场景：
 * - 规则门模式（默认）
 *   - 疑问句 → pass（需要查）
 *   - 事实查询 → pass
 *   - 闲聊/创作 → skip
 *   - 翻译 → skip
 *   - 空消息 → skip
 *   - 触发词优先于跳过词
 * - strict 模式
 *   - 短消息无疑问词 → skip
 *   - 短消息有疑问词 → pass
 *   - 正常消息按规则判断
 * - 自定义词表
 *   - 自定义触发词
 *   - 自定义跳过词
 */

import { describe, it, expect } from 'vitest';
import { evaluateIntent } from './intent-gate.js';

describe('IntentGate — rule mode (default)', () => {
  // ===== 触发词命中 → pass =====
  it('should pass for explicit question with Chinese question mark', () => {
    expect(evaluateIntent('这个功能怎么用？')).toBe('pass');
  });

  it('should pass for explicit question with English question mark', () => {
    expect(evaluateIntent('How does this work?')).toBe('pass');
  });

  it('should pass for type query starting with 什么是', () => {
    expect(evaluateIntent('什么是知识库')).toBe('pass');
  });

  it('should pass for "如何" type query', () => {
    expect(evaluateIntent('如何配置知识库')).toBe('pass');
  });

  it('should pass for "为什么" type query', () => {
    expect(evaluateIntent('为什么检索结果不准确')).toBe('pass');
  });

  it('should pass for "解释" type query', () => {
    expect(evaluateIntent('解释一下RAG是什么')).toBe('pass');
  });

  it('should pass for "文档" reference query', () => {
    expect(evaluateIntent('文档里怎么写的')).toBe('pass');
  });

  it('should pass for "查一下" query', () => {
    expect(evaluateIntent('查一下昨天的销售数据')).toBe('pass');
  });

  it('should pass for "what" query', () => {
    expect(evaluateIntent('what is RAG')).toBe('pass');
  });

  it('should pass for comparison query', () => {
    expect(evaluateIntent('zhipu和openai的区别')).toBe('pass');
  });

  // ===== 跳过词命中 → skip =====
  it('should skip for creative writing request', () => {
    expect(evaluateIntent('写一首关于春天的诗')).toBe('skip');
  });

  it('should skip for translation request', () => {
    expect(evaluateIntent('翻译成英文')).toBe('skip');
  });

  it('should skip for summary request', () => {
    expect(evaluateIntent('总结一下这段内容')).toBe('skip');
  });

  it('should skip for joke request', () => {
    expect(evaluateIntent('讲个笑话')).toBe('skip');
  });

  it('should skip for story request', () => {
    expect(evaluateIntent('讲个故事')).toBe('skip');
  });

  it('should skip for greeting', () => {
    expect(evaluateIntent('你好')).toBe('skip');
  });

  it('should skip for casual chat', () => {
    expect(evaluateIntent('随便聊聊')).toBe('skip');
  });

  it('should skip for "帮我" style request', () => {
    expect(evaluateIntent('帮我画一只猫')).toBe('skip');
  });

  it('should skip for "write a" request', () => {
    expect(evaluateIntent('write a poem about AI')).toBe('skip');
  });

  // ===== 中性消息 → pass（向后兼容） =====
  it('should pass for neutral message without triggers or skips', () => {
    expect(evaluateIntent('昨天的数据看起来不错')).toBe('pass');
  });

  it('should pass for simple noun phrase', () => {
    expect(evaluateIntent('2025年Q4财报')).toBe('pass');
  });

  // ===== 边界情况 =====
  it('should skip for empty string', () => {
    expect(evaluateIntent('')).toBe('skip');
  });

  it('should skip for whitespace-only string', () => {
    expect(evaluateIntent('   ')).toBe('skip');
  });

  // 触发词优先于跳过词
  it('should pass even with skip word if trigger word is present', () => {
    expect(evaluateIntent('解释一下什么是笑话')).toBe('pass');
  });

  it('should pass for mixed trigger and skip', () => {
    // "翻译" 是跳过词，"如何" 是触发词
    expect(evaluateIntent('如何翻译这段文字')).toBe('pass');
  });
});

describe('IntentGate — strict mode', () => {
  it('should skip for short message without question in strict mode', () => {
    const config = { mode: 'strict' as const };
    expect(evaluateIntent('你好', config)).toBe('skip');
  });

  it('should pass for short message with explicit trigger in strict mode', () => {
    const config = { mode: 'strict' as const };
    expect(evaluateIntent('什么', config)).toBe('pass');
  });

  it('should pass for normal message with trigger in strict mode', () => {
    const config = { mode: 'strict' as const };
    expect(evaluateIntent('什么是RAG', config)).toBe('pass');
  });

  it('should skip for greeting in strict mode', () => {
    const config = { mode: 'strict' as const };
    expect(evaluateIntent('hello', config)).toBe('skip');
  });
});

describe('IntentGate — custom word list', () => {
  it('should use custom triggers', () => {
    const config = {
      triggers: ['股票', '基金', '行情'],
      skips: ['聊天', '随便'],
    };
    expect(evaluateIntent('今天股票行情如何', config)).toBe('pass');
  });

  it('should skip with custom skip words', () => {
    const config = {
      triggers: ['股票', '基金'],
      skips: ['聊天', '随便'],
    };
    expect(evaluateIntent('随便聊聊', config)).toBe('skip');
  });

  it('should pass for neutral when custom trigger is absent', () => {
    const config = {
      triggers: ['股票', '基金'],
      skips: ['聊天'],
    };
    // 既不是股票也不是聊天 → 默认 pass（向后兼容）
    expect(evaluateIntent('天气怎么样', config)).toBe('pass');
  });
});
