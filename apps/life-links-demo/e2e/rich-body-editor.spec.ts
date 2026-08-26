import { expect, test, type Locator, type Page } from "@playwright/test";

import { createLinkBodyDocFromPlainText, type LinkBodyDoc, type LinkRecord, type ProjectRecord, type UserRecord } from "@life-links/core";

const owner: Pick<UserRecord, "id" | "email" | "displayName" | "createdAt"> = {
  id: "demo-owner",
  email: "owner@life-links.test",
  displayName: "Demo Owner",
  createdAt: "2026-05-01T00:00:00.000Z"
};

const project: ProjectRecord = {
  id: "rich-project",
  ownerId: owner.id,
  name: "Rich Notes",
  createdAt: "2026-05-01T00:00:00.000Z"
};

test.describe("local rich body editor", () => {
  test("saves slash-command block content and renders it after save", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();

    await page.locator(".link-row").filter({ hasText: state.link.title }).click();
    await expect(page.locator(".public-content")).toContainText("Plain starting body");

    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("/hea");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await page.locator(".slash-command-menu").getByRole("option", { name: /Heading 1/ }).click();
    await page.keyboard.type("Install notes");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Preserve line one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/bul");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await page.locator(".slash-command-menu").getByRole("option", { name: /Bullet list/ }).click();
    await page.keyboard.type("First bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second bullet");

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/links/LL-RICH-00001") && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastPatch?.body).toContain("Install notes");
    expect(state.lastPatch?.body).toContain("First bullet");
    expect(state.lastPatch?.bodyDocVersion).toBe(1);
    expect(hasNodeType(state.lastPatch?.bodyDoc, "heading")).toBe(true);
    expect(hasNodeType(state.lastPatch?.bodyDoc, "bulletList")).toBe(true);

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Install notes" })).toBeVisible();
    await expect(page.locator(".public-content .body-list")).toContainText("First bullet");
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.locator(".link-row").filter({ hasText: "Install notes" })).toBeVisible();
  });

  test("formats selected text and edits links from the selection bubble", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await page.locator(".link-row").filter({ hasText: state.link.title }).click();
    await page.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    const editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Client portal");
    await page.keyboard.press("ControlOrMeta+A");

    const bubble = page.locator(".selection-bubble-menu");
    await expect(bubble).toBeVisible();
    await editor.click({ position: { x: 24, y: 160 } });
    await expect(bubble).toBeHidden();
    await page.keyboard.press("ControlOrMeta+A");
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "Bold" }).click();
    await bubble.getByRole("button", { name: "Link", exact: true }).click();

    const linkInput = bubble.getByLabel("Link URL");
    await expect(linkInput).toBeVisible();
    await linkInput.fill("client.example.com");
    await bubble.getByRole("button", { name: "Apply link" }).click();

    await page.keyboard.press("ControlOrMeta+A");
    await bubble.getByRole("button", { name: "Link", exact: true }).click();
    await expect(linkInput).toHaveValue("https://client.example.com");
    await linkInput.fill("portal.example.com");
    await bubble.getByRole("button", { name: "Apply link" }).click();

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/links/LL-RICH-00001") && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastPatch?.body).toContain("Client portal");
    expect(hasMarkType(state.lastPatch?.bodyDoc, "bold")).toBe(true);
    expect(hasMarkType(state.lastPatch?.bodyDoc, "link")).toBe(true);
    expect(JSON.stringify(state.lastPatch?.bodyDoc)).toContain("https://portal.example.com");

    await expect(dialog).toBeHidden();
    await expect(page.locator('.public-content .formatted-body a[href="https://portal.example.com"]')).toContainText("Client portal");
    await expect(page.locator(".public-content .formatted-body strong")).toContainText("Client portal");
  });

  test("recovers unsaved drafts and cleans pasted rich links", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await page.locator(".link-row").filter({ hasText: state.link.title }).click();
    await page.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    let editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await pasteHtml(
      editor,
      '<p><a href="javascript:alert(1)">Bad link</a> and <a href="https://safe.example.test/path">Safe link</a><script>window.bad = true</script></p>'
    );
    await expect(editor).toContainText("Safe link");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-link-editor-draft-v1:LL-RICH-00001") ?? ""))
      .toContain("Safe link");

    await dialog.getByRole("button", { name: "Close editor" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Draft recovered from this browser.")).toBeVisible();
    editor = page.getByRole("dialog").locator(".rich-body-editor-surface");
    await expect(editor).toContainText("Safe link");

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/links/LL-RICH-00001") && response.request().method() === "PATCH";
    });
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(JSON.stringify(state.lastPatch?.bodyDoc)).toContain("https://safe.example.test/path");
    expect(JSON.stringify(state.lastPatch?.bodyDoc)).not.toContain("javascript:");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-link-editor-draft-v1:LL-RICH-00001")))
      .toBeNull();
  });
});

async function mockLifeLinksApi(page: Page, baseURL: string) {
  const now = "2026-05-07T12:00:00.000Z";
  const state: {
    link: LinkRecord;
    lastPatch: Partial<LinkRecord> | null;
  } = {
    link: {
      id: "LL-RICH-00001",
      url: new URL("/qr/LL-RICH-00001", baseURL).toString(),
      status: "claimed",
      ownerId: owner.id,
      title: "Rich body field test",
      body: "Plain starting body",
      bodyDoc: createLinkBodyDocFromPlainText("Plain starting body"),
      bodyDocVersion: 1,
      projectId: project.id,
      privacy: "public",
      media: [],
      createdAt: now,
      updatedAt: now
    },
    lastPatch: null
  };

  await page.route("**/api/config", async (route) => {
    await route.fulfill({ json: { qrBaseUrl: baseURL, maxBatchCount: 10000 } });
  });
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { user: owner, qrBaseUrl: baseURL } });
  });
  await page.route("**/api/links", async (route) => {
    await route.fulfill({ json: { links: [state.link] } });
  });
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({ json: { projects: [project] } });
  });
  await page.route("**/api/qr/LL-RICH-00001", async (route) => {
    await route.fulfill({ json: { state: "claimed", link: state.link, viewerIsOwner: true } });
  });
  await page.route("**/api/links/LL-RICH-00001", async (route) => {
    const patch = route.request().postDataJSON() as Partial<LinkRecord>;
    state.lastPatch = patch;
    state.link = {
      ...state.link,
      ...patch,
      bodyDoc: patch.bodyDoc ?? state.link.bodyDoc,
      bodyDocVersion: patch.bodyDocVersion ?? state.link.bodyDocVersion,
      updatedAt: new Date(now).toISOString()
    };
    await route.fulfill({ json: { link: state.link } });
  });

  return state;
}

function hasNodeType(doc: LinkBodyDoc | null | undefined, type: string): boolean {
  return Boolean(
    doc?.content?.some((node) => {
      if (node.type === type) {
        return true;
      }
      return hasNodeType({ type: "doc", content: node.content }, type);
    })
  );
}

function hasMarkType(doc: LinkBodyDoc | null | undefined, type: string): boolean {
  return Boolean(
    doc?.content?.some((node) => {
      if (node.marks?.some((mark) => mark.type === type)) {
        return true;
      }
      return hasMarkType({ type: "doc", content: node.content }, type);
    })
  );
}

async function pasteHtml(locator: Locator, html: string) {
  await locator.evaluate((element, pastedHtml) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", pastedHtml);
    clipboardData.setData("text/plain", pastedHtml.replace(/<[^>]+>/g, " "));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, html);
}
