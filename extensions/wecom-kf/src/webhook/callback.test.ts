import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

import {
  computeWecomMsgSignature,
  encryptWecomPlaintext,
  parseWecomCallback,
} from "../webhook/crypto.js";
import type { WecomAccountConfig } from "../types/index.js";

const dispatchKfMessageMock = vi.hoisted(() => vi.fn(async () => undefined));
const syncKfMessagesMock = vi.hoisted(() => vi.fn());
const getWecomRuntimeMock = vi.hoisted(() => vi.fn());
const claimInboundMock = vi.hoisted(() => vi.fn(async (_openKfId: string, msgid: string) => ({
  kind: msgid === "msg-1-dup" ? "duplicate" : "claimed",
  key: msgid,
})));
const commitInboundMock = vi.hoisted(() => vi.fn(async () => undefined));
const releaseInboundMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../dispatch/inbound-dispatcher.js", () => ({
  dispatchKfMessage: dispatchKfMessageMock,
}));

vi.mock("../agent/api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/api-client.js")>();
  return {
    ...actual,
    syncKfMessages: syncKfMessagesMock,
  };
});

vi.mock("../runtime/index.js", () => ({
  getWecomRuntime: getWecomRuntimeMock,
  setWecomRuntime: vi.fn(),
}));

vi.mock("../dedup/kf-inbound-dedup.js", () => ({
  claimWecomKfInboundMsgid: claimInboundMock,
  commitWecomKfInboundMsgid: commitInboundMock,
  releaseWecomKfInboundMsgid: releaseInboundMock,
  resolveKfInboundDedupeNamespace: vi.fn((openKfId: string) => `wecom-kf-inbound:${openKfId}`),
}));

