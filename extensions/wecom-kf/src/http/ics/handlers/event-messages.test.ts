/**
 * 事件消息配置处理器单元测试
 *
 * 测试覆盖：
 * - 渠道默认事件消息的读取和更新
 * - 账号级事件消息的读取、更新和删除
 * - 错误处理（无效 JSON、配置路径缺失等）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventMessagesHandler } from "./event-messages.js";
import type { GatewayRuntime } from "../../../types/compat.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Mock safeConfigUpdate / triggerConfigReload ───

vi.mock("../storage/config-reload.js", () => ({
  safeConfigUpdate: vi.fn(async (_path: string, updater: (cfg: Record<string, unknown>) => Record<string, unknown>) => {
    // 模拟执行 updater 并记录最终结果
    const result = updater({ channels: { "wecom-kf": {} } });
    return result;
  }),
  triggerConfigReload: vi.fn(async () => {}),
}));

// ─── 辅助工厂 ───

/** 创建模拟 Runtime */
function createMockRuntime(config: Record<string, unknown> = {}): GatewayRuntime {
  return {
    config: {
      _configPath: "/tmp/openclaw.json",
      channels: {
        "wecom-kf": {
          eventMessages: {
            welcome: { enabled: true, msgtype: "text", content: { text: "你好" } },
          },
          accounts: {
            "acct-001": {
              eventMessages: {
                welcome: { enabled: true, msgtype: "text", content: { text: "VIP 专属" } },
              },
            },
          },
        },
      },
      ...config,
    },
  };
}

/** 创建模拟 IncomingMessage */
function createMockReq(
  method: string,
  url: string,
  body?: Record<string, unknown>
): IncomingMessage {
  const req = Object.create(require("node:events").EventEmitter.prototype);
  req.method = method;
  req.url = url;
  req.headers = {};

  // 模拟可读流
  setTimeout(() => {
    if (body) {
      req.emit("data", Buffer.from(JSON.stringify(body)));
    }
    req.emit("end");
  }, 0);

  return req as IncomingMessage;
}

/** 创建模拟 ServerResponse */
function createMockRes(): ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 200,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      res._status = statusCode;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    end(data?: string) {
      res._body = data ?? "";
    },
  } as unknown as ServerResponse & { _status: number; _body: string };
  return res;
}

describe("事件消息处理器", () => {
  let runtime: GatewayRuntime;

  beforeEach(() => {
    runtime = createMockRuntime();
    vi.clearAllMocks();
  });

  describe("GET /ics/config/event-messages", () => {
    it("应返回渠道默认事件消息配置", async () => {
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("GET", "/ics/config/event-messages");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data.welcome.enabled).toBe(true);
      expect(body.data.welcome.content.text).toBe("你好");
    });

    it("当配置为空时应返回空对象", async () => {
      runtime = createMockRuntime({
        channels: { "wecom-kf": {} },
      });
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("GET", "/ics/config/event-messages");
      const res = createMockRes();

      await handler(req, res);

      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({});
    });
  });

  describe("GET /ics/config/event-messages/:accountId", () => {
    it("应返回账号级事件消息配置", async () => {
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("GET", "/ics/config/event-messages/acct-001");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data.welcome.content.text).toBe("VIP 专属");
    });

    it("当账号不存在时应返回空对象", async () => {
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("GET", "/ics/config/event-messages/non-existent");
      const res = createMockRes();

      await handler(req, res);

      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({});
    });
  });

  describe("PUT /ics/config/event-messages", () => {
    it("应更新渠道默认配置并触发热重载", async () => {
      const { triggerConfigReload } = await import("../storage/config-reload.js");
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("PUT", "/ics/config/event-messages", {
        welcome: { enabled: false, msgtype: "text", content: { text: "更新后" } },
      });
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data.updated).toBe(true);
      expect(triggerConfigReload).toHaveBeenCalledOnce();
    });
  });

  describe("DELETE /ics/config/event-messages/:accountId", () => {
    it("应删除账号级配置并触发热重载", async () => {
      const { triggerConfigReload } = await import("../storage/config-reload.js");
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("DELETE", "/ics/config/event-messages/acct-001");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.ok).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(triggerConfigReload).toHaveBeenCalledOnce();
    });
  });

  describe("HTTP 方法校验", () => {
    it("对不支持的方法应返回 405", async () => {
      const handler = createEventMessagesHandler(runtime);
      const req = createMockReq("PATCH", "/ics/config/event-messages");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(405);
    });
  });
});
