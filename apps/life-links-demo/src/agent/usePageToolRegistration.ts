import { useEffect, useRef, useState } from "react";
import {
  getBrowserWebMcpHost,
  LIFE_LINKS_PAGE_TOOL_NAMES,
  validateLifeLinksPageToolCatalog,
  type BrowserWebMcpHost,
  type LifeLinksPageToolName
} from "./browserWebMcpHost";
import type {
  WebMcpExecutionContext,
  WebMcpJsonValue,
  WebMcpToolDefinition
} from "../webmcpCompatibility";

export type LifeLinksAgentSurface = "owner-workspace" | "login" | "public-qr";

export interface PageToolEligibility {
  readonly authenticatedOwnerId: string | null;
  readonly surface: LifeLinksAgentSurface;
  readonly agentConnected: boolean;
}

export type PageToolRegistrationErrorCode =
  | "invalid_tool_catalog"
  | "duplicate_tool_name"
  | "registration_failed";

export type PageToolRegistrationStatus =
  | { readonly status: "inactive" }
  | {
      readonly status: "unsupported";
      readonly message: "WebMCP unavailable in this browser";
    }
  | {
      readonly status: "registering";
      readonly toolNames: readonly LifeLinksPageToolName[];
    }
  | {
      readonly status: "registered";
      readonly toolNames: readonly LifeLinksPageToolName[];
    }
  | {
      readonly status: "error";
      readonly error: {
        readonly code: PageToolRegistrationErrorCode;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

export interface PageToolRegistrationRequest {
  readonly documentLike: object | null | undefined;
  readonly eligibility: PageToolEligibility;
  readonly definitions: readonly WebMcpToolDefinition[];
}

export interface UsePageToolRegistrationOptions {
  readonly definitions: readonly WebMcpToolDefinition[];
  readonly eligibility: PageToolEligibility;
  readonly documentLike?: object | null;
}

const INACTIVE_STATUS: PageToolRegistrationStatus = { status: "inactive" };
const UNSUPPORTED_STATUS: PageToolRegistrationStatus = {
  status: "unsupported",
  message: "WebMCP unavailable in this browser"
};
const REGISTERING_STATUS: PageToolRegistrationStatus = {
  status: "registering",
  toolNames: LIFE_LINKS_PAGE_TOOL_NAMES
};
const REGISTERED_STATUS: PageToolRegistrationStatus = {
  status: "registered",
  toolNames: LIFE_LINKS_PAGE_TOOL_NAMES
};
const INVALID_CATALOG_STATUS: PageToolRegistrationStatus = {
  status: "error",
  error: {
    code: "invalid_tool_catalog",
    message: "The Life Links agent connection requires its complete tool catalog.",
    retryable: false
  }
};
const DUPLICATE_TOOL_STATUS: PageToolRegistrationStatus = {
  status: "error",
  error: {
    code: "duplicate_tool_name",
    message:
      "The saved agent connection could not start because a Life Links page tool is already registered.",
    retryable: true
  }
};
const REGISTRATION_FAILED_STATUS: PageToolRegistrationStatus = {
  status: "error",
  error: {
    code: "registration_failed",
    message: "The saved agent connection could not register its page tools in this browser.",
    retryable: true
  }
};

interface ActiveRegistration {
  readonly scopeKey: string;
  readonly modelContext: object;
  readonly controller: AbortController;
  readonly generation: number;
}

interface PendingRegistration extends ActiveRegistration {
  readonly completion: Promise<PageToolRegistrationStatus>;
}

interface FailedRegistration {
  readonly scopeKey: string;
  readonly modelContext: object;
  readonly status: PageToolRegistrationStatus;
}

function safeRegistrationError(error: unknown): PageToolRegistrationStatus {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
  const duplicate = errorMessage.includes("duplicate") && errorMessage.includes("tool");
  return duplicate ? DUPLICATE_TOOL_STATUS : REGISTRATION_FAILED_STATUS;
}

export function eligiblePageToolScopeKey(eligibility: PageToolEligibility): string | null {
  const ownerId = eligibility.authenticatedOwnerId?.trim();
  if (
    !eligibility.agentConnected ||
    eligibility.surface !== "owner-workspace" ||
    !ownerId
  ) {
    return null;
  }
  return `owner:${ownerId}`;
}

export function agentConnectionIsActive(
  connected: boolean,
  authenticatedOwnerId: string | null,
  surface: LifeLinksAgentSurface,
  guestView: boolean
): boolean {
  return Boolean(
    connected &&
      authenticatedOwnerId &&
      surface === "owner-workspace" &&
      !guestView
  );
}

export class PageToolRegistrationLifecycle {
  private status: PageToolRegistrationStatus = INACTIVE_STATUS;
  private generation = 0;
  private active: ActiveRegistration | null = null;
  private pending: PendingRegistration | null = null;
  private failed: FailedRegistration | null = null;
  private definitionsByName = new Map<string, WebMcpToolDefinition>();

  getStatus(): PageToolRegistrationStatus {
    return this.status;
  }

  async synchronize(request: PageToolRegistrationRequest): Promise<PageToolRegistrationStatus> {
    const catalog = validateLifeLinksPageToolCatalog(request.definitions);
    if (!catalog.ok) {
      this.stopRegistrations();
      this.status = INVALID_CATALOG_STATUS;
      return this.status;
    }

    this.definitionsByName = new Map(
      catalog.definitions.map((definition) => [definition.name, definition])
    );

    const scopeKey = eligiblePageToolScopeKey(request.eligibility);
    if (scopeKey === null) {
      this.stopRegistrations();
      this.status = INACTIVE_STATUS;
      return this.status;
    }

    const resolution = getBrowserWebMcpHost(request.documentLike);
    if (resolution.status === "unsupported") {
      this.stopRegistrations();
      this.status = UNSUPPORTED_STATUS;
      return this.status;
    }

    if (
      this.failed?.scopeKey === scopeKey &&
      this.failed.modelContext === resolution.host.modelContext
    ) {
      return this.failed.status;
    }

    if (this.matches(this.active, scopeKey, resolution.host)) {
      return this.status;
    }
    if (this.matches(this.pending, scopeKey, resolution.host)) {
      return this.pending!.completion;
    }

    this.stopRegistrations();
    const generation = ++this.generation;
    const controller = new AbortController();
    const liveDefinitions = catalog.definitions.map((definition) =>
      this.createLiveDefinition(definition, generation, controller)
    );

    this.status = REGISTERING_STATUS;
    const pendingBase = {
      scopeKey,
      modelContext: resolution.host.modelContext,
      controller,
      generation
    };
    const completion = Promise.resolve()
      .then(() => resolution.host.registerCatalog(liveDefinitions, controller.signal))
      .then(() => {
        if (!this.isCurrentPending(generation, controller) || controller.signal.aborted) {
          return this.status;
        }
        this.active = pendingBase;
        this.pending = null;
        this.status = REGISTERED_STATUS;
        return this.status;
      })
      .catch((error: unknown) => {
        if (!this.isCurrentPending(generation, controller)) {
          return this.status;
        }
        controller.abort(new DOMException("page tool registration failed", "AbortError"));
        this.pending = null;
        this.status = safeRegistrationError(error);
        this.failed = {
          scopeKey,
          modelContext: resolution.host.modelContext,
          status: this.status
        };
        return this.status;
      });

    this.pending = { ...pendingBase, completion };
    return completion;
  }

  deactivate(): PageToolRegistrationStatus {
    this.stopRegistrations();
    this.status = INACTIVE_STATUS;
    return this.status;
  }

  dispose(): void {
    this.deactivate();
    this.definitionsByName.clear();
  }

  private matches(
    registration: ActiveRegistration | PendingRegistration | null,
    scopeKey: string,
    host: BrowserWebMcpHost
  ): boolean {
    return Boolean(
      registration &&
        !registration.controller.signal.aborted &&
        registration.scopeKey === scopeKey &&
        registration.modelContext === host.modelContext
    );
  }

  private stopRegistrations(): void {
    this.generation += 1;
    this.pending?.controller.abort(
      new DOMException("page tool eligibility changed", "AbortError")
    );
    this.active?.controller.abort(
      new DOMException("page tool eligibility changed", "AbortError")
    );
    this.pending = null;
    this.active = null;
    this.failed = null;
  }

  private isCurrentPending(generation: number, controller: AbortController): boolean {
    return (
      this.pending?.generation === generation && this.pending.controller === controller
    );
  }

  private createLiveDefinition(
    definition: WebMcpToolDefinition,
    generation: number,
    registrationController: AbortController
  ): WebMcpToolDefinition {
    return {
      ...definition,
      execute: async (
        input: unknown,
        context?: WebMcpExecutionContext
      ): Promise<WebMcpJsonValue> => {
        if (!this.isActiveRegistration(generation, registrationController)) {
          throw new Error("Life Links page tool is not active.");
        }
        const currentDefinition = this.definitionsByName.get(definition.name);
        if (!currentDefinition) {
          throw new Error("Life Links page tool is no longer active.");
        }
        const execution = bindExecutionToRegistration(
          context,
          registrationController.signal
        );
        try {
          return await currentDefinition.execute(input, execution.context);
        } finally {
          execution.dispose();
        }
      }
    };
  }

  private isActiveRegistration(
    generation: number,
    controller: AbortController
  ): boolean {
    return Boolean(
      this.active?.generation === generation &&
        this.active.controller === controller &&
        !controller.signal.aborted
    );
  }
}

function bindExecutionToRegistration(
  hostContext: WebMcpExecutionContext | undefined,
  registrationSignal: AbortSignal
): { readonly context: WebMcpExecutionContext; dispose(): void } {
  const context = hostContext ?? {};
  const hostSignal = context.signal;
  if (!hostSignal || hostSignal === registrationSignal) {
    return {
      context: { ...context, signal: registrationSignal },
      dispose: () => undefined
    };
  }

  const controller = new AbortController();
  const abortFromRegistration = () => abortFrom(registrationSignal, controller);
  const abortFromHost = () => abortFrom(hostSignal, controller);
  if (registrationSignal.aborted) {
    abortFromRegistration();
  } else {
    registrationSignal.addEventListener("abort", abortFromRegistration, { once: true });
  }
  if (hostSignal.aborted) {
    abortFromHost();
  } else {
    hostSignal.addEventListener("abort", abortFromHost, { once: true });
  }

  return {
    context: { ...context, signal: controller.signal },
    dispose: () => {
      registrationSignal.removeEventListener("abort", abortFromRegistration);
      hostSignal.removeEventListener("abort", abortFromHost);
    }
  };
}

function abortFrom(source: AbortSignal, controller: AbortController) {
  if (!controller.signal.aborted) {
    controller.abort(source.reason);
  }
}

function defaultDocumentLike(): object | null {
  return typeof document === "undefined" ? null : document;
}

export function usePageToolRegistration({
  definitions,
  eligibility,
  documentLike = defaultDocumentLike()
}: UsePageToolRegistrationOptions): PageToolRegistrationStatus {
  const lifecycleRef = useRef<PageToolRegistrationLifecycle | null>(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = new PageToolRegistrationLifecycle();
  }
  const lifecycle = lifecycleRef.current;
  const [status, setStatus] = useState<PageToolRegistrationStatus>(() =>
    lifecycle.getStatus()
  );
  const scopeKey = eligiblePageToolScopeKey(eligibility);
  const hostResolution = getBrowserWebMcpHost(documentLike);
  const hostIdentity =
    hostResolution.status === "supported" ? hostResolution.host.modelContext : null;

  useEffect(
    () => () => {
      lifecycle.deactivate();
    },
    [lifecycle, documentLike, hostIdentity, scopeKey]
  );

  useEffect(() => {
    let acceptsResult = true;
    const completion = lifecycle.synchronize({
      documentLike,
      eligibility,
      definitions
    });
    setStatus(lifecycle.getStatus());
    void completion.then((nextStatus) => {
      if (acceptsResult) {
        setStatus(nextStatus);
      }
    });
    return () => {
      acceptsResult = false;
    };
  }, [
    definitions,
    documentLike,
    eligibility.agentConnected,
    eligibility.authenticatedOwnerId,
    eligibility.surface,
    hostIdentity,
    lifecycle
  ]);

  return status;
}
