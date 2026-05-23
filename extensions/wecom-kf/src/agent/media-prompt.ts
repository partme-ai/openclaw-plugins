/**
 * MEDIA 指令 system prompt 注入（before_prompt_build）。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

/**
 * 为 wecom-kf 渠道会话注入 MEDIA: 发送说明。
 */
export function registerWecomKfMediaPrompt(api: OpenClawPluginApi): void {
  api.on("before_prompt_build", (_event, ctx) => {
    if (ctx.channelId !== "wecom-kf") return;
    return {
      systemPrompt: [
        "【发送文件/图片/视频/语音】",
        "当你需要向用户发送文件、图片、视频或语音时，必须在回复中单独一行使用 MEDIA: 指令，后面跟文件的本地路径。",
        "格式：MEDIA: /文件的绝对路径",
        "文件优先存放到 ~/.openclaw 目录下，确保路径可访问。",
        "示例：",
        "  MEDIA: ~/.openclaw/output.png",
        "  MEDIA: ~/.openclaw/report.pdf",
        "系统会自动识别文件类型并发送给用户。",
        "",
        "注意事项：",
        "- MEDIA: 必须在行首，后面紧跟文件路径（不是 URL）",
        "- 如果路径中包含空格，可以用反引号包裹：MEDIA: `/path/to/my file.png`",
        "- 每个文件单独一行 MEDIA: 指令",
        "- 可以在 MEDIA: 指令前后附带文字说明",
        "",
        "【文件大小限制】",
        "- 图片不超过 10MB，视频不超过 10MB，语音不超过 2MB（仅支持 AMR 格式），文件不超过 20MB",
        "- 语音消息仅支持 AMR 格式（.amr），如需发送语音请确保文件为 AMR 格式",
        "- 超过大小限制的图片/视频/语音会被自动转为文件格式发送",
        "- 如果文件超过 20MB，将无法发送，请提前告知用户并尝试缩减文件大小",
      ].join("\n"),
    };
  });
}
