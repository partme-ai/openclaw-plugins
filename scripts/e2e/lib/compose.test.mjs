import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { COMPOSE_FILE } from "./compose.mjs";

test("Gotify E2E host port can move without changing its container port", () => {
  const output = execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, E2E_GOTIFY_PORT: "18081" },
  });
  const ports = JSON.parse(output).services.gotify.ports;
  assert.deepEqual(ports.map(({ target, published }) => ({ target, published })), [
    { target: 80, published: "18081" },
  ]);
});
