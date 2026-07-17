/**
 * 向量写入前的公共防线：维度必须完全一致，且每个元素都必须是有限数值。
 * 提前拒绝 NaN/Infinity 和维度漂移，避免污染已经持久化的知识库索引。
 */
export function assertVector(vector: number[], dimensions: number, label = 'vector'): void {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`${label} dimensions mismatch: expected ${dimensions}, received ${Array.isArray(vector) ? vector.length : 'invalid'}`);
  }
  if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite value`);
  }
}
