import { renderToStaticMarkup } from "react-dom/server";
import type { Plugin } from "vite";
import { PublicInformation } from "../src/PublicInformation";
import type { PublicInformationPage } from "../src/workspace/routes";

export const PUBLIC_INFORMATION_PAGES = ["home", "about", "contact", "privacy", "terms"] as const satisfies readonly PublicInformationPage[];

// Render only public information, never the application or an owner's data.
// PublicInformation remains the single source for approved notices and links.
export function renderPublicInformationDocument(template: string, page: PublicInformationPage): string {
  const emptyRoot = '<div id="root"></div>';
  if (template.split(emptyRoot).length !== 2) {
    throw new Error("Built client template must contain one empty root element");
  }
  const markup = renderToStaticMarkup(<PublicInformation page={page} />);
  return template.replace(emptyRoot, () => `<div id="root">${markup}</div>`);
}

export function prerenderPublicInformation(): Plugin {
  return {
    name: "life-links-public-information",
    apply: "build",
    // Vite has emitted the completed HTML and its hashed asset references.
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") {
        throw new Error("Built client index.html is required for public information");
      }
      const template = typeof index.source === "string" ? index.source : new TextDecoder().decode(index.source);
      for (const page of PUBLIC_INFORMATION_PAGES) {
        this.emitFile({ type: "asset", fileName: `${page}.html`, source: renderPublicInformationDocument(template, page) });
      }
    }
  };
}
