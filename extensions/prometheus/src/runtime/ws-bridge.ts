/**
 * Gateway RPC 桥接层
 *
 * 基于公开的 `openclaw/plugin-sdk/gateway-runtime` 中的 `GatewayClient`
 * 连接当前 Gateway，自插件内拉取 `/overview`、`/usage` 依赖的真实方法数据。
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
 * 读取当前 Gateway 配置
 */
export function getConfig(): Record<string, unknown> {
  return getRuntime().config;
}

/**
 * 检查 Runtime 是否可用
 */
export function isReady(): boolean {
  return _runtime !== null;
}

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

function readGatewayConfig(config: Record<string, unknown>): Record<string, unknown> {
  const gateway = config.gateway;
  return gateway && typeof gateway === "object" ? (gateway as Record<string, unknown>) : {};
}

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

function pickString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
