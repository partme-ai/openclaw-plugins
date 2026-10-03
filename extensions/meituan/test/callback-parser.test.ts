import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MEITUAN_NOTIFICATION_TYPES } from "../src/callback/catalog.js";
import { parseMeituanCallback } from "../src/callback/parser.js";

const defaults = { developerId: "123", signKey: "secret", nowSeconds: 1_700_000_000, toleranceSeconds: 300, maxBodyBytes: 65_536 };

function signed(fields: Record<string, string>): Record<string, string> {
  const source = "secret" + Object.keys(fields).sort().map((key) => key + fields[key]).join("");
  return { ...fields, sign: createHash("sha1").update(source).digest("hex") };
}

function base(msgType = "5810055", businessId = "58") {
  return { businessId, msgType, msgId: "m-1", developerId: "123", timestamp: "1700000000", message: '{"messageId":"inner-1","orderId":"o-1"}' };
}

describe("Meituan notification callback parser", () => {
  it("parses signed form and JSON envelopes into one typed event", () => {
    const form = new URLSearchParams(signed(base())).toString();
    const fromForm = parseMeituanCallback({ ...defaults, body: form, contentType: "application/x-www-form-urlencoded" });
    const fromJson = parseMeituanCallback({ ...defaults, body: JSON.stringify(signed(base())), contentType: "application/json" });
    expect(fromForm).toMatchObject({ businessId: "58", msgType: "5810055", msgId: "m-1", typeName: "verify_order_info_push", payload: { orderId: "o-1" } });
    expect(fromJson).toEqual(fromForm);
    expect(JSON.stringify(fromForm)).not.toContain("secret");
    expect(JSON.stringify(fromForm)).not.toContain("\"sign\"");
  });

  it("accepts signed legacy invokeType/param aliases and preserves message kind", () => {
    const fields = signed({ businessId: "2", invokeType: "210069", msg_id: "im-1", developerId: "123", timestamp: "1700000000", param: '{"content":"hello"}' });
    const event = parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });
    expect(event).toMatchObject({ kind: "message", msgType: "210069", msgId: "im-1", payload: { content: "hello" } });
  });

  it("uses an exact numeric inner messageId when the envelope has no msgId", () => {
    for (const messageId of ["1234567890", "3702923312382104528"]) {
      const fields = signed({ businessId: "58", msgType: "5810055", developerId: "123",
        timestamp: "1700000000", message: `{"messageId":${messageId},"orderId":"o-1"}` });
      const event = parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });
      expect(event.msgId).toBe(messageId);
      expect(String(event.payload.messageId)).toBe(messageId);
    }
  });

  it("parses every registered notification or message without changing its business identity", () => {
    for (const type of MEITUAN_NOTIFICATION_TYPES) {
      const fields = signed({ businessId: type.businessId, msgType: type.msgType, msgId: `event-${type.businessId}-${type.msgType}`,
        developerId: "123", timestamp: "1700000000", message: '{"event":"received"}' });
      const event = parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });
      expect(event).toMatchObject({ businessId: type.businessId, msgType: type.msgType, kind: type.kind,
        typeName: type.name, payload: { event: "received" } });
    }
  });

  it("accepts the SDK fixture's millisecond timestamp without changing the signed value", () => {
    const fields = signed({ businessId: "59", msgType: "5910003", msgId: "3702923312382104528",
      developerId: "123", timestamp: "1711592316026", message: '{"productId":1000,"flowStatus":30}' });
    const event = parseMeituanCallback({ ...defaults, nowSeconds: 1_711_592_316,
      body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });
    expect(event).toMatchObject({ msgType: "5910003", timestamp: 1_711_592_316,
      payload: { productId: 1000, flowStatus: 30 } });
  });

  it("preserves 19-digit numeric business identifiers in form and JSON object envelopes", () => {
    const message = '{"orderId":3702923312382104528,"items":[{"skuId":9223372036854775807}]}';
    const fields = signed({ ...base(), message });
    const form = parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });
    expect(form.payload).toEqual({ orderId: "3702923312382104528", items: [{ skuId: "9223372036854775807" }] });
    expect(form.messageRaw).toBe(message);
    const jsonBody = JSON.stringify({ ...fields, message: "PLACEHOLDER" }).replace('"message":"PLACEHOLDER"', `"message":${message}`);
    const json = parseMeituanCallback({ ...defaults, body: jsonBody, contentType: "application/json" });
    expect(json).toEqual(form);
    const pretty = jsonBody.replace(`"message":${message}`, `"message": { "orderId": 3702923312382104528, "items": [ { "skuId": 9223372036854775807 } ] }`);
    expect(parseMeituanCallback({ ...defaults, body: pretty, contentType: "application/json" })).toEqual(form);
  });

  it("has unique registry keys and excludes documented synchronous queries and commands", () => {
    const keys = MEITUAN_NOTIFICATION_TYPES.map(({ businessId, msgType }) => `${businessId}:${msgType}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("71:7110001");
    for (const excluded of ["58:5810023", "58:5810149", "58:5810147", "59:5910007", "59:5910035", "51:5110005", "51:5110029", "46:4610029"]) {
      expect(keys).not.toContain(excluded);
    }
  });

  it("rejects missing/bad signatures, expired timestamps, mismatched developer and unknown types", () => {
    const valid = signed(base());
    for (const fields of [
      { ...valid, sign: "" }, { ...valid, sign: "0".repeat(40) },
      signed({ ...base(), timestamp: "1699999000" }),
      signed({ ...base(), developerId: "999" }),
      signed(base("5810023")), signed(base("9999999")),
    ]) {
      expect(() => parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" })).toThrow();
    }
  });

  it("rejects conflicting aliases, duplicate form keys, malformed JSON and oversized bodies", () => {
    const fields = signed(base());
    for (const body of [
      `${new URLSearchParams(fields)}&msgType=5810173`,
      new URLSearchParams(signed({ ...base(), invokeType: "5810173" })).toString(),
      new URLSearchParams(signed({ ...base(), message: "not-json" })).toString(),
    ]) {
      expect(() => parseMeituanCallback({ ...defaults, body, contentType: "application/x-www-form-urlencoded" })).toThrow();
    }
    expect(() => parseMeituanCallback({ ...defaults, body: "{oops", contentType: "application/json" })).toThrow();
    const json = JSON.stringify(signed(base()));
    expect(() => parseMeituanCallback({ ...defaults, body: json.replace('"msgType":"5810055",', '"msgType":"5810055","msgType":"5810055",'), contentType: "application/json" })).toThrow();
    expect(() => parseMeituanCallback({ ...defaults, body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded", maxBodyBytes: 10 })).toThrow();
  });
});