vi.mock("../state/cursor-store.js", () => {
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

const {
  createKfCallbackHandler,
  startKfCallbackProcessing,
  stopKfCallbackProcessing,
} = await import("./callback.js");

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
  const req = new EventEmitter() as IncomingMessage & EventEmitter & { destroy?: () => void };
  req.method = "POST";
  req.url = `/wecom/kefu?${new URLSearchParams(query).toString()}`;
  req.headers = { host: "localhost" };
  req.destroy = () => req.removeAllListeners();
  setImmediate(() => {
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
  // 大多数用例只验证一次同步的业务语义，关闭重试可避免失败用例之间残留后台任务。
  // 重试本身由独立用例显式开启并验证。
  const handlerOptions = {
    nowSeconds: () => 1710000004,
    syncRetryAttempts: 1,
    syncRetryDelayMs: 0,
  };
  const accountConfig: WecomAccountConfig = {
    corpId: CORP_ID,
    corpSecret: "secret",
    openKfId: "kf_001",
    token: TOKEN,
    encodingAESKey: ENCODING_AES_KEY,
  };

  const getAccountConfig = () => accountConfig;

  beforeEach(() => {
    startKfCallbackProcessing();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getWecomRuntimeMock.mockReturnValue({
      config: {
        current: () => ({
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
        }),
      },
    });
  });

  afterEach(async () => {
    await stopKfCallbackProcessing(1_000).catch(() => undefined);
    vi.restoreAllMocks();
    getWecomRuntimeMock.mockReset();
    syncKfMessagesMock.mockReset();
    dispatchKfMessageMock.mockReset();
    claimInboundMock.mockClear();
    commitInboundMock.mockClear();
    releaseInboundMock.mockClear();
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

    const handler = createKfCallbackHandler(getAccountConfig, handlerOptions);
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

    const handler = createKfCallbackHandler(getAccountConfig, handlerOptions);
    const res = mockResponse();
    await handler(
      makePostReq({ msg_signature: msgSignature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    expect(console.log).toHaveBeenCalledWith("[wecom_kf] KF account authorized");
    expect(console.log).toHaveBeenCalledWith("[wecom_kf] KF account deauthorized");
  });

  it("无账号配置时返回 500", async () => {
    const handler = createKfCallbackHandler(() => undefined);
    const res = mockResponse();
    await handler(makeGetReq({ echostr: "x" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("No account config");
  });

  it("拒绝签名正确但时间戳过期的重放请求", async () => {
    const encryptedEchostr = encryptWecomPlaintext({
      encodingAESKey: ENCODING_AES_KEY,
      receiveId: CORP_ID,
      plaintext: "stale",
    });
    const timestamp = "1709999000";
    const nonce = "nonce-stale";
    const msgSignature = computeWecomMsgSignature({ token: TOKEN, timestamp, nonce, encrypt: encryptedEchostr });
    const handler = createKfCallbackHandler(getAccountConfig, handlerOptions);
    const res = mockResponse();
    await handler(makeGetReq({ msg_signature: msgSignature, timestamp, nonce, echostr: encryptedEchostr }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("invalid callback");
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

    const handler = createKfCallbackHandler(getAccountConfig, handlerOptions);
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
    expect(commitInboundMock).toHaveBeenCalledWith("kf_001", "msg-1");
  });

  it("派发失败时释放 msgid，且不推进当前页游标", async () => {
    dispatchKfMessageMock.mockRejectedValueOnce(new Error("dispatch failed"));
    syncKfMessagesMock.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor-failed",
      has_more: 0,
      msg_list: [{
        msgid: "msg-failed",
        msgtype: "text",
        origin: 3,
        open_kfid: "kf_001",
        external_userid: "wx-user-1",
        text: { content: "retry me" },
      }],
    });

    const xml = buildEventXml(
      "kf_msg_or_event",
      "<Token><![CDATA[SYNC_TOKEN]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId>",
    );
    const encrypt = encryptWecomPlaintext({ encodingAESKey: ENCODING_AES_KEY, receiveId: CORP_ID, plaintext: xml });
    const timestamp = "1710000005";
    const nonce = "nonce-failed";
    const msgSignature = computeWecomMsgSignature({ token: TOKEN, timestamp, nonce, encrypt });
    const handler = createKfCallbackHandler(getAccountConfig, handlerOptions);
    const res = mockResponse();
    await handler(makePostReq({ msg_signature: msgSignature, timestamp, nonce }, wrapEncryptedXml(encrypt)), res);

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(releaseInboundMock).toHaveBeenCalledWith("kf_001", "msg-failed", expect.any(Error)));
    expect(commitInboundMock).not.toHaveBeenCalledWith("kf_001", "msg-failed");
  });

  it("sync_msg 返回临时错误时后台重试，成功后才结束同步任务", async () => {
    syncKfMessagesMock
      .mockResolvedValueOnce({
        errcode: 50001,
        errmsg: "temporary error",
        has_more: 0,
        msg_list: [],
      })
      .mockResolvedValueOnce({
        errcode: 0,
        errmsg: "ok",
        next_cursor: "cursor-retry",
        has_more: 0,
        msg_list: [],
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
    const nonce = "nonce-retry";
    const msgSignature = computeWecomMsgSignature({ token: TOKEN, timestamp, nonce, encrypt });
    const handler = createKfCallbackHandler(getAccountConfig, {
      ...handlerOptions,
      syncRetryAttempts: 2,
    });
    const res = mockResponse();

    await handler(
      makePostReq({ msg_signature: msgSignature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );

    // 企业微信回调不等待下游 API；防止平台因处理超时重复推送同一事件。
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    await vi.waitFor(() => expect(syncKfMessagesMock).toHaveBeenCalledTimes(2));
  });

  it("拒绝失控的后台同步重试参数", () => {
    expect(() => createKfCallbackHandler(getAccountConfig, {
      ...handlerOptions,
      syncRetryAttempts: 0,
    })).toThrow("syncRetryAttempts");
    expect(() => createKfCallbackHandler(getAccountConfig, {
      ...handlerOptions,
      syncRetryDelayMs: 30_001,
    })).toThrow("syncRetryDelayMs");
  });

  it("停机期间不 ACK 新的同步通知，而是返回 503 让企微重投", async () => {
    await stopKfCallbackProcessing();
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
    const nonce = "nonce-stopping";
    const signature = computeWecomMsgSignature({ token: TOKEN, timestamp, nonce, encrypt });
    const res = mockResponse();

    await createKfCallbackHandler(getAccountConfig, handlerOptions)(
      makePostReq({ msg_signature: signature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe("service stopping");
    expect(syncKfMessagesMock).not.toHaveBeenCalled();
  });

  it("Service stop 会等待已经快速 ACK 的后台同步完成", async () => {
    let finishSync!: (value: unknown) => void;
    syncKfMessagesMock.mockImplementationOnce(() => new Promise((resolve) => {
      finishSync = resolve;
    }));
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
    const nonce = "nonce-drain";
    const signature = computeWecomMsgSignature({ token: TOKEN, timestamp, nonce, encrypt });
    const res = mockResponse();
    await createKfCallbackHandler(getAccountConfig, handlerOptions)(
      makePostReq({ msg_signature: signature, timestamp, nonce }, wrapEncryptedXml(encrypt)),
      res,
    );
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(syncKfMessagesMock).toHaveBeenCalledOnce());

    let drained = false;
    const stopping = stopKfCallbackProcessing(1_000).then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    finishSync({ errcode: 0, errmsg: "ok", next_cursor: "cursor-drained", has_more: 0, msg_list: [] });
    await stopping;
    expect(drained).toBe(true);
  });

  it("拒绝非法的停机 drain 超时配置", async () => {
    await expect(stopKfCallbackProcessing(0)).rejects.toThrow("drain timeout");
  });
});
