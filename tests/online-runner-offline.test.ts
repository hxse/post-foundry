import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/errors";
import {
  computeLoopDelayMs,
  computeSleepWindowDelayMs,
  parseSleepUtcWindow,
  runOnlineOperationLoop,
  runOnlineOperationOnce,
  type OnlineOperationLockSnapshot
} from "../src/lib/orchestration/online-runner";

const now = "2026-06-24T02:00:00.000Z";

describe("online operation runner baseline", () => {
  it("runs one operation under an account lock and releases it", async () => {
    const dir = await tempDir();
    try {
      const lockPath = join(dir, "operation.zh-tech.lock");
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-once-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: async (context) => {
          expect(await fileExists(lockPath)).toBe(true);
          expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
            accountKey: "zh-tech",
            traceId: "trace-online-once-1",
            entrypoint: "run-once-online"
          });
          expect(context).toMatchObject({
            accountKey: "zh-tech",
            traceId: "trace-online-once-1",
            entrypoint: "run-once-online"
          });
          return {
            outcome: "completed",
            finalAction: "auto_post",
            summary: {
              posted: false
            }
          };
        }
      });

      expect(result).toMatchObject({
        accountKey: "zh-tech",
        traceId: "trace-online-once-1",
        outcome: "completed",
        finalAction: "auto_post"
      });
      expect(await fileExists(lockPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent once runs for the same account", async () => {
    const dir = await tempDir();
    try {
      const firstEntered = deferred<void>();
      const releaseFirst = deferred<void>();
      let secondStarted = false;

      const first = runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-lock-1",
        now: fixedNow(now),
        lockPollIntervalMs: 5,
        enableHeartbeat: false,
        operation: async () => {
          firstEntered.resolve();
          await releaseFirst.promise;
          return { outcome: "completed", finalAction: "auto_post" };
        }
      });
      await firstEntered.promise;

      const second = runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-lock-2",
        now: fixedNow(now),
        lockPollIntervalMs: 5,
        enableHeartbeat: false,
        operation: async () => {
          secondStarted = true;
          return { outcome: "skipped", finalAction: "defer" };
        }
      });

      await sleep(25);
      expect(secondStarted).toBe(false);
      releaseFirst.resolve();

      await expect(first).resolves.toMatchObject({ traceId: "trace-online-lock-1" });
      await expect(second).resolves.toMatchObject({ traceId: "trace-online-lock-2" });
      expect(secondStarted).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans corrupt locks before running", async () => {
    const dir = await tempDir();
    try {
      const lockPath = join(dir, "operation.zh-tech.lock");
      await writeFile(lockPath, "not-json");

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-corrupt-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: async () => ({ outcome: "completed", finalAction: "auto_post" })
      });

      expect(result.outcome).toBe("completed");
      expect(await fileExists(lockPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans stale locks before running", async () => {
    const dir = await tempDir();
    try {
      const lockPath = join(dir, "operation.zh-tech.lock");
      await writeFile(lockPath, JSON.stringify(staleLock(), null, 2));

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-stale-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        isProcessAlive: () => true,
        operation: async () => ({ outcome: "completed", finalAction: "auto_post" })
      });

      expect(result.outcome).toBe("completed");
      expect(await fileExists(lockPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("releases heartbeat sidecars without resurrecting locks", async () => {
    const dir = await tempDir();
    try {
      const lockPath = join(dir, "operation.zh-tech.lock");
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-online-heartbeat-1",
        now: () => new Date(),
        lockTtlSeconds: 1,
        operation: async () => {
          await sleep(1_100);
          return { outcome: "completed", finalAction: "auto_post" };
        }
      });

      expect(result.outcome).toBe("completed");
      expect(await fileExists(lockPath)).toBe(false);
      expect(await fileExists(lockPath + ".heartbeat")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs the loop by reusing the once runner", async () => {
    const dir = await tempDir();
    try {
      const sleeps: number[] = [];
      const traceIds: string[] = [];
      const result = await runOnlineOperationLoop({
        accountKey: "zh-tech",
        lockDir: dir,
        now: fixedNow(now),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 1,
        intervalSeconds: 300,
        jitterSeconds: 5,
        maxIterations: 2,
        enableHeartbeat: false,
        operation: async (context) => {
          traceIds.push(context.traceId);
          return { outcome: "skipped", finalAction: "defer" };
        }
      });

      expect(result.iterations).toBe(2);
      expect(result.results.every((run) => run.entrypoint === "run-loop-online")).toBe(true);
      expect(traceIds).toHaveLength(2);
      expect(sleeps).toEqual([305_000]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors UTC sleep windows before starting a loop iteration", async () => {
    const dir = await tempDir();
    try {
      const sleeps: number[] = [];
      const result = await runOnlineOperationLoop({
        accountKey: "zh-tech",
        lockDir: dir,
        now: fixedNow("2026-06-24T23:30:00.000Z"),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        sleepUtc: "23:00-01:00",
        intervalSeconds: 300,
        maxIterations: 1,
        enableHeartbeat: false,
        operation: async () => ({ outcome: "skipped", finalAction: "defer" })
      });

      expect(result.iterations).toBe(1);
      expect(sleeps).toEqual([90 * 60_000]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects loop intervals below the minimum interval", async () => {
    await expect(
      runOnlineOperationLoop({
        accountKey: "zh-tech",
        intervalSeconds: 299,
        operation: async () => ({ outcome: "skipped", finalAction: "defer" })
      })
    ).rejects.toMatchObject({
      provider: "local",
      stage: "online_operation_runner",
      code: "invalid_request"
    });
  });

  it("computes jitter and sleep windows deterministically", () => {
    expect(computeLoopDelayMs({ intervalSeconds: 300, jitterSeconds: 10, random: () => 0 })).toBe(290_000);
    expect(computeLoopDelayMs({ intervalSeconds: 300, jitterSeconds: 10, random: () => 1 })).toBe(310_000);
    expect(() => computeLoopDelayMs({ intervalSeconds: 299 })).toThrow(ApiError);
    expect(computeSleepWindowDelayMs(new Date("2026-06-24T12:20:00.000Z"), parseSleepUtcWindow("12:00-13:00"))).toBe(40 * 60_000);
    expect(() => parseSleepUtcWindow("24:00-01:00")).toThrow(ApiError);
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "post-foundry-online-runner-"));
}

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

function staleLock(): OnlineOperationLockSnapshot {
  return {
    kind: "post_foundry_online_operation_lock_v1",
    lockId: "stale-lock-id",
    accountKey: "zh-tech",
    pid: 999_999,
    hostname: "test-host",
    entrypoint: "run-loop-online",
    traceId: "trace-stale-lock",
    startedAt: "2026-06-23T00:00:00.000Z",
    expiresAt: "2026-06-23T01:00:00.000Z"
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
