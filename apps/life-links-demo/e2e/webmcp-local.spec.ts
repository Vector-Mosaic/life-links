import { expect, test, type Page } from "@playwright/test";
import {
  createLinkBodyDocFromPlainText,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkRecord,
  type UserRecord
} from "@life-links/core";

import { LIFE_LINKS_PAGE_TOOL_NAMES } from "../src/agent/browserWebMcpHost";

const owner: Pick<UserRecord, "id" | "email" | "displayName" | "createdAt"> = {
  id: "webmcp-owner",
  email: "owner@webmcp.test",
  displayName: "WebMCP Owner",
  createdAt: "2026-08-26T12:00:00.000Z"
};

const rootLifeLink: LifeLinkRecord = {
  id: "life-link-camera-bag",
  ownerId: owner.id,
  parentId: null,
  qrId: null,
  title: "Field Camera Bag",
  body: "The top-level field camera kit.",
  bodyDoc: createLinkBodyDocFromPlainText("The top-level field camera kit."),
  bodyDocVersion: 1,
  privacy: "private",
  media: [],
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z"
};

const targetLifeLink: LifeLinkRecord = {
  id: "life-link-camera-battery-kit",
  ownerId: owner.id,
  parentId: rootLifeLink.id,
  qrId: "LL-CAMERA-BATTERY-KIT",
  title: "Camera Battery Kit",
  body: "Battery readiness\nTwo charged batteries and one USB-C charger.",
  bodyDoc: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Battery readiness" }]
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Two charged batteries and one USB-C charger." }]
      }
    ]
  },
  bodyDocVersion: 1,
  privacy: "public",
  media: [],
  createdAt: "2026-08-26T12:01:00.000Z",
  updatedAt: "2026-08-26T12:01:00.000Z"
};

const CANONICAL_TOOL_NAMES = [...LIFE_LINKS_PAGE_TOOL_NAMES].sort();

