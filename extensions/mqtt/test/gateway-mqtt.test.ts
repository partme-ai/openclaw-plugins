import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startBroker: vi.fn(),
  stopBroker: vi.fn(),
  handleInboundMessage: vi.fn(),
  configureSessionExpiry: vi.fn(),
  handleClientDisconnected: vi.fn(),
  markClientConnected: vi.fn(),
  resetSessionMappings: vi.fn(),
  loadTopicMappings: vi.fn(),
  hasLegacyMqttDmScope: vi.fn(),
  resolveBrokerConfig: vi.fn(),
  resolveOpenClawDmScope: vi.fn(),
  setMqttChannelConfig: vi.fn(),
  redactMqttError: vi.fn(),
}));

vi.mock("../src/transport/server.js", () => ({
  startBroker: mocks.startBroker,
  stopBroker: mocks.stopBroker,
}));
vi.mock("../src/inbound.js", () => ({ handleInboundMessage: mocks.handleInboundMessage }));
vi.mock("../src/routing/session-mapper.js", () => ({
  configureSessionExpiry: mocks.configureSessionExpiry,
  handleClientDisconnected: mocks.handleClientDisconnected,
  markClientConnected: mocks.markClientConnected,
  resetSessionMappings: mocks.resetSessionMappings,
}));
vi.mock("../src/routing/topic-router.js", () => ({ loadTopicMappings: mocks.loadTopicMappings }));
vi.mock("../src/config.js", () => ({
  hasLegacyMqttDmScope: mocks.hasLegacyMqttDmScope,
  resolveBrokerConfig: mocks.resolveBrokerConfig,
  resolveOpenClawDmScope: mocks.resolveOpenClawDmScope,
}));
vi.mock("../src/state/mqtt-state.js", () => ({ setMqttChannelConfig: mocks.setMqttChannelConfig }));
vi.mock("../src/shared/redact.js", () => ({ redactMqttError: mocks.redactMqttError }));

import { monitorMqttBroker } from "../src/transport/gateway-mqtt.js";

const brokerConfig = {
  host: "127.0.0.1",
  port: 1883,
  session: { maxExpirySeconds: 300, persistentAcrossReconnect: true },
  topicBindings: [{ topicPattern: "openclaw/+/in", agentId: "main" }],
};

function createContext(cfg: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const statuses: Array<Record<string, unknown>> = [];
  const context = {
    cfg,
    account: { accountId: "default" },
    abortSignal: controller.signal,
    setStatus: vi.fn((status: Record<string, unknown>) => statuses.push(status)),
    log: { info: vi.fn(), warn: vi.fn() },
  };
  return { controller, context, statuses };
}

describe("monitorMqttBroker — Gateway 生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startBroker.mockResolvedValue(undefined);
    mocks.stopBroker.mockResolvedValue(undefined);
    mocks.resolveBrokerConfig.mockReturnValue(brokerConfig);
    mocks.resolveOpenClawDmScope.mockReturnValue("per-channel-peer");
    mocks.hasLegacyMqttDmScope.mockReturnValue(false);
    mocks.redactMqttError.mockImplementation((error: unknown) => error instanceof Error ? error.message : String(error));
  });

  it("启动 Broker、发布运行状态，并在 abort 后完整清理", async () => {
    const { controller, context, statuses } = createContext({
      mqttTopicMappings: [{ topicPattern: "devices/#", agentId: "iot" }],
    });
    const monitoring = monitorMqttBroker(context as never);

    await vi.waitFor(() => expect(mocks.startBroker).toHaveBeenCalledTimes(1));
    expect(mocks.configureSessionExpiry).toHaveBeenCalledWith(300, true);
    expect(mocks.loadTopicMappings).toHaveBeenCalledWith([{ topicPattern: "devices/#", agentId: "iot" }]);
    expect(mocks.setMqttChannelConfig).toHaveBeenCalledWith(brokerConfig, "per-channel-peer");
    expect(statuses[0]).toMatchObject({ accountId: "default", running: true, configured: true, port: 1883 });

    controller.abort();
    await monitoring;
    expect(mocks.stopBroker).toHaveBeenCalledTimes(1);
    expect(mocks.resetSessionMappings).toHaveBeenCalledTimes(1);
    expect(mocks.setMqttChannelConfig).toHaveBeenLastCalledWith(null);
    expect(statuses.at(-1)).toMatchObject({ accountId: "default", running: false });
  });

  it("启动失败时记录脱敏错误、继续清理并向宿主抛出原异常", async () => {
    const failure = new Error("broker credential secret");
    mocks.startBroker.mockRejectedValue(failure);
    mocks.redactMqttError.mockReturnValue("broker startup failed [REDACTED]");
    mocks.hasLegacyMqttDmScope.mockReturnValue(true);
    const { context, statuses } = createContext();

    await expect(monitorMqttBroker(context as never)).rejects.toBe(failure);
    expect(context.log.warn).toHaveBeenCalledWith(expect.stringContaining("legacy config"));
    expect(statuses).toContainEqual(expect.objectContaining({
      accountId: "default",
      running: false,
      lastError: "broker startup failed [REDACTED]",
    }));
    expect(mocks.stopBroker).toHaveBeenCalledTimes(1);
    expect(mocks.resetSessionMappings).toHaveBeenCalledTimes(1);
  });
});
