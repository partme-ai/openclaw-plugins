import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

import {
  computeWecomMsgSignature,
  encryptWecomPlaintext,
  parseWecomCallback,
} from "../crypto.js";
import type { WecomAccountConfig } from "../types/index.js";

const dispatchKfMessageMock = vi.hoisted(() => vi.fn(async () => undefined));
const syncKfMessagesMock = vi.hoisted(() => vi.fn());
const getWecomRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../dispatch.js", () => ({
  dispatchKfMessage: dispatchKfMessageMock,
}));

vi.mock("../agent/api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/api-client.js")>();
  return {
    ...actual,
    syncKfMessages: syncKfMessagesMock,
  };
});

vi.mock("../runtime.js", () => ({
  getWecomRuntime: getWecomRuntimeMock,
  setWecomRuntime: vi.fn(),
}));

vi.mock("../dedup/kf-inbound-dedup.js", () => ({
  claimWecomKfInboundMsgid: vi.fn(async (_openKfId: string, msgid: string) => msgid !== "msg-1-dup"),
  resolveKfInboundDedupeNamespace: vi.fn((openKfId: string) => `wecom-kf-inbound:${openKfId}`),
}));

vi.mock("../cursor-store.js", () => {
  const memory = new Map<string, string>();
  return {
    getCursorStore: () => ({
      getCursor: async (key: string) => memory.get(key) ?? "",
      saveCursor: async (key: string, cursor: string) => {
        memory.set(key, cursor);
      },
    }),
    initCursorStore: vi.fn(),
    resetCursorStoreForTests: vi.fn(() => memory.clear()),
  };
});

const { createKfCallbackHandler } = await import("./callback.js");

const TOKEN = "test-token";
const ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const CORP_ID = "ww1234567890abcdef";

function buildEventXml(event: string, extra = ""): string {
  return `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><CreateTime>1234567890</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[${event}]]></Event>${extra}</xml>`;
}

