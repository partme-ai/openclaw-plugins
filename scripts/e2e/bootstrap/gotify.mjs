/**
 * Bootstrap Gotify app + client tokens for E2E (Docker gotify/server).
 * Writes secrets to scripts/e2e/.e2e-secrets.json (gitignored).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR } from "../lib/utils.mjs";

const GOTIFY_URL = process.env.GOTIFY_URL ?? "http://127.0.0.1:18080";
const ADMIN_USER = process.env.GOTIFY_ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.GOTIFY_ADMIN_PASS ?? "openclaw-e2e";
const basicAuth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

/**
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>|FormData|undefined} body
 * @param {string} [token]
 */
async function gotifyApi(method, path, body, token) {
  const headers = {};
  if (body instanceof FormData) {
    /* FormData sets Content-Type */
  } else if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["X-Gotify-Key"] = token;
  else headers["Authorization"] = `Basic ${basicAuth}`;

  const res = await fetch(`${GOTIFY_URL}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gotify ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** @returns {Promise<Record<string, unknown>>} */
export async function bootstrapGotify() {
  const health = await fetch(`${GOTIFY_URL}/health`);
  if (!health.ok) throw new Error(`Gotify not healthy at ${GOTIFY_URL}`);

  const appForm = new FormData();
  appForm.append("name", "openclaw-e2e");
  appForm.append("description", "E2E test app");
  const app = await gotifyApi("POST", "/application", appForm);

  const clientForm = new FormData();
  clientForm.append("name", "openclaw-e2e-client");
  const client = await gotifyApi("POST", "/client", clientForm);

  const secrets = {
    serverUrl: GOTIFY_URL,
    appToken: app.token,
    clientToken: client.token,
    allowedAppId: app.id,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(E2E_DIR, { recursive: true });
  writeFileSync(join(E2E_DIR, ".e2e-secrets.json"), JSON.stringify(secrets, null, 2));
  console.log("[gotify-bootstrap] tokens written (appId=%s)", app.id);
  return secrets;
}
