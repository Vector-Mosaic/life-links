// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitePeopleDialog } from "./InvitePeopleDialog";
import { cancelAccountInvitation, createAccountInvitation, listAccountInvitations } from "../api";

vi.mock("../api", () => ({ cancelAccountInvitation: vi.fn(), createAccountInvitation: vi.fn(), listAccountInvitations: vi.fn() }));

describe("Invite people", () => {
  let container: HTMLDivElement;
  let root: Root;
  const code = "synthetic_invitation_".padEnd(43, "x");
  const invitation = { id: "synthetic-invitation-id", createdAt: "2026-10-01T12:00:00.000Z",
    expiresAt: "2099-10-08T12:00:00.000Z", revokedAt: null, redeemedAt: null };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(listAccountInvitations).mockReset().mockResolvedValue({ enabled: true, invitations: [] });
    vi.mocked(createAccountInvitation).mockReset().mockResolvedValue({ invitation, invitationCode: code });
    vi.mocked(cancelAccountInvitation).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render() { await act(async () => root.render(<InvitePeopleDialog onClose={() => {}} />)); }
  function button(text: string) { return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!; }
  async function click(text: string) { await act(async () => button(text).click()); }

  it("only creates on request and copies a fragment link while keeping records private", async () => {
    await render();
    expect(createAccountInvitation).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Your records, agent connections, and calendars stay private.");
    await click("Create invitation link");
    const input = document.body.querySelector<HTMLInputElement>("input")!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(`${window.location.origin}/register#invite=${code}`);
    await click("Copy link");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value);
    expect(document.body.textContent).toContain("Copied!");
    vi.mocked(listAccountInvitations).mockResolvedValue({ enabled: true, invitations: [{ ...invitation, revokedAt: new Date().toISOString() }] });
    await click("Cancel invitation");
    expect(cancelAccountInvitation).toHaveBeenCalledWith(invitation.id);
    expect(document.body.querySelector("input")).toBeNull();
    expect(document.body.textContent).toContain("Cancelled");
  });

  it("offers manual copying when the clipboard is unavailable", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("unavailable"));
    await render(); await click("Create invitation link"); await click("Copy link");
    expect(document.body.querySelector("[role=alert]")?.textContent).toBe("Select and copy the invitation link below.");
    expect(document.body.querySelector<HTMLInputElement>("input")!.selectionEnd).toBe(document.body.querySelector<HTMLInputElement>("input")!.value.length);
  });

  it("reconciles an uncertain create without automatically creating another invitation", async () => {
    vi.mocked(createAccountInvitation).mockRejectedValue(new Error("lost response"));
    vi.mocked(listAccountInvitations).mockResolvedValueOnce({ enabled: true, invitations: [] })
      .mockResolvedValue({ enabled: true, invitations: [invitation] });
    await render(); await click("Create invitation link");
    expect(createAccountInvitation).toHaveBeenCalledTimes(1);
    expect(listAccountInvitations).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Check the list before creating another.");
    expect(button("Cancel invitation")).toBeDefined();
    expect(document.body.querySelector("input")).toBeNull();
  });
});
