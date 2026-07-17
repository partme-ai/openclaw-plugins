/**
 * @fileoverview RabbitMQ Agent 工具注册入口。
 *
 * 向 OpenClaw Agent 暴露两个受 Schema 约束的能力：`mq.publish` 用于异步事件发布，
 * `mq.request` 用于 Direct Reply-to RPC。真正的连接、Publisher Confirm、mandatory
 * 路由校验和超时释放均由 transport 层负责，本文件只做参数归一化和工具结果封装。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { publishMessage, requestMessage } from "../transport/server.js";

const PublishParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    routingKey: { type: "string" },
    payload: {},
    persistent: { type: "boolean", default: false },
    headers: { type: "object", additionalProperties: true },
    correlationId: { type: "string" },
  },
  required: ["routingKey", "payload"],
} as const;

const RequestParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    queue: { type: "string" },
    payload: {},
    timeoutMs: { type: "integer", minimum: 1, default: 15000 },
    correlationId: { type: "string" },
  },
  required: ["queue", "payload"],
} as const;

/**
 * 注册面向 Agent 的 RabbitMQ 发布与请求工具。
 *
 * 工具层只做 Schema 约束、参数归一化和结果封装；Publisher Confirm、mandatory 路由检查、
 * RPC correlationId 与超时清理均委托给 transport。setup-only 宿主没有工具能力时安全跳过。
 */
export function registerRabbitmqTools(api: OpenClawPluginApi): void {
  /* setup-only 或精简宿主可能没有工具注册能力，此时保持 Channel 本身可用。 */
  if (typeof (api as any).registerTool !== "function") {
    return;
  }

  (api as any).registerTool(
    {
      name: "mq.publish",
      description: "Publish a message to RabbitMQ (topic exchange)",
      parameters: PublishParamsSchema,
      async execute(_id: string, params: any) {
        // payload 统一转为 wire string；对象序列化失败时让工具调用显式失败，不吞异常。
        const payload =
          typeof params.payload === "string" ? params.payload : JSON.stringify(params.payload ?? {});
        await publishMessage(params.routingKey, payload, {
          persistent: params.persistent === true,
          headers: params.headers,
          correlationId: typeof params.correlationId === "string" ? params.correlationId : undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, routingKey: params.routingKey, publishedAt: Date.now() },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    { name: "mq.publish" },
  );

  (api as any).registerTool(
    {
      name: "mq.request",
      description: "Send an RPC-style request to a RabbitMQ queue and wait for reply",
      parameters: RequestParamsSchema,
      async execute(_id: string, params: any) {
        const payload =
          typeof params.payload === "string" ? params.payload : JSON.stringify(params.payload ?? {});
        const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 15000;
        const result = await requestMessage({
          queue: params.queue,
          payload,
          timeoutMs,
          correlationId: typeof params.correlationId === "string" ? params.correlationId : undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, ...result }, null, 2),
            },
          ],
        };
      },
    },
    { name: "mq.request" },
  );
}
