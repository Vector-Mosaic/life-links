import { fork, spawn, type ChildProcess, type ForkOptions } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AttachmentBinary = "office" | "ffmpeg" | "ffprobe" | "whisper";
export type AttachmentNativeRuntime = {
  binaries: Record<AttachmentBinary, string>;
  whisper: { modelPath: string; modelSha256: string; version: string };
};
export const WHISPER_MODEL_SHA256 = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
export function attachmentRuntime(env: NodeJS.ProcessEnv = process.env): AttachmentNativeRuntime {
  return {
    binaries: {
      // The canonical launcher handles Office's first-profile exit-81 startup
      // protocol. Its native descendants remain in this job's process group.
      office: env.ATTACHMENT_OFFICE_BINARY ?? "/usr/bin/soffice",
      ffmpeg: env.ATTACHMENT_FFMPEG_BINARY ?? "/opt/life-links/bin/ffmpeg",
      ffprobe: env.ATTACHMENT_FFPROBE_BINARY ?? "/opt/life-links/bin/ffprobe",
      whisper: env.ATTACHMENT_WHISPER_BINARY ?? "/opt/life-links/bin/whisper-cli"
    },
    whisper: { modelPath: env.ATTACHMENT_WHISPER_MODEL ?? "/opt/life-links/models/ggml-base.bin",
      modelSha256: WHISPER_MODEL_SHA256, version: "whisper.cpp-v1.8.6/base-multilingual" }
  };
}

export class AttachmentProcessingError extends Error {
  constructor(readonly reason: string) { super(reason); }
}
export interface AttachmentProcessingJob {
  readonly directory: string;
  readonly signal: AbortSignal;
  readonly runtime: AttachmentNativeRuntime;
  runWorker<T = any>(kind: "text" | "image" | "office", message: object): Promise<T>;
  runNative(binary: AttachmentBinary, args: string[], options?: { stdoutLimit?: number }): Promise<{ stdout: Buffer; stderr: Buffer }>;
}

/** Parent-owned process lifetime. All native processors are direct children of
 * this owner, never untracked grandchildren of a disposable JS worker. */
export async function withAttachmentJob<T>(runtime: AttachmentNativeRuntime, timeoutMs: number,
  signal: AbortSignal | undefined, operation: (job: AttachmentProcessingJob) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const directory = await mkdtemp(path.join(tmpdir(), "life-links-attachment-"));
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new AttachmentProcessingError("processing_timeout")), timeoutMs);
  const pending = new Set<Promise<unknown>>();
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production", UV_THREADPOOL_SIZE: "1", VIPS_CONCURRENCY: "1",
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    HOME: directory, USERPROFILE: directory, TMPDIR: directory, TMP: directory, TEMP: directory,
    LANG: "C.UTF-8", SAL_USE_VCLPLUGIN: "svp"
  };
  const track = <R>(promise: Promise<R>): Promise<R> => {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  };
  const job: AttachmentProcessingJob = {
    directory, signal: controller.signal, runtime,
    runWorker: <R>(kind: "text" | "image" | "office", message: object) => track(new Promise<R>((resolve, reject) => {
      controller.signal.throwIfAborted();
      const worker = kind === "image" ? "attachment-image-worker.js" : kind === "office" ? "attachment-office-worker.js" : "attachment-extractor-worker.js";
      const workerOptions: ForkOptions & { windowsHide: boolean } = {
        execArgv: ["--max-old-space-size=128"], env: environment, serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true, detached: process.platform !== "win32"
      };
      const child = fork(fileURLToPath(new URL(worker, import.meta.url)), [], workerOptions);
      let received = false; let result: R;
      let failure: unknown = new AttachmentProcessingError("decode_limit");
      const stop = supervise(child, controller.signal, (error) => { failure = error; });
      child.once("message", (value: R) => { received = true; result = value; stop(); });
      child.once("error", () => { failure = new AttachmentProcessingError("runtime_unavailable"); stop(); });
      child.once("close", async () => {
        await stop();
        if (controller.signal.aborted) reject(controller.signal.reason);
        else if (received) resolve(result!); else reject(failure);
      });
      child.send(message, (error) => { if (error) stop(); });
    })),
    runNative: (binary, args, options = {}) => track(new Promise((resolve, reject) => {
      controller.signal.throwIfAborted();
      // The qualified native runtime is Linux. Windows tree-kill cannot own a
      // descendant after its leader exits; do not claim that unsupported lane.
      // JS-only text, static images and PDF workers remain available on Windows.
      if (process.platform !== "linux") return reject(new AttachmentProcessingError("runtime_unavailable"));
      const executable = runtime.binaries[binary];
      if (!executable || !path.isAbsolute(executable)) return reject(new AttachmentProcessingError("runtime_unavailable"));
      const child = spawn(executable, args, { cwd: directory, env: environment,
        stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true, detached: true });
      let failure: unknown;
      const stop = supervise(child, controller.signal, (error) => { failure = error; });
      const output: Buffer[] = []; const errors: Buffer[] = [];
      let outputBytes = 0; let errorBytes = 0;
      child.stdout!.on("data", (bytes: Buffer) => {
        outputBytes += bytes.length;
        if (outputBytes > (options.stdoutLimit ?? 2 * 1024 * 1024)) { failure = new AttachmentProcessingError("decode_limit"); void stop(); }
        else output.push(bytes);
      });
      child.stderr!.on("data", (bytes: Buffer) => {
        errorBytes += bytes.length;
        if (errorBytes > 512 * 1024) { failure = new AttachmentProcessingError("decode_limit"); void stop(); }
        else errors.push(bytes);
      });
      child.once("error", () => { failure = new AttachmentProcessingError("runtime_unavailable"); void stop(); });
      child.once("close", async (code) => {
        await stop();
        if (controller.signal.aborted) reject(controller.signal.reason);
        else if (failure) reject(failure);
        else if (code !== 0) reject(new AttachmentProcessingError("malformed"));
        else resolve({ stdout: Buffer.concat(output), stderr: Buffer.concat(errors) });
      });
    }))
  };
  try { return await operation(job); }
  finally {
    clearTimeout(timer); signal?.removeEventListener("abort", cancel);
    controller.abort(new DOMException("Attachment job ended", "AbortError"));
    await Promise.allSettled([...pending]);
    await rm(directory, { recursive: true, force: true });
  }
}

function supervise(child: ChildProcess, signal: AbortSignal, fail: (error: unknown) => void): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    signal.removeEventListener("abort", abort);
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      if (!child.pid) return resolve();
      if (process.platform === "win32") {
        // PID came directly from this job's spawn; never discover or target a
        // managed runtime by executable name. /T includes processor children.
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const killer = spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
        killer.once("error", () => { child.kill("SIGKILL"); resolve(); });
        killer.once("close", () => resolve());
      } else {
        // Kill the whole dedicated process group even after its leader exits.
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL"); }
        resolve();
      }
    });
    return stopping;
  };
  const abort = () => { fail(signal.reason); void stop(); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return stop;
}
