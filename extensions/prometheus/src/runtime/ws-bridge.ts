/**
 * @fileoverview Gateway WebSocket RPC 桥接层。
 *
 * @description
 * 基于 `openclaw/plugin-sdk/gateway-runtime` 的 GatewayClient 连接当前 Gateway，
 * 供 collector 拉取 overview/usage 等 RPC 数据；含重连与成功/失败审计。
 *
 * @module runtime/ws-bridge
 */

import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

import type { GatewayRuntime } from "../types.js";
import { recordRpcError, recordRpcSuccess, setRpcClientInitialized } from "./store.js";

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 5_000;

/** 缓存的 Gateway Runtime 引用 */
let _runtime: GatewayRuntime | null = null;
let _gatewayClient: GatewayClient | null = null;
let _gatewayReadyPromise: Promise<GatewayClient> | null = null;

/**
 * 设置 Gateway Runtime 引用
 * 在插件 register() 时调用
 *
 * @param runtime - Gateway 注入的运行时
 */
export function setRuntime(runtime: GatewayRuntime): void {
  _runtime = runtime;
}

/**
 * 获取 Gateway Runtime 引用
 *
 * @throws 如果 runtime 未初始化
 */
export function getRuntime(): GatewayRuntime {
  if (!_runtime) {
    throw new Error(
      "[openclaw-prometheus] Gateway runtime not initialized. Plugin not registered?"
    );
  }
  return _runtime;
}

/**
 * @description 执行单次 Gateway RPC 请求并记录成功/失败审计。
 *
 * @param method - RPC 方法名
 * @param params - 可选请求参数
 * @returns RPC 响应 payload
 * @throws 连接失败或 RPC 错误时抛出
 */
export async function rpcCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const client = await getGatewayClient();
    const payload = await client.request<T>(method, params ?? {});
    recordRpcSuccess(method);
    return payload;
  } catch (error) {
    recordRpcError(method, error);
    throw error;
  }
}

/**
 * 并行执行多个 RPC 调用
 * 失败的请求返回 null，不影响其他请求
 *
 * @param requests - 请求列表 [方法名, 参数?]
 * @returns 响应列表（与请求顺序对应）
 */
export async function rpcBatch(
  requests: Array<[string, Record<string, unknown>?]>
): Promise<Array<unknown | null>> {
  const results = await Promise.allSettled(
    requests.map(([method, params]) => rpcCall(method, params))
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}

/**
 * @description 读取当前 Gateway 配置对象。
 *
 * @returns Gateway config 根对象
 */
export function getConfig(): Record<string, unknown> {
  return getRuntime().config;
}

/**
 * @description 检查 Gateway Runtime 是否已通过 setRuntime 注入。
 *
 * @returns true 表示 runtime 已就绪
 */
export function isReady(): boolean {
  return _runtime !== null;
}

/** @description 获取或建立 GatewayClient 单例（含重连 Promise 缓存）。 */
async function getGatewayClient(): Promise<GatewayClient> {
  if (_gatewayClient && _gatewayReadyPromise) {
    return _gatewayReadyPromise;
  }

  const runtime = getRuntime();
  const gateway = readGatewayConfig(runtime.config);
  const url = resolveGatewayUrl(gateway);
  const connect = resolveGatewayConnect(gateway);

  _gatewayReadyPromise = connectWithRetry(url, connect, 0);

  return _gatewayReadyPromise;
}

/**
 * @description 带超时与指数退避的 GatewayClient 连接尝试。
 *
 * @param url - WebSocket Gateway URL
 * @param connect - 鉴权与 role/scopes 连接参数
 * @param attempt - 当前重试次数（0-based）
 */
async function connectWithRetry(
  url: string,
  connect: Record<string, unknown>,
  attempt: number,
): Promise<GatewayClient> {
  return new Promise<GatewayClient>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        const err = new Error(
          `[openclaw-prometheus] Gateway connection timeout after ${CONNECT_TIMEOUT_MS}ms at ${url}`
        );
        handleConnectionFailure(err, url, connect, attempt, reject);
      }
    }, CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    const client = new GatewayClient({
      url,
      ...connect,
      requestTimeoutMs: 20_000,
      onHelloOk: () => {
        if (!settled) {
          settled = true;
          cleanup();
          setRpcClientInitialized(true);
          resolve(client);
        }
      },
      onConnectError: (error) => {
        if (!settled) {
          settled = true;
          cleanup();
          setRpcClientInitialized(false);
          handleConnectionFailure(error, url, connect, attempt, reject);
        }
      },
      onClose: () => {
        setRpcClientInitialized(false);
        // 不清空 _gatewayReadyPromise，让下次 rpcCall 触发重连
        _gatewayClient = null;
      },
    });

    _gatewayClient = client;
    client.start();
  });
}

