let _runtime: Record<string, unknown> | undefined;

export function setRuntime(rt: Record<string, unknown>): void {
  _runtime = rt;
}

export function getRuntime(): Record<string, unknown> {
  if (!_runtime) throw new Error("Runtime not initialized");
  return _runtime;
}
