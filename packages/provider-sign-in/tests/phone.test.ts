import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelnyxVerificationSmsSender, SmsVerificationDeliveryError } from "../src/phone.js";

const config = {
  apiKey: "synthetic-telnyx-key-never-used-online", fromE164: "+18005550123",
  messagingProfileId: "abc85f64-5717-4562-b3fc-2c9600000000", appDisplayName: "Example App",
};
const request = { phoneE164: "+12025550123", code: "004217", operationId: "example/verification/challenge-1/send-1" };
const messageId = "40385f64-5717-4562-b3fc-2c963f66afa6";
const text = `${config.appDisplayName} verification code: ${request.code}. Do not share this code. Reply STOP to opt out.`;
function acknowledgement() {
  return { data: { record_type: "message", direction: "outbound", id: messageId, type: "SMS", messaging_profile_id: config.messagingProfileId,
    from: { phone_number: config.fromE164 }, to: [{ phone_number: request.phoneE164, status: "queued" }], text, encoding: "GSM-7", parts: 1, errors: [], cc: [] } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Telnyx verification SMS delivery", () => {
  it("constructs offline and sends one bound SMS through the fixed endpoint without idempotency claims", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(acknowledgement())));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createTelnyxVerificationSmsSender(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sender.send(request)).toEqual({ provider: "telnyx", accepted: true, messageId, operationId: request.operationId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", accept: "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ from: config.fromE164, messaging_profile_id: config.messagingProfileId,
      to: request.phoneE164, text, type: "SMS", encoding: "gsm7" });
    expect(init.body).not.toContain(request.operationId);
  });

  it("keeps configuration and request snapshots across caller mutation", async () => {
    const inputConfig = { ...config };
    const inputRequest = { ...request };
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createTelnyxVerificationSmsSender(inputConfig);
    inputConfig.fromE164 = "+18005550124";
    inputConfig.apiKey = "changed-key";
    const result = sender.send(inputRequest);
    inputRequest.phoneE164 = "+12025550124";
    inputRequest.operationId = "changed-operation";
    inputRequest.code = "999999";
    finish(new Response(JSON.stringify(acknowledgement())));
    expect(await result).toEqual({ provider: "telnyx", accepted: true, messageId, operationId: request.operationId });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe(request.phoneE164);
  });

  it("bounds the template to one GSM-7 part and rejects customization that breaks that bound offline", async () => {
    const longName = "A".repeat(40);
    const longText = `${longName} verification code: ${request.code}. Do not share this code. Reply STOP to opt out.`;
    const data = acknowledgement();
    data.data.text = longText;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetchMock);
    await createTelnyxVerificationSmsSender({ ...config, appDisplayName: longName }).send(request);
    expect(longText.length).toBe(114);
    expect(longText).toMatch(/^[A-Za-z0-9 .:]+$/u);
    for (const appDisplayName of ["A".repeat(41), "App😀", "App^", "App[one]", "App|", "App€", "App’", "App\n", ""]) {
      expect(() => createTelnyxVerificationSmsSender({ ...config, appDisplayName })).toThrow("invalid_configuration");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid config, destinations, codes and operation IDs before external effects", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const changed of [{ apiKey: "bad\r\nkey" }, { apiKey: "bad key" }, { fromE164: "18005550123" }, { fromE164: config.fromE164 + "\n" },
      { messagingProfileId: "bad-profile" }, { messagingProfileId: config.messagingProfileId + "\n" }]) {
      expect(() => createTelnyxVerificationSmsSender({ ...config, ...changed })).toThrow("invalid_configuration");
    }
    const sender = createTelnyxVerificationSmsSender(config);
    for (const changed of [{ phoneE164: "2025550123" }, { phoneE164: "+02025550123" }, { phoneE164: "+1234567890123456" },
      { phoneE164: "+12025550123\n" }, { code: "4217" }, { code: "１２３４５６" }, { code: "1234567" }, { code: "123456\n" },
      { operationId: "a".repeat(257) }, { operationId: "bad\noperation" }]) {
      await expect(sender.send({ ...request, ...changed })).rejects.toMatchObject({ outcome: "rejected", code: "invalid_request" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 401, 402, 403, 404, 405, 422, 429])("classifies HTTP %s as request rejection with no retry or provider output", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(`private ${config.apiKey} ${request.phoneE164} ${request.code}`, { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createTelnyxVerificationSmsSender(config).send(request)).rejects.toMatchObject({ outcome: "rejected", code: "delivery_rejected", message: "delivery_rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([302, 408, 409, 500, 503])("keeps HTTP %s unknown without replaying", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("private provider response", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createTelnyxVerificationSmsSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never exposes transport messages, private values or error causes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error(`${config.apiKey} ${request.phoneE164} ${request.code}`)); vi.stubGlobal("fetch", fetchMock);
    const error = await createTelnyxVerificationSmsSender(config).send(request).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SmsVerificationDeliveryError);
    expect(error).toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    for (const privateValue of [config.apiKey, request.phoneE164, request.code]) expect(String(error)).not.toContain(privateValue);
    expect(error).not.toHaveProperty("cause");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["not json", "[]", "{}", '{"data":null}'])("keeps malformed acknowledgement %s unknown", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(createTelnyxVerificationSmsSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("requires the exact sender, recipient, profile, text, SMS type, single part and safe acceptance status", async () => {
    const changes = [
      { id: "bad-id" }, { record_type: "wrong" }, { direction: "inbound" }, { type: "MMS" }, { messaging_profile_id: "other-profile" },
      { from: { phone_number: "+18005550124" } }, { to: [{ phone_number: "+12025550124", status: "queued" }] },
      { to: [] }, { to: [{ phone_number: request.phoneE164, status: "queued" }, { phone_number: "+12025550124", status: "queued" }] },
      { to: [{ phone_number: request.phoneE164, status: "sending_failed" }] }, { text: "different code" }, { encoding: "UTF-16" }, { parts: 2 },
      { errors: [{ detail: "private" }] }, { errors: undefined }, { cc: [{ phone_number: "+12025550124" }] },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { ...acknowledgement().data, ...changes.shift() } })));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createTelnyxVerificationSmsSender(config);
    const count = changes.length;
    for (let index = 0; index < count; index += 1) await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it("bounds declared and streamed acknowledgement size", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { headers: { "content-length": "8193" } })).mockResolvedValueOnce(new Response("x".repeat(8193)));
    vi.stubGlobal("fetch", fetchMock); const sender = createTelnyxVerificationSmsSender(config);
    await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown" });
    await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a stalled send at its deadline without retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("private timeout")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = createTelnyxVerificationSmsSender(config).send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the same total deadline while reading a stalled response body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
        init.signal!.addEventListener("abort", () => controller.error(new Error("private body timeout")), { once: true });
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const result = createTelnyxVerificationSmsSender(config).send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
