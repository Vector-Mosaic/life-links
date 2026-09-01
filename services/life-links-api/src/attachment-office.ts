import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AttachmentProcessingError, type AttachmentProcessingJob } from "./attachment-native-runtime.js";

// Defense in depth: preparation removes evaluative input before Office loads it.
// These are Office-owned registry properties, not a claim that --headless is a sandbox.
export const OFFICE_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop><prop oor:name="Field" oor:op="fuse"><value>false</value></prop><prop oor:name="Chart" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>1</value></prop><prop oor:name="RecalcOptimalRowHeightMode" oor:op="fuse"><value>1</value></prop></item>
</oor:items>`;

export async function prepareOfficePdf(data: Buffer, mimeType: string, job: AttachmentProcessingJob): Promise<{ data: Buffer; warnings: string[]; processorVersion: string }> {
  const format = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" :
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ? "xlsx" : null;
  if (!format) throw new AttachmentProcessingError("unsupported_format");
  const prepared = await job.runWorker("office", { data, mimeType });
  if (!prepared || prepared.status !== "ready") {
    const reason = prepared?.reason === "extraction_limit" ? "decode_limit" :
      ["encrypted", "unsupported_format"].includes(prepared?.reason) ? prepared.reason : "malformed";
    throw new AttachmentProcessingError(reason);
  }
  const bytes = Buffer.from(prepared.data ?? []);
  if (!bytes.length || bytes.length > 25 * 1024 * 1024 || !Array.isArray(prepared.warnings) || prepared.warnings.length > 4 ||
      prepared.warnings.some((warning: unknown) => typeof warning !== "string" || warning.length > 160)) throw new AttachmentProcessingError("decode_limit");
  const input = join(job.directory, `document.${format}`); const output = join(job.directory, "document.pdf");
  const profile = join(job.directory, "office-profile");
  await mkdir(join(profile, "user"), { recursive: true, mode: 0o700 });
  await writeFile(join(profile, "user", "registrymodifications.xcu"), OFFICE_PROFILE, { flag: "wx", mode: 0o600 });
  await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
  job.signal?.throwIfAborted();
  const versionResult = await job.runNative("office", ["--version"], { stdoutLimit: 4096 });
  const version = /^LibreOffice\s+(\d+(?:\.\d+){1,4})\b/m.exec(versionResult.stdout.toString("utf8"))?.[1];
  if (!version) throw new AttachmentProcessingError("runtime_unavailable");
  const filter = format === "docx" ? "writer_pdf_Export" : "calc_pdf_Export";
  const options = JSON.stringify({ UseLosslessCompression: { type: "boolean", value: "true" },
    ReduceImageResolution: { type: "boolean", value: "false" }, ExportFormFields: { type: "boolean", value: "false" },
    IsAddStream: { type: "boolean", value: "false" }, PDFViewSelection: { type: "long", value: "3" } });
  await job.runNative("office", [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--nologo", "--nodefault", "--norestore",
    "--convert-to", `pdf:${filter}:${options}`, "--outdir", job.directory, input], { stdoutLimit: 8192 });
  job.signal?.throwIfAborted();
  const info = await lstat(output).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 5) throw new AttachmentProcessingError("malformed");
  if (info.size > 25 * 1024 * 1024) throw new AttachmentProcessingError("decode_limit");
  const pdf = await readFile(output);
  if (pdf.length !== info.size || !pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new AttachmentProcessingError("malformed");
  return { data: pdf, warnings: prepared.warnings, processorVersion: `libreoffice/${version};cached-print-v1` };
}
