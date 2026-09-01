import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

type PdfFixtureOptions = {
  pages?: number;
  width?: number;
  height?: number;
  cropBox?: [number, number, number, number];
  rotation?: number;
  encrypted?: boolean;
  transferMap?: boolean;
};

const passwordPadding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const md5 = (value: Buffer) => createHash("md5").update(value).digest();
const pad = (value: string) => Buffer.concat([Buffer.from(value), passwordPadding]).subarray(0, 32);

function rc4(key: Buffer, value: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
  const result = Buffer.alloc(value.length); let i = 0; j = 0;
  for (let n = 0; n < value.length; n++) {
    i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]];
    result[n] = value[n] ^ state[(state[i] + state[j]) & 255];
  }
  return result;
}

function serialize(objects: Buffer[], encryptId?: number, documentId?: Buffer): Buffer {
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]; const offsets = [0]; let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk); size += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R /ID [<${documentId!.toString("hex")}> <${documentId!.toString("hex")}>]` : ""} >>\nstartxref\n${size}\n%%EOF`));
  return Buffer.concat(chunks);
}

function stream(data: Buffer, extra = ""): Buffer {
  return Buffer.concat([Buffer.from(`<< /Length ${data.length}${extra} >>\nstream\n`), data, Buffer.from("\nendstream")]);
}

/** Valid PDFs assembled directly from objects: tests do not use the renderer as their oracle. */
export function vectorPdf(options: PdfFixtureOptions = {}): Buffer {
  const { pages = 2, width = 100, height = 80, cropBox, rotation = 0, encrypted = false, transferMap = false } = options;
  const documentId = Buffer.from("102030405060708090a0b0c0d0e0f001", "hex");
  const ownerKey = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad("fixture-private"));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const encryptionKey = md5(Buffer.concat([pad("fixture-private"), ownerKey, permissions, documentId])).subarray(0, 5);
  const userKey = rc4(encryptionKey, passwordPadding);
  const objects = [Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages} >>`)];
  for (let page = 0; page < pages; page++) {
    const contentId = 4 + page * 2;
    const resources = transferMap ? "/ExtGState << /GS << /TR << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >> >> >>" : "";
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]${cropBox ? ` /CropBox [${cropBox.join(" ")}]` : ""} /Rotate ${rotation} /Resources << ${resources} >> /Contents ${contentId} 0 R >>`));
    // A lower-left square and an upper-right triangle distinguish page and orientation.
    const content = `${transferMap ? "/GS gs\n" : ""}${page % 2 ? "0 1 0" : "1 0 0"} rg 10 10 30 20 re f\n${page % 2 ? "1 1 0" : "0 0 1"} rg 60 50 m 90 50 l 75 70 l h f\n`;
    let bytes = deflateSync(Buffer.from(content));
    if (encrypted) {
      const identity = Buffer.alloc(5); identity.writeUIntLE(contentId, 0, 3);
      bytes = rc4(md5(Buffer.concat([encryptionKey, identity])).subarray(0, 10), bytes);
    }
    objects.push(stream(bytes, " /Filter /FlateDecode"));
  }
  if (encrypted) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${ownerKey.toString("hex")}> /U <${userKey.toString("hex")}> /P -4 >>`));
  return serialize(objects, encrypted ? objects.length : undefined, documentId);
}

/** A scan-like PDF containing only a compressed raster, with no text objects or fonts. */
export function rasterOnlyPdf(options: { corruptImage?: boolean } = {}): Buffer {
  const width = 240; const height = 120; const pixels = Buffer.alloc(width * height * 3, 255);
  const paint = (x: number, y: number, color: number[]) => pixels.set(color, (y * width + x) * 3);
  for (let y = 12; y < 48; y++) for (let x = 12; x < 48; x++) paint(x, y, [255, 0, 0]);
  for (let y = 12; y < 48; y++) for (let x = 152; x < 188; x++) if (x >= 170 - (y - 12) / 2 && x <= 170 + (y - 12) / 2) paint(x, y, [0, 0, 255]);
  const glyphs = [
    ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    ["00010", "00110", "01010", "10010", "11111", "00010", "00010"]
  ];
  glyphs.forEach((rows, glyph) => rows.forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === "1") for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) paint(56 + glyph * 32 + x * 4 + dx, 72 + y * 4 + dy, [0, 0, 0]);
  })));
  const content = Buffer.from("q 240 0 0 120 0 0 cm /Scan Do Q\n");
  return serialize([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>"),
    stream(content),
    stream(options.corruptImage ? Buffer.from("NOT-A-JPEG") : deflateSync(pixels), ` /Type /XObject /Subtype /Image /Width 240 /Height 120 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${options.corruptImage ? "/DCTDecode" : "/FlateDecode"} /Interpolate false`)
  ]);
}
