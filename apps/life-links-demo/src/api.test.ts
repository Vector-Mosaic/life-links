import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, attachQr, connectAgent, disconnectAgent, login, updateLifeLink } from "./api";

describe("Life Links API error normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes legacy string error envelopes", async () => {
    const body = { error: "invalid_credentials" };
    stubJsonResponse(401, body);

    const error = await rejectedApiError(login("owner@example.test", "wrong"));

    expect(error).toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "Invalid credentials.",
      retryable: false,
      reason: undefined,
      body
    });
  });

  it("normalizes canonical structured errors with bounded metadata", async () => {
    const body = {
      error: {
        code: "stale_life_link",
        message: "Life Link changed after it was read.",
        retryable: true,
        reason: "expected_updated_at_mismatch"
      }
    };
    stubJsonResponse(409, body);

    const error = await rejectedApiError(updateLifeLink(
      "life-link-1",
      "2026-08-25T00:00:00.000Z",
      { title: "Fresh title" }
    ));

    expect(error).toMatchObject({
      status: 409,
      code: "stale_life_link",
      message: "Life Link changed after it was read.",
      retryable: true,
      reason: "expected_updated_at_mismatch",
      body
    });
  });

  it("normalizes the claim cross-owner outcome into a stable ApiError", async () => {
    const body = {
      result: "owned_by_other",
      state: { state: "private", qrId: "LL-DEMO-00001" }
    };
    stubJsonResponse(409, body);

    const error = await rejectedApiError(attachQr(
      "LL-DEMO-00001",
      "life-link-1",
      "attach-command-1"
    ));

    expect(error).toMatchObject({
      status: 409,
      code: "owned_by_other",
      message: "That QR code is already claimed by another account.",
      retryable: false,
      reason: undefined,
      body
    });
  });

  it("preserves successful attach decoding and request shape", async () => {
    const body = {
      result: "already_owned",
      state: { state: "claimed", link: { id: "LL-DEMO-00001" }, viewerIsOwner: true }
    };
    const fetchMock = stubJsonResponse(200, body);

    await expect(attachQr("LL-DEMO-00001", "life-link-1", "attach-command-1")).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/qr/LL-DEMO-00001/claim", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        commandId: "attach-command-1",
        mode: "attach",
        lifeLinkId: "life-link-1"
      })
    });
  });

  it("connects and disconnects through the one durable agent-connection resource", async () => {
    const connected = {
      agentConnection: {
        connected: true,
        connectedAt: "2026-08-27T21:00:00.000Z"
      }
    };
    const disconnected = {
      agentConnection: {
        connected: false,
        connectedAt: null
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, connected))
      .mockResolvedValueOnce(jsonResponse(200, disconnected));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAgent()).resolves.toEqual(connected);
    await expect(disconnectAgent()).resolves.toEqual(disconnected);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/agent-connection", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agent-connection", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "DELETE"
    });
  });
});

function stubJsonResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => jsonResponse(status, body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function rejectedApiError(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Expected API request to reject");
}
