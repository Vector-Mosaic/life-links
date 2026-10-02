const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024;
const OPERATION_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

export type EmailVerificationDeliveryErrorCode = "invalid_configuration" | "invalid_request" | "delivery_rejected" | "delivery_outcome_unknown";

/** Safe to record without the recipient, code, bearer or gateway response. */
export class EmailVerificationDeliveryError extends Error {
  constructor(
    readonly outcome: "rejected" | "unknown",
    readonly code: EmailVerificationDeliveryErrorCode,
  ) {
    super(code);
    this.name = "EmailVerificationDeliveryError";
  }
}

export interface AgentCommunicationsVerificationEmailConfig {
  /** Approved HTTPS gateway origin, with no path, query, fragment or credentials. */
  gatewayBaseUrl: string;
  /** Scoped application mail-send/own-operation-read credential: 32–4096 printable ASCII characters, never a coordinator token. */
  bearerToken: string;
  /** Exact gateway-owned sending mailbox, validated on every operation response. */
  senderMailbox: string;
  appDisplayName: string;
}

export interface EmailVerificationRequest {
  email: string;
  code: string;
  /** Immutable gateway effect identity; dot-only URL segments are excluded. Retain the same recipient, code, body and ID. */
  operationId: string;
}

export interface EmailVerificationAcknowledgement {
  provider: "agent_communications";
  accepted: true;
  /** Opaque gateway-owned immutable provider reference; restricted server data, not a delivery receipt. */
  messageId: string;
  operationId: string;
}

export interface EmailVerificationSender {
  /** Gateway/provider acceptance is not delivery or possession. No automatic transport retry. */
  send(request: EmailVerificationRequest): Promise<EmailVerificationAcknowledgement>;
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validEmail(value: unknown): value is string {
  return validText(value, 254) && /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/u.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invalidInput(configuration = false): never {
  throw new EmailVerificationDeliveryError("rejected", configuration ? "invalid_configuration" : "invalid_request");
}

function unknownOutcome(): never {
  throw new EmailVerificationDeliveryError("unknown", "delivery_outcome_unknown");
}

function gatewayOrigin(value: unknown): string {
  if (!validText(value, 2048) || /\s/u.test(value)) invalidInput(true);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) invalidInput(true);
    return url.origin;
  } catch {
    return invalidInput(true);
  }
}

async function readOperation(response: Response): Promise<unknown> {
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

type OperationResult = { kind: "accepted"; messageId: string } | { kind: "eligible_retry" };

function inspectMissingOperation(value: unknown): void {
  const envelope = record(value), error = record(envelope?.error);
  if (!error || error.code !== "not_found" || error.message !== "operation was not found"
    || !validText(error.request_id, 128) || !OPERATION_ID.test(error.request_id)) unknownOutcome();
}

function inspectOperation(value: unknown, operationId: string, senderMailbox: string, allowEligibleRetry: boolean): OperationResult {
  const operation = record(value);
  if (!operation || operation.operation_id !== operationId || operation.kind !== "mail.send" || operation.sender_mailbox !== senderMailbox) unknownOutcome();
  const accepted = (operation.state === "submitted" && operation.provider_status === "accepted")
    || (operation.state === "reconciled_sent" && operation.provider_status === "sent");
  if (accepted) {
    if (!validText(operation.provider_ref, 2048) || !/^[\u0021-\u007e]+$/u.test(operation.provider_ref)) unknownOutcome();
    return { kind: "accepted", messageId: operation.provider_ref };
  }
  const rejected = (operation.state === "failed" && (operation.provider_status === null || operation.provider_status === "not_found"))
    || (operation.state === "submission_failed" && operation.provider_status === "draft");
  if (rejected && validText(operation.last_error_code, 128)) {
    throw new EmailVerificationDeliveryError("rejected", "delivery_rejected");
  }
  if (allowEligibleRetry && operation.state === "admitted" && operation.provider_status === "not_found" && operation.provider_ref === null) {
    // The gateway durably claims creating_draft before provider I/O; admitted is a never-attempted stage, not a missing-marker inference.
    return { kind: "eligible_retry" };
  }
  if (allowEligibleRetry && operation.state === "deferred" && operation.provider_status === "throttled"
    && operation.last_error_code === "provider_throttled" && validText(operation.retry_after_at, 64)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(operation.retry_after_at)) {
    const eligibleAt = Date.parse(operation.retry_after_at);
    if (Number.isFinite(eligibleAt) && eligibleAt <= Date.now()) return { kind: "eligible_retry" };
  }
  // Draft creation/submission uncertainty, unexpired deferral and unreadable states cannot justify another send.
  return unknownOutcome();
}

/** Construction is offline. Graph/certificate custody and message reconciliation remain with the gateway. */
export function createAgentCommunicationsVerificationEmailSender(config: AgentCommunicationsVerificationEmailConfig): EmailVerificationSender {
  if (!config || !validText(config.bearerToken, 4096) || config.bearerToken.length < 32
    || !/^[\u0021-\u007e]+$/u.test(config.bearerToken) || !validEmail(config.senderMailbox) || !validText(config.appDisplayName, 100)) invalidInput(true);
  const origin = gatewayOrigin(config.gatewayBaseUrl);
  // Capture validated configuration before any caller mutation or network request.
  const { bearerToken, senderMailbox, appDisplayName } = config;
  return Object.freeze({
    async send(request: EmailVerificationRequest): Promise<EmailVerificationAcknowledgement> {
      if (!request || !validEmail(request.email) || !validText(request.code, 6) || !/^[0-9]{6}$/u.test(request.code)
        || !validText(request.operationId, 128) || !OPERATION_ID.test(request.operationId)
        || request.operationId === "." || request.operationId === "..") invalidInput();
      const { email, code, operationId } = request;
      const body = JSON.stringify({
        operation_id: operationId,
        to: [email],
        cc: [],
        subject: `Your ${appDisplayName} verification code`,
        body: `${appDisplayName} verification code: ${code}\n\nUse this code to verify your email address. Do not share it with anyone.\n\nIf you did not request this code, you can ignore this email.`,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const headers = { authorization: `Bearer ${bearerToken}`, accept: "application/json" };
      try {
        const observed = await fetch(`${origin}/v1/operations/${encodeURIComponent(operationId)}`, {
          method: "GET", redirect: "error", signal: controller.signal, headers,
        });
        if (observed.status === 404) {
          inspectMissingOperation(await readOperation(observed));
          // The gateway, not this client, serializes admission and reconciles retained provider markers before creating a draft.
        } else {
          if (!observed.ok) {
            void observed.body?.cancel().catch(() => undefined);
            unknownOutcome();
          }
          const state = inspectOperation(await readOperation(observed), operationId, senderMailbox, true);
          if (state.kind === "accepted") return { provider: "agent_communications", accepted: true, messageId: state.messageId, operationId };
          // Only a gateway-confirmed never-attempted stage or definite 429 with elapsed eligibility reaches this explicit retry.
        }
        const response = await fetch(`${origin}/v1/mail`, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { ...headers, "content-type": "application/json", "Idempotency-Key": operationId },
          body,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          // A rejected HTTP request cannot disprove a prior effect under this original operation identity.
          unknownOutcome();
        }
        const state = inspectOperation(await readOperation(response), operationId, senderMailbox, false);
        if (state.kind !== "accepted") unknownOutcome();
        return { provider: "agent_communications", accepted: true, messageId: state.messageId, operationId };
      } catch (error) {
        if (error instanceof EmailVerificationDeliveryError) throw error;
        return unknownOutcome();
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    },
  });
}
