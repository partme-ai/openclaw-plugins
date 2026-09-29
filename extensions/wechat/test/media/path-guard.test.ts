import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readWeixinLocalMedia } from "../../src/media/path-guard.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((entry) => fs.rm(entry, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

async function withStateDir<T>(stateDir: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
  }
}

describe("Weixin local media Path Guard", () => {
  it("reads a file in the trusted current session sandbox", async () => {
    const parent = await tempDir("weixin-session-sandboxes-");
    const sessionWorkspaceDir = path.join(parent, "sandboxes", "current");
    await fs.mkdir(sessionWorkspaceDir, { recursive: true });
    const filePath = path.join(sessionWorkspaceDir, "result.png");
    await fs.writeFile(filePath, "session-media");

    await withStateDir(parent, async () => {
      await expect(
        readWeixinLocalMedia({
          filePath,
          cfg: {},
          agentId: "main",
          sessionWorkspaceDir,
          maxBytes: 1024,
        }),
      ).resolves.toEqual(Buffer.from("session-media"));
    });
  });

  it("does not grant a sibling sandbox through the current session", async () => {
    const parent = await tempDir("weixin-session-sandboxes-");
    const sessionWorkspaceDir = path.join(parent, "sandboxes", "current");
    const siblingWorkspaceDir = path.join(parent, "sandboxes", "sibling");
    await fs.mkdir(sessionWorkspaceDir, { recursive: true });
    await fs.mkdir(siblingWorkspaceDir, { recursive: true });
    const filePath = path.join(siblingWorkspaceDir, "secret.png");
    await fs.writeFile(filePath, "sibling-secret");

    await withStateDir(parent, async () => {
      await expect(
        readWeixinLocalMedia({
          filePath,
          cfg: {},
          agentId: "main",
          sessionWorkspaceDir,
          maxBytes: 1024,
        }),
      ).rejects.toThrow("not under an allowed directory");
    });
  });

  it("reads a regular file inside an explicitly trusted root", async () => {
    const root = await tempDir("weixin-media-root-");
    const filePath = path.join(root, "report.txt");
    await fs.writeFile(filePath, "safe-media");

    await expect(
      readWeixinLocalMedia({ filePath, customRoots: [root], maxBytes: 1024 }),
    ).resolves.toEqual(Buffer.from("safe-media"));
  });

  it("rejects files outside mediaLocalRoots", async () => {
    const root = await tempDir("weixin-media-root-");
    const outside = await tempDir("weixin-media-outside-");
    const filePath = path.join(outside, "secret.txt");
    await fs.writeFile(filePath, "secret");

    await expect(
      readWeixinLocalMedia({ filePath, customRoots: [root], maxBytes: 1024 }),
    ).rejects.toThrow("not under an allowed directory");
  });

  it("rejects symbolic-link escapes and oversized files", async () => {
    const root = await tempDir("weixin-media-root-");
    const outside = await tempDir("weixin-media-outside-");
    const target = path.join(outside, "secret.txt");
    const link = path.join(root, "linked-secret.txt");
    await fs.writeFile(target, "secret");
    await fs.symlink(target, link);

    await expect(
      readWeixinLocalMedia({
        filePath: link,
        customRoots: [root],
        maxBytes: 1024,
      }),
    ).rejects.toThrow();

    const large = path.join(root, "large.bin");
    await fs.writeFile(large, Buffer.alloc(32));
    await expect(
      readWeixinLocalMedia({
        filePath: large,
        customRoots: [root],
        maxBytes: 16,
      }),
    ).rejects.toThrow();
  });
});
