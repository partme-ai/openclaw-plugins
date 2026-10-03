import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeituanPluginConfig } from "../types.js";
import { MeituanCallbackInbox } from "./inbox.js";
import { MeituanCallbackError, parseMeituanCallback } from "./parser.js";

export const MEITUAN_CALLBACK_PATH = "/meituan/callback";

function reply(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ code, message }));
}

async function readBounded(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    bytes += chunk.length;
    if (bytes > maxBytes) throw new MeituanCallbackError(413, -1, "callback body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 外部推送入口。只有验签且持久化成功的通知才返回平台成功回执。 */
export function createMeituanCallbackHandler(config: MeituanPluginConfig, inbox: MeituanCallbackInbox) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      reply(res, 405, -1, "method not allowed");
      return true;
    }
    try {
      const body = await readBounded(req, config.callbacks.maxBodyBytes);
      const event = parseMeituanCallback({
        body, contentType: req.headers["content-type"] ?? "", developerId: config.developerId,
        signKey: config.signKey, maxBodyBytes: config.callbacks.maxBodyBytes,
        toleranceSeconds: config.callbacks.timestampToleranceSeconds,
      });
      await inbox.accept(event);
      reply(res, 200, 0, "success");
    } catch (error) {
      if (error instanceof MeituanCallbackError) reply(res, error.status, error.code, error.message);
      else reply(res, 503, -1, "callback storage unavailable");
    }
    return true;
  };
}
