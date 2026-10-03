/** Stop the disposable installed Gateway, observe closed ports, then start it again. */
import { execFileSync } from "node:child_process";
import { COMPOSE_FILE, DOCKER, dockerEnv, useHostGateway } from "./compose.mjs";
import { ensureGatewayRunning, readStartedGatewayBaseline, stopHostGateway } from "./gateway.mjs";
import { GATEWAY_PORT } from "./utils.mjs";

export async function restartInstalledGateway(ctx, ownedPorts = []) {
  if (useHostGateway()) {
    stopHostGateway();
  } else {
    execFileSync(DOCKER, ["compose", "-f", COMPOSE_FILE, "stop", "openclaw"], {
      env: dockerEnv(),
      stdio: "inherit",
    });
  }
  await ctx.waitFor(async () => {
    const ports = [GATEWAY_PORT, ...ownedPorts];
    const listening = await Promise.all(ports.map((port) => ctx.tcpReachable(port)));
    return listening.every((open) => !open);
  }, { label: "stopped Gateway and plugin listeners released", timeoutMs: 30_000 });
  const gateway = await ensureGatewayRunning();
  const host = await readStartedGatewayBaseline(gateway);
  ctx.gatewayRestarts.push({ gateway, host });
  return { gateway, host };
}
