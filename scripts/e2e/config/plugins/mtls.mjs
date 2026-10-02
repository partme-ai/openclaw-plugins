import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import { E2E_PORTS, STATE_DIR } from "../../lib/utils.mjs";

const CERT_DIR = join(STATE_DIR, "mtls-certs");

/** OpenClaw 2026.9.6 requires a non-loopback client attribution behind a trusted proxy. */
export function mtlsClientAddress() {
  const interfaces = Object.entries(networkInterfaces());
  interfaces.sort(([left], [right]) => Number(!/^(en|eth)/.test(left)) - Number(!/^(en|eth)/.test(right)));
  const addresses = interfaces.flatMap(([, entries]) => (entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isIP(entry.address) === 4 && entry.address !== "0.0.0.0")
    .map((entry) => entry.address));
  const configured = process.env.E2E_MTLS_CLIENT_ADDRESS;
  if (configured) {
    if (!addresses.includes(configured)) {
      throw new Error("E2E_MTLS_CLIENT_ADDRESS must be a non-loopback IPv4 address assigned to this host");
    }
    return configured;
  }
  if (addresses[0]) return addresses[0];
  throw new Error("mTLS E2E requires a non-loopback IPv4 host interface for trusted-proxy attribution");
}

function openssl(...args) {
  execFileSync("openssl", args, { cwd: CERT_DIR, stdio: "ignore" });
}

function prepareCertificates() {
  mtlsClientAddress();
  rmSync(CERT_DIR, { recursive: true, force: true });
  mkdirSync(CERT_DIR, { recursive: true });

  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=OpenClaw E2E CA", "-keyout", "ca.key", "-out", "ca.crt");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", "server.key", "-out", "server.csr");
  openssl("x509", "-req", "-days", "1", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-copy_extensions", "copy", "-out", "server.crt");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=e2e-client", "-keyout", "client.key", "-out", "client.csr");
  openssl("x509", "-req", "-days", "1", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAserial", "ca.srl", "-out", "client.crt");

  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Rogue E2E CA", "-keyout", "rogue-ca.key", "-out", "rogue-ca.crt");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=e2e-client", "-keyout", "rogue-client.key", "-out", "rogue-client.csr");
  openssl("x509", "-req", "-days", "1", "-in", "rogue-client.csr", "-CA", "rogue-ca.crt", "-CAkey", "rogue-ca.key", "-CAcreateserial", "-out", "rogue-client.crt");
}

/** @param {import('./mqtt.mjs').ConfigContext} ctx */
export function mtlsConfig(ctx) {
  prepareCertificates();
  const runtimeCertDir = process.env.OPENCLAW_E2E_HOST_GATEWAY === "1" || process.env.OPENCLAW_E2E_HOST_GATEWAY === "true"
    ? CERT_DIR
    : "/state/mtls-certs";

  return {
    pluginEntry: {
      mtls: {
        enabled: true,
        config: {
          enabled: true,
          tls: {
            certFile: `${runtimeCertDir}/server.crt`,
            keyFile: `${runtimeCertDir}/server.key`,
            caFile: `${runtimeCertDir}/ca.crt`,
          },
          proxy: {
            listenHost: "127.0.0.1",
            listenPort: E2E_PORTS.mtlsHttps,
            upstreamHost: "127.0.0.1",
            upstreamPort: ctx.gatewayPort,
            userHeader: "x-forwarded-user",
          },
          allowedClients: [{ cn: "e2e-client" }],
        },
      },
    },
    channelEntry: {},
  };
}
