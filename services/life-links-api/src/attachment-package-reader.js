// Shared byte preflight for Office text and visual derivatives. Never extract to disk.
import yauzl from "yauzl";

const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
const maxZipBytes = 64 * 1024 * 1024;
const maxEntryBytes = 16 * 1024 * 1024;

export async function validateOfficePackage(data, format, collect = format === "docx") {
  if (data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) fail("encrypted");
  const names = new Set(); const parts = new Map(); let count = 0; let total = 0;
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("malformed"));
      const stop = (error) => { zip.close(); reject(error); };
      zip.on("error", stop); zip.on("end", resolve);
      zip.on("entry", (entry) => {
        try {
          if (++count > 2048 || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
              entry.uncompressedSize > maxEntryBytes || (total += entry.uncompressedSize) > maxZipBytes) fail("extraction_limit");
          if (entry.generalPurposeBitFlag & 1) fail("encrypted");
          if (names.has(entry.fileName) || /(^|\/)vbaProject\.bin$/i.test(entry.fileName)) fail("malformed");
          names.add(entry.fileName);
          if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) { stop(error ?? new Error("malformed")); return; }
            let size = 0; const chunks = [];
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > maxEntryBytes || size > entry.uncompressedSize) stream.destroy(Object.assign(new Error("extraction_limit"), { reason: "extraction_limit" }));
              else if (collect) chunks.push(chunk);
            });
            stream.on("error", stop); stream.on("end", () => {
              if (collect) parts.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        } catch (error) { stop(error); }
      });
      zip.readEntry();
    });
  });
  if (!names.has("[Content_Types].xml") || (format === "xlsx" && !names.has("xl/workbook.xml"))) fail("malformed");
  return parts;
}