function wrapEncryptedXml(encrypt: string): string {
  return `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
}

function makeGetReq(query: Record<string, string>): IncomingMessage {
  const params = new URLSearchParams(query);
  return {
    method: "GET",
    url: `/wecom/kefu?${params.toString()}`,
    headers: { host: "localhost" },
  } as IncomingMessage;
}

function makePostReq(query: Record<string, string>, body: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = "POST";
  req.url = `/wecom/kefu?${new URLSearchParams(query).toString()}`;
  req.headers = { host: "localhost" };
  queueMicrotask(() => {
    req.emit("data", Buffer.from(body, "utf-8"));
    req.emit("end");
  });
  return req;
}

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload?: string) {
      this.body = payload ?? "";
    },
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

describe("parseWecomCallback", () => {
  it("GET 验签并解密 echostr", () => {
    const plainEchostr = "hello-echostr-verify";
    const encryptedEchostr = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: plainEchostr,
    });
    const timestamp = "1710000000";
    const nonce = "nonce-abc";
    const msgSignature = computeWecomMsgSignature({
      token: TOKEN,
      timestamp,
      nonce,
      encrypt: encryptedEchostr,
    });

    const parsed = parseWecomCallback(
      { msg_signature: msgSignature, timestamp, nonce, echostr: encryptedEchostr },
      null,
      TOKEN,
      ENCODING_AES_KEY,
      CORP_ID,
    );

    expect(parsed.type).toBe("verify");
    expect(parsed.echostr).toBe(plainEchostr);
  });

  it("POST 解密 XML 并 parseXml", () => {
    const xml = buildEventXml("kf_msg_or_event", "<Token><![CDATA[SYNC_TOKEN]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId>");
    const encrypt = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: xml,
    });
    const timestamp = "1710000001";
    const nonce = "nonce-def";
    const msgSignature = computeWecomMsgSignature({
      token: TOKEN,
      timestamp,
      nonce,
      encrypt,
    });

    const parsed = parseWecomCallback(
      { msg_signature: msgSignature, timestamp, nonce },
      wrapEncryptedXml(encrypt),
      TOKEN,
      ENCODING_AES_KEY,
      CORP_ID,
    );

    expect(parsed.type).toBe("event");
    expect(parsed.data?.Event).toBe("kf_msg_or_event");
    expect(parsed.data?.OpenKfId).toBe("kf_001");
    expect(parsed.data?.Token).toBe("SYNC_TOKEN");
  });
});

describe("createKfCallbackHandler", () => {
  const accountConfig: WecomAccountConfig = {
    corpId: CORP_ID,
    corpSecret: "secret",
    openKfId: "kf_001",
    token: TOKEN,
    encodingAESKey: ENCODING_AES_KEY,
  };

  const getAccountConfig = () => accountConfig;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getWecomRuntimeMock.mockReturnValue({
      config: {
        channels: {
          "wecom-kf": {
            enabled: true,
            defaultAccount: "default",
            accounts: {
              default: {
                openKfId: "kf_001",
                agentId: "agent-1",
                corpId: CORP_ID,
                corpSecret: "secret",
                token: TOKEN,
                encodingAESKey: ENCODING_AES_KEY,
              },
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getWecomRuntimeMock.mockReset();
    syncKfMessagesMock.mockReset();
    dispatchKfMessageMock.mockReset();
  });

  it("GET 返回解密后的 echostr 明文", async () => {
    const plainEchostr = "verify-ok";
    const encryptedEchostr = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: plainEchostr,
    });
    const timestamp = "1710000002";
    const nonce = "nonce-get";
    const msgSignature = computeWecomMsgSignature({
      token: TOKEN,
      timestamp,
      nonce,
      encrypt: encryptedEchostr,
    });

    const handler = createKfCallbackHandler(getAccountConfig);
    const res = mockResponse();
    await handler(
      makeGetReq({
        msg_signature: msgSignature,
        timestamp,
        nonce,
        echostr: encryptedEchostr,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(plainEchostr);
  });

  it("POST kf_account_auth_change 返回 success 并打日志", async () => {
    const xml = buildEventXml(
      "kf_account_auth_change",
      "<AuthAddOpenKfId><![CDATA[kf_new]]></AuthAddOpenKfId><AuthDelOpenKfId><![CDATA[kf_old]]></AuthDelOpenKfId>",
    );
    const encrypt = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: xml,
    });
    const timestamp = "1710000003";
    const nonce = "nonce-post";
    const msgSignature = computeWecomMsgSignature({
      token: TOKEN,
      timestamp,
      nonce,
      encrypt,
    });

    const handler = createKfCallbackHandler(getAccountConfig);
    const res = mockResponse();
    await handler(
      makePostReq({ msg_signature: msgSignature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    expect(console.log).toHaveBeenCalledWith("[wecom_kf] KF account authorized: kf_new");
    expect(console.log).toHaveBeenCalledWith("[wecom_kf] KF account deauthorized: kf_old");
  });

  it("无账号配置时返回 500", async () => {
    const handler = createKfCallbackHandler(() => undefined);
    const res = mockResponse();
    await handler(makeGetReq({ echostr: "x" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("No account config");
  });

  it("POST kf_msg_or_event 快速 200 后触发 sync_msg 分页", async () => {
    dispatchKfMessageMock.mockClear();
    syncKfMessagesMock.mockClear();

    let syncCallCount = 0;
    syncKfMessagesMock.mockImplementation(async (_agent, params) => {
      syncCallCount += 1;
      if (syncCallCount === 1) {
        expect(params.token).toBe("SYNC_TOKEN");
        expect(params.open_kfid).toBe("kf_001");
        return {
          errcode: 0,
          errmsg: "ok",
          next_cursor: "cursor-1",
          has_more: 1,
          msg_list: [
            {
              msgid: "msg-1",
              msgtype: "text",
              origin: 3,
              open_kfid: "kf_001",
              external_userid: "wx-user-1",
              text: { content: "hello" },
            },
          ],
        };
      }
      expect(params.cursor).toBe("cursor-1");
      return {
        errcode: 0,
        errmsg: "ok",
        next_cursor: "cursor-2",
        has_more: 0,
        msg_list: [
          {
            msgid: "msg-1-dup",
            msgtype: "text",
            origin: 3,
            open_kfid: "kf_001",
            external_userid: "wx-user-1",
            text: { content: "hello again" },
          },
        ],
      };
    });

    const xml = buildEventXml(
      "kf_msg_or_event",
      "<Token><![CDATA[SYNC_TOKEN]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId>",
    );
    const encrypt = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: xml,
    });
    const timestamp = "1710000004";
    const nonce = "nonce-sync";
    const msgSignature = computeWecomMsgSignature({
      token: TOKEN,
      timestamp,
      nonce,
      encrypt,
    });

    const handler = createKfCallbackHandler(getAccountConfig);
    const res = mockResponse();
    await handler(
      makePostReq({ msg_signature: msgSignature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");

    await vi.waitFor(() => {
      expect(syncCallCount).toBe(2);
    });
    expect(dispatchKfMessageMock).toHaveBeenCalledTimes(1);
  });
});
