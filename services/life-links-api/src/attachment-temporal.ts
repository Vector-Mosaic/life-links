import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENT_IMAGE_MAX_PIXELS, ATTACHMENT_IMAGE_MAX_SOURCE_EDGE,
  type AttachmentImageReadOptions, type AttachmentImageResult } from "@life-links/core";
import { AttachmentProcessingError, type AttachmentProcessingJob } from "./attachment-native-runtime.js";

const MAX_FRAMES = 512;
const MAX_DURATION_MS = 300_000;
const MAX_STREAMS = 8;
const PROBE_BYTES = 2 * 1024 * 1024;
const FRAME_BYTES = 128 * 1024 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const videoMimes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function fail(reason: "malformed" | "decode_limit" | "unsupported_format"): never { throw new AttachmentProcessingError(reason); }
function requestError(code: string): never { throw Object.assign(new Error(code), { requestError: code }); }

type Animation = { width: number; height: number; delays: number[]; loopCount: number | null; format: "gif" | "apng" | "webp" };
export type TemporalStream = {
  index: number; codecType: string; codecName: string; timeBase: string; startTimeMs: number;
  durationMs: number | null; width?: number; height?: number; sampleAspectRatio?: string;
  rotation: number; attachedPic: boolean;
};
export type TemporalProbe = {
  inputPath: string; inputArguments: string[]; formatName: string; durationMs: number;
  startTimeMs: number; timelineStartSeconds: string; streams: TemporalStream[]; warnings: string[]; processorVersion: string;
};
export type PreparedTemporalImage = {
  data?: Buffer; source: NonNullable<AttachmentImageResult["source"]>; warnings: string[]; processorVersion: string;
};

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
      width * height > ATTACHMENT_IMAGE_MAX_PIXELS) fail("decode_limit");
}

function addFrame(delays: number[], delay: number): void {
  if (delays.length >= MAX_FRAMES) fail("decode_limit");
  if (!Number.isFinite(delay) || delay < 0) fail("malformed");
  delays.push(delay);
}

/** Only container structure/timing is read here. Native decoders still validate
 * and composite the selected frame; bytes are never mistaken for instructions. */