/** @description 连接失败时清理 client 并按 MAX_RECONNECT_ATTEMPTS 调度重试。 */
function handleConnectionFailure(
  error: unknown,
  url: string,
  connect: Record<string, unknown>,
  attempt: number,
  reject: (reason: Error) => void,
): void {
  _gatewayClient = null;
  _gatewayReadyPromise = null;

  const nextAttempt = attempt + 1;
  if (nextAttempt < MAX_RECONNECT_ATTEMPTS) {
    // 延迟后重试
    setTimeout(() => {
      _gatewayReadyPromise = connectWithRetry(url, connect, nextAttempt);
      // 重连 Promise 静默替换，下次 rpcCall 会使用新的
    }, RECONNECT_DELAY_MS);
    reject(new Error(
      `[openclaw-prometheus] Gateway connection failed (attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS}), retrying in ${RECONNECT_DELAY_MS}ms...`
    ));
  } else {
    reject(new Error(
      `[openclaw-prometheus] Gateway connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts: ${String(error)}`
    ));
  }
}

/** @description 从 Gateway config 根对象读取 gateway 子树。 */
function readGatewayConfig(config: Record<string, unknown>): Record<string, unknown> {
  const gateway = config.gateway;
  return gateway && typeof gateway === "object" ? (gateway as Record<string, unknown>) : {};
}

/** @description 解析 Gateway WebSocket URL（环境变量 > remote.url > 本地默认端口）。 */
function resolveGatewayUrl(gateway: Record<string, unknown>): string {
  const envUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const remote = gateway.remote;
  if (remote && typeof remote === "object") {
    const remoteUrl = (remote as Record<string, unknown>).url;
    if (typeof remoteUrl === "string" && remoteUrl.trim()) {
      return remoteUrl.trim();
    }
  }

  const port = typeof gateway.port === "number" && Number.isFinite(gateway.port) ? gateway.port : 18789;
  return `ws://127.0.0.1:${port}`;
}

/** @description 组装 GatewayClient 连接鉴权参数（token/password）。 */
function resolveGatewayConnect(gateway: Record<string, unknown>): Record<string, unknown> {
  const auth = gateway.auth && typeof gateway.auth === "object"
    ? (gateway.auth as Record<string, unknown>)
    : {};

  const token = pickString(
    process.env.OPENCLAW_GATEWAY_TOKEN,
    typeof auth.token === "string" ? auth.token : undefined,
    typeof gateway.token === "string" ? gateway.token : undefined,
  );
  const password = pickString(
    process.env.OPENCLAW_GATEWAY_PASSWORD,
    typeof auth.password === "string" ? auth.password : undefined,
    typeof gateway.password === "string" ? gateway.password : undefined,
  );

  const connect: Record<string, unknown> = {
    role: "operator",
    scopes: ["operator.read", "operator.write"],
  };

  if (token) {
    connect.token = token;
  }
  if (password) {
    connect.password = password;
  }

  return connect;
}

/** @description 返回第一个非空 trim 字符串，否则 undefined。 */
function pickString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
