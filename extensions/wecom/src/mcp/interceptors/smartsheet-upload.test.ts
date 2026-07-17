import { beforeEach, describe, expect, it, vi } from "vitest";

const sendJsonRpcMock = vi.hoisted(() => vi.fn());
const getRootsMock = vi.hoisted(() => vi.fn());
const guardedReadMock = vi.hoisted(() => vi.fn());

vi.mock("../transport.js", () => ({
  sendJsonRpc: sendJsonRpcMock,
}));

vi.mock("../../media/media-path-guard.js", () => ({
  getExtendedMediaLocalRoots: getRootsMock,
  readGuardedLocalMediaFile: guardedReadMock,
}));

vi.mock("../debug-log.js", () => ({
  mcpDebugLog: vi.fn(),
}));

import { smartsheetUploadInterceptor } from "./smartsheet-upload.js";
import type { CallContext } from "./types.js";

function context(cell: Record<string, unknown>): CallContext {
  return {
    category: "doc",
    method: "smartsheet_add_records",
    args: {
      docid: "doc-1",
      records: [{ values: { attachment: [cell] } }],
    },
    mediaLocalRoots: ["/allowed"],
  };
}

describe("smartsheetUploadInterceptor Path Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRootsMock.mockResolvedValue(["/default", "/allowed"]);
    guardedReadMock.mockResolvedValue({
      ok: true,
      buffer: Buffer.from("safe-file"),
    });
    sendJsonRpcMock.mockImplementation(
      async (
        _category: string,
        _method: string,
        params: { name?: string },
      ) => ({
        content: [
          {
            type: "text",
            text:
              params.name === "upload_doc_image"
                ? JSON.stringify({
                    errcode: 0,
                    url: "https://safe.example/image",
                  })
                : JSON.stringify({ errcode: 0, fileid: "file-1" }),
          },
        ],
      }),
    );
  });

  it("拒绝 Path Guard 白名单外的本地文件且不调用上传接口", async () => {
    guardedReadMock.mockResolvedValueOnce({
      ok: false,
      rejectReason: "not allowed",
      error: "outside allowed roots",
    });

    await expect(
      smartsheetUploadInterceptor.beforeCall?.(
        context({ file_path: "/etc/passwd" }),
      ),
    ).rejects.toThrow('拒绝读取文件 "passwd": not allowed');
    expect(getRootsMock).toHaveBeenCalledWith({
      mediaLocalRoots: ["/allowed"],
    });
    expect(sendJsonRpcMock).not.toHaveBeenCalled();
  });

  it("通过 Path Guard 读取后再上传并移除私有本地路径字段", async () => {
    const cell = { file_path: "/allowed/report.pdf" };
    const result = await smartsheetUploadInterceptor.beforeCall?.(
      context(cell),
    );

    expect(guardedReadMock).toHaveBeenCalledWith({
      filePath: "/allowed/report.pdf",
      allowedRoots: ["/default", "/allowed"],
      maxBytes: 10 * 1024 * 1024,
    });
    expect(sendJsonRpcMock).toHaveBeenCalledWith(
      "doc",
      "tools/call",
      expect.objectContaining({
        name: "upload_doc_file",
        arguments: expect.objectContaining({
          file_name: "report.pdf",
          file_base64_content: Buffer.from("safe-file").toString("base64"),
        }),
      }),
      { timeoutMs: 60_000 },
    );
    expect(cell).toEqual({ file_id: "file-1" });
    expect(result?.args).toBeDefined();
  });

  it("在读取文件前拒绝超过 20 个上传任务", async () => {
    const ctx = context({ file_path: "/allowed/first.txt" });
    ctx.args.records = [
      {
        values: {
          attachment: Array.from({ length: 21 }, (_, index) => ({
            file_path: `/allowed/${index}.txt`,
          })),
        },
      },
    ];

    await expect(smartsheetUploadInterceptor.beforeCall?.(ctx)).rejects.toThrow(
      "单次最多上传 20 个文件",
    );
    expect(guardedReadMock).not.toHaveBeenCalled();
  });
});
