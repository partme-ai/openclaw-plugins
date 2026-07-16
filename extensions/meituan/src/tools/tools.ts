import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { MeituanClient } from "../meituan/meituan-api.js";
import type { MeituanPluginConfig } from "../types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: undefined };
type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: unknown) => Promise<ToolResult>;
};

export const MEITUAN_TOOL_NAME = "meituan_openapi_invoke";

export function createMeituanTool(
  ctx: OpenClawPluginToolContext,
  config: MeituanPluginConfig,
  client = new MeituanClient(config),
): ToolDefinition {
  const operationNames = config.operations.map((operation) => operation.name);
  const operationHelp = config.operations
    .map((operation) => `${operation.name}: ${operation.description ?? operation.apiPath}`)
    .join("; ");
  return {
    name: MEITUAN_TOOL_NAME,
    label: "美团 MTOp OpenAPI",
    description: `调用配置白名单中的美团 MTOp OpenAPI。可用操作：${operationHelp}`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "biz"],
      properties: {
        operation: { type: "string", enum: operationNames },
        biz: {
          type: "object",
          description: "该 API 官方文档定义的业务参数；插件会将其序列化到 biz 表单字段",
          additionalProperties: true,
        },
      },
    },
    execute: async (_toolCallId, params) => {
      if (config.ownerOnly && ctx.senderIsOwner !== true) {
        return result({ success: false, error: "Meituan tools are restricted to the command owner" });
      }
      try {
        const input = asObject(params);
        const operation = requiredOperation(input.operation, operationNames);
        const biz = asObject(input.biz);
        return result({ success: true, data: await client.invoke(operation, biz) });
      } catch (error) {
        return result({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

function result(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], details: undefined };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("parameters and biz must be objects");
  }
  return value as Record<string, unknown>;
}

function requiredOperation(value: unknown, allowed: string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`operation must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
