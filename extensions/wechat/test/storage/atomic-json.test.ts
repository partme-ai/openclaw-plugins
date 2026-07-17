import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePrivateJsonAtomic } from "../../src/storage/atomic-json.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("writePrivateJsonAtomic", () => {
  it("writes complete JSON with private file and directory modes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-atomic-json-"));
    roots.push(root);
    const filePath = path.join(root, "private", "state.json");

    writePrivateJsonAtomic(filePath, { token: "secret", cursor: "next" });

    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ token: "secret", cursor: "next" });
    if (process.platform !== "win32") {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    }
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["state.json"]);
  });

  it("atomically replaces an existing value", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-atomic-json-"));
    roots.push(root);
    const filePath = path.join(root, "state.json");
    writePrivateJsonAtomic(filePath, { version: 1 });
    writePrivateJsonAtomic(filePath, { version: 2 });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ version: 2 });
  });
});
