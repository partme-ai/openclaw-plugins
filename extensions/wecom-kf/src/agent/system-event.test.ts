/**
 * system-event 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractWelcomeContent,
  handleSystemEvent,
  inferServiceStateFromSessionChange,
  readKfSystemEventFields,
  resolveKfWelcomeText,
} from "./system-event.js";

vi.mock("../config/event-messages.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/event-messages.js")>();
  return {
    ...actual,
    getEventMessagesConfig: vi.fn(async () => ({
      welcome: {
        enabled: true,
        msgtype: "text",
        content: { text: { content: "event-messages 欢迎语" } },
      },
    })),
  };
});

describe("readKfSystemEventFields", () => {
  it("应从 msg.event 读取 event_type 与 welcome_code", () => {
    const fields = readKfSystemEventFields({
      origin: 4,
      msgtype: "event",
      event: {
        event_type: "enter_session",
        welcome_code: "WELCOME-ABC",
      },
    } as never);

    expect(fields.eventType).toBe("enter_session");
    expect(fields.welcomeCode).toBe("WELCOME-ABC");
  });

  it("msg_send_fail 应读取 fail_msgid / fail_type", () => {
    const fields = readKfSystemEventFields({
      origin: 4,
      msgtype: "event",
      event: {
        event_type: "msg_send_fail",
        fail_msgid: "m1",
        fail_type: 2,
      },
    } as never);

    expect(fields.eventType).toBe("msg_send_fail");
    expect(fields.failMsgId).toBe("m1");
    expect(fields.failType).toBe(2);
  });
});

describe("extractWelcomeContent", () => {
  it("应支持 content.text.content 结构", () => {
    expect(
      extractWelcomeContent({
        enabled: true,
        msgtype: "text",
        content: { text: { content: "你好" } },
      }),
    ).toBe("你好");
  });

  it("应支持 content.content 扁平结构", () => {
    expect(
      extractWelcomeContent({
        enabled: true,
        msgtype: "text",
        content: { content: "扁平欢迎语" },
      }),
    ).toBe("扁平欢迎语");
  });

  it("disabled 时应返回 undefined", () => {
    expect(
      extractWelcomeContent({
        enabled: false,
        msgtype: "text",
        content: { text: { content: "不应出现" } },
      }),
    ).toBeUndefined();
  });
});

describe("resolveKfWelcomeText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("优先使用 event-messages 配置", async () => {
    const text = await resolveKfWelcomeText({
      openKfId: "wk_001",
      accountConfig: { welcomeText: "账号级欢迎语" },
    });
    expect(text).toBe("event-messages 欢迎语");
  });
});

describe("inferServiceStateFromSessionChange", () => {
  it("优先使用 event.service_state", () => {
    expect(inferServiceStateFromSessionChange({ serviceState: 3, changeType: 2 })).toBe(3);
  });

  it("change_type=3 映射为已结束(4)", () => {
    expect(inferServiceStateFromSessionChange({ changeType: 3 })).toBe(4);
  });
});

describe("handleSystemEvent session_status_change", () => {
  it("state=3 时写入 session service state", async () => {
    const sessionModule = await import("../state/session-service-state.js");
    const spy = vi.spyOn(sessionModule, "setKfSessionServiceState").mockResolvedValue();

    await handleSystemEvent(
      {
        origin: 4,
        msgtype: "event",
        open_kfid: "wk1",
        external_userid: "u1",
        event: {
          event_type: "session_status_change",
          service_state: 3,
          change_type: 2,
        },
      } as never,
      { openKfId: "wk1" },
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        openKfId: "wk1",
        externalUserId: "u1",
        serviceState: 3,
      }),
    );

    spy.mockRestore();
  });
});
