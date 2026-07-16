/**
 * @fileoverview OAuth2 授权事务和登录会话的安全存储。
 *
 * 支持有容量上限的进程内后端和带 TTL 的 Redis 后端；授权 state 采用一次性 `take` 防重放，
 * Cookie 仅保存经 HMAC-SHA256 签名的随机标识，并启用 HttpOnly/SameSite。`returnTo` 被限制为
 * 本站绝对路径以阻止开放重定向，签名比较使用常量时间算法。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { Redis } from "ioredis";

import type { AuthContext, OAuth2ClientConfig, OAuth2TokenSet } from "../shared/types.js";

export type OAuth2Session = {
  id: string;
  context: AuthContext;
  tokens: OAuth2TokenSet;
  expiresAt: number;
};

export type PendingState = { expiresAt: number; returnTo: string; codeVerifier: string };
type StoredValue = PendingState | OAuth2Session;

interface SessionBackend {
  start(): Promise<void>;
  stop(): Promise<void>;
  get<T extends StoredValue>(key: string): Promise<T | null>;
  take<T extends StoredValue>(key: string): Promise<T | null>;
  set(key: string, value: StoredValue, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

class MemoryBackend implements SessionBackend {
  private readonly values = new Map<string, StoredValue>();
  constructor(private readonly maxEntries: number) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.values.clear(); }
  async get<T extends StoredValue>(key: string): Promise<T | null> {
    const value = this.values.get(key);
    if (!value || value.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return value as T;
  }
  async take<T extends StoredValue>(key: string): Promise<T | null> {
    const value = await this.get<T>(key);
    this.values.delete(key);
    return value;
  }
  async set(key: string, value: StoredValue): Promise<void> {
    const now = Date.now();
    for (const [candidate, stored] of this.values) {
      if (stored.expiresAt <= now) this.values.delete(candidate);
    }
    if (!this.values.has(key) && this.values.size >= this.maxEntries) {
      throw new Error(`[openclaw-oauth2] in-memory session store capacity ${this.maxEntries} reached`);
    }
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

class RedisBackend implements SessionBackend {
  private readonly redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
    });
  }
  async start(): Promise<void> { await this.redis.connect(); }
  async stop(): Promise<void> {
    if (this.redis.status === "end") return;
    await this.redis.quit();
  }
  async get<T extends StoredValue>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) as T : null;
  }
  async take<T extends StoredValue>(key: string): Promise<T | null> {
    const value = await this.redis.getdel(key);
    return value ? JSON.parse(value) as T : null;
  }
  async set(key: string, value: StoredValue, ttlMs: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "PX", Math.max(1, ttlMs));
  }
  async delete(key: string): Promise<void> { await this.redis.del(key); }
}

function parseCookies(headers: IncomingHttpHeaders): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    result.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return result;
}

function safeReturnTo(value: string | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  return value;
}

/** 统一管理 PKCE 授权事务、会话 Cookie 及其内存/Redis 生命周期。 */
export class OAuth2SessionStore {
  private readonly backend: SessionBackend;
  private readonly prefix: string;

  constructor(private readonly config: OAuth2ClientConfig) {
    this.prefix = config.sessionStore.keyPrefix.replace(/:+$/, "");
    this.backend = config.sessionStore.type === "redis"
      ? new RedisBackend(config.sessionStore.redisUrl as string)
      : new MemoryBackend(config.sessionStore.maxEntries);
  }

  async start(): Promise<void> { await this.backend.start(); }
  async stop(): Promise<void> { await this.backend.stop(); }

  async createAuthorizationState(returnTo: string | undefined, codeVerifier: string): Promise<{ state: string; cookie: string }> {
    const state = randomBytes(32).toString("base64url");
    const ttlMs = this.config.stateTtlSeconds * 1000;
    await this.backend.set(this.key("state", state), {
      expiresAt: Date.now() + ttlMs,
      returnTo: safeReturnTo(returnTo, this.config.successRedirect),
      codeVerifier,
    }, ttlMs);
    return { state, cookie: this.cookie(this.stateCookieName(state), this.sign(state), this.config.stateTtlSeconds) };
  }

  async consumeAuthorizationState(state: string, headers: IncomingHttpHeaders): Promise<PendingState | null> {
    const signedState = parseCookies(headers).get(this.stateCookieName(state));
    if (!signedState || this.verify(signedState) !== state) return null;
    const key = this.key("state", state);
    const pending = await this.backend.take<PendingState>(key);
    if (!pending || pending.expiresAt <= Date.now()) return null;
    return pending;
  }

  async createSession(context: AuthContext, tokens: OAuth2TokenSet): Promise<{ session: OAuth2Session; cookie: string }> {
    const id = randomBytes(32).toString("base64url");
    const ttlMs = this.config.sessionTtlSeconds * 1000;
    const session = { id, context, tokens, expiresAt: Date.now() + ttlMs };
    await this.backend.set(this.key("session", id), session, ttlMs);
    return { session, cookie: this.cookie(this.config.sessionCookieName, this.sign(id), this.config.sessionTtlSeconds) };
  }

  async saveSession(session: OAuth2Session): Promise<void> {
    const ttlMs = session.expiresAt - Date.now();
    if (ttlMs <= 0) return this.backend.delete(this.key("session", session.id));
    await this.backend.set(this.key("session", session.id), session, ttlMs);
  }

  async getSession(headers: IncomingHttpHeaders): Promise<OAuth2Session | null> {
    const signedId = parseCookies(headers).get(this.config.sessionCookieName);
    if (!signedId) return null;
    const id = this.verify(signedId);
    if (!id) return null;
    const session = await this.backend.get<OAuth2Session>(this.key("session", id));
    if (!session || session.expiresAt <= Date.now()) {
      await this.backend.delete(this.key("session", id));
      return null;
    }
    return session;
  }

  async deleteSession(headers: IncomingHttpHeaders): Promise<OAuth2Session | null> {
    const session = await this.getSession(headers);
    if (session) await this.backend.delete(this.key("session", session.id));
    return session;
  }

  clearCookie(): string { return this.cookie(this.config.sessionCookieName, "", 0); }
  clearStateCookie(state: string): string { return this.cookie(this.stateCookieName(state), "", 0); }

  private key(kind: "state" | "session", id: string): string { return `${this.prefix}:${kind}:${id}`; }

  private stateCookieName(state: string): string {
    const suffix = createHash("sha256").update(state).digest("hex").slice(0, 16);
    return `openclaw_oauth2_state_${suffix}`;
  }

  private cookie(name: string, value: string, maxAge: number): string {
    return [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      this.config.secureCookies ? "Secure" : "",
      `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    ].filter(Boolean).join("; ");
  }

  private sign(value: string): string {
    const signature = createHmac("sha256", this.config.sessionSecret).update(value).digest("base64url");
    return `${value}.${signature}`;
  }

  private verify(signed: string): string | null {
    const separator = signed.lastIndexOf(".");
    if (separator <= 0) return null;
    const value = signed.slice(0, separator);
    const provided = Buffer.from(signed.slice(separator + 1));
    const expected = Buffer.from(createHmac("sha256", this.config.sessionSecret).update(value).digest("base64url"));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    return value;
  }
}
