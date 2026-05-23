/**
 * @module webhook/command-auth
 *
 * Webhook 命令授权**薄封装**（复用 `shared/command-auth`）。
 *
 * **职责**：解析 DM 策略下的命令执行权限，生成未授权中文提示。
 *
 * **与 message-sdk 关系**：无直接依赖；与 OpenClaw channel.reply 授权模型对齐。
 *
 * **关键导出**：`resolveWecomCommandAuthorization`、`buildWecomUnauthorizedCommandPrompt`
 */

export {
  resolveWecomCommandAuthorization,
  buildWecomUnauthorizedCommandPrompt,
  type WecomCommandAuthResult,
} from "../shared/command-auth.js";
