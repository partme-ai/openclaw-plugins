/**
 * RabbitMQ 配置解析与验证测试
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRabbitmqConfig,
  validateRabbitmqConfig,
  buildRabbitmqConfigSnapshot,
  DEFAULT_RABBITMQ_CONFIG,
} from '../src/config.js';

describe('rabbitmq-config', () => {
  describe('resolveRabbitmqConfig', () => {
    it('should use defaults when no config provided', () => {
      const result = resolveRabbitmqConfig({});
      expect(result).toEqual(DEFAULT_RABBITMQ_CONFIG);
    });

    it('should parse url from runtime config', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: { url: 'amqp://rabbitmq-host:5672' } },
      });
      expect(result.url).toBe('amqp://rabbitmq-host:5672');
    });

    it('should parse exchange from runtime config', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: { exchange: 'my-exchange' } },
      });
      expect(result.exchange).toBe('my-exchange');
    });

    it('should parse topicPrefix from runtime config', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: { topicPrefix: 'custom' } },
      });
      expect(result.topicPrefix).toBe('custom');
    });

    it('should parse topic bindings', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: {
          topicBindings: [
            { topicPattern: 'device.#', agentId: 'agent1', accountId: 'acc1' },
            { topicPattern: 'sensor.#', agentId: 'agent2' },
          ],
        } },
      });
      expect(result.topicBindings).toHaveLength(2);
      expect(result.topicBindings[0].topicPattern).toBe('device.#');
      expect(result.topicBindings[0].agentId).toBe('agent1');
      expect(result.topicBindings[0].accountId).toBe('acc1');
      expect(result.topicBindings[1].accountId).toBe('default');
    });

    it('should parse subscribe topics', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: {
          subscribeTopics: ['topic1', 'topic2'],
        } },
      });
      expect(result.subscribeTopics).toEqual(['topic1', 'topic2']);
    });

    it('should parse payload mode', () => {
      const result = resolveRabbitmqConfig({
        channels: { rabbitmq: {
          payload: { mode: 'jsonOnly' },
        } },
      });
      expect(result.payload.mode).toBe('jsonOnly');
    });

    it('should handle missing nested config gracefully', () => {
      const result = resolveRabbitmqConfig({ channels: { rabbitmq: null } });
      expect(result.url).toBe(DEFAULT_RABBITMQ_CONFIG.url);
    });

    it('should handle undefined rabbitmq config', () => {
      const result = resolveRabbitmqConfig({});
      expect(result.url).toBe(DEFAULT_RABBITMQ_CONFIG.url);
    });

    it('should support legacy top-level rabbitmq config', () => {
      const result = resolveRabbitmqConfig({
        rabbitmq: { url: 'amqp://legacy-host:5672', exchangeType: 'fanout' },
      });
      expect(result.url).toBe('amqp://legacy-host:5672');
      expect(result.exchangeType).toBe('fanout');
    });
  });

  describe('validateRabbitmqConfig', () => {
    it('should return empty array for valid config', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: 'amqp://localhost',
        exchange: 'test',
        topicPrefix: 'test',
        topicBindings: [
          { topicPattern: 'device.#', agentId: 'agent1', accountId: 'default' },
        ],
        subscribeTopics: ['test.#'],
        payload: { mode: 'jsonTextOrPlain' as const },
      };
      const issues = validateRabbitmqConfig(config);
      expect(issues).toHaveLength(0);
    });

    it('should report missing url', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: '',
        exchange: 'test',
        topicPrefix: 'test',
      };
      const issues = validateRabbitmqConfig(config);
      expect(issues).toContain('RabbitMQ URL is required');
    });

    it('should report missing exchange', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: 'amqp://localhost',
        exchange: '',
        topicPrefix: 'test',
      };
      const issues = validateRabbitmqConfig(config);
      expect(issues).toContain('RabbitMQ exchange name is required');
    });

    it('should report missing topicPattern in bindings', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: 'amqp://localhost',
        exchange: 'test',
        topicPrefix: 'test',
        topicBindings: [{ topicPattern: '', agentId: 'agent1', accountId: 'default' }],
      };
      const issues = validateRabbitmqConfig(config);
      expect(issues).toContain('topicBindings: topicPattern is required');
    });

    it('should report missing agentId in bindings', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: 'amqp://localhost',
        exchange: 'test',
        topicPrefix: 'test',
        topicBindings: [{ topicPattern: 'device.#', agentId: '', accountId: 'default' }],
      };
      const issues = validateRabbitmqConfig(config);
      expect(issues).toContain('topicBindings: agentId is required');
    });
  });

  describe('buildRabbitmqConfigSnapshot', () => {
    it('should build snapshot from config', () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        url: 'amqp://localhost',
        exchange: 'test',
        topicPrefix: 'test',
        topicBindings: [
          { topicPattern: 'device.#', agentId: 'agent1', accountId: 'default' },
        ],
        subscribeTopics: ['test.#'],
        payload: { mode: 'jsonTextOrPlain' as const },
      };
      const snapshot = buildRabbitmqConfigSnapshot(config);
      expect(snapshot).toEqual({
        url: config.url,
        exchange: config.exchange,
        exchangeType: config.exchangeType,
        exchangeDurable: config.exchangeDurable,
        topicPrefix: config.topicPrefix,
        topicBindings: config.topicBindings,
        subscribeTopics: config.subscribeTopics,
        payload: config.payload,
        queue: config.queue,
        retry: config.retry,
        connection: config.connection,
        consume: config.consume,
        dispatch: config.dispatch,
        idempotency: config.idempotency,
      });
    });
  });
});
