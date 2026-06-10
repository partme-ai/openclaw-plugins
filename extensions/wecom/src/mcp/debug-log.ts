/**
 * @module mcp/debug-log
 *
 * MCP 调试日志开关：避免热路径上对大对象做 JSON.stringify。
 */

/** 是否启用 MCP 详细调试日志（WECOM_MCP_DEBUG=1 或 OPENCLAW_DEBUG 含 mcp）。 */
export function isWeComMcpDebugEnabled(): boolean {
  const explicit = process.env.WECOM_MCP_DEBUG?.trim();
  if (explicit === "1" || explicit?.toLowerCase() === "true") {
    return true;
  }
  const openclawDebug = process.env.OPENCLAW_DEBUG?.toLowerCase() ?? "";
  return openclawDebug.includes("mcp");
}

/**
 * 仅在 MCP 调试开启时输出 console.log。
 */
export function mcpDebugLog(message: string): void {
  if (isWeComMcpDebugEnabled()) {
    console.log(message);
  }
}
