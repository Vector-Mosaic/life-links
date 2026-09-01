import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { attachmentRuntime, AttachmentProcessingError, withAttachmentJob } from "../src/attachment-native-runtime.js";
import { DOCX_MIME, wordVisualFixture } from "./attachment-office-fixtures.js";

const runtime = () => { const value = attachmentRuntime(); value.binaries.ffprobe = process.execPath; return value; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function readWhenReady(file: string) {
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text) return JSON.parse(text);
    await pause(20);
  }
  throw new Error("Synthetic processor did not become ready");
}

describe("parent-owned attachment native runtime", () => {
  it("delivers actual Office worker IPC and removes its private scratch directory after worker exit", async () => {
    let directory = "";
    const result = await withAttachmentJob(runtime(), 10000, undefined, async (job) => {
      directory = job.directory;
      return job.runWorker("office", { data: await wordVisualFixture(), mimeType: DOCX_MIME });
    });
    expect(result.status).toBe("ready"); expect(Buffer.isBuffer(result.data)).toBe(true);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(process.platform === "linux")("cancels the exact running processor and its child before removing scratch and releasing the job", async () => {
    const controller = new AbortController(); let directory = ""; let pids: { parent: number; child: number } | undefined;
    const program = `const cp=require('node:child_process');const fs=require('node:fs');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('ready.json',JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);`;
    try {
      const outcome = withAttachmentJob(runtime(), 10000, controller.signal, async (job) => {
        directory = job.directory;
        const running = job.runNative("ffprobe", ["-e", program]);
        const rejected = expect(running).rejects.toMatchObject({ name: "AbortError" });
        pids = await readWhenReady(path.join(directory, "ready.json"));
        controller.abort(new DOMException("Synthetic cancellation", "AbortError"));
        await rejected;
      });
      await outcome;
      expect(pids).toBeDefined(); expect(alive(pids!.parent)).toBe(false); expect(alive(pids!.child)).toBe(false);
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      controller.abort();
      // Only PIDs returned by this synthetic test's own spawn are cleanup targets.
      for (const pid of pids ? [pids.parent, pids.child] : []) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 15000);

  it.runIf(process.platform === "linux")("times out a processor and returns only the safe failure reason after cleanup", async () => {
    let directory = "";
    const running = withAttachmentJob(runtime(), 400, undefined, (job) => {
      directory = job.directory;
      return job.runNative("ffprobe", ["-e", "setInterval(()=>{},1000)"]);
    });
    await expect(running).rejects.toMatchObject({ reason: "processing_timeout" });
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10000);

  it.runIf(process.platform === "linux")("does not expose processor stderr on nonzero exit or accept a missing executable", async () => {
    await expect(withAttachmentJob(runtime(), 5000, undefined, (job) => job.runNative("ffprobe", ["-e", "process.stderr.write('PRIVATE_DOCUMENT_SENTINEL');process.exit(7)"])))
      .rejects.toEqual(new AttachmentProcessingError("malformed"));
    const missing = runtime(); missing.binaries.ffprobe = path.resolve("synthetic-missing-attachment-processor.exe");
    await expect(withAttachmentJob(missing, 5000, undefined, (job) => job.runNative("ffprobe", [])))
      .rejects.toEqual(new AttachmentProcessingError("runtime_unavailable"));
  });

  it.runIf(process.platform === "linux")("terminates oversized stdout/stderr and cannot run after cancellation", async () => {
    for (const stream of ["stdout", "stderr"]) {
      await expect(withAttachmentJob(runtime(), 5000, undefined, (job) => job.runNative("ffprobe", ["-e", `process.${stream}.write('x'.repeat(1024*1024));setInterval(()=>{},1000)`], { stdoutLimit: 64 })))
        .rejects.toEqual(new AttachmentProcessingError("decode_limit"));
    }
    const controller = new AbortController(); controller.abort(new DOMException("Cancelled", "AbortError"));
    await expect(withAttachmentJob(runtime(), 5000, controller.signal, () => { throw new Error("must not start"); }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it.runIf(process.platform === "linux")("awaits and cancels an unawaited processor before resolving the parent operation", async () => {
    let directory = ""; let rejected = false;
    await withAttachmentJob(runtime(), 5000, undefined, async (job) => {
      directory = job.directory;
      void job.runNative("ffprobe", ["-e", "setInterval(()=>{},1000)"]).catch(() => { rejected = true; });
    });
    expect(rejected).toBe(true);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(process.platform !== "linux")("explicitly refuses unsupported native platforms without spawning desktop processors", async () => {
    await expect(withAttachmentJob(runtime(), 5000, undefined, (job) => job.runNative("ffprobe", ["-e", "throw new Error('must not execute')"])))
      .rejects.toEqual(new AttachmentProcessingError("runtime_unavailable"));
  });

  it.runIf(process.platform === "linux")("kills inherited-stdio descendants even when their processor leader has already exited", async () => {
    let directory = ""; let pids: { parent: number; child: number } | undefined;
    const program = `const cp=require('node:child_process');const fs=require('node:fs');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});fs.writeFileSync('ready.json',JSON.stringify({parent:process.pid,child:child.pid}));process.exit(0);`;
    try {
      const running = withAttachmentJob(runtime(), 1800, undefined, async (job) => {
        directory = job.directory;
        const native = job.runNative("ffprobe", ["-e", program]);
        const rejected = expect(native).rejects.toMatchObject({ reason: "processing_timeout" });
        pids = await readWhenReady(path.join(directory, "ready.json"));
        await rejected;
      });
      await running;
      expect(pids).toBeDefined(); expect(alive(pids!.parent)).toBe(false); expect(alive(pids!.child)).toBe(false);
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      for (const pid of pids ? [pids.parent, pids.child] : []) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 12000);
});
