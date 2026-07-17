import { afterEach, describe, expect, it } from "vitest";

import { bridgeRuntime, clearBridgeRuntime, getBridgeRuntime, setBridgeRuntime } from "../src/runtime.js";

afterEach(() => clearBridgeRuntime());

describe("Bridge 进程内 Runtime 生命周期", () => {
  it("只提取最小能力，并可在停止时清理旧宿主引用", () => {
    const api = { runtime: { id: "runtime" }, logger: { info() {} }, pluginConfig: { secret: true } } as never;
    expect(bridgeRuntime(api)).toEqual({ runtime: { id: "runtime" }, logger: api.logger });
    expect(setBridgeRuntime(api)).toEqual(getBridgeRuntime());
    clearBridgeRuntime();
    expect(getBridgeRuntime()).toBeNull();
  });
});
