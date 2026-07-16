import { readFile } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";

import { authorizeMtlsRequest, buildForwardHeaders } from "./policy.js";
import { recordMtlsRequest, trackMtlsSession } from "./runtime/stats.js";
import type { ClientCertInfo, MtlsConfig } from "./shared/types.js";

export type MtlsProxyLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

function getCommonName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cn = (value as { CN?: unknown }).CN;
  if (typeof cn === "string") return cn;
  if (Array.isArray(cn) && cn.length > 0) return String(cn[0]);
  return undefined;
}

export function extractClientCertificate(socket: TLSSocket): ClientCertInfo | undefined {
  const certificate = socket.getPeerCertificate();
  if (!certificate || Object.keys(certificate).length === 0) return undefined;
  return {
    subject: getCommonName(certificate.subject),
    issuer: getCommonName(certificate.issuer),
    fingerprint: certificate.fingerprint256 ?? certificate.fingerprint,
    serialNumber: certificate.serialNumber,
    notBefore: certificate.valid_from,
    notAfter: certificate.valid_to,
    verified: socket.authorized,
  };
}

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "https://openclaw-mtls.local").pathname;
  } catch {
    return "/";
  }
}

function writeRejectedResponse(
  response: http.ServerResponse,
  statusCode: 401 | 403,
  message: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": 'Mutual realm="openclaw-mtls"',
    connection: "close",
  });
  response.end(JSON.stringify({ error: "mtls_authentication_failed", message }));
}

function writeRejectedUpgrade(socket: Duplex, statusCode: 401 | 403, message: string): void {
  const statusText = statusCode === 401 ? "Unauthorized" : "Forbidden";
  const body = JSON.stringify({ error: "mtls_authentication_failed", message });
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body,
  );
}

function serializeUpgradeResponse(response: http.IncomingMessage): string {
  const statusCode = response.statusCode ?? 101;
  const statusMessage = response.statusMessage ?? "Switching Protocols";
  const headers: string[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  return `HTTP/1.1 ${statusCode} ${statusMessage}\r\n${headers.join("\r\n")}\r\n\r\n`;
}

export class MtlsProxyServer {
  private server: https.Server | null = null;
  private readonly tunnelSockets = new Set<Duplex>();

  constructor(
    private readonly config: MtlsConfig,
    private readonly logger: MtlsProxyLogger,
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    const [cert, key, ca] = await Promise.all([
      readFile(this.config.tls.certFile),
      readFile(this.config.tls.keyFile),
      readFile(this.config.tls.caFile),
    ]);

    const server = https.createServer(
      {
        cert,
        key,
        ca,
        requestCert: this.config.tls.requestCert,
        // Authorization is enforced per path so public/health routes can still be served.
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      },
      (request, response) => this.handleHttp(request, response),
    );
    server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    server.on("clientError", (error, socket) => {
      this.logger.warn(`[openclaw-mtls] client error: ${error.message}`);
      socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.proxy.listenPort, this.config.proxy.listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.info(
      `[openclaw-mtls] listening on https://${this.config.proxy.listenHost}:${this.config.proxy.listenPort} -> http://${this.config.proxy.upstreamHost}:${this.config.proxy.upstreamPort}`,
    );
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const socket of this.tunnelSockets) socket.destroy();
    this.tunnelSockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }

  address(): ReturnType<https.Server["address"]> {
    return this.server?.address() ?? null;
  }

  private authorize(request: http.IncomingMessage) {
    const certificate = extractClientCertificate(request.socket as TLSSocket);
    const authorization = authorizeMtlsRequest(this.config, pathnameOf(request.url), certificate);
    if (!authorization.allowed) {
      recordMtlsRequest("rejected");
    } else if (authorization.authenticated) {
      recordMtlsRequest("authenticated");
    } else {
      recordMtlsRequest("passthrough");
    }
    return { authorization, certificate };
  }

  private handleHttp(request: http.IncomingMessage, response: http.ServerResponse): void {
    const { authorization, certificate } = this.authorize(request);
    if (!authorization.allowed) {
      writeRejectedResponse(response, authorization.statusCode, authorization.message);
      return;
    }

    const upstream = http.request(
      {
        host: this.config.proxy.upstreamHost,
        port: this.config.proxy.upstreamPort,
        method: request.method,
        path: request.url,
        headers: buildForwardHeaders(
          this.config,
          request.headers,
          authorization.authenticated ? certificate : undefined,
          request.socket.remoteAddress,
          "http",
        ),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.setTimeout(this.config.proxy.requestTimeoutMs, () => {
      upstream.destroy(new Error("upstream request timed out"));
    });
    upstream.on("error", (error) => {
      this.logger.error(`[openclaw-mtls] upstream HTTP error: ${error.message}`);
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      if (!response.writableEnded) {
        response.end(JSON.stringify({ error: "bad_gateway", message: "OpenClaw Gateway unavailable" }));
      }
    });
    request.pipe(upstream);
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const { authorization, certificate } = this.authorize(request);
    if (!authorization.allowed) {
      writeRejectedUpgrade(socket, authorization.statusCode, authorization.message);
      return;
    }

    const upstream = http.request({
      host: this.config.proxy.upstreamHost,
      port: this.config.proxy.upstreamPort,
      method: request.method,
      path: request.url,
      headers: buildForwardHeaders(
        this.config,
        request.headers,
        authorization.authenticated ? certificate : undefined,
        request.socket.remoteAddress,
        "upgrade",
      ),
    });
    upstream.setTimeout(this.config.proxy.requestTimeoutMs, () => {
      upstream.destroy(new Error("upstream upgrade timed out"));
    });
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(serializeUpgradeResponse(upstreamResponse));
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      trackMtlsSession(1);
      this.tunnelSockets.add(socket);
      this.tunnelSockets.add(upstreamSocket);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        this.tunnelSockets.delete(socket);
        this.tunnelSockets.delete(upstreamSocket);
        trackMtlsSession(-1);
      };
      socket.once("close", close);
      upstreamSocket.once("close", close);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.on("response", (upstreamResponse) => {
      socket.write(serializeUpgradeResponse(upstreamResponse));
      upstreamResponse.pipe(socket);
    });
    upstream.on("error", (error) => {
      this.logger.error(`[openclaw-mtls] upstream WebSocket error: ${error.message}`);
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    upstream.end();
  }
}
