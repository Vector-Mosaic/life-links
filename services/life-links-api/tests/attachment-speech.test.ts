import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVideoWindow } from "../src/attachment-speech.js";
import { AttachmentProcessingError, type AttachmentProcessingJob } from "../src/attachment-native-runtime.js";

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("../src/attachment-temporal.js", () => ({ probeTemporalSource: probe }));
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); vi.clearAllMocks(); });

async function fixture({ silent = false, json = undefined as unknown } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "attachment-speech-test-")); folders.push(directory);
  const model = Buffer.from("synthetic model for process-boundary tests only");
  const modelPath = path.join(directory, "model.bin"); await writeFile(modelPath, model);
  probe.mockResolvedValue({ inputPath: path.join(directory, "source.input"), inputArguments: ["-f", "mov", "-enable_drefs", "0"],
    durationMs: 65_000, startTimeMs: 0, streams: [{ index: 0, codecType: "video" }, { index: 2, codecType: "audio" }, { index: 3, codecType: "audio" }],
    warnings: [], processorVersion: "ffmpeg-9.0.1" });
  const controller = new AbortController();
  const runNative = vi.fn<AttachmentProcessingJob["runNative"]>(async (binary, args) => {
    if (binary === "ffmpeg") {
      const pcm = Buffer.alloc(32_000); if (!silent) for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 1000, i);
      return { stdout: pcm, stderr: Buffer.alloc(0) };
    }
    const wavPath = args[args.indexOf("--file") + 1]; const wav = await readFile(wavPath);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF"); expect(wav.readUInt32LE(24)).toBe(16_000); expect(wav.readUInt16LE(22)).toBe(1);
    const outputBase = args[args.indexOf("--output-file") + 1];
    await writeFile(`${outputBase}.json`, typeof json === "string" ? json : JSON.stringify(json ?? { transcription: [
      { offsets: { from: 120, to: 900 }, text: " Keep the green box." },
      { offsets: { from: 900, to: 1500 }, text: " Do not translate this line." }
    ] }));
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  const job: AttachmentProcessingJob = { directory, signal: controller.signal, runNative, runWorker: vi.fn(),
    runtime: { binaries: { office: "/office", ffmpeg: "/ffmpeg", ffprobe: "/ffprobe", whisper: "/whisper" },
      whisper: { modelPath, modelSha256: createHash("sha256").update(model).digest("hex"), version: "synthetic-test-model" } } };
  return { job, runNative, controller };
}

