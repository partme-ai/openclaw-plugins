import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCommandAuthorization: vi.fn(),
  resolveDmOutcome: vi.fn(),
  handleSlashCommand: vi.fn(),
  downloadMedia: vi.fn(),
  resolveTypingTicket: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-runtime", () => ({ createTypingCallbacks: vi.fn() }));
vi.mock("openclaw/plugin-sdk/infra-runtime", () => ({
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
  weixinMessageToMsgContext: vi.fn(),
  getContextTokenFromMsgContext: vi.fn(),
  isMediaItem: () => true,
}));
vi.mock("../../src/messaging/send-media.js", () => ({ sendWeixinMediaFile: vi.fn() }));
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
  vi.clearAllMocks();
  mocks.resolveCommandAuthorization.mockResolvedValue({
    senderAllowedForCommands: false,
    commandAuthorized: false,
  });
  mocks.resolveDmOutcome.mockReturnValue("unauthorized");
});

describe("processOneMessage authorization boundary", () => {
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
