import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import type { AttachmentProcessingJob } from "../src/attachment-native-runtime.js";

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type); let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); name.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return chunk;
}

/** Three real delta frames. Frame 2 temporarily draws green, then disposal
 * PREVIOUS restores red before frame 3 paints one blue pixel. */
export function disposalApng(): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
  const animation = Buffer.alloc(8); animation.writeUInt32BE(3); animation.writeUInt32BE(2, 4);
  let sequence = 0;
  const frame = (width: number, height: number, x: number, y: number, delay: number, disposal: number, color: number[], first = false) => {
    const control = Buffer.alloc(26); control.writeUInt32BE(sequence++); control.writeUInt32BE(width, 4); control.writeUInt32BE(height, 8);
    control.writeUInt32BE(x, 12); control.writeUInt32BE(y, 16); control.writeUInt16BE(delay, 20); control.writeUInt16BE(10, 22); control[24] = disposal;
    const pixels = Buffer.alloc(height * (width * 4 + 1));
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) pixels.set(color, row * (width * 4 + 1) + 1 + col * 4);
    const compressed = deflateSync(pixels);
    const prefix = Buffer.alloc(4); if (!first) prefix.writeUInt32BE(sequence++);
    return [pngChunk("fcTL", control), pngChunk(first ? "IDAT" : "fdAT", first ? compressed : Buffer.concat([prefix, compressed]))];
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("acTL", animation),
    ...frame(4, 4, 0, 0, 1, 0, [255, 0, 0, 255], true), ...frame(2, 2, 0, 0, 2, 2, [0, 255, 0, 255]),
    ...frame(1, 1, 3, 3, 3, 0, [0, 0, 255, 255]), pngChunk("IEND", Buffer.alloc(0))]);
}

export function disposalGif(): Buffer {
  // LZW clears before every literal: all codes remain 3 bits, no fixture-side
  // dictionary implementation to share a defect with the native decoder.
  const image = (width: number, height: number, x: number, y: number, delay: number, disposal: number, palette: number) => {
    const control = Buffer.from([0x21, 0xf9, 4, disposal << 2, delay, 0, 0, 0]);
    const descriptor = Buffer.alloc(10); descriptor[0] = 0x2c; descriptor.writeUInt16LE(x, 1); descriptor.writeUInt16LE(y, 3);
    descriptor.writeUInt16LE(width, 5); descriptor.writeUInt16LE(height, 7);
    const codes: number[] = [];
    for (let index = 0; index < width * height; index++) codes.push(4, palette);
    codes.push(5); const compressed = Buffer.alloc(Math.ceil(codes.length * 3 / 8));
    let bit = 0;
    for (const code of codes) { for (let offset = 0; offset < 3; offset++, bit++) compressed[bit >>> 3] |= ((code >> offset) & 1) << (bit & 7); }
    return Buffer.concat([control, descriptor, Buffer.from([2, compressed.length]), compressed, Buffer.from([0])]);
  };
  const header = Buffer.from([4, 0, 4, 0, 0x81, 0, 0]);
  const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const loop = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from("NETSCAPE2.0"), Buffer.from([3, 1, 2, 0, 0])]);
  return Buffer.concat([Buffer.from("GIF89a"), header, palette, loop,
    image(4, 4, 0, 0, 10, 1, 0), image(2, 2, 0, 0, 20, 3, 1), image(1, 1, 3, 3, 30, 1, 2), Buffer.from([0x3b])]);
}

export async function disposalWebp(): Promise<Buffer> {
  // The GIF decoder is used only to manufacture this lossless WebP fixture.
  // Production WebP selection must use its own real native WebP compositor.
  return sharp(disposalGif(), { animated: true }).webp({ lossless: true, loop: 2, delay: [100, 200, 300] }).toBuffer();
}

/** Lossless MOV with timestamps 0, 100, 400 ms, not a constant-rate proxy. */
export async function variableTimeVideo(job: AttachmentProcessingJob, rotate = false): Promise<Buffer> {
  for (const [index, color] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
    await writeFile(join(job.directory, `${index}.png`), await sharp({ create: { width: 32, height: 16, channels: 3, background: color } }).png().toBuffer());
  }
  const output = join(job.directory, "variable.mov");
  await job.runNative("ffmpeg", ["-v", "error", "-nostdin", "-framerate", "10", "-i", join(job.directory, "%d.png"),
    "-vf", "setpts=if(eq(N\\,0)\\,0\\,if(eq(N\\,1)\\,1\\,4))/(10*TB),setsar=2/1",
    "-fps_mode", "vfr", "-enc_time_base", "1/1000", "-c:v", "png", "-threads", "1", "-pix_fmt", "rgb24", "-f", "mov", output]);
  if (!rotate) return readFile(output);
  const rotated = join(job.directory, "rotated.mov");
  await job.runNative("ffmpeg", ["-v", "error", "-nostdin", "-display_rotation", "90", "-i", output, "-map", "0:v:0", "-c", "copy", rotated]);
  return readFile(rotated);
}
