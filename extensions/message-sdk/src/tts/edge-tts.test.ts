/**
 * Edge TTS CLI 生命周期测试。
 *
 * mock `execFile` 但真实写入临时输出，验证参数数组（无 shell）、大小闸门、超时分类与目录清理。
 */

import * as fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const childMocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: childMocks.execFile }));

import { TTSRequestError, TTSTimeoutError } from "./errors.js";
import { synthesizeEdgeTTS } from "./edge-tts.js";

function fakeChild() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
}

describe("synthesizeEdgeTTS", () => {
  afterEach(() => {
    childMocks.execFile.mockReset();
  });

  it("uses execFile argument boundaries and returns the generated MP3", async () => {
    let outputFile = "";
    childMocks.execFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error?: Error | null) => void) => {
      outputFile = args[args.indexOf("--write-media") + 1] ?? "";
      void fs.writeFile(outputFile, "mp3-data").then(() => callback(null));
      return fakeChild();
    });

    const result = await synthesizeEdgeTTS("你好; rm -rf /", {
      voice: "zh-CN-XiaoxiaoNeural",
      rate: "+10%",
    });

    expect(result.audio.toString()).toBe("mp3-data");
    expect(childMocks.execFile).toHaveBeenCalledWith(
      "edge-tts",
      expect.arrayContaining(["--text", "你好; rm -rf /", "--voice", "zh-CN-XiaoxiaoNeural"]),
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
    await expect(fs.access(outputFile)).rejects.toThrow();
  });

  it("rejects oversized CLI output and still removes the temp directory", async () => {
    let outputFile = "";
    childMocks.execFile.mockImplementation((_command: string, args: string[], _options: unknown, callback: (error?: Error | null) => void) => {
      outputFile = args[args.indexOf("--write-media") + 1] ?? "";
      void fs.writeFile(outputFile, "too-large").then(() => callback(null));
      return fakeChild();
    });
    await expect(synthesizeEdgeTTS("text", { maxAudioBytes: 2 }))
      .rejects.toThrow(/maxAudioBytes=2/);
    await expect(fs.access(outputFile)).rejects.toThrow();
  });

  it("classifies killed CLI processes as timeout", async () => {
    childMocks.execFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error & { killed?: boolean }) => void) => {
      const error = Object.assign(new Error("process stopped"), { killed: true });
      queueMicrotask(() => callback(error));
      return fakeChild();
    });
    await expect(synthesizeEdgeTTS("text", { timeoutMs: 10 })).rejects.toBeInstanceOf(TTSTimeoutError);
  });

  it("fails invalid input before spawning a child process", async () => {
    await expect(synthesizeEdgeTTS(" ")).rejects.toBeInstanceOf(TTSRequestError);
    await expect(synthesizeEdgeTTS("text", { timeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(synthesizeEdgeTTS("text", { maxAudioBytes: 0 })).rejects.toThrow(RangeError);
    expect(childMocks.execFile).not.toHaveBeenCalled();
  });
});
