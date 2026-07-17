/**
 * @fileoverview 高德地点能力到 OpenClaw Tool 契约的适配层。
 *
 * 本文件定义三个工具的 JSON Schema、调用权限和参数边界，并把高德响应统一封装为文本结果。
 * 所有 Agent 参数都按不可信输入处理，经长度、类型、枚举及经纬度范围校验后才调用客户端。
 */
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import type { AmapPluginConfig } from "../types.js";
import { AmapClient } from "../amap/amap-api.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: undefined };
type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: unknown) => Promise<ToolResult>;
};

/** 插件对 Agent 暴露的固定工具白名单；顺序与 `createAmapTools` 返回值保持一致。 */
export const AMAP_TOOL_NAMES = ["amap_search_places", "amap_search_nearby", "amap_place_detail"] as const;
const POI_TYPES_PATTERN = /^\d{6}(?:\|\d{6})*$/u;
const POI_IDS_PATTERN = /^[A-Za-z0-9]+(?:\|[A-Za-z0-9]+){0,9}$/u;

/** 为一次 Tool 上下文创建高德地点工具集合。 */
export function createAmapTools(
  ctx: OpenClawPluginToolContext,
  config: AmapPluginConfig,
  client = new AmapClient(config),
): ToolDefinition[] {
  const execute = (handler: (params: Record<string, unknown>) => Promise<Record<string, unknown>>) =>
    async (_toolCallId: string, params: unknown): Promise<ToolResult> => {
      if (config.ownerOnly && ctx.senderIsOwner !== true) return result({ success: false, error: "AMap tools are restricted to the command owner" });
      try {
        return boundedResult({ success: true, data: await handler(asObject(params)) }, config.maxToolResultBytes);
      } catch (error) {
        return result({ success: false, error: safeErrorMessage(error) });
      }
    };

  return [
    {
      name: AMAP_TOOL_NAMES[0],
      label: "高德地点搜索",
      description: "使用高德地点搜索 2.0 按关键词、类型和区域查询 POI。",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          keywords: { type: "string", minLength: 1, maxLength: 80 },
          types: { type: "string", pattern: "^\\d{6}(?:\\|\\d{6})*$", maxLength: 128 },
          region: { type: "string", maxLength: 64 },
          city_limit: { type: "boolean" },
          page_size: { type: "integer", minimum: 1, maximum: 25 },
          page_num: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      execute: execute(async (p) => {
        const keywords = optionalString(p.keywords, "keywords", 80);
        const types = optionalPoiTypes(p.types);
        if (!keywords && !types) throw new Error("keywords or types is required");
        const pagination = paginationParams(p);
        return client.get("/v5/place/text", {
          keywords, types,
          region: optionalString(p.region, "region", 64),
          city_limit: optionalBoolean(p.city_limit, "city_limit") === true ? "true" : undefined,
          ...pagination,
        });
      }),
    },
    {
      name: AMAP_TOOL_NAMES[1],
      label: "高德周边搜索",
      description: "使用高德地点搜索 2.0 查询指定经纬度附近的 POI。",
      parameters: {
        type: "object", additionalProperties: false, required: ["location"],
        properties: {
          location: { type: "string", pattern: "^-?\\d+(?:\\.\\d{1,6})?,-?\\d+(?:\\.\\d{1,6})?$" },
          keywords: { type: "string", maxLength: 80 },
          types: { type: "string", pattern: "^\\d{6}(?:\\|\\d{6})*$", maxLength: 128 },
          radius: { type: "integer", minimum: 0, maximum: 50000 },
          sortrule: { type: "string", enum: ["distance", "weight"] },
          page_size: { type: "integer", minimum: 1, maximum: 25 },
          page_num: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      execute: execute(async (p) => {
        const pagination = paginationParams(p);
        return client.get("/v5/place/around", {
          location: coordinates(p.location),
          keywords: optionalString(p.keywords, "keywords", 80),
          types: optionalPoiTypes(p.types),
          radius: optionalInteger(p.radius, "radius", 0, 50_000),
          sortrule: optionalEnum(p.sortrule, "sortrule", ["distance", "weight"]),
          ...pagination,
        });
      }),
    },
    {
      name: AMAP_TOOL_NAMES[2],
      label: "高德地点详情",
      description: "使用高德地点搜索 2.0 按 POI ID 查询详情。",
      parameters: {
        type: "object", additionalProperties: false, required: ["id"],
        properties: { id: { type: "string", pattern: "^[A-Za-z0-9]+(?:\\|[A-Za-z0-9]+){0,9}$", maxLength: 128 } },
      },
      execute: execute(async (p) => client.get("/v5/place/detail", { id: poiIds(p.id) })),
    },
  ];
}

function result(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], details: undefined };
}

/** 上游响应上限保护进程；更小的 Tool Result 上限保护模型上下文和会话持久化。 */
function boundedResult(payload: Record<string, unknown>, maxBytes: number): ToolResult {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return result({ success: false, error: "AMap tool result exceeded maxToolResultBytes" });
  }
  return { content: [{ type: "text", text }], details: undefined };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name} must be a non-empty string up to ${max} characters`);
  if (/[\u0000-\u001F\u007F]/u.test(value)) throw new Error(`${name} must not contain control characters`);
  return value.trim();
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, name, max);
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value as number;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function optionalEnum<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

/** 高德 POI 类型是六位行业代码；多类型用竖线分隔，拒绝把任意文本透传到供应商。 */
function optionalPoiTypes(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const types = requiredString(value, "types", 128);
  if (!POI_TYPES_PATTERN.test(types)) throw new Error("types must contain 6-digit POI codes separated by |");
  return types;
}

/** 地点详情官方支持一次最多十个 POI ID，多个 ID 用竖线分隔。 */
function poiIds(value: unknown): string {
  const ids = requiredString(value, "id", 128);
  if (!POI_IDS_PATTERN.test(ids)) throw new Error("id must contain 1 to 10 alphanumeric POI IDs separated by |");
  return ids;
}

/** 同一检索条件最多翻取 200 条；组合校验比单独限制 page_num 更准确。 */
function paginationParams(params: Record<string, unknown>): { page_size?: number; page_num?: number } {
  const pageSize = optionalInteger(params.page_size, "page_size", 1, 25);
  const pageNum = optionalInteger(params.page_num, "page_num", 1, 20);
  if ((pageSize ?? 10) * (pageNum ?? 1) > 200) {
    throw new Error("page_num and page_size must not request records beyond the first 200 results");
  }
  return { page_size: pageSize, page_num: pageNum };
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "AMap tool execution failed";
  return raw.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, 512) || "AMap tool execution failed";
}

function coordinates(value: unknown): string {
  const raw = requiredString(value, "location", 64);
  const match = raw.match(/^(-?\d+(?:\.\d{1,6})?),(-?\d+(?:\.\d{1,6})?)$/);
  if (!match) throw new Error("location must be longitude,latitude with at most 6 decimal places");
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error("location coordinates are out of range");
  return raw;
}