function animationInfo(data: Buffer, mimeType: string): Animation | null {
  if (data.length > MAX_INPUT_BYTES) fail("decode_limit");
  if (mimeType === "image/gif") {
    if (data.length < 14 || !["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) fail("malformed");
    const width = data.readUInt16LE(6); const height = data.readUInt16LE(8); dimensions(width, height);
    let offset = 13 + (data[10] & 128 ? 3 * (1 << ((data[10] & 7) + 1)) : 0);
    const delays: number[] = []; let delay = 0; let loopCount: number | null = null; let ended = false;
    const blocks = (keep = 0): Buffer[] => {
      const result: Buffer[] = [];
      while (offset < data.length) {
        const length = data[offset++];
        if (!length) return result;
        if (offset + length > data.length) fail("malformed");
        // Image/comment payload may contain millions of tiny sub-blocks. Skip
        // those bytes without retaining a Buffer object for each block.
        if (result.length < keep) result.push(data.subarray(offset, offset + length));
        offset += length;
      }
      return fail("malformed");
    };
    while (offset < data.length) {
      const marker = data[offset++];
      if (marker === 0x3b) { ended = true; break; }
      if (marker === 0x21) {
        if (offset >= data.length) fail("malformed");
        const label = data[offset++]; const values = blocks(label === 0xf9 || label === 0xff ? 3 : 0);
        if (label === 0xf9) {
          if (values.length !== 1 || values[0].length !== 4) fail("malformed");
          delay = values[0].readUInt16LE(1) * 10;
        } else if (label === 0xff && values[0]?.toString("ascii") === "NETSCAPE2.0") {
          if (values[1]?.length !== 3 || values[1][0] !== 1) fail("malformed");
          loopCount = values[1].readUInt16LE(1);
        }
      } else if (marker === 0x2c) {
        if (offset + 10 > data.length) fail("malformed");
        const x = data.readUInt16LE(offset); const y = data.readUInt16LE(offset + 2);
        const w = data.readUInt16LE(offset + 4); const h = data.readUInt16LE(offset + 6);
        if (!w || !h || x + w > width || y + h > height) fail("malformed");
        const packed = data[offset + 8]; offset += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
        if (offset >= data.length) fail("malformed");
        offset++; blocks(); addFrame(delays, delay); delay = 0;
      } else fail("malformed");
    }
    if (!ended || !delays.length) fail("malformed");
    return delays.length > 1 ? { width, height, delays, loopCount, format: "gif" } : null;
  }
  if (mimeType === "image/png") {
    if (data.length < 33 || !data.subarray(0, 8).equals(pngSignature)) fail("malformed");
    let offset = 8; let width = 0; let height = 0; let count = 0; let loopCount = 0; let ended = false;
    const delays: number[] = [];
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset); const kind = data.subarray(offset + 4, offset + 8).toString("ascii");
      if (length > data.length - offset - 12) fail("malformed");
      const chunk = data.subarray(offset + 8, offset + 8 + length);
      if (kind === "IHDR") {
        if (offset !== 8 || length !== 13) fail("malformed");
        width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); dimensions(width, height);
      } else if (kind === "acTL") {
        if (length !== 8 || count) fail("malformed");
        count = chunk.readUInt32BE(0); loopCount = chunk.readUInt32BE(4);
        if (!count) fail("malformed");
        if (count > MAX_FRAMES) fail("decode_limit");
      } else if (kind === "fcTL") {
        if (length !== 26 || !count) fail("malformed");
        const w = chunk.readUInt32BE(4); const h = chunk.readUInt32BE(8);
        if (!w || !h || chunk.readUInt32BE(12) + w > width || chunk.readUInt32BE(16) + h > height || chunk[24] > 2 || chunk[25] > 1) fail("malformed");
        addFrame(delays, chunk.readUInt16BE(20) * 1000 / (chunk.readUInt16BE(22) || 100));
      } else if (kind === "IEND") { ended = true; break; }
      offset += length + 12;
    }
    if (!ended || !width || (count && delays.length !== count)) fail("malformed");
    return count ? { width, height, delays, loopCount, format: "apng" } : null;
  }
  if (mimeType === "image/webp") {
    if (data.length < 20 || data.subarray(0, 4).toString("ascii") !== "RIFF" || data.subarray(8, 12).toString("ascii") !== "WEBP" ||
        data.readUInt32LE(4) !== data.length - 8) fail("malformed");
    let offset = 12; let width = 0; let height = 0; let animated = false; let loopCount: number | null = null;
    const delays: number[] = [];
    while (offset + 8 <= data.length) {
      const length = data.readUInt32LE(offset + 4); const kind = data.subarray(offset, offset + 4).toString("ascii");
      if (length > data.length - offset - 8) fail("malformed");
      const chunk = data.subarray(offset + 8, offset + 8 + length);
      if (kind === "VP8X") {
        if (length !== 10) fail("malformed");
        animated = Boolean(chunk[0] & 2); width = chunk.readUIntLE(4, 3) + 1; height = chunk.readUIntLE(7, 3) + 1; dimensions(width, height);
      } else if (kind === "ANIM") {
        if (length !== 6 || !animated || loopCount !== null) fail("malformed");
        loopCount = chunk.readUInt16LE(4);
      } else if (kind === "ANMF") {
        if (length < 16 || !animated || loopCount === null) fail("malformed");
        const x = chunk.readUIntLE(0, 3) * 2; const y = chunk.readUIntLE(3, 3) * 2;
        const w = chunk.readUIntLE(6, 3) + 1; const h = chunk.readUIntLE(9, 3) + 1;
        if (x + w > width || y + h > height || chunk[15] & 0xfc) fail("malformed");
        addFrame(delays, chunk.readUIntLE(12, 3));
      }
      offset += length + 8 + (length & 1);
    }
    if (offset !== data.length || (animated && (!delays.length || loopCount === null))) fail("malformed");
    return animated ? { width, height, delays, loopCount, format: "webp" } : null;
  }
  return null;
}

