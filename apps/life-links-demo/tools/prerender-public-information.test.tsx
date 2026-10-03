// @vitest-environment jsdom
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicInformation, privacyParagraphs, termsParagraphs } from "../src/PublicInformation";
import { PUBLIC_INFORMATION_PAGES, renderPublicInformationDocument } from "./prerender-public-information";

const headings = {
  home: "Your everyday context, connected.", about: "About LifeLinks", contact: "Contact LifeLinks",
  privacy: "Privacy notice", terms: "Evaluation terms"
} as const;
const template = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Life Links</title><link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script type="module" crossorigin src="/assets/index-123abc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-456def.css" /></head>
<body><div id="root"></div></body></html>`;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("public information build documents", () => {
  it("limits prerendering to the five existing public information pages", () => {
    expect(PUBLIC_INFORMATION_PAGES).toEqual(["home", "about", "contact", "privacy", "terms"]);
  });

  it.each(PUBLIC_INFORMATION_PAGES)("renders current %s content without changing the completed client assets or bootstrap", page => {
    const rendered = renderPublicInformationDocument(template, page);
    const document = parse(rendered);
    const expected = parse(`<div id="root">${renderToStaticMarkup(<PublicInformation page={page} />)}</div>`);
    expect(document.querySelector("#root")!.innerHTML).toBe(expected.querySelector("#root")!.innerHTML);
    expect(document.querySelector("#public-information-title")?.textContent).toBe(headings[page]);
    expect(document.title).toBe("Life Links");
    expect(document.head.innerHTML).toBe(parse(template).head.innerHTML);
    expect(document.querySelector('script[type="module"]')?.getAttribute("src")).toBe("/assets/index-123abc.js");
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("/assets/index-456def.css");
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.svg");
    expect(document.querySelectorAll("#root")).toHaveLength(1);
    expect(document.querySelector("address a")?.getAttribute("href")).toBe("mailto:justin@vmosaic.com");
    expect(document.querySelector("address")?.textContent).toContain("16 Paddington Ct");
    expect(document.querySelector("address")?.textContent).toContain("Naples, FL 34104");
    for (const href of ["/home", "/about", "/contact", "/privacy", "/terms", "/delete-account"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it.each(["privacy", "terms"] as const)("includes every approved %s paragraph as readable HTML before JavaScript executes", page => {
    const document = parse(renderPublicInformationDocument(template, page));
    const paragraphs = [...document.querySelectorAll("article > p")].map(paragraph => paragraph.textContent);
    expect(paragraphs).toEqual(page === "privacy" ? [...privacyParagraphs] : [...termsParagraphs]);
  });

  it("keeps the About consent preview unchecked and unable to send a verification message", () => {
    const document = parse(renderPublicInformationDocument(template, "about"));
    expect(document.querySelector("#sms-verification")?.textContent).toContain("Phone verification is not available yet");
    expect(document.querySelector('input[type="checkbox"]')?.hasAttribute("checked")).toBe(false);
    expect(document.querySelector(".public-phone-entry")?.textContent).toContain("cannot send a message");
    expect(document.querySelector(".public-phone-entry form")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".public-phone-entry button")?.disabled).toBe(true);
  });

  it.each(["", template.replace('<div id="root"></div>', ""), template.replace('<div id="root"></div>', '<div id="root">private owner data</div>'),
    template.replace('<div id="root"></div>', '<div id="root"></div><div id="root"></div>')])
    ("refuses a template without exactly one empty application root", invalid => {
      expect(() => renderPublicInformationDocument(invalid, "privacy")).toThrow("Built client template must contain one empty root element");
    });
});

const builtDist = process.env.PUBLIC_INFORMATION_DIST;
describe.skipIf(!builtDist)("actual built public information artifacts", () => {
  it("preserves the SPA shell, emits all current public documents and resolves their completed assets", async () => {
    const directory = path.resolve(builtDist!);
    const index = await readFile(path.join(directory, "index.html"), "utf8");
    const indexDocument = parse(index);
    expect(indexDocument.querySelector("#root")?.innerHTML).toBe("");
    expect(indexDocument.querySelector(".public-information-content")).toBeNull();
    expect(indexDocument.title).toBe("Life Links");
    const assets = [...indexDocument.querySelectorAll('script[type="module"][src], link[rel="stylesheet"][href], link[rel="icon"][href]')]
      .map(element => element.getAttribute(element.tagName === "SCRIPT" ? "src" : "href")!);
    expect(assets.some(asset => /^\/assets\/.+\.js$/.test(asset))).toBe(true);
    expect(assets.some(asset => /^\/assets\/.+\.css$/.test(asset))).toBe(true);
    expect(assets).toContain("/favicon.svg");
    for (const asset of assets) {
      expect(asset).toMatch(/^\/(?!\/)/);
      const file = await stat(path.join(directory, asset.slice(1)));
      expect(file.isFile()).toBe(true); expect(file.size).toBeGreaterThan(0);
    }
    for (const page of PUBLIC_INFORMATION_PAGES) {
      const html = await readFile(path.join(directory, `${page}.html`), "utf8");
      expect(html).toBe(renderPublicInformationDocument(index, page));
      expect(parse(html).querySelector("#public-information-title")?.textContent).toBe(headings[page]);
    }
  });

  it("copies the single public OpenAI challenge exactly without a BOM or newline", async () => {
    // The gate supplies this package's dist; its source public folder is a sibling.
    const source = await readFile(path.resolve(builtDist!, "..", "public", ".well-known", "openai-apps-challenge"));
    const artifact = await readFile(path.join(path.resolve(builtDist!), ".well-known", "openai-apps-challenge"));
    expect(source.toString("utf8")).toBe("ShvNzVnFK6dfqNcYlkKkRCUsIbx1Dfofl7VxO-T-amk");
    expect(artifact).toEqual(source);
  });
});
