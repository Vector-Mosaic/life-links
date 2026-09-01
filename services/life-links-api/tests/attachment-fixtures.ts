import JSZip from "jszip";
import ExcelJS from "exceljs";

export function textPdf(text: string, blankPage = false): Buffer {
  const content = `BT /F1 12 Tf 40 160 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [3 0 R${blankPage ? " 6 0 R" : ""}] /Count ${blankPage ? 2 : 1} >>`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...(blankPage ? ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> >>"] : [])
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

export const wordSecondaryFacts = {
  header: "Serial H-8402 — café 🏕️",
  unreferencedHeader: "Unused header maintenance fact: replace filter U-2154.",
  footer: "Warranty expires 2032-04-19.",
  footnote: "Tighten the brass valve to 4 N·m.",
  endnote: "Replacement seal: END-6938.",
  comment: "Owner comment: inspect the blue seam before use."
} as const;

export async function wordDocument(text: string, withSecondaryText = false): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p></w:body></w:document>`);
  if (withSecondaryText) {
    const parts = [
      ["header1", "header", "hdr", wordSecondaryFacts.header],
      ["footer1", "footer", "ftr", wordSecondaryFacts.footer],
      ["footnotes", "footnotes", "footnotes", wordSecondaryFacts.footnote],
      ["endnotes", "endnotes", "endnotes", wordSecondaryFacts.endnote],
      ["comments", "comments", "comments", wordSecondaryFacts.comment]
    ] as const;
    const namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    for (const [name, type, tag, marker] of parts) {
      const tabStop = type === "header" ? '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' : "";
      const paragraph = `<w:p>${tabStop}<w:r><w:t>${marker}</w:t></w:r></w:p>`;
      const singular = type === "footnotes" ? "footnote" : type === "endnotes" ? "endnote" : type === "comments" ? "comment" : null;
      const headerTable = type === "header" ? '<w:p><w:r><w:t>Header second paragraph.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Pressure</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4 bar</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' : "";
      const separator = type === "footnotes" || type === "endnotes" ? `<w:${singular} w:id="0" w:type="separator"><w:p><w:r><w:t>${type.toUpperCase()}_SEPARATOR_EXPLANATION</w:t></w:r></w:p></w:${singular}>` : "";
      const orphan = singular ? `<w:${singular} w:id="99"><w:p><w:r><w:t>UNREFERENCED_${type.toUpperCase()}_TEXT</w:t></w:r></w:p></w:${singular}>` : "";
      zip.file(`word/${name}.xml`, `<w:${tag} ${namespace}>${singular ? `${separator}<w:${singular} w:id="1">${paragraph}</w:${singular}>${orphan}` : paragraph + headerTable}</w:${tag}>`);
    }
    const types = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", types.replace("</Types>", parts.map(([name, type]) => `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join("") + '<Override PartName="/word/header-unused.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
    zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map(([name, type]) => `<Relationship Id="${type}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${name}.xml"/>`).join("")}<Relationship Id="unused-header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-unused.xml"/></Relationships>`);
    const document = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", document.replace("<w:document ", '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ').replace("</w:body>", '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:pPr><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/><w:commentReference w:id="1"/></w:r></w:p><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/></w:sectPr></w:body>'));
    zip.file("word/orphan-header.xml", `<w:hdr ${namespace}><w:p><w:r><w:t>ORPHAN_HEADER_NOT_REFERENCED</w:t></w:r></w:p></w:hdr>`);
    zip.file("word/header-unused.xml", `<w:hdr ${namespace}><w:p><w:r><w:t>${wordSecondaryFacts.unreferencedHeader}</w:t></w:r></w:p></w:hdr>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function workbookDocument(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Camping");
  sheet.getCell("A1").value = "Tent checklist";
  sheet.getCell("B2").value = { formula: "1+2", result: 3 };
  const hidden = workbook.addWorksheet("Hidden notes", { state: "hidden" });
  hidden.getCell("A1").value = "Inspect poles";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function extendedConditionalFormattingWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Safe UUID compatibility");
  sheet.getCell("A1").value = "Packed items";
  sheet.getCell("A2").value = 3;
  sheet.getCell("A3").value = 9;
  sheet.addConditionalFormatting({
    ref: "A2:A3",
    rules: [{
      type: "dataBar",
      priority: 1,
      gradient: false,
      cfvo: [{ type: "min" }, { type: "max" }],
      color: { argb: "FF00AA88" }
    } as ExcelJS.DataBarRuleType & { color: { argb: string } }]
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
