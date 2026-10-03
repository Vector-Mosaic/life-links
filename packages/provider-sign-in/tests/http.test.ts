import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postFormEmpty, requestJson } from "../src/http.js";

const fetchMock = vi.fn<typeof fetch>();
const endpoint = "https://appleid.apple.com/auth/revoke";
const form = new URLSearchParams({ token: "restricted-test-token" });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded provider response transport", () => {
  it("preserves ordinary JSON and optional-status behavior while rejecting empty JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"accepted":true}', { status: 200 }));
    expect(await requestJson(endpoint)).toMatchObject({ status: 200, body: { accepted: true } });
    fetchMock.mockResolvedValueOnce(new Response("not JSON", { status: 403 }));
    expect(await requestJson(endpoint, {}, [403])).toEqual({ status: 403, body: null, headers: {} });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(requestJson(endpoint)).rejects.toMatchObject({ code: "sign_in_failed" });
  });

  it.each(["headers", "body"] as const)("aborts stalled %s under one ten-second deadline without retry", async (stage) => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = init!.signal!;
      if (stage === "headers") return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("restricted-test-token")), { once: true });
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { signal.addEventListener("abort", () => controller.error(new Error("restricted-test-token")), { once: true }); },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    const pending = postFormEmpty(endpoint, form);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({ code: "revocation_failed", message: "Provider authorization could not be revoked." });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
