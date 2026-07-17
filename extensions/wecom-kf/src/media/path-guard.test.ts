/**
 * 本地媒体路径安全边界测试。
 *
 * 这里刻意使用真实目录、真实符号链接与 message-sdk Path Guard，避免只验证 mock
 * 而漏掉 `realpath`、目录前缀混淆和文件大小限制等生产风险。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readGuardedLocalMediaFile, resolveAllowedRootForLocalPath } from "./path-guard.js";

const tempPaths: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

describe("resolveAllowedRootForLocalPath", () => {
  it("允许白名单目录内的真实文件", async () => {
    const root = await makeTempDir("wecom-kf-guard-root-");
    const file = path.join(root, "photo.png");
    await fs.writeFile(file, "png-data");

    expect(await resolveAllowedRootForLocalPath(file, [root])).toBe(await fs.realpath(root));
  });

  it("拒绝名称前缀相同但实际位于白名单外的兄弟目录", async () => {
    const parent = await makeTempDir("wecom-kf-guard-prefix-");
    const root = path.join(parent, "allowed");
    const sibling = path.join(parent, "allowed-evil");
    await fs.mkdir(root);
    await fs.mkdir(sibling);
    const secret = path.join(sibling, "secret.txt");
    await fs.writeFile(secret, "secret");

    expect(await resolveAllowedRootForLocalPath(secret, [root])).toBeUndefined();
  });

  it("拒绝把文件系统根目录作为白名单", async () => {
    const root = path.parse(process.cwd()).root;
    expect(await resolveAllowedRootForLocalPath(import.meta.filename, [root])).toBeUndefined();
  });

  it("拒绝通过白名单内符号链接逃逸到外部文件", async () => {
    const root = await makeTempDir("wecom-kf-guard-link-root-");
    const outside = await makeTempDir("wecom-kf-guard-link-outside-");
    const secret = path.join(outside, "secret.txt");
    const link = path.join(root, "looks-safe.txt");
    await fs.writeFile(secret, "secret");
    await fs.symlink(secret, link);

    expect(await resolveAllowedRootForLocalPath(link, [root])).toBeUndefined();
  });
});

describe("readGuardedLocalMediaFile", () => {
  it("通过真实 Path Guard 读取白名单内文件", async () => {
    const root = await makeTempDir("wecom-kf-guard-read-");
    const file = path.join(root, "note.txt");
    await fs.writeFile(file, "hello");

    const result = await readGuardedLocalMediaFile({ filePath: file, allowedRoots: [root] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString("utf8")).toBe("hello");
    }
  });

  it("将超出大小限制归类为 too large", async () => {
    const root = await makeTempDir("wecom-kf-guard-size-");
    const file = path.join(root, "large.bin");
    await fs.writeFile(file, Buffer.alloc(32));

    const result = await readGuardedLocalMediaFile({
      filePath: file,
      allowedRoots: [root],
      maxBytes: 8,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectReason).toBe("too large");
    }
  });
});
