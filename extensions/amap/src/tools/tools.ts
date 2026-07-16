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

export const AMAP_TOOL_NAMES = ["amap_search_places", "amap_search_nearby", "amap_place_detail"] as const;

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
        return result({ success: true, data: await handler(asObject(params)) });
      } catch (error) {
        return result({ success: false, error: error instanceof Error ? error.message : String(error) });
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
          types: { type: "string", minLength: 1, maxLength: 128 },
          region: { type: "string", maxLength: 64 },
          city_limit: { type: "boolean" },
          page_size: { type: "integer", minimum: 1, maximum: 25 },
          page_num: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
      execute: execute(async (p) => {
        const keywords = optionalString(p.keywords, "keywords", 80);
        const types = optionalString(p.types, "types", 128);
        if (!keywords && !types) throw new Error("keywords or types is required");
        return client.get("/v5/place/text", {
          keywords, types,
          region: optionalString(p.region, "region", 64),
          city_limit: optionalBoolean(p.city_limit, "city_limit") === true ? "true" : undefined,
          page_size: optionalInteger(p.page_size, "page_size", 1, 25),
          page_num: optionalInteger(p.page_num, "page_num", 1, 100),
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
          types: { type: "string", maxLength: 128 },
          radius: { type: "integer", minimum: 0, maximum: 50000 },
          sortrule: { type: "string", enum: ["distance", "weight"] },
          page_size: { type: "integer", minimum: 1, maximum: 25 },
          page_num: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
      execute: execute(async (p) => client.get("/v5/place/around", {
        location: coordinates(p.location),
        keywords: optionalString(p.keywords, "keywords", 80),
        types: optionalString(p.types, "types", 128),
        radius: optionalInteger(p.radius, "radius", 0, 50_000),
        sortrule: optionalEnum(p.sortrule, "sortrule", ["distance", "weight"]),
        page_size: optionalInteger(p.page_size, "page_size", 1, 25),
        page_num: optionalInteger(p.page_num, "page_num", 1, 100),
      })),
    },
    {
      name: AMAP_TOOL_NAMES[2],
      label: "高德地点详情",
      description: "使用高德地点搜索 2.0 按 POI ID 查询详情。",
      parameters: {
        type: "object", additionalProperties: false, required: ["id"],
        properties: { id: { type: "string", minLength: 1, maxLength: 128 } },
      },
      execute: execute(async (p) => client.get("/v5/place/detail", { id: requiredString(p.id, "id", 128) })),
    },
  ];
}

function result(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], details: undefined };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name} must be a non-empty string up to ${max} characters`);
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

function coordinates(value: unknown): string {
  const raw = requiredString(value, "location", 64);
  const match = raw.match(/^(-?\d+(?:\.\d{1,6})?),(-?\d+(?:\.\d{1,6})?)$/);
  if (!match) throw new Error("location must be longitude,latitude with at most 6 decimal places");
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error("location coordinates are out of range");
  return raw;
}
