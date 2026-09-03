import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIRMATION_APP_HTML } from "../../../../services/life-links-api/src/remote-confirmation-app.js";

const views: JSDOM[] = [];
afterEach(() => { for (const view of views.splice(0)) view.window.close(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function view() {
  const sent: Array<{ id?: string; method?: string; params?: any }> = [];
  const parent = { postMessage(message: any) { sent.push(message); } };
  const dom = new JSDOM(CONFIRMATION_APP_HTML, { runScripts: "dangerously", beforeParse(window) {
    Object.defineProperty(window, "parent", { value: parent });
    Object.defineProperty(window, "ResizeObserver", { value: class { observe() {} disconnect() {} } });
  } });
  views.push(dom);
  const document = dom.window.document;
  const receive = (data: unknown, source: unknown = parent) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: source as Window, data }));
  const notify = (method: string, params: any, source?: unknown) => receive({ jsonrpc: "2.0", method, params }, source);
  const respond = (id: string, result: any) => receive({ jsonrpc: "2.0", id, result });
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const ready = async () => {
    respond(sent[0].id!, { protocolVersion: "2026-01-26", hostCapabilities: { serverTools: {} }, hostContext: { theme: "dark" } });
    await flush();
  };
  const preview = (overrides: Record<string, unknown> = {}) => ({
    structuredContent: { ok: true, status: "awaiting_confirmation", previewId: "preview-one", expiresAt: new Date(Date.now() + 600000).toISOString(),
      effects: { operation: "delete", records: [{ id: "synthetic-one", title: "<img src=x onerror=alert(1)>" }] }, ...overrides },
    _meta: { lifeLinksConfirmation: { previewId: "preview-one", challenge: "a".repeat(43) } }, content: []
  });
  const show = (result = preview()) => {
    notify("ui/notifications/tool-input", { arguments: { previewId: "preview-one" } });
    notify("ui/notifications/tool-result", result);
  };
  return { dom, document, sent, receive, notify, respond, button, ready, preview, show,
    calls: () => sent.filter(item => item.method === "tools/call") };
}