test.describe("local controlled WebMCP host", () => {
  test("registers only with consent, invokes all five tools, and cleans every eligibility boundary", async ({
    baseURL,
    page
  }) => {
    await installControlledWebMcpHost(page);
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Agent Access" })).toBeVisible();
    const accessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await expect(accessToggle).not.toBeChecked();
    await expect.poll(() => controlledHostSnapshot(page)).toMatchObject({
      activeNames: [],
      registrationNames: []
    });

    await accessToggle.check();
    await expect(page.getByText("Five Life Links page tools are available to the agent in this live page.")).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    expect((await controlledHostSnapshot(page)).registrationNames.sort()).toEqual(CANONICAL_TOOL_NAMES);

    const openResult = await invokeControlledTool(page, "open_life_link", {
      lifeLinkId: targetLifeLink.id
    });
    expect(openResult).toMatchObject({
      ok: true,
      lifeLinkId: targetLifeLink.id,
      visibleEffect: "life_link_opened"
    });
    await expect(page).toHaveURL(new RegExp(`/life-links/${targetLifeLink.id}$`));
    await expect(page.locator(`[data-selected-life-link-id="${targetLifeLink.id}"]`)).toBeVisible();
    await expect(page.locator(".life-link-owner-detail").getByRole("heading", { name: targetLifeLink.title })).toBeVisible();

    const inspectResult = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(inspectResult).toMatchObject({
      ok: true,
      lifeLink: {
        id: targetLifeLink.id,
        qrId: targetLifeLink.qrId,
        updatedAt: targetLifeLink.updatedAt
      },
      visibleEffect: "current_life_link_focused"
    });
    await expect(page.getByText("Inspected the selected Life Link")).toBeVisible();

    const searchResult = await invokeControlledTool(page, "search_my_life_links", {
      query: "battery",
      limit: 10
    });
    expect(searchResult).toMatchObject({
      ok: true,
      query: "battery",
      resultCount: 1,
      totalCount: 1,
      visibleEffect: "search_results_highlighted"
    });
    await expect(page.getByLabel("Search My Life Links")).toHaveValue("battery");
    const visibleSearchResult = page.locator(`[data-life-link-search-id="${targetLifeLink.id}"]`);
    await expect(visibleSearchResult).toContainText(targetLifeLink.title);
    await expect(visibleSearchResult).toContainText(`${rootLifeLink.title} > ${targetLifeLink.title}`);

    const proposedTitle = "Camera Battery Kit — preflight checklist";
    const proposedBody = "Confirm both batteries are charged before departure.";
    const recoveredHumanTitle = "Camera kit — recovered human draft";
    const humanTitle = "Camera kit — human work in progress";
    const canonicalDraftKey = `life-links-editor-draft-v2:${targetLifeLink.id}`;
    await seedCanonicalDraft(page, canonicalDraftKey, recoveredHumanTitle);
    const draftResult = await invokeControlledTool(page, "draft_life_link_update", {
      lifeLinkId: targetLifeLink.id,
      baseUpdatedAt: targetLifeLink.updatedAt,
      title: proposedTitle,
      body: proposedBody,
      sourceLifeLinkIds: [rootLifeLink.id]
    });
    expect(draftResult).toMatchObject({
      ok: true,
      lifeLinkId: targetLifeLink.id,
      saved: false,
      privacyChanged: false,
      visibleEffect: "agent_draft_opened"
    });
    const editor = page.getByRole("dialog");
    await expect(editor.getByText("Agent draft — not saved", { exact: true })).toBeVisible();
    await expect(editor.locator(".agent-draft-review")).toContainText(proposedTitle);
    await expect(editor.locator(".agent-draft-review")).toContainText(proposedBody);
    await expect(editor.locator(".agent-draft-review")).toContainText(`Privacy unchanged: ${targetLifeLink.privacy}`);
    await expect(editor.getByLabel("Authorized source Life Links")).toContainText(rootLifeLink.id);
    await expect(editor.getByLabel("Title")).toHaveValue(recoveredHumanTitle);
    await expect(editor.getByText("Draft recovered from this browser.")).toBeVisible();
    await expect(editor.locator(".rich-body-editor-surface").getByRole("heading", { name: "Battery readiness" })).toBeVisible();
    await editor.getByLabel("Title").fill(humanTitle);
    await expect.poll(() => readCanonicalDraftSummary(page, canonicalDraftKey)).toEqual({
      title: humanTitle,
      hasHeading: true
    });
    await page.waitForTimeout(350);
    expect(state.patchRequests).toEqual([]);

    await editor.getByRole("button", { name: "Apply proposal" }).click();
    await expect(editor.getByLabel("Title")).toHaveValue(proposedTitle);
    await expect(editor.locator(".rich-body-editor-surface")).toContainText(proposedBody);
    await expect(editor.getByText("Applied to the editor, but still not saved.")).toBeVisible();
    await expect(editor.getByRole("button", { name: "Discard draft" })).toBeHidden();
    await page.waitForTimeout(350);
    expect(state.patchRequests).toEqual([]);
    await expect.poll(() => readCanonicalDraftSummary(page, canonicalDraftKey)).toEqual({
      title: humanTitle,
      hasHeading: true
    });

    const blockedOpen = await invokeControlledTool(page, "open_life_link", {
      lifeLinkId: targetLifeLink.id
    });
    expect(blockedOpen).toMatchObject({
      ok: false,
      error: { code: "editor_open", retryable: true }
    });
    await expect(editor.getByText("Applied to the editor, but still not saved.")).toBeVisible();
    await expect(editor.getByLabel("Title")).toHaveValue(proposedTitle);
    await expect.poll(() => readCanonicalDraftSummary(page, canonicalDraftKey)).toEqual({
      title: humanTitle,
      hasHeading: true
    });

    await editor.getByRole("button", { name: "Undo and dismiss" }).click();
    await expect(editor.getByText("Agent draft — not saved", { exact: true })).toBeHidden();
    await expect(editor.getByLabel("Title")).toHaveValue(humanTitle);
    await expect(editor.locator(".rich-body-editor-surface").getByRole("heading", { name: "Battery readiness" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Discard draft" })).toBeVisible();
    expect(state.patchRequests).toEqual([]);

    const titleOnlyProposal = "Camera Battery Kit — title-only review";
    const titleOnlyDraft = await invokeControlledTool(page, "draft_life_link_update", {
      lifeLinkId: targetLifeLink.id,
      baseUpdatedAt: targetLifeLink.updatedAt,
      title: titleOnlyProposal
    });
    expect(titleOnlyDraft).toMatchObject({
      ok: true,
      proposedFields: ["title"],
      saved: false
    });
    await editor.getByRole("button", { name: "Apply proposal" }).click();
    await expect(editor.getByLabel("Title")).toHaveValue(titleOnlyProposal);
    await expect(editor.locator(".rich-body-editor-surface").getByRole("heading", { name: "Battery readiness" })).toBeVisible();
    await expect.poll(() => readCanonicalDraftSummary(page, canonicalDraftKey)).toEqual({
      title: humanTitle,
      hasHeading: true
    });
    await editor.getByRole("button", { name: "Undo and dismiss" }).click();
    await expect(editor.getByLabel("Title")).toHaveValue(humanTitle);
    await expect(editor.locator(".rich-body-editor-surface").getByRole("heading", { name: "Battery readiness" })).toBeVisible();
    expect(state.patchRequests).toEqual([]);

    await editor.getByRole("button", { name: "Close editor" }).click();
    await expect(editor).toBeHidden();
    const findResult = await invokeControlledTool(page, "start_find_mode", {
      lifeLinkId: targetLifeLink.id
    });
    expect(findResult).toMatchObject({
      ok: true,
      lifeLinkId: targetLifeLink.id,
      qrId: targetLifeLink.qrId,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    await expect(page.getByRole("heading", { name: "Search And Find" })).toBeVisible();
    await expect(page.locator(".find-target")).toContainText(targetLifeLink.title);
    await expect(page.locator(".find-target")).toContainText(targetLifeLink.qrId!);

    const activity = page.locator(".agent-activity-panel");
    await expect(activity.locator(".agent-activity-item")).toHaveCount(7);
    for (const label of [
      "Opened a Life Link in the workspace",
      "Inspected the selected Life Link",
      "Showed bounded Life Link search results",
      "Staged an unsaved Life Link draft",
      "Started Find Mode for a Life Link"
    ]) {
      await expect(activity.getByText(label).first()).toBeVisible();
    }
    await expect(activity).not.toContainText("battery");
    await expect(activity).not.toContainText(proposedBody);
    await expect(activity).not.toContainText(targetLifeLink.id);
    expect(state.patchRequests).toEqual([]);

    await accessToggle.uncheck();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    await expect(page.getByText("No agent tool activity in this page session.")).toBeVisible();

    await accessToggle.check();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    await page
      .getByRole("complementary", { name: "Life Links navigation" })
      .getByRole("button", { name: "My Life Links" })
      .click();
    await expect(page.locator(".life-link-owner-detail")).toContainText(targetLifeLink.title);
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Open QR page" }).click();
    await expect(page).toHaveURL(new RegExp(`/qr/${targetLifeLink.qrId}$`));
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);

    await page.getByRole("button", { name: "Open in My Life Links" }).click();
    await expect(page).toHaveURL(new RegExp(`/life-links/${targetLifeLink.id}$`));
    await expect(page.getByRole("checkbox", { name: /Off|On for this page session/ })).not.toBeChecked();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);

    const restoredAccessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await restoredAccessToggle.check();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    state.holdLogout = true;
    await page.locator(".sidebar-actions").getByRole("button", { name: "Logout" }).click();
    await state.logoutStarted;
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    state.releaseLogout();
    await expect(page.getByRole("heading", { name: "Demo Login" })).toBeVisible();

    expect(state.patchRequests).toEqual([]);
  });
});

type MockApiState = {
  patchRequests: string[];
  holdLogout: boolean;
  logoutStarted: Promise<void>;
  releaseLogout(): void;
};

async function mockLifeLinksApi(page: Page, baseURL: string): Promise<MockApiState> {
  let markLogoutStarted: () => void = () => undefined;
  let releaseLogout: () => void = () => undefined;
  const logoutStarted = new Promise<void>((resolve) => {
    markLogoutStarted = resolve;
  });
  const logoutRelease = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });
  const state: MockApiState = {
    patchRequests: [],
    holdLogout: false,
    logoutStarted,
    releaseLogout
  };
  const targetLink = compatibilityLink(targetLifeLink, baseURL);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === "PATCH") {
      state.patchRequests.push(path);
      await route.fulfill({ status: 500, json: { error: { code: "unexpected_patch", message: "Draft tools may not write." } } });
      return;
    }
    if (path === "/api/config" && method === "GET") {
      await route.fulfill({ json: { qrBaseUrl: baseURL, maxBatchCount: 10000 } });
      return;
    }
    if (path === "/api/me" && method === "GET") {
      await route.fulfill({ json: { user: owner, qrBaseUrl: baseURL } });
      return;
    }
    if (path === "/api/links" && method === "GET") {
      await route.fulfill({ json: { links: [targetLink] } });
      return;
    }
    if (path === "/api/projects" && method === "GET") {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    if (path === "/api/life-links" && method === "GET") {
      const parentId = url.searchParams.get("parentId");
      await route.fulfill({
        json: {
          lifeLinks: parentId === rootLifeLink.id ? [summary(targetLifeLink, 0)] : [summary(rootLifeLink, 1)],
          nextCursor: null,
          truncated: false
        }
      });
      return;
    }
    if (path === "/api/life-links/search" && method === "GET") {
      await route.fulfill({
        json: {
          results: [searchItem(targetLifeLink)],
          totalCount: 1,
          truncated: false,
          hasMore: false,
          nextCursor: null
        }
      });
      return;
    }
    if (path.startsWith("/api/life-links/") && method === "GET") {
      const lifeLinkId = decodeURIComponent(path.slice("/api/life-links/".length));
      const lifeLink = lifeLinkId === rootLifeLink.id ? rootLifeLink : lifeLinkId === targetLifeLink.id ? targetLifeLink : null;
      if (!lifeLink) {
        await route.fulfill({ status: 404, json: { error: { code: "life_link_not_found", message: "Not found." } } });
        return;
      }
      await route.fulfill({ json: { detail: canonicalDetail(lifeLink) } });
      return;
    }
    if (path === `/api/qr/${targetLifeLink.qrId}` && method === "GET") {
      await route.fulfill({ json: { state: "claimed", link: targetLink, viewerIsOwner: true } });
      return;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      if (state.holdLogout) {
        markLogoutStarted();
        await logoutRelease;
      }
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: { code: "unexpected_test_request", message: `${method} ${path}` } }
    });
  });

  return state;
}

