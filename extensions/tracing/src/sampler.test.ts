/**
 * 概率采样器单元测试
 *
 * 测试覆盖：
 * - 100% 采样率（全采样）
 * - 0% 采样率（全拒绝）
 * - 确定性：相同 traceId 产生相同结果
 * - 采样率范围校验
 * - 动态采样率调整
 */

import { describe, it, expect } from "vitest";
import { TracingSampler } from "./sampler.js";

describe("TracingSampler", () => {
  describe("全采样 / 全拒绝", () => {
    it("采样率 1.0 应始终返回 true", () => {
      const sampler = new TracingSampler(1.0);
      for (let i = 0; i < 100; i++) {
        expect(sampler.shouldSample(`trace-${i}`)).toBe(true);
      }
    });

    it("采样率 0.0 应始终返回 false", () => {
      const sampler = new TracingSampler(0.0);
      for (let i = 0; i < 100; i++) {
        expect(sampler.shouldSample(`trace-${i}`)).toBe(false);
      }
    });
  });

  describe("确定性采样", () => {
    it("相同 traceId 应始终产生相同结果", () => {
      const sampler = new TracingSampler(0.5);
      const traceId = "abc123def456";
      const result1 = sampler.shouldSample(traceId);
      const result2 = sampler.shouldSample(traceId);
      const result3 = sampler.shouldSample(traceId);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it("不同 traceId 不应全部产生相同结果（概率性）", () => {
      const sampler = new TracingSampler(0.5);
      const results = new Set<boolean>();
      for (let i = 0; i < 200; i++) {
        results.add(sampler.shouldSample(`trace-unique-${i}`));
      }
      // 200 次采样 0.5 概率，应该有 true 和 false 两种结果
      expect(results.size).toBe(2);
    });
  });

  describe("采样率范围", () => {
    it("超出范围的采样率应被裁剪", () => {
      const sampler1 = new TracingSampler(2.0);
      expect(sampler1.getSampleRate()).toBe(1.0);

      const sampler2 = new TracingSampler(-1.0);
      expect(sampler2.getSampleRate()).toBe(0.0);
    });

    it("默认采样率应为 1.0", () => {
      const sampler = new TracingSampler();
      expect(sampler.getSampleRate()).toBe(1.0);
    });
  });

  describe("动态调整", () => {
    it("setSampleRate 应更新采样率", () => {
      const sampler = new TracingSampler(1.0);
      expect(sampler.getSampleRate()).toBe(1.0);

      sampler.setSampleRate(0.3);
      expect(sampler.getSampleRate()).toBe(0.3);
    });

    it("setSampleRate 应裁剪越界值", () => {
      const sampler = new TracingSampler(0.5);
      sampler.setSampleRate(5.0);
      expect(sampler.getSampleRate()).toBe(1.0);
    });
  });

  describe("近似采样率验证", () => {
    it("0.5 采样率在大量 traceId 下应接近 50%", () => {
      const sampler = new TracingSampler(0.5);
      let sampled = 0;
      const total = 10000;

      for (let i = 0; i < total; i++) {
        if (sampler.shouldSample(`trace-${i}-${Math.random().toString(36)}`)) {
          sampled++;
        }
      }

      const ratio = sampled / total;
      // 允许 ±10% 的误差
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });
  });
});
