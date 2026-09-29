import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCommandAuthorization: vi.fn(),
  resolveDmOutcome: vi.fn(),
  handleSlashCommand: vi.fn(),
  downloadMedia: vi.fn(),
  resolveTypingTicket: vi.fn(),
  resolveSandboxContext: vi.fn(),
  sendWeixinMediaFile: vi.fn(),
  createMsgContext: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-message", () => ({ createTypingCallbacks: vi.fn() }));
vi.mock("openclaw/plugin-sdk/agent-harness-runtime", () => ({
  resolveSandboxContext: mocks.resolveSandboxContext,
}));
vi.mock("openclaw/plugin-sdk/temp-path", () => ({
  resolvePreferredOpenClawTmpDir: () => "/tmp/openclaw-weixin-test",
}));
vi.mock("openclaw/plugin-sdk/command-auth", () => ({
  resolveSenderCommandAuthorizationWithRuntime: mocks.resolveCommandAuthorization,
  resolveDirectDmAuthorizationOutcome: mocks.resolveDmOutcome,
}));
vi.mock("../../src/api/api.js", () => ({ sendTyping: vi.fn() }));
vi.mock("../../src/auth/accounts.js", () => ({
  loadWeixinAccount: () => ({ userId: "linked-user" }),
}));
vi.mock("../../src/auth/pairing.js", () => ({
  readFrameworkAllowFromList: () => ["paired-user"],
}));
vi.mock("../../src/cdn/upload.js", () => ({ downloadRemoteImageToTemp: vi.fn() }));
vi.mock("../../src/media/media-download.js", () => ({
  downloadMediaFromItem: mocks.downloadMedia,
}));
vi.mock("../../src/util/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/messaging/debug-mode.js", () => ({ isDebugMode: () => false }));
vi.mock("../../src/messaging/error-notice.js", () => ({ sendWeixinErrorNotice: vi.fn() }));
vi.mock("../../src/messaging/inbound.js", () => ({
  setContextToken: vi.fn(),
  weixinMessageToMsgContext: mocks.createMsgContext,
  getContextTokenFromMsgContext: vi.fn(),
  isMediaItem: () => true,
}));
vi.mock("../../src/messaging/send-media.js", () => ({ sendWeixinMediaFile: mocks.sendWeixinMediaFile }));
vi.mock("../../src/messaging/markdown-filter.js", () => ({
  StreamingMarkdownFilter: class {
    feed(value: string): string { return value; }
    flush(): string { return ""; }
  },
}));
vi.mock("../../src/messaging/send.js", () => ({ sendMessageWeixin: vi.fn() }));
vi.mock("../../src/messaging/slash-commands.js", () => ({
  handleSlashCommand: mocks.handleSlashCommand,
}));

import type { WeixinMessage } from "../../src/api/types.js";
import { MessageItemType } from "../../src/api/types.js";
import { processOneMessage } from "../../src/messaging/process-message.js";
import { captureWeixinReplyWorkspace } from "../../src/media/reply-workspace.js";
import { readWeixinLocalMedia } from "../../src/media/path-guard.js";

const cleanup: string[] = [];
let previousStateDir: string | undefined;

function message(text = "/status"): WeixinMessage {
  return {
    from_user_id: "stranger",
    context_token: "ctx",
    item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
  };
}

function deps() {
  return {
    accountId: "account",
    config: {} as never,
    channelRuntime: { commands: {} } as never,
    baseUrl: "https://ilinkai.weixin.qq.com",
    cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    allowFrom: ["configured-user"],
    resolveTypingTicket: mocks.resolveTypingTicket,
    log: vi.fn(),
    errLog: vi.fn(),
  };
}

beforeEach(() => {
  previousStateDir = process.env.OPENCLAW_STATE_DIR;
  vi.clearAllMocks();
  mocks.resolveCommandAuthorization.mockResolvedValue({
    senderAllowedForCommands: false,
    commandAuthorized: false,
  });
  mocks.resolveDmOutcome.mockReturnValue("unauthorized");
});