async function readCanonicalDraftSummary(page: Page, storageKey: string) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const draft = JSON.parse(raw) as { patch?: { title?: string; bodyDoc?: unknown } };
    return {
      title: draft.patch?.title ?? null,
      hasHeading: JSON.stringify(draft.patch?.bodyDoc ?? null).includes('"heading"')
    };
  }, storageKey);
}

async function seedCanonicalDraft(page: Page, storageKey: string, title: string) {
  await page.evaluate(({ key, nextTitle, lifeLink }) => {
    window.localStorage.setItem(key, JSON.stringify({
      version: 2,
      lifeLinkId: lifeLink.id,
      lifeLinkUpdatedAt: lifeLink.updatedAt,
      savedAt: "2026-08-26T12:02:00.000Z",
      patch: {
        title: nextTitle,
        body: lifeLink.body,
        bodyDoc: lifeLink.bodyDoc,
        bodyDocVersion: lifeLink.bodyDocVersion,
        privacy: lifeLink.privacy
      }
    }));
  }, { key: storageKey, nextTitle: title, lifeLink: targetLifeLink });
}

function compatibilityLink(lifeLink: LifeLinkRecord, baseURL: string): LinkRecord {
  return {
    id: lifeLink.qrId!,
    url: new URL(`/qr/${lifeLink.qrId}`, baseURL).toString(),
    status: "claimed",
    ownerId: lifeLink.ownerId,
    title: lifeLink.title,
    body: lifeLink.body,
    bodyDoc: lifeLink.bodyDoc,
    bodyDocVersion: lifeLink.bodyDocVersion,
    projectId: null,
    privacy: lifeLink.privacy,
    media: [],
    createdAt: lifeLink.createdAt,
    updatedAt: lifeLink.updatedAt
  };
}

