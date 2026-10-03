// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { AccountDeletionDialog, AccountDeletionPage } from "./AccountDeletionDialog";

const removeAccount = vi.hoisted(() => vi.fn());
vi.mock("../api", async importOriginal => ({ ...await importOriginal<typeof import("../api")>(), deleteAccount: removeAccount }));

describe("human account deletion", () => {
  let root: Root; let host: HTMLDivElement;
  let deleted: ReturnType<typeof vi.fn>; let close: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    removeAccount.mockReset(); deleted = vi.fn().mockResolvedValue(undefined); close = vi.fn();
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<AccountDeletionDialog user={{ id: "owner", email: "owner@example.test", displayName: "Owner", createdAt: "2026-01-01" }} onClose={close} onDeleted={deleted} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  function dialog() {
    // The shared Dialog portals into document.body, outside the root host.
    const element = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(element).not.toBeNull();
    return element!;
  }
  async function confirm(value: string) {
    const input = dialog().querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function submit() { await act(async () => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

  it("requires exact human confirmation and cancellation never deletes", async () => {
    await confirm("delete"); await submit();
    expect(removeAccount).not.toHaveBeenCalled();
    const cancel = [...dialog().querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
    await act(async () => cancel.click());
    expect(close).toHaveBeenCalledOnce(); expect(removeAccount).not.toHaveBeenCalled();
  });
  it("retains the authenticated workspace when calendar cleanup needs a retry", async () => {
    removeAccount.mockRejectedValue(new ApiError(409, "account_deletion_pending", { reason: "calendar_cleanup_pending" }));
    await confirm("DELETE"); await submit();
    expect(removeAccount).toHaveBeenCalledOnce(); expect(deleted).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Your account has not been deleted");
    expect(dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
  it("closes sessions only after confirmed local deletion and preserves Apple revocation notice", async () => {
    removeAccount.mockResolvedValue({ status: "deleted", appleRevocation: "manual_required" });
    await confirm("DELETE"); await submit();
    expect(removeAccount).toHaveBeenCalledOnce(); expect(deleted).toHaveBeenCalledOnce();
    expect(dialog().textContent).toContain("Account deleted");
    expect(dialog().textContent).toContain("remove LifeLinks under Sign in with Apple");
  });
  it("retires the old deletion result when another owner signs in", async () => {
    const user = { id: "owner", email: "owner@example.test", displayName: "Owner", createdAt: "2026-01-01" };
    await act(async () => root.render(<AccountDeletionPage user={user} onDeleted={deleted} />));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Delete my account")!.click());
    removeAccount.mockResolvedValue({ status: "deleted", appleRevocation: "not_required" });
    await confirm("DELETE"); await submit();
    await act(async () => root.render(<AccountDeletionPage user={null} onDeleted={deleted} />));
    expect(host.textContent).toContain("have been deleted");
    await act(async () => root.render(<AccountDeletionPage user={{ ...user, id: "next-owner", email: "next@example.test" }} onDeleted={deleted} />));
    expect(host.textContent).toContain("next@example.test");
    expect([...host.querySelectorAll("button")].some(button => button.textContent === "Delete my account")).toBe(true);
    expect(host.textContent).not.toContain("have been deleted");
  });
});
