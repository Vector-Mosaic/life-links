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
  test("connects once, invokes all five tools, persists, and disconnects only explicitly", async ({
    baseURL,
    page
  }) => {
    await installControlledWebMcpHost(page);
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/");
    await expect(page.locator("#agent-access-title")).toHaveText("Agent Connection");
    const connectButton = page.getByRole("button", { name: "Connect Agent" });
    await expect(connectButton).toBeVisible();
    await expect.poll(() => controlledHostSnapshot(page)).toMatchObject({
      activeNames: [],
      registrationNames: []
    });

    await connectButton.click();
    await expect(page.getByText("Connected until you disconnect. Life Links tools are available to your agent.")).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    expect((await controlledHostSnapshot(page)).registrationNames.sort()).toEqual(CANONICAL_TOOL_NAMES);
    expect(state.connectRequests).toBe(1);

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

    const proposedTitle = "Camera Battery Kit — revision-safe title";
    const recoveredHumanTitle = "Camera kit — recovered human draft";
    const canonicalDraftKey = `life-links-editor-draft-v2:${targetLifeLink.id}`;
    await seedCanonicalDraft(page, canonicalDraftKey, recoveredHumanTitle);
    const dirtyResult = await invokeControlledTool(page, "update_life_link_content", {
      lifeLinkId: targetLifeLink.id,
      baseUpdatedAt: targetLifeLink.updatedAt,
      title: proposedTitle,
      sourceLifeLinkIds: [rootLifeLink.id]
    });
    expect(dirtyResult).toMatchObject({ ok: false, error: { code: "editor_dirty", retryable: true } });
    expect(state.patchRequests).toEqual([]);

    await page.evaluate((key) => window.localStorage.removeItem(key), canonicalDraftKey);
    const updateResult = await invokeControlledTool(page, "update_life_link_content", {
      lifeLinkId: targetLifeLink.id,
      baseUpdatedAt: targetLifeLink.updatedAt,
      title: proposedTitle,
      sourceLifeLinkIds: [rootLifeLink.id]
    });
    expect(updateResult).toMatchObject({
      ok: true,
      lifeLinkId: targetLifeLink.id,
      updatedAt: "2026-08-26T12:03:00.000Z",
      updatedFields: ["title"],
      saved: true,
      privacyChanged: false,
      visibleEffect: "life_link_content_updated"
    });
    expect(state.patchRequests).toEqual([{
      path: `/api/life-links/${targetLifeLink.id}`,
      body: {
        expectedUpdatedAt: targetLifeLink.updatedAt,
        title: proposedTitle
      }
    }]);
    await expect(page.locator(".life-link-owner-detail").getByRole("heading", { name: proposedTitle })).toBeVisible();
    await expect(page.locator(".life-link-owner-detail")).toContainText("Battery readiness");

    const staleResult = await invokeControlledTool(page, "update_life_link_content", {
      lifeLinkId: targetLifeLink.id,
      baseUpdatedAt: targetLifeLink.updatedAt,
      body: "This stale update must not be written."
    });
    expect(staleResult).toMatchObject({ ok: false, error: { code: "stale_life_link", retryable: true } });
    expect(state.patchRequests).toHaveLength(1);

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
      "Updated Life Link content",
      "Started Find Mode for a Life Link"
    ]) {
      await expect(activity.getByText(label).first()).toBeVisible();
    }
    await expect(activity).not.toContainText("battery");
    await expect(activity).not.toContainText(targetLifeLink.id);
    expect(state.patchRequests).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole("button", { name: "Disconnect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    expect(state.connectRequests).toBe(1);
    await expect(invokeControlledTool(page, "open_life_link", {
      lifeLinkId: targetLifeLink.id
    })).resolves.toMatchObject({ ok: true, lifeLinkId: targetLifeLink.id });
    await expect(page.locator(".life-link-owner-detail")).toContainText(proposedTitle);
    await page.locator(".life-link-owner-detail").getByRole("button", { name: "Open QR page" }).click();
    await expect(page).toHaveURL(new RegExp(`/qr/${targetLifeLink.qrId}$`));
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);

    await page.getByRole("button", { name: "Open in My Life Links" }).click();
    await expect(page).toHaveURL(new RegExp(`/life-links/${targetLifeLink.id}$`));
    await expect(page.getByRole("button", { name: "Disconnect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);

    state.holdLogout = true;
    await page.locator(".sidebar-actions").getByRole("button", { name: "Logout" }).click();
    await state.logoutStarted;
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    state.releaseLogout();
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
    expect(state.disconnectRequests).toBe(0);

    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill("durable-agent-connection");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#agent-access-title")).toHaveText("Agent Connection");
    await expect(page.getByRole("button", { name: "Disconnect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    expect(state.connectRequests).toBe(1);
    expect(state.disconnectRequests).toBe(0);

    await page.getByRole("button", { name: "Disconnect Agent" }).click();
    await expect(page.getByRole("button", { name: "Connect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    expect(state.disconnectRequests).toBe(1);

    await page.reload();
    await expect(page.getByRole("button", { name: "Connect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);

    expect(state.patchRequests).toHaveLength(1);
  });
});

type MockApiState = {
  patchRequests: Array<{ path: string; body: unknown }>;
  connectRequests: number;
  disconnectRequests: number;
  connected: boolean;
  signedIn: boolean;
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
    connectRequests: 0,
    disconnectRequests: 0,
    connected: false,
    signedIn: true,
    holdLogout: false,
    logoutStarted,
    releaseLogout
  };
  let currentTarget = { ...targetLifeLink };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === "PATCH" && path === `/api/life-links/${targetLifeLink.id}`) {
      const body = request.postDataJSON() as {
        expectedUpdatedAt?: string;
        title?: string;
        body?: string;
      };
      state.patchRequests.push({ path, body });
      if (body.expectedUpdatedAt !== currentTarget.updatedAt) {
        await route.fulfill({
          status: 409,
          json: { error: { code: "stale_life_link", message: "Life Link changed.", retryable: true } }
        });
        return;
      }
      const nextBody = body.body ?? currentTarget.body;
      currentTarget = {
        ...currentTarget,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.body === undefined
          ? {}
          : { body: nextBody, bodyDoc: createLinkBodyDocFromPlainText(nextBody), bodyDocVersion: 1 }),
        updatedAt: "2026-08-26T12:03:00.000Z"
      };
      await route.fulfill({ json: { lifeLink: currentTarget } });
      return;
    }
    if (path === "/api/config" && method === "GET") {
      await route.fulfill({ json: { qrBaseUrl: baseURL, maxBatchCount: 10000 } });
      return;
    }
    if (path === "/api/me" && method === "GET") {
      await route.fulfill({
        json: {
          user: state.signedIn ? owner : null,
          qrBaseUrl: baseURL,
          agentConnection: mockAgentConnection(state.connected)
        }
      });
      return;
    }
    if (path === "/api/auth/login" && method === "POST") {
      state.signedIn = true;
      await route.fulfill({
        json: {
          user: owner,
          qrBaseUrl: baseURL,
          agentConnection: mockAgentConnection(state.connected)
        }
      });
      return;
    }
    if (path === "/api/agent-connection" && method === "PUT") {
      state.connectRequests += 1;
      state.connected = true;
      await route.fulfill({ json: { agentConnection: mockAgentConnection(true) } });
      return;
    }
    if (path === "/api/agent-connection" && method === "DELETE") {
      state.disconnectRequests += 1;
      state.connected = false;
      await route.fulfill({ json: { agentConnection: mockAgentConnection(false) } });
      return;
    }
    if (path === "/api/links" && method === "GET") {
      await route.fulfill({ json: { links: [compatibilityLink(currentTarget, baseURL)] } });
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
          lifeLinks: parentId === rootLifeLink.id ? [summary(currentTarget, 0)] : [summary(rootLifeLink, 1)],
          nextCursor: null,
          truncated: false
        }
      });
      return;
    }
    if (path === "/api/life-links/search" && method === "GET") {
      await route.fulfill({
        json: {
          results: [searchItem(currentTarget)],
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
      const lifeLink = lifeLinkId === rootLifeLink.id ? rootLifeLink : lifeLinkId === currentTarget.id ? currentTarget : null;
      if (!lifeLink) {
        await route.fulfill({ status: 404, json: { error: { code: "life_link_not_found", message: "Not found." } } });
        return;
      }
      await route.fulfill({ json: { detail: canonicalDetail(lifeLink, currentTarget) } });
      return;
    }
    if (path === `/api/qr/${targetLifeLink.qrId}` && method === "GET") {
      await route.fulfill({
        json: { state: "claimed", link: compatibilityLink(currentTarget, baseURL), viewerIsOwner: true }
      });
      return;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      state.signedIn = false;
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

function mockAgentConnection(connected: boolean) {
  return {
    connected,
    connectedAt: connected ? "2026-08-27T21:00:00.000Z" : null
  };
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

function canonicalDetail(lifeLink: LifeLinkRecord, currentTarget = targetLifeLink): LifeLinkDetail {
  const isRoot = lifeLink.id === rootLifeLink.id;
  return {
    lifeLink,
    ancestry: {
      items: isRoot ? [summary(rootLifeLink, 1)] : [summary(rootLifeLink, 1), summary(currentTarget, 0)],
      truncated: false,
      omittedCount: 0
    },
    children: isRoot ? [summary(currentTarget, 0)] : [],
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
