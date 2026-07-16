import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { RednodeClient } from "../agent/xhs-api.js";
import type { RednodePluginConfig } from "../types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: undefined };
type ToolDefinition = {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: unknown) => Promise<ToolResult>;
};

export const REDNODE_TOOL_NAME = "rednode_ark_invoke";

export function createRednodeTool(ctx: OpenClawPluginToolContext, config: RednodePluginConfig, client = new RednodeClient(config)): ToolDefinition {
  const names = config.operations.map((operation) => operation.name);
  const help = config.operations.map((operation) => `${operation.name} (${operation.method}): ${operation.description ?? operation.apiPath}`).join("; ");
  return {
    name: REDNODE_TOOL_NAME,
    label: "小红书 Ark Open API",
    description: `调用配置白名单中的小红书 Ark API。POST/PUT 必须 confirm=true。可用操作：${help}`,
    parameters: {
      type: "object", additionalProperties: false, required: ["operation"],
      properties: {
        operation: { type: "string", enum: names },
        path_params: { type: "object", additionalProperties: { type: ["string", "number"] } },
        query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
        body: { type: "object", additionalProperties: true },
        confirm: { type: "boolean", description: "写操作必须显式为 true" },
      },
    },
    execute: async (_toolCallId, params) => {
      if (config.ownerOnly && ctx.senderIsOwner !== true) return result({ success: false, error: "Rednode tools are restricted to the command owner" });
      try {
        const input = asObject(params);
        const operationName = readOperation(input.operation, names);
        const operation = client.getOperation(operationName);
        if (!operation) throw new Error("operation is not configured");
        if (operation.method !== "GET" && input.confirm !== true) throw new Error(`operation ${operationName} is a ${operation.method} write; confirm=true is required`);
        return result({ success: true, data: await client.invoke({
          operation: operationName,
          pathParams: optionalObject(input.path_params),
          query: optionalObject(input.query),
          body: optionalObject(input.body),
        }) });
      } catch (error) {
        return result({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

function result(payload: Record<string, unknown>): ToolResult { return { content: [{ type: "text", text: JSON.stringify(payload) }], details: undefined }; }
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  return value as Record<string, unknown>;
}
function optionalObject(value: unknown): Record<string, unknown> | undefined { return value === undefined ? undefined : asObject(value); }
function readOperation(value: unknown, allowed: string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`operation must be one of: ${allowed.join(", ")}`);
  return value;
}
