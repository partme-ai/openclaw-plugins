import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveMtlsConfig } from "../src/config.js";
import { MtlsProxyServer } from "../src/proxy-server.js";

const directory = mkdtempSync(path.join(os.tmpdir(), "openclaw-mtls-"));
const file = (name: string) => path.join(directory, name);
const runOpenSsl = (...args: string[]) =>
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });

let upstream: http.Server;
let proxy: MtlsProxyServer;
let proxyPort: number;

function request(options: https.RequestOptions): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  runOpenSsl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Test CA", "-keyout", "ca.key", "-out", "ca.crt");
  runOpenSsl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", "server.key", "-out", "server.csr");
  runOpenSsl("x509", "-req", "-days", "1", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-copy_extensions", "copy", "-out", "server.crt");
  runOpenSsl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=service-a", "-keyout", "client.key", "-out", "client.csr");
  runOpenSsl("x509", "-req", "-days", "1", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "client.crt");

  upstream = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.headers));
  });
  upstream.on("upgrade", (_request, socket, head) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    if (head.length > 0) socket.write(head);
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("upstream not bound");

  const config = resolveMtlsConfig({
    enabled: true,
    tls: {
      certFile: file("server.crt"),
      keyFile: file("server.key"),
      caFile: file("ca.crt"),
    },
    proxy: { listenHost: "127.0.0.1", listenPort: 0, upstreamPort: upstreamAddress.port },
  });
  proxy = new MtlsProxyServer(config, { info() {}, warn() {}, error() {} });
  await proxy.start();
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === "string") throw new Error("proxy not bound");
  proxyPort = proxyAddress.port;
}, 20_000);

afterAll(async () => {
  await proxy?.stop();
  await new Promise<void>((resolve, reject) => upstream?.close((error) => (error ? reject(error) : resolve())));
  rmSync(directory, { recursive: true, force: true });
});

describe("mTLS reverse proxy", () => {
  it("rejects protected requests without a client certificate", async () => {
    const response = await request({
      host: "127.0.0.1",
      port: proxyPort,
      path: "/v1/chat",
      ca: readFileSync(file("ca.crt")),
    });
    expect(response.status).toBe(401);
  });

  it("forwards verified identity to the OpenClaw upstream", async () => {
    const response = await request({
      host: "127.0.0.1",
      port: proxyPort,
      path: "/v1/chat",
      ca: readFileSync(file("ca.crt")),
      cert: readFileSync(file("client.crt")),
      key: readFileSync(file("client.key")),
      headers: {
        "x-forwarded-user": "spoofed-user",
        "x-client-cert": "spoofed-cert",
      },
    });
    expect(response.status).toBe(200);
    const headers = JSON.parse(response.body) as Record<string, string>;
    expect(headers["x-forwarded-user"]).toBe("service-a");
    expect(headers["x-client-cert"]).toBe("service-a");
    expect(headers["x-forwarded-proto"]).toBe("https");
  });

  it("proxies authenticated WebSocket upgrades", async () => {
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: proxyPort,
        servername: "localhost",
        ca: readFileSync(file("ca.crt")),
        cert: readFileSync(file("client.crt")),
        key: readFileSync(file("client.key")),
      });
      let buffer = Buffer.alloc(0);
      let upgraded = false;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("WebSocket proxy test timed out"));
      }, 5_000);
      socket.on("secureConnect", () => {
        socket.write(
          "GET /ws HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n\r\n",
        );
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!upgraded) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          expect(buffer.subarray(0, headerEnd).toString("utf8")).toContain("101 Switching Protocols");
          buffer = buffer.subarray(headerEnd + 4);
          upgraded = true;
          socket.write("proxy-ping");
        }
        if (upgraded && buffer.includes(Buffer.from("proxy-ping"))) {
          clearTimeout(timeout);
          socket.end();
          resolve(buffer.toString("utf8"));
        }
      });
      socket.on("error", reject);
    });
    expect(echoed).toContain("proxy-ping");
  });
});
