/**
 * 从 Agent 出站文本推断本机文件/图片路径（需与入站原文交叉校验）。
 */

const LOCAL_FILE_RE = new RegExp(
  String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF\u3400-\u4DBF]+)`,
  "g",
);

/**
 * 从文本中提取本机绝对路径（不限扩展名）。
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

export type ExtractLocalImagePathsParams = {
  text: string;
  /** 安全约束：路径必须也出现在入站原文中 */
  mustAlsoAppearIn: string;
};

/**
 * 从出站文本提取本机图片路径（png/jpg/jpeg/gif/webp/bmp），且须出现在 mustAlsoAppearIn。
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
    if (!mustAlsoAppearIn.includes(p)) continue;
    found.add(p);
  }
  return Array.from(found);
}