afterEach(async () => {
  if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousStateDir;
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("processOneMessage authorization boundary", () => {
  it("sends existing local media even when sandbox backend provisioning is unavailable", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-existing-media-"));
    cleanup.push(stateDir);
    const sessionWorkspaceDir = path.join(stateDir, "sandboxes", "current");
    const filePath = path.join(sessionWorkspaceDir, "result.png");
    await fs.mkdir(sessionWorkspaceDir, { recursive: true });
    await fs.writeFile(filePath, "existing-media");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    mocks.resolveCommandAuthorization.mockResolvedValue({
      senderAllowedForCommands: true,
      commandAuthorized: false,
    });
    mocks.resolveDmOutcome.mockReturnValue("authorized");
    mocks.createMsgContext.mockReturnValue({ Body: "hello", To: "stranger" });
    mocks.resolveSandboxContext.mockRejectedValue(new Error("backend unavailable"));
    mocks.sendWeixinMediaFile.mockImplementationOnce(async (params) => {
      const bytes = await readWeixinLocalMedia({ ...params, maxBytes: 1024 });
      expect(bytes).toEqual(Buffer.from("existing-media"));
    });
    let deliver: (payload: { mediaUrl: string }) => Promise<void>;
    const input = deps();
    input.channelRuntime = {
      commands: {},
      routing: { resolveAgentRoute: () => ({
        agentId: "main",
        sessionKey: "agent:main:direct:current",
        mainSessionKey: "agent:main:main",
      }) },
      session: {
        resolveStorePath: () => "/tmp/store.json",
        recordInboundSession: vi.fn(),
      },
      reply: {
        finalizeInboundContext: (ctx: unknown) => ctx,
        resolveHumanDelayConfig: () => undefined,
        createReplyDispatcherWithTyping: (params: { deliver: typeof deliver }) => {
          deliver = params.deliver;
          return { dispatcher: {}, replyOptions: {}, markDispatchIdle: vi.fn() };
        },
        withReplyDispatcher: ({ run }: { run: () => Promise<void> }) => run(),
        dispatchReplyFromConfig: () => {
          captureWeixinReplyWorkspace({
            agentId: "main",
            sessionKey: "agent:main:direct:current",
            workspaceDir: sessionWorkspaceDir,
          });
          return deliver({ mediaUrl: filePath });
        },
      },
    } as never;

    await expect(processOneMessage(message("hello"), input)).resolves.toBeUndefined();

    expect(mocks.resolveSandboxContext).not.toHaveBeenCalled();
    expect(mocks.sendWeixinMediaFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath,
      sessionWorkspaceDir,
      agentId: "main",
    }));
  });

  it("fails the batch when the channel runtime is unavailable", async () => {
    const input = deps();
    Object.assign(input, { channelRuntime: undefined });
    await expect(processOneMessage(message("hello"), input as never)).rejects.toThrow(
      "channelRuntime is unavailable",
    );
  });

  it("drops an unauthorized sender before slash, media, config and agent side effects", async () => {
    await processOneMessage(message(), deps());

    expect(mocks.resolveCommandAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "stranger",
        configuredAllowFrom: ["configured-user"],
      }),
    );
    expect(mocks.handleSlashCommand).not.toHaveBeenCalled();
    expect(mocks.downloadMedia).not.toHaveBeenCalled();
    expect(mocks.resolveTypingTicket).not.toHaveBeenCalled();
  });

  it("runs a built-in slash command only after command authorization succeeds", async () => {
    mocks.resolveCommandAuthorization.mockResolvedValue({
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    mocks.resolveDmOutcome.mockReturnValue("authorized");
    mocks.handleSlashCommand.mockResolvedValue({ handled: true });

    await processOneMessage(message(), deps());

    expect(mocks.handleSlashCommand).toHaveBeenCalledOnce();
    expect(mocks.downloadMedia).not.toHaveBeenCalled();
    expect(mocks.resolveTypingTicket).not.toHaveBeenCalled();
  });
});