describe("static MCP Apps deletion confirmation", () => {
  it("negotiates the standard bridge, shows complete effects as inert text and never auto-approves", async () => {
    const ui = view();
    expect(ui.sent).toHaveLength(1);
    expect(ui.sent[0].method).toBe("ui/initialize");
    expect(ui.button("accept").disabled).toBe(true);
    await ui.ready();
    expect(ui.sent[1].method).toBe("ui/notifications/initialized");
    ui.show();
    expect(ui.calls()).toEqual([]);
    expect(ui.document.getElementById("effects")!.textContent).toBe(JSON.stringify(ui.preview().structuredContent.effects, null, 2));
    expect(ui.document.querySelector("img")).toBeNull();
    expect(ui.document.documentElement.innerHTML).not.toContain("a".repeat(43));
    expect(ui.document.body.textContent).not.toContain("a".repeat(43));
    expect(ui.button("accept").disabled).toBe(false);
  });

  it("submits only the bound proof after a click, suppresses double clicks, and reports the saved receipt without leaking proof", async () => {
    const ui = view(); await ui.ready(); ui.show();
    ui.button("accept").click(); ui.button("accept").click();
    expect(ui.calls()).toHaveLength(1);
    expect(ui.calls()[0].params).toEqual({ name: "confirm_change", arguments: { previewId: "preview-one", challenge: "a".repeat(43), decision: "accept" } });
    ui.respond(ui.calls()[0].id!, { structuredContent: { ok: true, data: { previewId: "preview-one", status: "applied", result: { affectedIds: ["synthetic-one"] } } } });
    await flush();
    expect(ui.document.getElementById("status")!.textContent).toContain("Change completed");
    expect(ui.button("accept").disabled).toBe(true);
    const context = ui.sent.find(item => item.method === "ui/update-model-context")!;
    expect(context.params).toEqual({ structuredContent: { lifeLinksChange: { previewId: "preview-one", status: "applied" } } });
    expect(JSON.stringify(context)).not.toContain("a".repeat(43));
    ui.show(); ui.button("accept").click();
    expect(ui.calls()).toHaveLength(1);
  });

  it("sends cancel rather than approval and freezes the cancelled receipt", async () => {
    const ui = view(); await ui.ready(); ui.show(); ui.button("cancel").click();
    expect(ui.calls()[0].params.arguments.decision).toBe("cancel");
    ui.respond(ui.calls()[0].id!, { structuredContent: { ok: true, data: { previewId: "preview-one", status: "cancelled" } } });
    await flush();
    expect(ui.document.getElementById("status")!.textContent).toContain("Cancelled");
    ui.show(); expect(ui.button("accept").disabled).toBe(true);
  });

  it("does not label a direct move or already-applied receipt as a deletion", async () => {
    const ui = view(); await ui.ready();
    ui.notify("ui/notifications/tool-input", { arguments: { previewId: "preview-one" } });
    ui.notify("ui/notifications/tool-result", { structuredContent: { contentIsUntrusted: true,
      data: { previewId: "preview-one", status: "applied", result: { operation: "move" } } } });
    expect(ui.document.getElementById("heading")!.textContent).toBe("Life Links change");
    expect(ui.document.getElementById("status")!.textContent).toBe("Change completed. Life Links saved the result.");
    expect(ui.button("accept").disabled).toBe(true); expect(ui.calls()).toEqual([]);
  });

  it("refuses expired, missing-proof and mismatched preview deliveries without submitting", async () => {
    const expired = view(); await expired.ready(); expired.show(expired.preview({ expiresAt: new Date(Date.now() - 1).toISOString() }));
    expect(expired.button("accept").disabled).toBe(true);
    expect(expired.document.getElementById("status")!.textContent).toContain("expired");
    const missing = view(); await missing.ready(); const noProof = missing.preview(); delete (noProof as any)._meta; missing.show(noProof);
    expect(missing.button("accept").disabled).toBe(true);
    const mismatch = view(); await mismatch.ready(); mismatch.show(mismatch.preview({ previewId: "another-preview" }));
    expect(mismatch.button("accept").disabled).toBe(true);
    expect([...expired.calls(), ...missing.calls(), ...mismatch.calls()]).toEqual([]);
  });

  it("ignores non-parent frames, early results, partial inputs, and model-supplied approval fields", async () => {
    const ui = view(); ui.show(); expect(ui.button("accept").disabled).toBe(true);
    await ui.ready();
    ui.notify("ui/notifications/tool-input-partial", { arguments: { previewId: "preview-one", approved: true } });
    ui.notify("ui/notifications/tool-result", ui.preview(), {});
    expect(ui.button("accept").disabled).toBe(true);
    ui.show(); expect(ui.calls()).toEqual([]);
    ui.notify("ui/notifications/tool-input", { arguments: { previewId: "another-preview", approved: true } });
    ui.show(); expect(ui.button("accept").disabled).toBe(true);
    expect(ui.calls()).toEqual([]);
  });

  it("does not re-enable a cancelled tool from a late pending delivery", async () => {
    const ui = view(); await ui.ready(); ui.show();
    ui.notify("ui/notifications/tool-cancelled", { reason: "User cancelled" });
    ui.show(); ui.button("accept").click();
    expect(ui.button("accept").disabled).toBe(true); expect(ui.calls()).toEqual([]);
  });

  it("does not claim completion or retry automatically on an error or partial result", async () => {
    const ui = view(); await ui.ready(); ui.show(); ui.button("accept").click();
    ui.respond(ui.calls()[0].id!, { isError: true, structuredContent: { ok: false, code: "stale_calendar_event" } });
    await flush();
    expect(ui.document.getElementById("status")!.textContent).toContain("do not assume");
    expect(ui.button("accept").disabled).toBe(true); expect(ui.calls()).toHaveLength(1);
    const partial = view(); await partial.ready(); partial.show(); partial.button("accept").click();
    partial.respond(partial.calls()[0].id!, { structuredContent: { ok: true, data: { previewId: "preview-one", status: "partial", removedIds: ["one"], remainingIds: ["two"] } } });
    await flush();
    expect(partial.document.getElementById("status")!.textContent).toContain("Only part");
    expect(partial.button("accept").disabled).toBe(true); expect(partial.calls()).toHaveLength(1);
  });

  it("requires negotiated host tools and disables a torn-down view", async () => {
    const unsupported = view();
    unsupported.respond(unsupported.sent[0].id!, { protocolVersion: "2026-01-26", hostCapabilities: {} });
    await flush(); unsupported.show(); expect(unsupported.button("accept").disabled).toBe(true);
    const ui = view(); await ui.ready(); ui.show();
    ui.receive({ jsonrpc: "2.0", id: "teardown", method: "ui/resource-teardown", params: {} });
    ui.button("accept").click(); expect(ui.calls()).toEqual([]);
    expect(ui.sent.at(-1)).toEqual({ jsonrpc: "2.0", id: "teardown", result: {} });
  });
});
