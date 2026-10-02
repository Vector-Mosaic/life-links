const TELNYX_SMS_URL = "https://api.telnyx.com/v2/messages";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const E164 = /^\+[1-9][0-9]{1,14}$/u;
const ACCEPTED_STATUSES = new Set(["queued", "sending", "sent", "delivered", "delivery_unconfirmed"]);

export type SmsVerificationDeliveryErrorCode = "invalid_configuration" | "invalid_request" | "delivery_rejected" | "delivery_outcome_unknown";

/** Safe to record without the recipient, code, API key or provider response. */
export class SmsVerificationDeliveryError extends Error {
  constructor(
    readonly outcome: "rejected" | "unknown",
    readonly code: SmsVerificationDeliveryErrorCode,
  ) {
    super(code);
    this.name = "SmsVerificationDeliveryError";
  }
}

export interface TelnyxVerificationSmsConfig {
  apiKey: string;
  fromE164: string;
  messagingProfileId: string;
  /** 1–40 ASCII GSM-basic name characters; the resulting template is one SMS part. */
  appDisplayName: string;
}

export interface SmsVerificationRequest {
  phoneE164: string;
  code: string;
  /** Durable consumer correlation only. Telnyx SMS declares no provider idempotency mechanism. */
  operationId: string;
}

export interface SmsVerificationAcknowledgement {
  provider: "telnyx";
  accepted: true;
  messageId: string;
  operationId: string;
}

export interface SmsVerificationSender {
  /** Acceptance is not delivery or possession. No automatic retry; an unknown send is not safe to replay. */
  send(request: SmsVerificationRequest): Promise<SmsVerificationAcknowledgement>;
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invalidInput(configuration = false): never {
  throw new SmsVerificationDeliveryError("rejected", configuration ? "invalid_configuration" : "invalid_request");
}

async function readAcknowledgement(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) throw new Error();
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

/** Construction is offline. The consumer must configure an approved SMS sender/profile, STOP/HELP handling and send authority. */
export function createTelnyxVerificationSmsSender(config: TelnyxVerificationSmsConfig): SmsVerificationSender {
  if (!config || !validText(config.apiKey, 4096) || /\s/u.test(config.apiKey) || !validText(config.fromE164, 16) || !E164.test(config.fromE164)
    || !validText(config.messagingProfileId, 36) || !UUID.test(config.messagingProfileId)
    || !validText(config.appDisplayName, 40) || !/^[A-Za-z0-9][A-Za-z0-9 .&'()/:-]{0,39}$/u.test(config.appDisplayName)) invalidInput(true);
  const { apiKey, fromE164, messagingProfileId, appDisplayName } = config;
  return Object.freeze({
    async send(request: SmsVerificationRequest): Promise<SmsVerificationAcknowledgement> {
      if (!request || !validText(request.phoneE164, 16) || !E164.test(request.phoneE164) || !validText(request.code, 6) || !/^[0-9]{6}$/u.test(request.code)
        || !validText(request.operationId, 256) || !/^[A-Za-z0-9][A-Za-z0-9_./:-]*$/u.test(request.operationId)) invalidInput();
      const { phoneE164, code, operationId } = request;
      // All allowed name/template characters are single-septet GSM-7; maximum length is 114.
      const text = `${appDisplayName} verification code: ${code}. Do not share this code. Reply STOP to opt out.`;
      const body = JSON.stringify({ from: fromE164, messaging_profile_id: messagingProfileId, to: phoneE164, text, type: "SMS", encoding: "gsm7" });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(TELNYX_SMS_URL, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
          body,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          const rejected = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409;
          throw new SmsVerificationDeliveryError(rejected ? "rejected" : "unknown", rejected ? "delivery_rejected" : "delivery_outcome_unknown");
        }
        const acknowledgement = record(await readAcknowledgement(response));
        const data = record(acknowledgement?.data);
        const from = record(data?.from);
        const to = Array.isArray(data?.to) && data.to.length === 1 ? record(data.to[0]) : null;
        if (!data || !validText(data.id, 36) || !UUID.test(data.id) || data.record_type !== "message" || data.direction !== "outbound" || data.type !== "SMS"
          || data.messaging_profile_id !== messagingProfileId || from?.phone_number !== fromE164 || to?.phone_number !== phoneE164
          || typeof to.status !== "string" || !ACCEPTED_STATUSES.has(to.status) || data.text !== text || data.parts !== 1 || data.encoding !== "GSM-7"
          || !Array.isArray(data.errors) || data.errors.length !== 0 || (data.cc !== undefined && (!Array.isArray(data.cc) || data.cc.length !== 0))) throw new Error();
        return { provider: "telnyx", accepted: true, messageId: data.id, operationId };
      } catch (error) {
        if (error instanceof SmsVerificationDeliveryError) throw error;
        throw new SmsVerificationDeliveryError("unknown", "delivery_outcome_unknown");
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    },
  });
}
