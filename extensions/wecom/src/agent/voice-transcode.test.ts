import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetFfmpegAvailabilityCacheForTests,
  hasFfmpeg,
} from "./voice-transcode.js";

const spawnMock = vi.fn();

describe("hasFfmpeg", () => {
  const originalGetBuiltinModule = (process as unknown as Record<string, unknown>).getBuiltinModule;

  afterEach(() => {
    _resetFfmpegAvailabilityCacheForTests();
    spawnMock.mockReset();
    (process as unknown as Record<string, unknown>).getBuiltinModule = originalGetBuiltinModule;
  });

  it("caches probe result and spawns ffmpeg only once", async () => {
    // Mock process.getBuiltinModule to return our mock spawn
    (process as unknown as Record<string, unknown>).getBuiltinModule = vi.fn(() => ({
      spawn: spawnMock,
    }));

    spawnMock.mockImplementation(() => {
      const handlers: Record<string, Array<(code?: number) => void>> = {};
      return {
        on(event: string, cb: (code?: number) => void) {
          handlers[event] ??= [];
          handlers[event].push(cb);
          if (event === "exit") {
            queueMicrotask(() => handlers.exit?.forEach((fn) => fn(0)));
          }
          return undefined;
        },
      };
    });

    await expect(hasFfmpeg()).resolves.toBe(true);
    await expect(hasFfmpeg()).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith("ffmpeg", ["-version"], { stdio: "ignore" });
  });
});