/** Called only for the supported attachment MIME types; static images retain
 * their established sharp path, not an unnecessary video transcode. */
export function isTemporalAttachment(data: Buffer, mimeType: string): boolean {
  return videoMimes.has(mimeType) || animationInfo(data, mimeType) !== null;
}

function inputFormat(data: Buffer, mimeType: string, animation: Animation | null): string {
  // Pinned FFmpeg 9.0.1 names this demuxer webp_anim; the newer online manual
  // calls it webp. Never select webp_pipe, which can flatten animation.
  if (animation) return animation.format === "webp" ? "webp_anim" : animation.format;
  if (mimeType === "video/webm") {
    if (data.length < 4 || data.readUInt32BE(0) !== 0x1a45dfa3) fail("malformed");
    return "matroska";
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    if (data.length < 12 || !["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(data.subarray(4, 8).toString("ascii"))) fail("malformed");
    return "mov";
  }
  return fail("unsupported_format");
}

/** File input and the one chosen demuxer are allowlisted. MOV external data
 * references remain disabled; no original filename, network URL or user option
 * reaches argv. The job owner bounds/reaps native processes and removes files. */
function inputArguments(format: string): string[] {
  const args = ["-protocol_whitelist", "file", "-format_whitelist", format === "mov" ? "mov,mp4,m4a,3gp,3g2,mj2" : format,
    "-f", format, "-max_streams", String(MAX_STREAMS), "-max_pixels", String(ATTACHMENT_IMAGE_MAX_PIXELS),
    "-threads", "1", "-err_detect", "crccheck+explode"];
  if (format === "mov") args.push("-enable_drefs", "0", "-use_absolute_path", "0", "-ignore_chapters", "1");
  if (["gif", "apng", "webp_anim"].includes(format)) args.push("-ignore_loop", "1");
  // Retain declared zero/small delays instead of substituting browser defaults.
  if (format === "gif" || format === "webp_anim") args.push("-min_delay", "0", "-default_delay", "0");
  return args;
}

function finiteMs(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return null;
  const number = Number(value) * 1000;
  return Number.isFinite(number) ? number : null;
}
function rational(value: unknown): [bigint, bigint] {
  if (typeof value !== "string" || !/^\d{1,12}\/\d{1,12}$/.test(value)) fail("malformed");
  const [n, d] = value.split("/").map(BigInt);
  if (n <= 0n || d <= 0n) fail("malformed");
  return [n, d];
}
const roundedMs = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
function decimalSeconds(value: unknown): { text: string; numerator: bigint; denominator: bigint } {
  const text = value === undefined || value === "N/A" ? "0" : String(value);
  if (!/^-?\d{1,12}(?:\.\d{1,9})?$/.test(text)) fail("malformed");
  const [integer, fraction = ""] = text.replace(/^-/, "").split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return { text, numerator: (BigInt(integer) * denominator + BigInt(fraction || "0")) * (text.startsWith("-") ? -1n : 1n), denominator };
}

/** Shared with local video-speech extraction: one materialized source/probe,
 * no second identity, queue, process owner or untrusted metadata transport. */
export async function probeTemporalSource(data: Buffer, mimeType: string, job: AttachmentProcessingJob): Promise<TemporalProbe> {
  if (!data.length) fail("malformed");
  if (data.length > MAX_INPUT_BYTES) fail("decode_limit");
  const animation = animationInfo(data, mimeType); const format = inputFormat(data, mimeType, animation);
  const inputPath = join(job.directory, `${randomUUID()}.input`);
  await writeFile(inputPath, data, { flag: "wx", mode: 0o600 });
  const args = inputArguments(format);
  const entries = "program_version=version:format=format_name,duration,start_time:stream=index,codec_type,codec_name,time_base,start_time,duration,width,height,sample_aspect_ratio:stream_disposition=attached_pic:stream_side_data=rotation";
  const result = await job.runNative("ffprobe", ["-v", "error", ...args, "-show_program_version", "-show_entries", entries, "-of", "json", "-i", inputPath], { stdoutLimit: PROBE_BYTES });
  let probe: any;
  try { probe = JSON.parse(result.stdout.toString("utf8")); } catch { return fail("malformed"); }
  if (!probe || !Array.isArray(probe.streams) || !probe.streams.length) fail("malformed");
  if (probe.streams.length > MAX_STREAMS) fail("decode_limit");
  const streams: TemporalStream[] = probe.streams.map((stream: any) => {
    if (!Number.isSafeInteger(stream.index) || stream.index < 0 || stream.index >= MAX_STREAMS ||
        typeof stream.codec_type !== "string" || !/^[a-z_]{1,20}$/.test(stream.codec_type) ||
        typeof stream.codec_name !== "string" || !/^[a-z0-9_]{1,40}$/.test(stream.codec_name)) fail("malformed");
    const timeBase = stream.time_base ?? "1/1000"; rational(timeBase);
    const rotationValue = stream.side_data_list?.find((value: any) => value.rotation !== undefined)?.rotation ?? 0;
    if (!Number.isFinite(rotationValue) || Math.abs(rotationValue / 90 - Math.round(rotationValue / 90)) > 0.0001) fail("unsupported_format");
    const rotation = ((Math.round(rotationValue) % 360) + 360) % 360;
    const durationMs = finiteMs(stream.duration); const startTimeMs = finiteMs(stream.start_time) ?? 0;
    if (durationMs !== null && (durationMs < 0 || (!animation && durationMs > MAX_DURATION_MS))) fail("decode_limit");
    if (stream.codec_type === "video") dimensions(stream.width, stream.height);
    return { index: stream.index, codecType: stream.codec_type, codecName: stream.codec_name, timeBase, startTimeMs, durationMs,
      width: stream.width, height: stream.height, sampleAspectRatio: stream.sample_aspect_ratio, rotation,
      attachedPic: stream.disposition?.attached_pic === 1 };
  });
  if (new Set(streams.map((value) => value.index)).size !== streams.length) fail("malformed");
  const durationMs = animation ? animation.delays.reduce((sum, value) => sum + value, 0) : finiteMs(probe.format?.duration);
  if (durationMs === null || durationMs < 0) fail("malformed");
  if (!animation && durationMs > MAX_DURATION_MS) fail("decode_limit");
  const version = probe.program_version?.version;
  if (version !== "9.0.1") throw new AttachmentProcessingError("runtime_unavailable");
  const encoderVersion = await job.runNative("ffmpeg", ["-version"], { stdoutLimit: 16 * 1024 });
  if (!/^ffmpeg version 9\.0\.1\s/.test(encoderVersion.stdout.toString("utf8"))) throw new AttachmentProcessingError("runtime_unavailable");
  const timelineStart = decimalSeconds(probe.format?.start_time);
  return { inputPath, inputArguments: args, formatName: format, durationMs, startTimeMs: finiteMs(timelineStart.text) ?? 0, timelineStartSeconds: timelineStart.text,
    streams, warnings: [], processorVersion: `life-links-temporal-v1/ffmpeg-${version}` };
}

type DecodedFrame = { ordinal: number; pts: string; timeMs: number; timeNumerator: bigint; timeDenominator: bigint;
  width: number; height: number; pixelFormat: string; sampleAspectRatio: string };
async function videoFrames(probe: TemporalProbe, stream: TemporalStream, job: AttachmentProcessingJob): Promise<DecodedFrame[]> {
  const result = await job.runNative("ffprobe", ["-v", "error", ...probe.inputArguments,
    "-select_streams", String(stream.index), "-show_frames", "-show_entries", "frame=pts,width,height,pix_fmt,sample_aspect_ratio:frame_side_data=",
    "-of", "compact=p=0:nk=0", "-i", probe.inputPath], { stdoutLimit: PROBE_BYTES });
  const frames: DecodedFrame[] = []; const [numerator, denominator] = rational(stream.timeBase);
  const origin = decimalSeconds(probe.timelineStartSeconds);
  for (const line of result.stdout.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields: Record<string, string> = {};
    for (const field of line.split("|")) {
      if (!field) continue;
      const [key, value, extra] = field.split("=");
      if (extra !== undefined || !["pts", "width", "height", "pix_fmt", "sample_aspect_ratio"].includes(key) || value === undefined || Object.hasOwn(fields, key)) fail("malformed");
      fields[key] = value;
    }
    if (!/^-?\d{1,20}$/.test(fields.pts ?? "")) fail("malformed");
    const width = Number(fields.width); const height = Number(fields.height); dimensions(width, height);
    const pixelFormat = fields.pix_fmt; const sampleAspectRatio = fields.sample_aspect_ratio ?? stream.sampleAspectRatio ?? "1:1";
    if (!/^[a-z0-9_]{1,32}$/.test(pixelFormat ?? "")) fail("malformed");
    // Decoder parameter changes can reinitialize FFmpeg's filter graph and
    // reset select(n). Refuse that subcase instead of returning a wrong frame.
    if (frames.length && (width !== frames[0].width || height !== frames[0].height ||
        pixelFormat !== frames[0].pixelFormat || sampleAspectRatio !== frames[0].sampleAspectRatio)) fail("unsupported_format");
    const timeNumerator = (BigInt(fields.pts) * numerator * origin.denominator - origin.numerator * denominator) * 1000n;
    const timeDenominator = denominator * origin.denominator;
    const timeMs = Number(timeNumerator) / Number(timeDenominator);
    if (!Number.isFinite(timeMs) || timeMs < -1 || timeMs > MAX_DURATION_MS ||
        (frames.length && timeNumerator < frames.at(-1)!.timeNumerator)) fail("malformed");
    frames.push({ ordinal: frames.length, pts: fields.pts, timeMs, timeNumerator, timeDenominator, width, height, pixelFormat, sampleAspectRatio });
  }
  if (!frames.length) fail("malformed");
  return frames;
}

function displayDimensions(width: number, height: number, ratio: string, rotation: number): { width: number; height: number } {
  if (ratio === "N/A" || ratio === "0:1") ratio = "1:1";
  if (!/^\d{1,8}:\d{1,8}$/.test(ratio)) fail("malformed");
  const [n, d] = ratio.split(":").map(Number);
  if (!n || !d) fail("malformed");
  const displayWidth = Math.round(width * n / d); dimensions(displayWidth, height);
  return rotation === 90 || rotation === 270 ? { width: height, height: displayWidth } : { width: displayWidth, height };
}

async function renderFrame(probe: TemporalProbe, stream: TemporalStream, ordinal: number, width: number, height: number,
  job: AttachmentProcessingJob): Promise<Buffer> {
  dimensions(width, height);
  const filters = `select=eq(n\\,${ordinal}),scale=${width}:${height}:flags=lanczos,setsar=1`;
  const result = await job.runNative("ffmpeg", ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-max_error_rate", "0",
    ...probe.inputArguments, "-autorotate", "-i", probe.inputPath, "-map", `0:${stream.index}`,
    "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-vf", filters,
    "-frames:v", "1", "-fps_mode", "passthrough", "-threads", "1", "-c:v", "png", "-pix_fmt", "rgba", "-f", "image2pipe", "pipe:1"],
  { stdoutLimit: FRAME_BYTES });
  const data = result.stdout;
  if (data.length < 33 || !data.subarray(0, 8).equals(pngSignature) || data.subarray(12, 16).toString("ascii") !== "IHDR" ||
      data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) fail("malformed");
  return data;
}

export async function prepareTemporalImage(data: Buffer, mimeType: string,
  options: AttachmentImageReadOptions & { frame?: number; atMs?: number }, job: AttachmentProcessingJob): Promise<PreparedTemporalImage> {
  if (options.page !== undefined || (options.frame !== undefined && options.atMs !== undefined)) requestError("invalid_attachment_image_request");
  const animation = animationInfo(data, mimeType);
  if (!animation && !videoMimes.has(mimeType)) requestError("invalid_attachment_image_request");
  if (animation ? options.atMs !== undefined : options.frame !== undefined) requestError("invalid_attachment_image_request");
  const frameNumber = options.frame ?? 1; const requestedTimeMs = options.atMs ?? 0;
  if (!Number.isSafeInteger(frameNumber) || frameNumber < 1 || frameNumber > MAX_FRAMES) requestError("invalid_attachment_image_frame");
  if (!Number.isSafeInteger(requestedTimeMs) || requestedTimeMs < 0 || requestedTimeMs > MAX_DURATION_MS) requestError("invalid_attachment_image_time");
  if (animation && frameNumber > animation.delays.length) requestError("invalid_attachment_image_frame");
  const probe = await probeTemporalSource(data, mimeType, job);
  const stream = probe.streams.find((value) => value.codecType === "video" && !value.attachedPic);
  if (!stream) fail("unsupported_format");
  const warnings = [animation ? "Only the selected composited animation frame is delivered; other frames are not visually inspected."
    : "Only one selected video frame is delivered; frameCount is 1, not the video's total frame count."];
  if (probe.streams.some((value) => value.index !== stream.index)) warnings.push("Additional video, audio or other streams are not inspected by this image request.");
  let source: NonNullable<AttachmentImageResult["source"]>; let ordinal: number;
  if (animation) {
    const startMs = roundedMs(animation.delays.slice(0, frameNumber - 1).reduce((sum, value) => sum + value, 0));
    const size = displayDimensions(animation.width, animation.height, stream.sampleAspectRatio ?? "1:1", stream.rotation);
    source = { mimeType, sizeBytes: data.length, ...size, orientation: 1, frameCount: animation.delays.length,
      animation: { frameNumber, frameCount: animation.delays.length, startMs, durationMs: roundedMs(animation.delays[frameNumber - 1]), loopCount: animation.loopCount } };
    ordinal = frameNumber - 1;
    if (animation.delays.some((delay) => delay === 0)) warnings.push("Animation timing preserves declared zero delays; playback applications may impose a minimum delay.");
    if (stream.rotation || size.width !== animation.width || size.height !== animation.height) warnings.push("Display rotation and pixel aspect ratio are normalized before cropping.");
  } else {
    if (requestedTimeMs >= probe.durationMs && requestedTimeMs !== 0) requestError("invalid_attachment_image_time");
    const frames = await videoFrames(probe, stream, job);
    let frame = frames[0];
    for (const candidate of frames) {
      // Compare exact source ticks, not rounded millisecond metadata or the
      // requested timestamp. This also preserves VFR boundaries and large PTS.
      if (candidate.timeNumerator > BigInt(requestedTimeMs) * candidate.timeDenominator) break;
      frame = candidate;
    }
    const size = displayDimensions(frame.width, frame.height, frame.sampleAspectRatio, stream.rotation);
    ordinal = frame.ordinal;
    source = { mimeType, sizeBytes: data.length, ...size, orientation: 1, frameCount: 1,
      video: { streamIndex: stream.index, durationMs: roundedMs(probe.durationMs), requestedTimeMs, frameTimeMs: roundedMs(frame.timeMs),
        framePts: frame.pts, timeBase: stream.timeBase, hasAudio: probe.streams.some((value) => value.codecType === "audio") } };
    if (frame.timeMs > requestedTimeMs) warnings.push("The requested start precedes the first displayed video frame; that first frame is returned.");
    if (stream.rotation || frame.sampleAspectRatio !== "1:1") warnings.push("Display rotation and pixel aspect ratio are normalized before cropping.");
  }
  if (options.mode === "crop" && (options.region.x + options.region.width > source.width || options.region.y + options.region.height > source.height)) requestError("invalid_attachment_image_region");
  return { source, warnings, processorVersion: probe.processorVersion,
    data: options.mode === "describe" ? undefined : await renderFrame(probe, stream, ordinal, source.width, source.height, job) };
}
