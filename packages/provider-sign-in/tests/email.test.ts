import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentCommunicationsVerificationEmailSender, EmailVerificationDeliveryError } from "../src/email.js";

const config = {
  gatewayBaseUrl: "https://communications.example.test", bearerToken: "synthetic-scoped-gateway-token-never-used-online",
  senderMailbox: "sender@example.test", appDisplayName: "Example App",
};
const request = { email: "Recipient@Example.test", code: "004217", operationId: "example.verification.challenge-1:send-1" };
const messageId = "AAMk-synthetic_immutable+message/ref==";
function operation(changed: Record<string, unknown> = {}) {
  return { operation_id: request.operationId, kind: "mail.send", sender_mailbox: config.senderMailbox,
    state: "submitted", provider_status: "accepted", provider_ref: messageId,
    retry_after_at: null, last_error_code: null, ...changed };
}
function response(value: unknown) { return new Response(JSON.stringify(value)); }
function absent() { return new Response(JSON.stringify({ error: { code: "not_found", message: "operation was not found", request_id: "synthetic-request-1" } }), { status: 404 }); }
function newSend(acknowledgement: unknown = operation()) {
  return vi.fn().mockResolvedValueOnce(absent()).mockResolvedValueOnce(response(acknowledgement));
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("gateway verification email delivery", () => {
  it("constructs offline, observes the original operation and sends the closed payload with its stable ID", async () => {
    const fetchMock = newSend(); vi.stubGlobal("fetch", fetchMock);
    const sender = createAgentCommunicationsVerificationEmailSender(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sender.send(request)).toEqual({ provider: "agent_communications", accepted: true, messageId, operationId: request.operationId });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getUrl, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(getUrl).toBe(`${config.gatewayBaseUrl}/v1/operations/${encodeURIComponent(request.operationId)}`);
    expect(getInit).toMatchObject({ method: "GET", redirect: "error" });
    expect(getInit.headers).toEqual({ authorization: `Bearer ${config.bearerToken}`, accept: "application/json" });
    expect(getInit).not.toHaveProperty("body");
    const [postUrl, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postUrl).toBe(`${config.gatewayBaseUrl}/v1/mail`);
    expect(postInit).toMatchObject({ method: "POST", redirect: "error" });
    expect(postInit.signal).toBe(getInit.signal);
    expect(postInit.headers).toEqual({ authorization: `Bearer ${config.bearerToken}`, accept: "application/json",
      "content-type": "application/json", "Idempotency-Key": request.operationId });
    const body = JSON.parse(postInit.body as string);
    expect(body).toEqual({ operation_id: request.operationId, to: [request.email], cc: [],
      subject: "Your Example App verification code",
      body: "Example App verification code: 004217\n\nUse this code to verify your email address. Do not share it with anyone.\n\nIf you did not request this code, you can ignore this email." });
    expect(body).not.toHaveProperty("from");
  });

  it.each([["submitted", "accepted"], ["reconciled_sent", "sent"]])("returns an existing %s/%s acceptance without POST", async (state, provider_status) => {
    const fetchMock = vi.fn().mockResolvedValue(response(operation({ state, provider_status }))); vi.stubGlobal("fetch", fetchMock);
    expect(await createAgentCommunicationsVerificationEmailSender(config).send(request)).toEqual({
      provider: "agent_communications", accepted: true, messageId, operationId: request.operationId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it.each(["admitted", "creating_draft", "draft_created", "draft_creation_unknown", "submitting", "submission_unknown", "unrecognized"])("contains existing %s state without POST or success", async (state) => {
    const fetchMock = vi.fn().mockResolvedValue(response(operation({ state, provider_status: "unknown" }))); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: "failed", provider_status: null, provider_ref: null, last_error_code: "provider_rejected" },
    { state: "failed", provider_status: "not_found", provider_ref: null, last_error_code: "provider_rejected" },
    { state: "submission_failed", provider_status: "draft", last_error_code: "provider_rejected" },
  ])("accepts only bound definitive no-send state as rejection", async (changed) => {
    const fetchMock = vi.fn().mockResolvedValue(response(operation(changed))); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "rejected", code: "delivery_rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows one explicit retry for a gateway-confirmed elapsed definite 429 under the same ID and body", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(operation({ state: "deferred", provider_status: "throttled", last_error_code: "provider_throttled", retry_after_at: "2026-10-02T00:59:59Z" })))
      .mockResolvedValueOnce(response(operation()));
    vi.stubGlobal("fetch", fetchMock);
    await createAgentCommunicationsVerificationEmailSender(config).send(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(request.operationId);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).operation_id).toBe(request.operationId);
  });

  it("resumes only the gateway's durable never-attempted admitted stage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(operation({ state: "admitted", provider_status: "not_found", provider_ref: null })))
      .mockResolvedValueOnce(response(operation()));
    vi.stubGlobal("fetch", fetchMock);
    await createAgentCommunicationsVerificationEmailSender(config).send(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).operation_id).toBe(request.operationId);
  });

  it.each(["creating_draft", "draft_creation_unknown", "submitting", "submission_unknown"])("never interprets a missing marker in %s as no prior effect", async (state) => {
    const fetchMock = vi.fn().mockResolvedValue(response(operation({ state, provider_status: "not_found", provider_ref: null })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { retry_after_at: "2999-10-02T00:59:59Z" }, { retry_after_at: "bad-date" }, { retry_after_at: null },
    { retry_after_at: "2000-01-01T00:00:00", last_error_code: "provider_throttled" },
    { retry_after_at: "2000-01-01T00:00:00Z", last_error_code: "unknown_effect" },
    { retry_after_at: "2000-01-01T00:00:00Z", provider_status: "unknown" },
  ])("does not dispatch a deferred state without positive elapsed no-effect evidence", async (changed) => {
    const fetchMock = vi.fn().mockResolvedValue(response(operation({ state: "deferred", provider_status: "throttled", last_error_code: "provider_throttled", ...changed })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not loop or resend when an explicit retry remains deferred", async () => {
    const deferred = operation({ state: "deferred", provider_status: "throttled", last_error_code: "provider_throttled", retry_after_at: "2000-01-01T00:00:00Z" });
    const fetchMock = vi.fn().mockImplementation(async () => response(deferred)); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires exact operation, kind, sender, coherent acceptance and a bounded opaque reference", async () => {
    const changes = [
      { operation_id: "another-operation" }, { kind: "mail.reply" }, { sender_mailbox: "other@example.test" },
      { sender_mailbox: "Sender@example.test" }, { provider_ref: null }, { provider_ref: "" }, { provider_ref: "x".repeat(2049) },
      { provider_ref: "private\nreference" }, { state: "submitted", provider_status: "sent" },
      { state: "reconciled_sent", provider_status: "accepted" }, { state: "failed", provider_status: "accepted", last_error_code: "provider_rejected" },
      { state: "submission_failed", provider_status: "unknown", last_error_code: "provider_rejected" },
      { state: "failed", provider_status: null, last_error_code: null },
      { state: "submission_failed", provider_status: "draft", last_error_code: "private\nerror" },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => response(operation(changes.shift()))); vi.stubGlobal("fetch", fetchMock);
    const sender = createAgentCommunicationsVerificationEmailSender(config), count = changes.length;
    for (let index = 0; index < count; index += 1) await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it("captures configuration and request before a caller can mutate them", async () => {
    const inputConfig = { ...config }, inputRequest = { ...request };
    let finish: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValueOnce(response(operation()));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createAgentCommunicationsVerificationEmailSender(inputConfig);
    inputConfig.gatewayBaseUrl = "https://other.example.test"; inputConfig.bearerToken = "changed-token"; inputConfig.senderMailbox = "other@example.test";
    const result = sender.send(inputRequest);
    inputRequest.email = "other@example.test"; inputRequest.code = "999999"; inputRequest.operationId = "changed-id";
    finish(absent());
    expect(await result).toMatchObject({ messageId, operationId: request.operationId });
    expect(fetchMock.mock.calls[1][0]).toBe(`${config.gatewayBaseUrl}/v1/mail`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).to).toEqual([request.email]);
  });

  it("rejects invalid configuration and request inputs offline", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const changed of [
      { gatewayBaseUrl: "http://communications.example.test" }, { gatewayBaseUrl: "https://user:pass@example.test" },
      { gatewayBaseUrl: "https://example.test/path" }, { gatewayBaseUrl: "https://example.test?q=1" }, { gatewayBaseUrl: "https://example.test#fragment" },
      { bearerToken: "bad\r\nInjected: yes" }, { bearerToken: "bad token" }, { senderMailbox: "one@example.test,two@example.test" }, { appDisplayName: "App\nInjected" },
      { bearerToken: "a".repeat(31) }, { bearerToken: "a".repeat(4097) }, { bearerToken: "界".repeat(32) },
    ]) expect(() => createAgentCommunicationsVerificationEmailSender({ ...config, ...changed })).toThrow("invalid_configuration");
    const sender = createAgentCommunicationsVerificationEmailSender(config);
    for (const changed of [
      { email: "one@example.test,two@example.test" }, { email: "one@example.test\nBcc: other@example.test" },
      { code: "12345" }, { code: "1234567" }, { code: "１２３４５６" }, { code: "123456\n" },
      { operationId: "contains/slash" }, { operationId: "challenge\nInjected" }, { operationId: "a".repeat(129) },
      { operationId: "." }, { operationId: ".." },
    ]) await expect(sender.send({ ...request, ...changed })).rejects.toMatchObject({ outcome: "rejected", code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([302, 400, 401, 403, 408, 409, 500, 503])("keeps unreadable GET HTTP %s unknown without POST", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("private response", { status })); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not json", "[]", '{"detail":"Not Found"}', '{"error":{"code":"not_found"}}',
    '{"error":{"code":"not_found","message":"route was not found","request_id":"synthetic-request-1"}}',
    '{"error":{"code":"not_found","message":"operation was not found","request_id":null}}',
  ])("does not dispatch for an unvalidated gateway-missing HTTP404 body %s", async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 404 })); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds a missing-operation response before it can justify dispatch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x".repeat(8193), { status: 404 })); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 408, 409, 500, 503])("does not let POST HTTP %s disprove a prior possibly submitted operation", async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response("private response", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sanitizes transport and gateway failures without raw values or causes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error(`${config.bearerToken} ${request.email} ${request.code}`)); vi.stubGlobal("fetch", fetchMock);
    const error = await createAgentCommunicationsVerificationEmailSender(config).send(request).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(EmailVerificationDeliveryError);
    expect(error).toMatchObject({ outcome: "unknown", code: "delivery_outcome_unknown" });
    for (const privateValue of [config.bearerToken, request.email, request.code]) expect(String(error)).not.toContain(privateValue);
    expect(error).not.toHaveProperty("cause");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["not json", "[]", "{}", "null"])("contains malformed GET acknowledgement %s without dispatch", async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body)); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds declared and streamed acknowledgements before any further send", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { headers: { "content-length": "8193" } })).mockResolvedValueOnce(new Response("x".repeat(8193)));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createAgentCommunicationsVerificationEmailSender(config);
    await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown" });
    await expect(sender.send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the POST acknowledgement and never repeats a send", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response("x".repeat(8193))); vi.stubGlobal("fetch", fetchMock);
    await expect(createAgentCommunicationsVerificationEmailSender(config).send(request)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses one total deadline across observation and dispatch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { setTimeout(() => resolve(absent()), 6_000); }))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("private timeout")), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = createAgentCommunicationsVerificationEmailSender(config).send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  });

  it("keeps the same deadline while reading a stalled operation body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"operation_id":'));
        init.signal!.addEventListener("abort", () => controller.error(new Error("private body timeout")), { once: true });
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const result = createAgentCommunicationsVerificationEmailSender(config).send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
