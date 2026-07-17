/**
 * @fileoverview 美团 MTOp 白名单工具定义。
 *
 * 工具层负责 owner、operation 和写操作确认；客户端层负责签名、凭据、请求边界、限流和
 * 标准成功码验证。Agent 不能直接提供 URL、businessId、Token 或 signKey。
 */
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { MeituanClient } from "../meituan/meituan-api.js";
import type { MeituanPluginConfig } from "../types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
};
type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: unknown) => Promise<ToolResult>;
};

/** 注册到 OpenClaw 的唯一美团工具名；具体接口只能从配置白名单中选择。 */
export const MEITUAN_TOOL_NAME = "meituan_openapi_invoke";

/**
 * 创建当前调用上下文绑定的美团工具。
 * owner 校验和写操作二次确认在进入网络客户端前完成，失败统一返回结构化工具结果。
 */
export function createMeituanTool(
  ctx: OpenClawPluginToolContext,
  config: MeituanPluginConfig,
  client = new MeituanClient(config),
): ToolDefinition {
  const operationNames = config.operations.map((operation) => operation.name);
  const operationHelp = config.operations
    .map(
      (operation) =>
        `${operation.name}: ${operation.description ?? operation.apiPath}`,
    )
    .join("; ");
  return {
    name: MEITUAN_TOOL_NAME,
    label: "美团 MTOp OpenAPI",
    description: `调用配置白名单中的美团 MTOp OpenAPI。write 操作必须 confirm=true。可用操作：${operationHelp}`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "biz"],
      properties: {
        operation: { type: "string", enum: operationNames },
        biz: {
          type: "object",
          description:
            "该 API 官方文档定义的业务参数；插件会将其序列化到 biz 表单字段",
          additionalProperties: true,
        },
        confirm: {
          type: "boolean",
          description: "riskLevel=write 的操作必须显式为 true",
        },
      },
    },
    execute: async (_toolCallId, params) => {
      if (config.ownerOnly && ctx.senderIsOwner !== true) {
        return result({
          success: false,
          error: "Meituan tools are restricted to the command owner",
        });
      }
      try {
        const input = asObject(params);
        const operationName = requiredOperation(
          input.operation,
          operationNames,
        );
        const operation = client.getOperation(operationName);
        if (!operation) throw new Error("operation is not configured");
        if (
          operation.requiresAuth &&
          config.requireAccountBinding &&
          !config.accountBindingMatched
        ) {
          throw new Error("agentAccountId has no Meituan credential binding");
        }
        if (operation.riskLevel === "write" && input.confirm !== true) {
          throw new Error(
            `operation ${operationName} is a write operation; confirm=true is required`,
          );
        }
        const biz = asObject(input.biz);
        return boundedResult({
          success: true,
          data: await client.invoke(operationName, biz),
        }, config.maxToolResultBytes);
      } catch (error) {
        return result({
          success: false,
          error: safeErrorMessage(error),
        });
      }
    },
  };
}

function result(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: undefined,
  };
}

/** `maxResponseBytes` 控制进程内存，本函数用更小上限控制进入模型 transcript 的内容。 */
function boundedResult(
  payload: Record<string, unknown>,
  maxBytes: number,
): ToolResult {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return result({
      success: false,
      error: "Meituan tool result exceeded maxToolResultBytes",
    });
  }
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
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

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Meituan tool execution failed";
  return raw
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 512) || "Meituan tool execution failed";
}
