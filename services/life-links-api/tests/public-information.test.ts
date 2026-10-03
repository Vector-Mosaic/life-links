import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore } from "../src/store.js";

const pages = ["home", "about", "contact", "privacy", "terms"] as const;
const challenge = "ShvNzVnFK6dfqNcYlkKkRCUsIbx1Dfofl7VxO-T-amk";
const shell = '<!doctype html><html><head><title>Life Links</title></head><body><div id="root"></div><script type="module" src="/assets/synthetic-app.js"></script></body></html>';
const documents = Object.fromEntries(pages.map(page => [page,
  `<!doctype html><html><head><title>Life Links</title></head><body><div id="root"><main><h1 id="public-information-title">Published ${page}</h1><p>Current public ${page} content.</p></main></div><script type="module" src="/assets/synthetic-app.js"></script></body></html>`])) as Record<typeof pages[number], string>;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function appForDist(directory: string) {
  return createLifeLinksApp({ store: new InMemoryLifeLinksStore(),
    config: readConfig({ NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory",
      SESSION_SECRET: "synthetic-public-information-session", QR_BASE_URL: "https://public-information.example.test",
      COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false", STATIC_DIST_PATH: directory }),
    logger: createLogger("public_information_test", { sink: () => undefined }) });
}

async function fixture(includeChallenge = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "life-links-public-information-"));
  directories.push(directory);
  await mkdir(path.join(directory, ".well-known"));
  await mkdir(path.join(directory, "assets"));
  await writeFile(path.join(directory, "index.html"), shell);
  await writeFile(path.join(directory, "assets", "synthetic-app.js"), "// synthetic client bootstrap");
  for (const page of pages) await writeFile(path.join(directory, `${page}.html`), documents[page]);
  await writeFile(path.join(directory, ".well-known", "private-fixture"), "synthetic-dotfile-must-stay-private");
  await writeFile(path.join(directory, ".env"), "synthetic-env-must-stay-private");
  if (includeChallenge) await writeFile(path.join(directory, ".well-known", "openai-apps-challenge"), challenge);
  return { app: appForDist(directory), directory };
}

describe("public information HTTP documents", () => {
  it.each(pages)("serves the published %s document without a private session", async page => {
    const { app } = await fixture();
    const response = await request(app).get(`/${page}`);
    expect(response.status).toBe(200); expect(response.headers["content-type"]).toMatch(/^text\/html(?:;|$)/);
    expect(response.text).toBe(documents[page]);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await request(app).get(`/${page}/?source=public-check`)).text).toBe(documents[page]);
  });

  it("retains the normal SPA bootstrap for other application paths and serves its referenced assets", async () => {
    const { app } = await fixture();
    for (const pathname of ["/", "/life-links", "/collections", "/routines", "/calendar", "/register", "/delete-account", "/privacy/extra"]) {
      const response = await request(app).get(pathname);
      expect(response.status).toBe(200); expect(response.text).toBe(shell);
    }
    expect((await request(app).get("/assets/synthetic-app.js")).text).toBe("// synthetic client bootstrap");
    expect((await request(app).get("/api/not-a-public-page")).status).toBe(404);
  });

  it("serves only the exact public challenge as plain text with matching GET and HEAD lengths", async () => {
    const { app } = await fixture();
    const get = await request(app).get("/.well-known/openai-apps-challenge");
    expect(get.status).toBe(200); expect(get.headers["content-type"]).toMatch(/^text\/plain(?:;|$)/);
    expect(get.headers["cache-control"]).toBe("no-cache");
    expect(get.text).toBe(challenge); expect(Number(get.headers["content-length"])).toBe(Buffer.byteLength(challenge));
    expect(get.headers["set-cookie"]).toBeUndefined();
    const head = await request(app).head("/.well-known/openai-apps-challenge");
    expect(head.status).toBe(200); expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
    expect(head.headers["content-length"]).toBe(get.headers["content-length"]); expect(head.text).toBeUndefined();
  });

  it("returns 404 for a missing challenge instead of a successful SPA shell", async () => {
    const { app } = await fixture(false);
    for (const method of ["get", "head"] as const) {
      const response = await request(app)[method]("/.well-known/openai-apps-challenge");
      expect(response.status).toBe(404); expect(response.text ?? "").not.toContain('<div id="root">');
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.text ?? "").not.toContain(challenge);
    }
  });

  it("does not disclose unrelated dotfiles or widen the challenge filename to a directory", async () => {
    const { app } = await fixture();
    for (const pathname of ["/.env", "/.well-known/private-fixture", "/.well-known/openai-apps-challenge/extra"]) {
      const response = await request(app).get(pathname);
      expect(response.text).toBe(shell);
      expect(response.text).not.toContain("synthetic-dotfile-must-stay-private");
      expect(response.text).not.toContain("synthetic-env-must-stay-private");
      expect(response.text).not.toContain(challenge);
    }
  });
});

const builtDist = process.env.PUBLIC_INFORMATION_DIST;
describe.skipIf(!builtDist)("actual built public information HTTP delivery", () => {
  it("serves all five completed documents with GET and HEAD while preserving the normal SPA", async () => {
    const directory = path.resolve(builtDist!);
    const app = appForDist(directory);
    for (const page of pages) {
      const html = await readFile(path.join(directory, `${page}.html`), "utf8");
      expect(html).toMatch(/<h1 id="public-information-title">[^<]+<\/h1>/);
      expect(html).not.toContain('<div id="root"></div>');
      const get = await request(app).get(`/${page}`);
      expect(get.status).toBe(200); expect(get.text).toBe(html);
      expect(get.headers["set-cookie"]).toBeUndefined();
      const head = await request(app).head(`/${page}`);
      expect(head.status).toBe(200); expect(head.headers["content-type"]).toMatch(/^text\/html(?:;|$)/);
      expect(Number(head.headers["content-length"])).toBe(Buffer.byteLength(html)); expect(head.text).toBeUndefined();
    }
    const index = await readFile(path.join(directory, "index.html"), "utf8");
    expect((await request(app).get("/life-links")).text).toBe(index);
    const get = await request(app).get("/.well-known/openai-apps-challenge");
    expect(get.status).toBe(200); expect(get.headers["content-type"]).toMatch(/^text\/plain(?:;|$)/);
    expect(get.headers["cache-control"]).toBe("no-cache");
    expect(get.text).toBe(challenge); expect(Number(get.headers["content-length"])).toBe(Buffer.byteLength(challenge));
    const head = await request(app).head("/.well-known/openai-apps-challenge");
    expect(head.status).toBe(200); expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
    expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]); expect(head.text).toBeUndefined();
  });
});
