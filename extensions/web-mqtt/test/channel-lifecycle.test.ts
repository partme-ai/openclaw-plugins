import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_ID, mqttWsChannel } from "../src/channel.js";
import { getWebMqttChannelConfig } from "../src/state/mqtt-state.js";
import { getStats } from "../src/transport/server.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe("web-mqtt channel lifecycle", () => {
  it("does not advertise an account until channels.mqtt-ws is explicitly configured", () => {
    expect(mqttWsChannel.config.listAccountIds({})).toEqual([]);
    expect(mqttWsChannel.config.listAccountIds({
      channels: { "mqtt-ws": { port: 15675, path: "/ws" } },
    })).toEqual([DEFAULT_ACCOUNT_ID]);
  });

  it("honors an already-aborted lifecycle signal and releases the listener", async () => {
    const port = await freePort();
    const controller = new AbortController();
    controller.abort();
    await mqttWsChannel.gateway.startAccount({
      cfg: {
        channels: {
          "mqtt-ws": {
            host: "127.0.0.1",
            port,
            path: "/ws",
            auth: { required: false, allowAnonymous: false, users: [] },
          },
        },
      },
      abortSignal: controller.signal,
    });

    expect(getStats().brokerReady).toBe(false);
    expect(getWebMqttChannelConfig()).toBeNull();
  });
});
