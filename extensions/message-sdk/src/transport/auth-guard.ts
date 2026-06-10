/**
 * @module message-sdk/transport/auth-guard
 *
 * 统一密码校验 — 明文 timingSafeEqual + sha256/sha512 哈希比对。
 *
 * mqtt 和 web-mqtt 各自实现了 `verifyPassword` 和 `safeEqual`，
 * 逻辑完全一致，收敛到此处。
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 恒定时间 Buffer 相等比较，防止时序侧信道。
 *
 * @param a - Buffer A
 * @param b - Buffer B
 * @returns 两个 Buffer 内容是否相等（长度不同直接返回 false）
 */
export function safeEqualBuffer(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 校验密码：支持明文比对或哈希比对。
 *
 * **明文模式**：传入 `expectedPlain` 时直接做恒定时间比较。
 * **哈希模式**：传入 `expectedHash` + `algorithm` 时对输入做哈希后比对。
 *
 * @param input - 用户输入的明文密码
 * @param expectedPlain - 配置中存储的明文密码（与 expectedHash 二选一）
 * @param expectedHash - 配置中存储的密码哈希（与 expectedPlain 二选一）
 * @param algorithm - 哈希算法，默认 `"sha256"`
 * @returns 密码是否匹配
 */
export function verifyPassword(
  input: string,
  expectedPlain?: string,
  expectedHash?: string,
  algorithm: "sha256" | "sha512" = "sha256",
): boolean {
  // 明文比对
  if (typeof expectedPlain === "string") {
    return safeEqualBuffer(Buffer.from(expectedPlain), Buffer.from(input));
  }
  // 哈希比对
  if (typeof expectedHash !== "string") {
    return false;
  }
  const actualHex = createHash(algorithm).update(input, "utf-8").digest("hex");
  const actualBuf = Buffer.from(actualHex, "hex");
  const expectedBuf = Buffer.from(expectedHash, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return safeEqualBuffer(actualBuf, expectedBuf);
}
