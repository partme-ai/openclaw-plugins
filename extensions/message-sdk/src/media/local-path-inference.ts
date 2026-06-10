/**
 * @module media/local-path-inference
 *
 * 从 Agent 出站文本推断本机文件/图片路径（需与入站原文交叉校验）。
 *
 * **职责**：在 Agent 未显式输出 `MEDIA:` 指令时，从回复文本中启发式提取
 * 本机绝对路径；图片路径必须与入站原文交叉验证，防止幻觉路径被发送。
 *
 * **关键导出**：`extractLocalFilePathsFromText`、`extractLocalImagePathsFromText`
 */

/** 匹配 Unix 风格本机绝对路径（Users/tmp/root/home 开头） */
const LOCAL_FILE_RE = new RegExp(
  String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF\u3400-\u4DBF]+)`,
  "g",
);

/**
 * 从文本中提取本机绝对路径（不限扩展名）。
 *
 * @param text - 待扫描文本（通常为 Agent 出站回复）
 * @returns 去重后的路径列表；空文本返回 `[]`
 *
 * @example
 * ```ts
 * extractLocalFilePathsFromText("见 /Users/me/out/report.pdf");
 * // => ["/Users/me/out/report.pdf"]
 * ```
 */
export function extractLocalFilePathsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(LOCAL_FILE_RE.source, LOCAL_FILE_RE.flags);
  while ((m = re.exec(text))) {
    const p = m[1];
    if (p) found.add(p);
  }
  return Array.from(found);
}

/**
 * `extractLocalImagePathsFromText` 参数 / Parameters for image path extraction.
 *
 * @property text - Agent 出站文本
 * @property mustAlsoAppearIn - 入站原文；路径必须出现在此字符串中才视为有效
 */
export type ExtractLocalImagePathsParams = {
  text: string;
  /** 安全约束：路径必须也出现在入站原文中 */
  mustAlsoAppearIn: string;
};

/**
 * 从出站文本提取本机图片路径，且须出现在 `mustAlsoAppearIn` 中。
 *
 * 仅匹配 png/jpg/jpeg/gif/webp/bmp 扩展名；用于防止 Agent 幻觉出不存在的图片路径。
 *
 * @param params - 出站文本与入站交叉校验原文
 * @returns 通过校验的图片路径列表
 *
 * @example
 * ```ts
 * extractLocalImagePathsFromText({
 *   text: "截图见 /Users/me/a.png",
 *   mustAlsoAppearIn: "用户上传了 /Users/me/a.png",
 * });
 * ```
 */
export function extractLocalImagePathsFromText(params: ExtractLocalImagePathsParams): string[] {
  const { text, mustAlsoAppearIn } = params;
  if (!text.trim()) return [];
  const exts = "(png|jpg|jpeg|gif|webp|bmp)";
  const re = new RegExp(String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>]+?\.${exts})`, "gi");
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[1];
    if (!p) continue;
    // 安全约束：路径必须在入站原文中出现，否则视为 Agent 幻觉
    if (!mustAlsoAppearIn.includes(p)) continue;
    found.add(p);
  }
  return Array.from(found);
}
