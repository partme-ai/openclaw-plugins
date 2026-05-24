import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  _resetFfmpegAvailabilityCacheForTests,
  hasFfmpeg,
} from "./voice-transcode.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const spawnMock = vi.mocked(spawn);

describe("hasFfmpeg", () => {
  afterEach(() => {
    _resetFfmpegAvailabilityCacheForTests();
    spawnMock.mockReset();
  });

  it("caches probe result and spawns ffmpeg only once", async () => {
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
      } as ReturnType<typeof spawn>;
    });

    await expect(hasFfmpeg()).resolves.toBe(true);
    await expect(hasFfmpeg()).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith("ffmpeg", ["-version"], { stdio: "ignore" });
  });
});
