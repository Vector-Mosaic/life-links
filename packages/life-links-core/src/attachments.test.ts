import { describe, expect, it } from "vitest";
import { ATTACHMENT_FILE_ACCEPT, ATTACHMENT_MIME_TYPES, attachmentFormat, resolveAttachmentMimeType } from "./attachments.js";

describe("canonical attachment format catalog", () => {
  it("keeps the existing media types while admitting only named document formats", () => {
    expect(ATTACHMENT_MIME_TYPES["image/png"]).toBe("image");
    expect(ATTACHMENT_MIME_TYPES["video/mp4"]).toBe("video");
    for (const extension of ["pdf", "docx", "xlsx", "txt", "csv", "md", "json"]) expect(ATTACHMENT_FILE_ACCEPT).toContain(`.${extension}`);
    for (const type of Object.keys(ATTACHMENT_MIME_TYPES)) expect(resolveAttachmentMimeType(type, "file")).toBe(type);
    expect(attachmentFormat("application/pdf")).toBe("pdf");
    expect(attachmentFormat("text/markdown")).toBe("text");
  });
  it("normalizes browser document aliases without admitting legacy spreadsheets or active content", () => {
    expect(resolveAttachmentMimeType("application/vnd.ms-excel", "camp.CSV")).toBe("text/csv");
    expect(resolveAttachmentMimeType("application/vnd.ms-excel", "camp.xls")).toBeNull();
    expect(resolveAttachmentMimeType("text/x-markdown", "camp.md")).toBe("text/markdown");
    expect(resolveAttachmentMimeType("application/zip", "camp.docx")).toContain("wordprocessingml");
    expect(resolveAttachmentMimeType("application/octet-stream", "camp.xlsx")).toContain("spreadsheetml");
    for (const type of ["text/html", "text/javascript", "application/x-msdownload"]) expect(resolveAttachmentMimeType(type, "fake.txt")).toBeNull();
  });
});
