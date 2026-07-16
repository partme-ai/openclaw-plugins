export function assertVector(vector: number[], dimensions: number, label = 'vector'): void {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`${label} dimensions mismatch: expected ${dimensions}, received ${Array.isArray(vector) ? vector.length : 'invalid'}`);
  }
  if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite value`);
  }
}
