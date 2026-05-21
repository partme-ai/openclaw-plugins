import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { publishMessage, requestMessage } from "./rabbitmq-server.js";

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
    timeoutMs: { type: "number", default: 15000 },
    correlationId: { type: "string" },
  },
  required: ["queue", "payload"],
} as const;

export function registerRabbitmqTools(api: OpenClawPluginApi): void {
  if (typeof (api as any).registerTool !== "function") {
    return;
  }

  (api as any).registerTool(
    {
      name: "mq.publish",
      description: "Publish a message to RabbitMQ (topic exchange)",
      parameters: PublishParamsSchema,
      async execute(_id: string, params: any) {
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

