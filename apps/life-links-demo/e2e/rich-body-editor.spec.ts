import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createLinkBodyDocFromPlainText,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkBodyDoc,
  type LinkRecord,
  type ProjectRecord,
  type UserRecord
} from "@life-links/core";

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
  test("keeps QR selection synchronized with browser back and forward", async ({ baseURL, page }) => {
    const publicTitle = "Fresh public QR response";
    const state = await mockLifeLinksApi(
      page,
      baseURL ?? "http://127.0.0.1:4174",
      { publicTitle }
    );

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await page.locator(".link-row").filter({ hasText: state.link.title }).click();
    await expect(page).toHaveURL(new RegExp(`/qr/${state.link.id}$`));
    await expect(page.locator(".public-content .project-label")).toHaveText("Life Link");
    await expect(page.getByRole("heading", { name: publicTitle })).toBeVisible();
    await expect(page.getByText(project.name)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();

    await page.getByRole("button", { name: "Open in My Life Links" }).click();
    await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
    await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/qr/${state.link.id}$`));
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
    await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  });

  test("saves slash-command block content and renders it after save", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await openOwnerLifeLink(page, state);
    await expect(page.locator(".life-link-detail-body")).toContainText("Plain starting body");
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Edit" }).click();
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
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastCanonicalPatch?.body).toContain("Install notes");
    expect(state.lastCanonicalPatch?.body).toContain("First bullet");
    expect(state.lastCanonicalPatch?.bodyDocVersion).toBe(1);
    expect(state.lastCanonicalExpectedUpdatedAt).toBe("2026-05-07T12:00:00.000Z");
    expect(hasNodeType(state.lastCanonicalPatch?.bodyDoc, "heading")).toBe(true);
    expect(hasNodeType(state.lastCanonicalPatch?.bodyDoc, "bulletList")).toBe(true);

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Install notes" })).toBeVisible();
    await expect(page.locator(".life-link-detail-body .body-list")).toContainText("First bullet");
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.locator(".link-row").filter({ hasText: "Install notes" })).toBeVisible();
  });

  test("formats selected text and edits links from the selection bubble", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await openOwnerLifeLink(page, state);
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Edit" }).click();

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
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastCanonicalPatch?.body).toContain("Client portal");
    expect(hasMarkType(state.lastCanonicalPatch?.bodyDoc, "bold")).toBe(true);
    expect(hasMarkType(state.lastCanonicalPatch?.bodyDoc, "link")).toBe(true);
    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).toContain("https://portal.example.com");

    await expect(dialog).toBeHidden();
    await expect(page.locator('.life-link-detail-body .formatted-body a[href="https://portal.example.com"]')).toContainText("Client portal");
    await expect(page.locator(".life-link-detail-body .formatted-body strong")).toContainText("Client portal");
  });

  test("recovers unsaved drafts and cleans pasted rich links", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByText("Recent Links")).toBeVisible();
    await openOwnerLifeLink(page, state);
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Edit" }).click();

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
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-editor-draft-v2:life-link-rich") ?? ""))
      .toContain("Safe link");

    await dialog.getByRole("button", { name: "Close editor" }).click();
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Draft recovered from this browser.")).toBeVisible();
    editor = page.getByRole("dialog").locator(".rich-body-editor-surface");
    await expect(editor).toContainText("Safe link");

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).toContain("https://safe.example.test/path");
    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).not.toContain("javascript:");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-editor-draft-v2:life-link-rich")))
      .toBeNull();
  });
});

type MockLifeLinksState = {
  link: LinkRecord;
  lifeLink: LifeLinkRecord;
  lastPatch: Partial<LinkRecord> | null;
  lastCanonicalPatch: Partial<LifeLinkRecord> | null;
  lastCanonicalExpectedUpdatedAt: string | null;
};

async function mockLifeLinksApi(
  page: Page,
  baseURL: string,
  options: { publicTitle?: string } = {}
): Promise<MockLifeLinksState> {
  const now = "2026-05-07T12:00:00.000Z";
  const state: MockLifeLinksState = {
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
    lifeLink: {
      id: "life-link-rich",
      ownerId: owner.id,
      parentId: project.id,
      qrId: "LL-RICH-00001",
      title: "Rich body field test",
      body: "Plain starting body",
      bodyDoc: createLinkBodyDocFromPlainText("Plain starting body"),
      bodyDocVersion: 1,
      privacy: "public",
      media: [],
      createdAt: now,
      updatedAt: now
    },
    lastPatch: null,
    lastCanonicalPatch: null,
    lastCanonicalExpectedUpdatedAt: null
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
  await page.route("**/api/life-links?*", async (route) => {
    await route.fulfill({
      json: {
        lifeLinks: [{
          id: project.id,
          parentId: null,
          qrId: null,
          title: project.name,
          privacy: "private",
          updatedAt: project.createdAt,
          childCount: 1
        }],
        nextCursor: null,
        truncated: false
      }
    });
  });
  await page.route("**/api/life-links/search?*", async (route) => {
    await route.fulfill({
      json: {
        results: [{
          lifeLink: canonicalSummary(state.lifeLink, 0),
          path: {
            items: [projectRootSummary(), canonicalSummary(state.lifeLink, 0)],
            truncated: false,
            omittedCount: 0
          },
          bodySummary: state.lifeLink.body,
          matchClass: "exact_qr"
        }],
        totalCount: 1,
        truncated: false,
        hasMore: false,
        nextCursor: null
      }
    });
  });
  await page.route("**/api/life-links/life-link-rich*", async (route) => {
    if (route.request().method() === "PATCH") {
      const request = route.request().postDataJSON() as Partial<LifeLinkRecord> & { expectedUpdatedAt?: string };
      const { expectedUpdatedAt, ...patch } = request;
      state.lastCanonicalExpectedUpdatedAt = expectedUpdatedAt ?? null;
      state.lastCanonicalPatch = patch;
      state.lifeLink = {
        ...state.lifeLink,
        ...patch,
        bodyDoc: patch.bodyDoc ?? state.lifeLink.bodyDoc,
        bodyDocVersion: patch.bodyDocVersion ?? state.lifeLink.bodyDocVersion,
        updatedAt: new Date(Date.parse(state.lifeLink.updatedAt) + 1000).toISOString()
      };
      state.link = {
        ...state.link,
        title: state.lifeLink.title,
        body: state.lifeLink.body,
        bodyDoc: state.lifeLink.bodyDoc,
        bodyDocVersion: state.lifeLink.bodyDocVersion,
        privacy: state.lifeLink.privacy,
        updatedAt: state.lifeLink.updatedAt
      };
      await route.fulfill({ json: { lifeLink: state.lifeLink } });
      return;
    }
    await route.fulfill({ json: { detail: canonicalDetail(state.lifeLink) } });
  });
  await page.route("**/api/qr/LL-RICH-00001", async (route) => {
    await route.fulfill({
      json: {
        state: "claimed",
        link: options.publicTitle ? { ...state.link, title: options.publicTitle } : state.link,
        viewerIsOwner: true
      }
    });
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

async function openOwnerLifeLink(page: Page, state: MockLifeLinksState) {
  await page.locator(".link-row").filter({ hasText: state.link.title }).click();
  await expect(page).toHaveURL(new RegExp(`/qr/${state.link.id}$`));
  await page.getByRole("button", { name: "Open in My Life Links" }).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
  await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
}

function canonicalSummary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return {
    id: lifeLink.id,
    parentId: lifeLink.parentId,
    qrId: lifeLink.qrId,
    title: lifeLink.title,
    privacy: lifeLink.privacy,
    updatedAt: lifeLink.updatedAt,
    childCount
  };
}

function projectRootSummary(): LifeLinkSummary {
  return {
    id: project.id,
    parentId: null,
    qrId: null,
    title: project.name,
    privacy: "private",
    updatedAt: project.createdAt,
    childCount: 1
  };
}

function canonicalDetail(lifeLink: LifeLinkRecord): LifeLinkDetail {
  return {
    lifeLink,
    ancestry: {
      items: [projectRootSummary(), canonicalSummary(lifeLink, 0)],
      truncated: false,
      omittedCount: 0
    },
    children: [],
    childrenPage: { nextCursor: null, truncated: false }
  };
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
