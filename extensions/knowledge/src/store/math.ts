/**
 * @fileoverview 向量相似度数学工具 — 供内存/SQLite 检索路径共用。
 *
 * **模块角色**：Knowledge Plugin · Store math utilities。
 *
 * @module knowledge/store/math
 */

/**
 * @description 计算两向量的余弦相似度并映射到 `[0, 1]`（1 表示最相似）。
 *
 * @param a - 向量 A。
 * @param b - 向量 B，维度须与 A 一致。
 * @returns 归一化相似度；零向量时返回 0。
 * @throws 维度不一致。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: a=${a.length}, b=${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) return 0;

  // 归一化到 [0, 1]
  return (dotProduct / magnitude + 1) / 2;
}
