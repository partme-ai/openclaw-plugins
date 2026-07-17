import { describe, expect, it, vi } from "vitest";

import { registerGotifyFull } from "../src/runtime/register-full.js";

type RegisteredRoute = {
  path: string;
  auth: string;
  match: string;
  handler: (req: { method?: string }, res: MockResponse) => Promise<void>;
};

type MockResponse = {
  status?: number;
  headers: Record<string, string>;
  body?: string;
  setHeader(name: string, value: string): void;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
};

function response(): MockResponse {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}

describe("registerGotifyFull", () => {
  it("registers exact, plugin-authenticated observability routes", () => {
    const routes: RegisteredRoute[] = [];
    registerGotifyFull({
      registerHttpRoute: (route: RegisteredRoute) => routes.push(route),
      runtime: { config: { current: () => ({}) } },
    } as never);

    expect(routes.map(({ path, auth, match }) => ({ path, auth, match }))).toEqual([
      { path: "/gotify/status", auth: "plugin", match: "exact" },
      { path: "/gotify/health", auth: "plugin", match: "exact" },
      { path: "/gotify/doctor", auth: "plugin", match: "exact" },
    ]);
  });

  it("returns no-store JSON for GET and rejects mutating methods", async () => {
    const registerHttpRoute = vi.fn();
    registerGotifyFull({
      registerHttpRoute,
      runtime: { config: { current: () => ({}) } },
    } as never);
    const statusRoute = registerHttpRoute.mock.calls[0][0] as RegisteredRoute;

    const getResponse = response();
    await statusRoute.handler({ method: "GET" }, getResponse);
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(getResponse.body ?? "{}").ok).toBe(true);

    const postResponse = response();
    await statusRoute.handler({ method: "POST" }, postResponse);
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.Allow).toBe("GET");
  });
});