function summary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
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

function canonicalDetail(lifeLink: LifeLinkRecord): LifeLinkDetail {
  const isRoot = lifeLink.id === rootLifeLink.id;
  return {
    lifeLink,
    ancestry: {
      items: isRoot ? [summary(rootLifeLink, 1)] : [summary(rootLifeLink, 1), summary(targetLifeLink, 0)],
      truncated: false,
      omittedCount: 0
    },
    children: isRoot ? [summary(targetLifeLink, 0)] : [],
    childrenPage: { nextCursor: null, truncated: false }
  };
}

function searchItem(lifeLink: LifeLinkRecord) {
  return {
    lifeLink: summary(lifeLink, 0),
    path: {
      items: [summary(rootLifeLink, 1), summary(lifeLink, 0)],
      truncated: false,
      omittedCount: 0
    },
    bodySummary: lifeLink.body,
    matchClass: "title" as const
  };
}

type ControlledHostSnapshot = {
  activeNames: string[];
  registrationNames: string[];
  abortedNames: string[];
};

async function installControlledWebMcpHost(page: Page) {
  await page.addInitScript(() => {
    type RegisteredTool = {
      name: string;
      execute(input: unknown, context: { signal?: AbortSignal }): unknown | Promise<unknown>;
    };
    type RegistrationOptions = { signal?: AbortSignal };

    const activeTools = new Map<string, RegisteredTool>();
    const registrationNames: string[] = [];
    const abortedNames: string[] = [];
    const modelContext = {
      async registerTool(tool: RegisteredTool, options: RegistrationOptions = {}) {
        if (activeTools.has(tool.name)) {
          throw new Error(`duplicate tool ${tool.name}`);
        }
        registrationNames.push(tool.name);
        activeTools.set(tool.name, tool);
        const unregister = () => {
          if (activeTools.get(tool.name) === tool) {
            activeTools.delete(tool.name);
            abortedNames.push(tool.name);
          }
        };
        if (options.signal?.aborted) {
          unregister();
        } else {
          options.signal?.addEventListener("abort", unregister, { once: true });
        }
      }
    };
    const testHost = {
      snapshot(): ControlledHostSnapshot {
        return {
          activeNames: [...activeTools.keys()].sort(),
          registrationNames: [...registrationNames],
          abortedNames: [...abortedNames]
        };
      },
      async invoke(name: string, input: unknown) {
        const tool = activeTools.get(name);
        if (!tool) {
          throw new Error(`Tool ${name} is not active.`);
        }
        const executionController = new AbortController();
        return tool.execute(input, { signal: executionController.signal });
      }
    };

    Object.defineProperty(window, "__lifeLinksControlledWebMcpHost", {
      configurable: false,
      enumerable: false,
      value: testHost
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      enumerable: false,
      value: modelContext
    });
  });
}

async function controlledHostSnapshot(page: Page): Promise<ControlledHostSnapshot> {
  return page.evaluate(() => {
    const host = (window as unknown as {
      __lifeLinksControlledWebMcpHost: { snapshot(): ControlledHostSnapshot };
    }).__lifeLinksControlledWebMcpHost;
    return host.snapshot();
  });
}

async function invokeControlledTool(page: Page, name: string, input: unknown): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const host = (window as unknown as {
        __lifeLinksControlledWebMcpHost: { invoke(name: string, input: unknown): Promise<unknown> };
      }).__lifeLinksControlledWebMcpHost;
      return await host.invoke(toolName, toolInput);
    },
    { toolName: name, toolInput: input }
  ) as Promise<Record<string, unknown>>;
}
