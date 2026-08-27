import { describe, expect, it, vi } from "vitest";
import {
  WEBMCP_COMPATIBILITY_PROBE_NAME,
  createWebMcpCompatibilityProbe,
  getWebMcpModelContext,
  registerWebMcpCompatibilityProbe,
  type WebMcpJsonValue,
  type WebMcpModelContext,
  type WebMcpRegistrationOptions,
  type WebMcpToolDefinition
} from "./webmcpCompatibility";

class ControlledModelContext implements WebMcpModelContext {
  readonly registrations: Array<{
    tool: WebMcpToolDefinition;
    options?: WebMcpRegistrationOptions;
  }> = [];

  readonly tools = new Map<string, WebMcpToolDefinition>();

  async registerTool<TResult extends WebMcpJsonValue>(
    tool: WebMcpToolDefinition<TResult>,
    options?: WebMcpRegistrationOptions
  ): Promise<void> {
    if (this.tools.has(tool.name)) {
      throw new Error("duplicate tool name");
    }

    this.registrations.push({ tool, options });
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      "abort",
      () => {
        this.tools.delete(tool.name);
      },
      { once: true }
    );
  }
}

describe("WebMCP compatibility contract", () => {
  it("feature-detects document.modelContext.registerTool without assuming global support", () => {
    expect(getWebMcpModelContext({})).toBeNull();
    expect(getWebMcpModelContext({ modelContext: {} })).toBeNull();

    const modelContext = new ControlledModelContext();
    expect(getWebMcpModelContext({ modelContext })).toBe(modelContext);
  });

  it("keeps unsupported browsers on the ordinary human path", async () => {
    const controller = new AbortController();
    const onVisibleEffect = vi.fn();

    await expect(registerWebMcpCompatibilityProbe({}, controller.signal, onVisibleEffect)).resolves.toEqual({
      status: "unsupported"
    });
    expect(onVisibleEffect).not.toHaveBeenCalled();
  });

  it("registers the exact narrow probe and preserves its annotations and lifecycle signal", async () => {
    const modelContext = new ControlledModelContext();
    const controller = new AbortController();

    await expect(
      registerWebMcpCompatibilityProbe({ modelContext }, controller.signal, vi.fn())
    ).resolves.toEqual({ status: "registered", toolName: WEBMCP_COMPATIBILITY_PROBE_NAME });

    expect(modelContext.registrations).toHaveLength(1);
    const registration = modelContext.registrations[0];
    expect(registration.options?.signal).toBe(controller.signal);
    expect(registration.tool).toMatchObject({
      name: "life_links_webmcp_probe",
      title: "Life Links WebMCP probe",
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"]
      }
    });
  });

  it("validates inputs in ordinary handler code before producing a visible effect", async () => {
    const onVisibleEffect = vi.fn();
    const tool = createWebMcpCompatibilityProbe(onVisibleEffect);

    await expect(tool.execute({}, {})).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_probe_input",
        message: "message must be the only input field and contain 1 to 80 characters.",
        retryable: false
      }
    });
    await expect(tool.execute({ message: "ok", extra: true }, {})).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_probe_input" }
    });
    await expect(tool.execute({ message: "x".repeat(81) }, {})).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_probe_input" }
    });
    expect(onVisibleEffect).not.toHaveBeenCalled();
  });

  it("returns a bounded structured result after the visible page effect", async () => {
    const onVisibleEffect = vi.fn();
    const tool = createWebMcpCompatibilityProbe(onVisibleEffect);

    await expect(tool.execute({ message: "visible success" }, { requestUserInteraction: vi.fn() })).resolves.toEqual({
      ok: true,
      echoed: "visible success",
      visibleEffect: "probe_status_changed",
      executionSignalAvailable: false
    });
    expect(onVisibleEffect).toHaveBeenCalledOnce();
    expect(onVisibleEffect).toHaveBeenCalledWith("visible success");
  });

  it("treats an execution signal as optional host capability", async () => {
    const tool = createWebMcpCompatibilityProbe(vi.fn());
    const executionController = new AbortController();

    await expect(tool.execute({ message: "signal check" }, { signal: executionController.signal })).resolves.toMatchObject({
      ok: true,
      executionSignalAvailable: true
    });
  });

  it("accepts the native Chrome callback shape with no execution context argument", async () => {
    const tool = createWebMcpCompatibilityProbe(vi.fn());

    await expect(tool.execute({ message: "native callback" })).resolves.toMatchObject({
      ok: true,
      executionSignalAvailable: false
    });
  });

  it("uses registration abort for catalog removal without assuming it cancels a captured invocation", async () => {
    const modelContext = new ControlledModelContext();
    const controller = new AbortController();
    const onVisibleEffect = vi.fn();

    await registerWebMcpCompatibilityProbe({ modelContext }, controller.signal, onVisibleEffect);
    const registeredTool = modelContext.tools.get(WEBMCP_COMPATIBILITY_PROBE_NAME);
    expect(registeredTool).toBeDefined();

    controller.abort(new DOMException("agent connection removed", "AbortError"));
    expect(modelContext.tools.has(WEBMCP_COMPATIBILITY_PROBE_NAME)).toBe(false);

    await expect(registeredTool!.execute({ message: "already running" }, {})).resolves.toMatchObject({
      ok: true,
      executionSignalAvailable: false
    });
  });

  it("rejects duplicate active names at the host boundary", async () => {
    const modelContext = new ControlledModelContext();
    const firstController = new AbortController();
    const secondController = new AbortController();

    await registerWebMcpCompatibilityProbe({ modelContext }, firstController.signal, vi.fn());
    await expect(
      registerWebMcpCompatibilityProbe({ modelContext }, secondController.signal, vi.fn())
    ).rejects.toThrow("duplicate tool name");
  });
});
