export type WebMcpJsonValue =
  | null
  | boolean
  | number
  | string
  | { readonly [key: string]: WebMcpJsonValue }
  | readonly WebMcpJsonValue[];

export interface WebMcpToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

export interface WebMcpExecutionContext {
  readonly requestUserInteraction?: (...args: unknown[]) => unknown;
  readonly signal?: AbortSignal;
  readonly [key: string]: unknown;
}

export interface WebMcpToolDefinition<TResult extends WebMcpJsonValue = WebMcpJsonValue> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations?: WebMcpToolAnnotations;
  readonly execute: (input: unknown, context: WebMcpExecutionContext) => TResult | Promise<TResult>;
}

export interface WebMcpRegistrationOptions {
  readonly signal?: AbortSignal;
}

export interface WebMcpModelContext {
  registerTool<TResult extends WebMcpJsonValue>(
    tool: WebMcpToolDefinition<TResult>,
    options?: WebMcpRegistrationOptions
  ): Promise<void>;
}

export type WebMcpRegistrationResult =
  | { readonly status: "registered"; readonly toolName: string }
  | { readonly status: "unsupported" };

export type WebMcpCompatibilityProbeResult =
  | {
      readonly ok: true;
      readonly echoed: string;
      readonly visibleEffect: "probe_status_changed";
      readonly executionSignalAvailable: boolean;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_probe_input";
        readonly message: string;
        readonly retryable: false;
      };
    };

export const WEBMCP_COMPATIBILITY_PROBE_NAME = "life_links_webmcp_probe";

const WEBMCP_COMPATIBILITY_PROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: {
      type: "string",
      minLength: 1,
      maxLength: 80
    }
  },
  required: ["message"]
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProbeMessage(input: unknown): string | null {
  if (!isRecord(input) || Object.keys(input).length !== 1) {
    return null;
  }

  const message = input.message;
  return typeof message === "string" && message.length >= 1 && message.length <= 80 ? message : null;
}

function hasAbortSignal(value: unknown): value is AbortSignal {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.aborted === "boolean" && typeof value.addEventListener === "function";
}

export function getWebMcpModelContext(documentLike: object): WebMcpModelContext | null {
  const candidate = (documentLike as { readonly modelContext?: unknown }).modelContext;
  if (!isRecord(candidate) || typeof candidate.registerTool !== "function") {
    return null;
  }

  return candidate as unknown as WebMcpModelContext;
}

export function createWebMcpCompatibilityProbe(
  onVisibleEffect: (message: string) => void
): WebMcpToolDefinition<WebMcpCompatibilityProbeResult> {
  return {
    name: WEBMCP_COMPATIBILITY_PROBE_NAME,
    title: "Life Links WebMCP probe",
    description: "Temporarily prove direct page-tool registration, invocation, and visible page effects.",
    inputSchema: WEBMCP_COMPATIBILITY_PROBE_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true
    },
    execute: async (input, context) => {
      const message = parseProbeMessage(input);
      if (message === null) {
        return {
          ok: false,
          error: {
            code: "invalid_probe_input",
            message: "message must be the only input field and contain 1 to 80 characters.",
            retryable: false
          }
        };
      }

      onVisibleEffect(message);
      return {
        ok: true,
        echoed: message,
        visibleEffect: "probe_status_changed",
        executionSignalAvailable: hasAbortSignal(context.signal)
      };
    }
  };
}

export async function registerWebMcpCompatibilityProbe(
  documentLike: object,
  signal: AbortSignal,
  onVisibleEffect: (message: string) => void
): Promise<WebMcpRegistrationResult> {
  const modelContext = getWebMcpModelContext(documentLike);
  if (modelContext === null) {
    return { status: "unsupported" };
  }

  await modelContext.registerTool(createWebMcpCompatibilityProbe(onVisibleEffect), { signal });
  return { status: "registered", toolName: WEBMCP_COMPATIBILITY_PROBE_NAME };
}
