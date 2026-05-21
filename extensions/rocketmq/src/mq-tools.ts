/**
 * RocketMQ 调试工具注册。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const PublishParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    topic: { type: "string" },
    tag: { type: "string" },
    keys: {
      type: "array",
      items: { type: "string" },
    },
    payload: {},
  },
  required: ["topic", "payload"],
} as const;

/**
 * 注册 mq.publish 调试工具。
 */
export function registerRockermqTools(api: OpenClawPluginApi): void {
  if (typeof (api as any).registerTool !== "function") {
    return;
  }

  (api as any).registerTool(
    {
      name: "mq.publish",
      description: "Publish a message to RocketMQ",
      parameters: PublishParamsSchema,
      async execute(
        _id: string,
        params: {
          topic: string;
          tag?: string;
          payload: unknown;
          keys?: string[];
        },
      ) {
        const { publishMessage } = await import("./rocketmq-server.js");
        const payload =
          typeof params.payload === "string"
            ? params.payload
            : JSON.stringify(params.payload ?? {});
        const receipt = await publishMessage({
          topic: params.topic,
          tag: params.tag,
          keys: params.keys,
          payload,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, topic: params.topic, tag: params.tag, receipt },
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
}
