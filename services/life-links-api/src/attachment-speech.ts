import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AttachmentProcessingError, type AttachmentProcessingJob } from "./attachment-native-runtime.js";
import { probeTemporalSource } from "./attachment-temporal.js";

const MAX_WINDOW_MS = 30_000;
const SAMPLE_RATE = 16_000;
const JSON_LIMIT = 1024 * 1024;
const ASR_WARNING = "Machine-generated speech transcription can omit or hallucinate words; it is not verified fact. Timestamps are approximate.";

export interface AttachmentSpeechResult {
  text: string;
  warnings: string[];
  startMs: number;
  endMs: number;
  sourceDurationMs: number;
  nextStartMs: number | null;
  audioStreamIndex: number;
  processorVersion: string;
  modelSha256: string;
}

/** Read one explicitly bounded audio window using the same parent-owned job,
 * source probe and private temporary directory as the visual attachment path. */
export async function transcribeVideoWindow(data: Buffer, mimeType: string,
  options: { startMs: number; durationMs: number; audioStreamIndex?: number },
  job: AttachmentProcessingJob): Promise<AttachmentSpeechResult> {
  job.signal.throwIfAborted();
  if (!Number.isSafeInteger(options.startMs) || options.startMs < 0 ||
      !Number.isSafeInteger(options.durationMs) || options.durationMs < 1 || options.durationMs > MAX_WINDOW_MS) {
    throw new AttachmentProcessingError("invalid_audio_window");
  }
  const probe = await probeTemporalSource(data, mimeType, job);
  const streams = probe.streams.filter((stream) => stream.codecType === "audio");
  if (!streams.length) throw new AttachmentProcessingError("no_audio");
  const stream = options.audioStreamIndex === undefined ? streams[0] :
    streams.find((candidate) => Number.isSafeInteger(options.audioStreamIndex) && candidate.index === options.audioStreamIndex);
  if (!stream) throw new AttachmentProcessingError("invalid_audio_stream");
  if (options.startMs >= probe.durationMs) throw new AttachmentProcessingError("invalid_audio_window");
  const endMs = Math.min(probe.durationMs, options.startMs + options.durationMs);
  const durationMs = endMs - options.startMs;
  const model = job.runtime.whisper;
  await verifyModel(model.modelPath, model.modelSha256, job.signal);
  const { stdout: pcm } = await job.runNative("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
    ...probe.inputArguments, "-ss", seconds(options.startMs), "-i", probe.inputPath,
    "-map", `0:${stream.index}`, "-t", seconds(durationMs), "-vn", "-sn", "-dn",
    "-af", "aresample=16000:async=1:first_pts=0", "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"
  ], { stdoutLimit: Math.ceil(durationMs * SAMPLE_RATE / 1000) * 2 + 64 });
  job.signal.throwIfAborted();
  if (pcm.length % 2 || pcm.length > Math.ceil(durationMs * SAMPLE_RATE / 1000) * 2) {
    throw new AttachmentProcessingError("decode_limit");
  }
  const base: AttachmentSpeechResult = {
    text: "", warnings: [...probe.warnings, ASR_WARNING, "Other audio streams and times outside this window were not transcribed."], startMs: options.startMs, endMs,
    sourceDurationMs: probe.durationMs, nextStartMs: endMs < probe.durationMs ? endMs : null,
    audioStreamIndex: stream.index, processorVersion: `${probe.processorVersion}; ${model.version}`, modelSha256: model.modelSha256
  };
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
  if (peak <= 1) {
    base.warnings.push("No audible signal was decoded in this audio window; no speech transcription was generated.");
    return base;
  }
  const wavPath = path.join(job.directory, "speech-window.wav");
  const outputBase = path.join(job.directory, "speech-transcript");
  await writeFile(wavPath, pcmWav(pcm), { flag: "wx", mode: 0o600, signal: job.signal });
  await job.runNative("whisper", [
    "--model", model.modelPath, "--file", wavPath, "--language", "auto", "--threads", "2",
    "--processors", "1", "--no-gpu", "--no-flash-attn", "--no-prints", "--suppress-nst",
    "--temperature", "0", "--no-fallback", "--max-context", "0",
    "--output-json", "--output-file", outputBase
  ], { stdoutLimit: 64 * 1024 });
  job.signal.throwIfAborted();
  const outputPath = `${outputBase}.json`;
  let bytes: Buffer;
  try {
    const metadata = await stat(outputPath);
    if (!metadata.isFile() || metadata.size > JSON_LIMIT) throw new AttachmentProcessingError("decode_limit");
    bytes = await readFile(outputPath, { signal: job.signal });
  } catch (error) {
    job.signal.throwIfAborted();
    if (error instanceof AttachmentProcessingError) throw error;
    throw new AttachmentProcessingError("malformed");
  }
  base.text = parseTranscript(bytes, options.startMs, endMs, base.warnings);
  if (!base.text.trim()) base.warnings.push("No speech was recognized in this window. This does not establish that the source contains no speech.");
  job.signal.throwIfAborted();
  return base;
}

async function verifyModel(modelPath: string, expectedHash: string, signal: AbortSignal) {
  if (!path.isAbsolute(modelPath) || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new AttachmentProcessingError("runtime_unavailable");
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(modelPath, { signal })) { signal.throwIfAborted(); hash.update(chunk); }
    if (hash.digest("hex") !== expectedHash) throw new AttachmentProcessingError("runtime_unavailable");
  } catch {
    signal.throwIfAborted();
    throw new AttachmentProcessingError("runtime_unavailable");
  }
}

function parseTranscript(bytes: Buffer, startMs: number, endMs: number, warnings: string[]) {
  let output: { transcription?: unknown };
  try { output = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AttachmentProcessingError("malformed"); }
  if (!output || !Array.isArray(output.transcription) || output.transcription.length > 512) throw new AttachmentProcessingError("malformed");
  let previousEnd = 0;
  const lines: string[] = [];
  for (const entry of output.transcription) {
    const from = entry?.offsets?.from; const to = entry?.offsets?.to;
    if (typeof entry?.text !== "string" || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
        from < previousEnd || to < from || from > endMs - startMs || to > MAX_WINDOW_MS) {
      throw new AttachmentProcessingError("malformed");
    }
    previousEnd = to;
    // Whisper uses 10 ms timestamp tokens, which can cross the last partial
    // token of a short window. Never claim a timestamp outside the actual read.
    if (to > endMs - startMs) warnings.push("The final estimated speech timestamp was limited to the end of the decoded audio window.");
    if (entry.text.trim()) lines.push(`[${timestamp(startMs + from)} – ${timestamp(Math.min(startMs + to, endMs))}]${entry.text}`);
  }
  return lines.join("\n");
}

function seconds(ms: number) { return (ms / 1000).toFixed(3); }
function timestamp(ms: number) {
  ms = Math.round(ms);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, "0")}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function pcmWav(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
