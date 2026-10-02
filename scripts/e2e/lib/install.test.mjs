import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertCleanPackedArtifact, preparePackedCandidate, reviewedArtifactDigest, trustedE2ELinkArgs } from "./install.mjs";

test("packed candidate is installed from tarball even when workspace dist differs", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-packed-candidate-"));
  try {
    const packageRoot = join(root, "package");
    const sourceDist = join(root, "repo", "extensions", "demo", "dist");
    const extracted = join(root, "state-e2e", "extensions", "demo");
    const archive = join(root, "candidate.tgz");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    mkdirSync(sourceDist, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "demo" }));
    writeFileSync(join(packageRoot, "dist", "index.js"), "reviewed tarball runtime");
    writeFileSync(join(sourceDist, "index.js"), "different workspace runtime");
    writeFileSync(join(sourceDist, "setup-entry.js"), "workspace-only setup entry");
    execFileSync("tar", ["-czf", archive, "-C", root, "package"]);

    const packedContentDigest = preparePackedCandidate(archive, extracted);
    assert.equal(readFileSync(join(extracted, "dist", "index.js"), "utf8"), "reviewed tarball runtime");
    assert.equal(existsSync(join(extracted, "dist", "setup-entry.js")), false);
    assert.equal(reviewedArtifactDigest(extracted), packedContentDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packed artifact cannot carry ignored dependency state", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-packed-review-"));
  try {
    assertCleanPackedArtifact(root);
    writeFileSync(join(root, "package-lock.json"), "{}");
    assert.throws(() => assertCleanPackedArtifact(root));
    unlinkSync(join(root, "package-lock.json"));
    mkdirSync(join(root, "node_modules"));
    assert.throws(() => assertCleanPackedArtifact(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local install consent is limited to a plugin in this checkout and extracted E2E state", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-install-test-"));
  try {
    const repo = join(root, "repo");
    const state = join(root, "state-e2e");
    const userState = join(root, "state");
    const outside = join(root, "outside");
    const source = join(repo, "extensions", "demo");
    const extracted = join(state, "extensions", "demo");
    mkdirSync(source, { recursive: true });
    mkdirSync(extracted, { recursive: true });
    mkdirSync(userState);
    mkdirSync(outside);

    assert.deepEqual(trustedE2ELinkArgs("extensions/demo", extracted, repo, state), [
      "--profile", "queue-e2e", "plugins", "install", "--link", "--force", realpathSync(extracted),
    ]);
    assert.throws(() => trustedE2ELinkArgs("../outside", extracted, repo, state));
    assert.throws(() => trustedE2ELinkArgs("extensions/demo", outside, repo, state));
    const escape = join(state, "extensions", "escape");
    symlinkSync(outside, escape);
    assert.throws(() => trustedE2ELinkArgs("extensions/demo", escape, repo, state));
    assert.throws(() => trustedE2ELinkArgs("extensions/demo", extracted, repo, userState));
    const unlistedManifest = JSON.stringify({ id: "demo", capabilities: { shell: true } });
    writeFileSync(join(source, "openclaw.plugin.json"), unlistedManifest);
    writeFileSync(join(extracted, "openclaw.plugin.json"), unlistedManifest);
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "unlisted-demo" }));
    writeFileSync(join(extracted, "package.json"), JSON.stringify({ name: "unlisted-demo" }));
    assert.throws(() => trustedE2ELinkArgs("extensions/demo", extracted, repo, state, "demo"));

    const bridgeSource = join(repo, "extensions", "bridge");
    const bridgeDest = join(state, "extensions", "bridge");
    mkdirSync(bridgeSource);
    mkdirSync(bridgeDest);
    for (const path of [bridgeSource, bridgeDest]) {
      writeFileSync(join(path, "openclaw.plugin.json"), JSON.stringify({ id: "bridge" }));
      writeFileSync(join(path, "package.json"), JSON.stringify({ name: "@partme.ai/openclaw-bridge" }));
    }
    const bridgeApproved = { bridge: reviewedArtifactDigest(bridgeDest) };
    assert.ok(trustedE2ELinkArgs("extensions/bridge", bridgeDest, repo, state, "bridge", bridgeApproved).includes("--accept-capabilities"));
    assert.throws(() => trustedE2ELinkArgs("extensions/bridge", bridgeDest, repo, state, "bridge"));

    for (const [id, packageName, capabilities] of [
      ["wecom", "@partme.ai/wecom", undefined],
      ["wechat-ipad", "@partme.ai/wechat-ipad", undefined],
      ["rednode", "@partme.ai/openclaw-rednode", undefined],
      ["amap", "@partme.ai/openclaw-amap", { amapWebService: true }],
      ["mtls", "@partme.ai/openclaw-mtls", { security: true, mtls: true, tls: true, authentication: true, reverseProxy: true, websocketProxy: true }],
      ["oauth2", "@partme.ai/openclaw-oauth2", { authentication: true, reverseProxy: true, websocketProxy: true, oidcDiscovery: true, authorizationCode: true, pkce: true, refreshToken: true, tokenRevocation: true, tokenIntrospection: true }],
      ["knowledge", "@partme.ai/openclaw-knowledge", { knowledgeRAG: true }],
      ["memory", "@partme.ai/openclaw-memory", undefined],
      ["openmem", "@partme.ai/openclaw-openmem", undefined],
      ["tracing", "@partme.ai/openclaw-tracing", { distributedTracing: true }],
      ["mqtt", "@partme.ai/openclaw-mqtt", { protocolBridge: true, iot: true }],
      ["web-mqtt", "@partme.ai/openclaw-web-mqtt", { protocolBridge: true, websocket: true }],
      ["web-socket", "@partme.ai/openclaw-web-socket", { protocolBridge: true }],
      ["rabbitmq", "@partme.ai/openclaw-rabbitmq", undefined],
      ["redis-stream", "@partme.ai/openclaw-redis-stream", undefined],
      ["rocketmq", "@partme.ai/openclaw-rocketmq", undefined],
      ["douyin", "@partme.ai/openclaw-douyin", undefined],
      ["meituan", "@partme.ai/openclaw-meituan", undefined],
      ["prometheus", "@partme.ai/openclaw-prometheus", { metricsExport: true }],
      ["nacos", "@partme.ai/openclaw-nacos", undefined],
      ["stomp", "@partme.ai/openclaw-stomp", { protocolBridge: true, tcp: true, tls: true, transactions: true }],
      ["web-stomp", "@partme.ai/openclaw-web-stomp", { protocolBridge: true, websocket: true, wss: true }],
      ["wecom-kf", "@partme.ai/wecom-kf", { humanTransfer: true, satisfactionSurvey: true, sessionManagement: true }],
      ["wechat", "@partme.ai/weixin", undefined],
    ]) {
      const src = join(repo, "extensions", id);
      const dest = join(state, "extensions", id);
      mkdirSync(src);
      mkdirSync(dest);
      const manifest = JSON.stringify({ id, capabilities });
      writeFileSync(join(src, "openclaw.plugin.json"), manifest);
      writeFileSync(join(dest, "openclaw.plugin.json"), manifest);
      const pkg = JSON.stringify({ name: packageName });
      writeFileSync(join(src, "package.json"), pkg);
      writeFileSync(join(dest, "package.json"), pkg);
      const approved = { [id]: reviewedArtifactDigest(dest) };
      assert.ok(trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved).includes("--accept-capabilities"));
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, { [id]: "unreviewed" }));
      writeFileSync(join(dest, "package.json"), JSON.stringify({ name: "unexpected-package" }));
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
      writeFileSync(join(dest, "package.json"), pkg);
      writeFileSync(join(dest, "openclaw.plugin.json"), JSON.stringify({ id, capabilities: { ...capabilities, shell: true } }));
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
      writeFileSync(join(dest, "openclaw.plugin.json"), manifest);
      const newService = join(dest, "new-service.js");
      writeFileSync(newService, "api.registerService({ id: 'new-service' })");
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
      unlinkSync(newService);
      const dist = join(dest, "dist");
      mkdirSync(dist);
      writeFileSync(join(dist, "index.js"), "changed compiled runtime");
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
    }

    for (const [id, routePaths, hooks, marker] of [
      ["router", ["/router/status", "/router/health", "/router/dlq", "/router/audit", "/router/dlq/replay"], ["message_received", "message_sent", "reply_payload_sending"], 'id: "openclaw-router-delivery"'],
      ["gotify", ["/gotify/status", "/gotify/health", "/gotify/doctor"], [], 'registerFull: registerGotifyFull'],
    ]) {
      const src = join(repo, "extensions", id);
      const dest = join(state, "extensions", id);
      const codeDir = id === "router" ? join(src, "src") : join(src, "src", "runtime");
      mkdirSync(codeDir, { recursive: true });
      mkdirSync(dest);
      const manifest = JSON.stringify({ id });
      const pkg = JSON.stringify({ name: `@partme.ai/openclaw-${id}` });
      for (const path of [src, dest]) {
        writeFileSync(join(path, "openclaw.plugin.json"), manifest);
        writeFileSync(join(path, "package.json"), pkg);
      }
      const code = [...routePaths.map((path) => `path: "${path}"`), ...hooks.map((hook) => `api.on("${hook}"`), id === "router" ? marker : ""].join("\n");
      const codePath = id === "router" ? join(codeDir, "index.ts") : join(codeDir, "register-full.ts");
      writeFileSync(codePath, code);
      const installedCodePath = id === "router" ? join(dest, "src", "index.ts") : join(dest, "src", "runtime", "register-full.ts");
      mkdirSync(id === "router" ? join(dest, "src") : join(dest, "src", "runtime"), { recursive: true });
      writeFileSync(installedCodePath, code);
      if (id === "gotify") writeFileSync(join(src, "src", "index.ts"), marker);
      const approved = { [id]: reviewedArtifactDigest(dest) };
      assert.ok(trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved).includes("--accept-capabilities"));
      writeFileSync(installedCodePath, `${code}\npath: "/unexpected"`);
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
      writeFileSync(installedCodePath, code);
      const newTool = join(dest, "new-tool.js");
      writeFileSync(newTool, "api.registerTool({ name: 'new-tool' })");
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
      unlinkSync(newTool);
      const dist = join(dest, "dist");
      mkdirSync(dist);
      writeFileSync(join(dist, "index.js"), "changed compiled runtime");
      assert.throws(() => trustedE2ELinkArgs(`extensions/${id}`, dest, repo, state, id, approved));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