describe("bounded local attachment speech", () => {
  it("uses the selected global audio stream and exact source window with timestamped text, provenance and remaining coverage", async () => {
    const { job, runNative } = await fixture();
    const result = await transcribeVideoWindow(Buffer.from("original"), "video/mp4", { startMs: 20_000, durationMs: 30_000, audioStreamIndex: 3 }, job);
    expect(result).toMatchObject({ startMs: 20_000, endMs: 50_000, sourceDurationMs: 65_000, nextStartMs: 50_000, audioStreamIndex: 3,
      processorVersion: "ffmpeg-9.0.1; synthetic-test-model", modelSha256: job.runtime.whisper.modelSha256 });
    expect(result.text).toBe("[00:00:20.120 – 00:00:20.900] Keep the green box.\n[00:00:20.900 – 00:00:21.500] Do not translate this line.");
    expect(result.warnings.join(" ")).toMatch(/hallucinate.*not verified fact/);
    expect(runNative.mock.calls[0][1]).toEqual(expect.arrayContaining(["-f", "mov", "-enable_drefs", "0", "-ss", "20.000", "-map", "0:3", "-t", "30.000"]));
    expect(runNative.mock.calls[1][1]).toEqual(expect.arrayContaining(["--language", "auto", "--no-gpu", "--max-context", "0"]));
    expect(runNative.mock.calls[1][1]).not.toContain("--translate");
  });

  it("clamps the last read to actual source duration and marks no remaining window", async () => {
    const { job, runNative } = await fixture();
    const result = await transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 60_000, durationMs: 30_000 }, job);
    expect(result).toMatchObject({ startMs: 60_000, endMs: 65_000, nextStartMs: null, audioStreamIndex: 2 });
    expect(runNative.mock.calls[0][1]).toEqual(expect.arrayContaining(["-t", "5.000"]));
  });

  it.each([{ startMs: -1, durationMs: 20 }, { startMs: 0, durationMs: 30_001 }, { startMs: 0.5, durationMs: 1 }, { startMs: 0, durationMs: 0 }])(
    "rejects invalid window %j before materializing a source", async (options) => {
      const { job, runNative } = await fixture();
      await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", options, job)).rejects.toMatchObject({ reason: "invalid_audio_window" });
      expect(probe).not.toHaveBeenCalled(); expect(runNative).not.toHaveBeenCalled();
    });

  it("does not silently substitute a different stream or accept a window outside the source", async () => {
    const { job, runNative } = await fixture();
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 10, audioStreamIndex: 0 }, job)).rejects.toMatchObject({ reason: "invalid_audio_stream" });
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 65_000, durationMs: 10 }, job)).rejects.toMatchObject({ reason: "invalid_audio_window" });
    probe.mockResolvedValueOnce({ streams: [{ index: 0, codecType: "video" }], durationMs: 20 });
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 10 }, job)).rejects.toMatchObject({ reason: "no_audio" });
    expect(runNative).not.toHaveBeenCalled();
  });

  it("does not run the model on digital silence, and does not mistake nonrecognition for proof of no speech", async () => {
    const silence = await fixture({ silent: true });
    const quiet = await transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, silence.job);
    expect(quiet.text).toBe(""); expect(quiet.warnings.join(" ")).toMatch(/No audible signal/); expect(silence.runNative).toHaveBeenCalledTimes(1);
    const unrecognized = await fixture({ json: { transcription: [] } });
    const empty = await transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, unrecognized.job);
    expect(empty.text).toBe(""); expect(empty.warnings.join(" ")).toMatch(/does not establish.*no speech/);
  });

  it("bounds a partial final timestamp without rewriting recognized words and keeps warnings within the reader contract", async () => {
    const { job } = await fixture({ json: { transcription: [{ offsets: { from: 0, to: 2010 }, text: "  Exact words and spacing." }] } });
    const result = await transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 63_000, durationMs: 30_000 }, job);
    expect(result.text).toBe("[00:01:03.000 – 00:01:05.000]  Exact words and spacing.");
    expect(result.warnings.join(" ")).toMatch(/limited to the end/);
    expect(result.warnings.length).toBeLessThanOrEqual(8);
    expect(result.warnings.every((warning) => warning.length <= 200)).toBe(true);
  });

  it("refuses a missing or changed model without passing raw local paths to consumers", async () => {
    const { job, runNative } = await fixture();
    await writeFile(job.runtime.whisper.modelPath, "changed");
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, job)).rejects.toMatchObject({ reason: "runtime_unavailable", message: "runtime_unavailable" });
    job.runtime.whisper.modelPath = path.join(job.directory, "missing.bin");
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, job)).rejects.toMatchObject({ reason: "runtime_unavailable" });
    expect(runNative).not.toHaveBeenCalled();
  });

  it.each(["not JSON", { transcription: [{ offsets: { from: 900, to: 100 }, text: "false" }] },
    { transcription: [{ offsets: { from: 0, to: 900 }, text: "one" }, { offsets: { from: 800, to: 1000 }, text: "two" }] }])(
    "refuses malformed or nonmonotone transcript output without publishing an invented result", async (json) => {
      const { job } = await fixture({ json });
      await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, job)).rejects.toMatchObject({ reason: "malformed" });
    });

  it("propagates cancellation and unavailable binaries without misclassifying them as a bad upload", async () => {
    const { job, controller, runNative } = await fixture();
    runNative.mockRejectedValueOnce(new AttachmentProcessingError("runtime_unavailable"));
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, job)).rejects.toMatchObject({ reason: "runtime_unavailable" });
    const cancelled = new Error("synthetic cancellation"); controller.abort(cancelled);
    await expect(transcribeVideoWindow(Buffer.from("source"), "video/mp4", { startMs: 0, durationMs: 2000 }, job)).rejects.toBe(cancelled);
  });
});
