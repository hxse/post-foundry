import { randomUUID } from "node:crypto";
import { hostname as readHostname } from "node:os";
import { resolve } from "node:path";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../api/errors";
import { reportProgress, type ProgressReporter } from "../progress";

export const defaultOnlineLoopIntervalSeconds = 8 * 60 * 60;
export const minimumOnlineLoopIntervalSeconds = 5 * 60;
export const defaultOnlineLoopJitterSeconds = 0;
export const defaultOnlineOperationLockTtlSeconds = 2 * 60 * 60;
export const defaultOnlineOperationLockPollIntervalMs = 1_000;

export type OnlineOperationEntrypoint = "prod-online-run-once" | "prod-online-run-loop" | "debug-online-post-preview";
export type OnlineOperationOutcome = "completed" | "skipped" | "failed";

export type OnlineOperationContext = {
  accountKey: string;
  traceId: string;
  entrypoint: OnlineOperationEntrypoint;
  startedAt: string;
};

export type OnlineOperationExecutorResult = {
  outcome: OnlineOperationOutcome;
  finalAction?: string;
  summary?: Record<string, unknown>;
};

export type OnlineOperationExecutor = (context: OnlineOperationContext) => Promise<OnlineOperationExecutorResult>;

export type OnlineOperationRunResult = OnlineOperationContext & {
  outcome: OnlineOperationOutcome;
  finalAction?: string;
  summary?: Record<string, unknown>;
  finishedAt: string;
};

export type OnlineOperationLockSnapshot = {
  kind: "post_foundry_online_operation_lock_v1";
  lockId: string;
  accountKey: string;
  pid: number;
  hostname: string;
  entrypoint: OnlineOperationEntrypoint;
  traceId: string;
  startedAt: string;
  expiresAt: string;
};

export type OnlineOperationLock = {
  lockPath: string;
  snapshot: OnlineOperationLockSnapshot;
  release(): Promise<void>;
};

export type RunOnlineOperationOnceInput = {
  accountKey: string;
  operation: OnlineOperationExecutor;
  entrypoint?: OnlineOperationEntrypoint;
  traceId?: string;
  lockDir?: string;
  lockTtlSeconds?: number;
  lockWaitTimeoutSeconds?: number;
  lockPollIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  hostname?: string;
  pid?: number;
  isProcessAlive?: (pid: number, hostname: string) => boolean;
  enableHeartbeat?: boolean;
  onProgress?: ProgressReporter;
};

export type RunOnlineOperationLoopInput = Omit<RunOnlineOperationOnceInput, "entrypoint" | "traceId"> & {
  intervalSeconds?: number;
  jitterSeconds?: number;
  sleepUtc?: string;
  maxIterations?: number;
  random?: () => number;
};

export type OnlineOperationLoopResult = {
  accountKey: string;
  iterations: number;
  results: OnlineOperationRunResult[];
};

export type AcquireAccountOperationLockInput = {
  accountKey: string;
  entrypoint: OnlineOperationEntrypoint;
  traceId: string;
  lockDir?: string;
  ttlSeconds?: number;
  waitTimeoutSeconds?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  hostname?: string;
  pid?: number;
  isProcessAlive?: (pid: number, hostname: string) => boolean;
  enableHeartbeat?: boolean;
  onProgress?: ProgressReporter;
};

type SleepWindow = {
  startMinute: number;
  endMinute: number;
};

const accountKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/);
const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const outcomeSchema = z.enum(["completed", "skipped", "failed"]);
const entrypointSchema = z.enum(["prod-online-run-once", "prod-online-run-loop", "debug-online-post-preview"]);
const lockSnapshotSchema = z
  .object({
    kind: z.literal("post_foundry_online_operation_lock_v1"),
    lockId: nonEmptyStringSchema,
    accountKey: accountKeySchema,
    pid: positiveIntegerSchema,
    hostname: nonEmptyStringSchema,
    entrypoint: entrypointSchema,
    traceId: nonEmptyStringSchema,
    startedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema
  })
  .strict();
const operationResultSchema = z
  .object({
    outcome: outcomeSchema,
    finalAction: nonEmptyStringSchema.optional(),
    summary: z.record(z.unknown()).optional()
  })
  .strict();

export async function runOnlineOperationOnce(input: RunOnlineOperationOnceInput): Promise<OnlineOperationRunResult> {
  const accountKey = parseAccountKey(input.accountKey);
  const entrypoint = input.entrypoint ?? "prod-online-run-once";
  const now = input.now ?? (() => new Date());
  const traceId = input.traceId ?? createTraceId(accountKey, now());
  reportProgress(input.onProgress, "online_operation.lock_wait.start", { account: accountKey, trace_id: traceId });
  const lock = await acquireAccountOperationLock({
    accountKey,
    entrypoint,
    traceId,
    lockDir: input.lockDir,
    ttlSeconds: input.lockTtlSeconds,
    waitTimeoutSeconds: input.lockWaitTimeoutSeconds,
    pollIntervalMs: input.lockPollIntervalMs,
    now,
    sleep: input.sleep,
    hostname: input.hostname,
    pid: input.pid,
    isProcessAlive: input.isProcessAlive,
    enableHeartbeat: input.enableHeartbeat,
    onProgress: input.onProgress
  });
  reportProgress(input.onProgress, "online_operation.lock.acquired", { account: accountKey, trace_id: traceId });

  const startedAt = now().toISOString();
  try {
    reportProgress(input.onProgress, "online_operation.executor.start", { account: accountKey, trace_id: traceId, entrypoint });
    const executorResult = parseOperationResult(
      await input.operation({
        accountKey,
        traceId,
        entrypoint,
        startedAt
      })
    );
    reportProgress(input.onProgress, "online_operation.executor.done", {
      account: accountKey,
      trace_id: traceId,
      outcome: executorResult.outcome,
      final_action: executorResult.finalAction ?? "none"
    });
    return {
      accountKey,
      traceId,
      entrypoint,
      startedAt,
      finishedAt: now().toISOString(),
      ...executorResult
    };
  } finally {
    await lock.release();
    reportProgress(input.onProgress, "online_operation.lock.released", { account: accountKey, trace_id: traceId });
  }
}

export async function runOnlineOperationLoop(input: RunOnlineOperationLoopInput): Promise<OnlineOperationLoopResult> {
  const accountKey = parseAccountKey(input.accountKey);
  const intervalSeconds = parseMinimumInteger(
    input.intervalSeconds ?? defaultOnlineLoopIntervalSeconds,
    "intervalSeconds",
    minimumOnlineLoopIntervalSeconds
  );
  const jitterSeconds = parseNonNegativeInteger(input.jitterSeconds ?? defaultOnlineLoopJitterSeconds, "jitterSeconds");
  const maxIterations = input.maxIterations === undefined ? undefined : parsePositiveInteger(input.maxIterations, "maxIterations");
  const sleepWindow = input.sleepUtc ? parseSleepUtcWindow(input.sleepUtc) : undefined;
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? sleepMs;
  const random = input.random ?? Math.random;
  const results: OnlineOperationRunResult[] = [];
  reportProgress(input.onProgress, "online_operation.loop.start", {
    account: accountKey,
    interval_seconds: intervalSeconds,
    jitter_seconds: jitterSeconds,
    max_iterations: maxIterations ?? "unbounded"
  });

  while (maxIterations === undefined || results.length < maxIterations) {
    const sleepWindowDelayMs = computeSleepWindowDelayMs(now(), sleepWindow);
    if (sleepWindowDelayMs > 0) {
      reportProgress(input.onProgress, "online_operation.loop.sleep_window", { delay_seconds: Math.ceil(sleepWindowDelayMs / 1_000) });
      await sleep(sleepWindowDelayMs);
    }

    results.push(
      await runOnlineOperationOnce({
        ...input,
        accountKey,
        entrypoint: "prod-online-run-loop",
        traceId: createTraceId(accountKey, now()),
        now,
        sleep
      })
    );

    if (maxIterations !== undefined && results.length >= maxIterations) {
      break;
    }

    const loopDelayMs = computeLoopDelayMs({ intervalSeconds, jitterSeconds, random });
    reportProgress(input.onProgress, "online_operation.loop.sleep", { delay_seconds: Math.ceil(loopDelayMs / 1_000) });
    await sleep(loopDelayMs);
  }

  return {
    accountKey,
    iterations: results.length,
    results
  };
}

export async function acquireAccountOperationLock(input: AcquireAccountOperationLockInput): Promise<OnlineOperationLock> {
  const accountKey = parseAccountKey(input.accountKey);
  const entrypoint = entrypointSchema.parse(input.entrypoint);
  const traceId = parseNonEmpty(input.traceId, "traceId");
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? sleepMs;
  const ttlSeconds = parsePositiveInteger(input.ttlSeconds ?? defaultOnlineOperationLockTtlSeconds, "ttlSeconds");
  const waitTimeoutSeconds = parseNonNegativeInteger(input.waitTimeoutSeconds ?? ttlSeconds, "waitTimeoutSeconds");
  const pollIntervalMs = parsePositiveInteger(input.pollIntervalMs ?? defaultOnlineOperationLockPollIntervalMs, "pollIntervalMs");
  const pid = input.pid ?? process.pid;
  const hostname = input.hostname ?? readHostname();
  const isProcessAlive = input.isProcessAlive ?? defaultIsProcessAlive;
  const lockDir = resolve(input.lockDir ?? "data/locks");
  const lockPath = resolve(lockDir, `operation.${accountKey}.lock`);
  const deadlineMs = now().getTime() + waitTimeoutSeconds * 1_000;
  let waitingLogged = false;

  await mkdir(lockDir, { recursive: true });

  while (true) {
    await removeStaleLockIfPresent({
      lockPath,
      now,
      hostname,
      isProcessAlive
    });

    const startedAt = now().toISOString();
    const snapshot: OnlineOperationLockSnapshot = {
      kind: "post_foundry_online_operation_lock_v1",
      lockId: randomUUID(),
      accountKey,
      pid,
      hostname,
      entrypoint,
      traceId,
      startedAt,
      expiresAt: new Date(now().getTime() + ttlSeconds * 1_000).toISOString()
    };

    try {
      await createLockFileAtomically({
        lockDir,
        lockPath,
        accountKey,
        pid,
        snapshot
      });
      return buildLockHandle({
        lockPath,
        snapshot,
        ttlSeconds,
        now,
        enableHeartbeat: input.enableHeartbeat ?? true
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (now().getTime() >= deadlineMs) {
        throw onlineRunnerError("invalid_request", "operation lock is held for account: " + accountKey, { reason: "lock_timeout" });
      }
      if (!waitingLogged) {
        reportProgress(input.onProgress, "online_operation.lock_wait.blocked", {
          account: accountKey,
          poll_interval_ms: pollIntervalMs,
          wait_timeout_seconds: waitTimeoutSeconds
        });
        waitingLogged = true;
      }
      await sleep(pollIntervalMs);
    }
  }
}

export function createSkippedOnlineOperationExecutor(reason: string): OnlineOperationExecutor {
  const message = parseNonEmpty(reason, "reason");
  return async () => ({
    outcome: "skipped",
    finalAction: "not_wired",
    summary: {
      reason: message
    }
  });
}

export function parseSleepUtcWindow(value: string): SleepWindow {
  const [start, end, extra] = value.split("-");
  if (!start || !end || extra !== undefined) {
    throw onlineRunnerError("invalid_request", "sleepUtc must use HH:MM-HH:MM");
  }
  return {
    startMinute: parseUtcMinute(start, "sleepUtc start"),
    endMinute: parseUtcMinute(end, "sleepUtc end")
  };
}

export function computeSleepWindowDelayMs(now: Date, window: SleepWindow | undefined): number {
  if (!window) {
    return 0;
  }
  if (window.startMinute === window.endMinute) {
    throw onlineRunnerError("invalid_request", "sleepUtc start and end must differ");
  }

  const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (window.startMinute < window.endMinute) {
    if (currentMinute >= window.startMinute && currentMinute < window.endMinute) {
      return (window.endMinute - currentMinute) * 60_000;
    }
    return 0;
  }

  if (currentMinute >= window.startMinute) {
    return (24 * 60 - currentMinute + window.endMinute) * 60_000;
  }
  if (currentMinute < window.endMinute) {
    return (window.endMinute - currentMinute) * 60_000;
  }
  return 0;
}

export function computeLoopDelayMs(input: {
  intervalSeconds: number;
  jitterSeconds?: number;
  random?: () => number;
}): number {
  const intervalSeconds = parseMinimumInteger(input.intervalSeconds, "intervalSeconds", minimumOnlineLoopIntervalSeconds);
  const jitterSeconds = parseNonNegativeInteger(input.jitterSeconds ?? defaultOnlineLoopJitterSeconds, "jitterSeconds");
  const baseMs = intervalSeconds * 1_000;
  if (jitterSeconds === 0) {
    return baseMs;
  }
  const random = input.random ?? Math.random;
  const jitterMs = Math.round((random() * 2 - 1) * jitterSeconds * 1_000);
  return Math.max(0, baseMs + jitterMs);
}

async function createLockFileAtomically(input: {
  lockDir: string;
  lockPath: string;
  accountKey: string;
  pid: number;
  snapshot: OnlineOperationLockSnapshot;
}): Promise<void> {
  const tempPath = resolve(input.lockDir, ".operation." + input.accountKey + "." + input.pid + "." + input.snapshot.lockId + ".tmp");
  try {
    await writeFile(tempPath, JSON.stringify(input.snapshot, null, 2), { flag: "wx" });
    await link(tempPath, input.lockPath);
  } finally {
    await unlinkIfPresent(tempPath);
  }
}

async function buildLockHandle(input: {
  lockPath: string;
  snapshot: OnlineOperationLockSnapshot;
  ttlSeconds: number;
  now: () => Date;
  enableHeartbeat: boolean;
}): Promise<OnlineOperationLock> {
  let released = false;
  const heartbeatMs = Math.max(1_000, Math.floor((input.ttlSeconds * 1_000) / 3));
  const heartbeat = input.enableHeartbeat
    ? setInterval(() => {
        void refreshLock(input.lockPath, input.snapshot.lockId, input.ttlSeconds, input.now);
      }, heartbeatMs)
    : undefined;
  heartbeat?.unref?.();

  return {
    lockPath: input.lockPath,
    snapshot: input.snapshot,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      await releaseLock(input.lockPath, input.snapshot.lockId);
    }
  };
}

async function refreshLock(lockPath: string, lockId: string, ttlSeconds: number, now: () => Date): Promise<void> {
  const snapshot = await readLockSnapshot(lockPath);
  if (!snapshot || snapshot.lockId !== lockId) {
    return;
  }
  const refreshed: OnlineOperationLockSnapshot = {
    ...snapshot,
    expiresAt: new Date(now().getTime() + ttlSeconds * 1_000).toISOString()
  };
  await writeHeartbeatSnapshot(lockPath, refreshed);
}

async function releaseLock(lockPath: string, lockId: string): Promise<void> {
  const snapshot = await readLockSnapshot(lockPath);
  if (!snapshot || snapshot.lockId !== lockId) {
    return;
  }
  await unlinkIfPresent(lockPath);
  await unlinkIfPresent(heartbeatPathFor(lockPath));
}

async function removeStaleLockIfPresent(input: {
  lockPath: string;
  now: () => Date;
  hostname: string;
  isProcessAlive: (pid: number, hostname: string) => boolean;
}): Promise<void> {
  const snapshot = await readEffectiveLockSnapshot(input.lockPath);
  if (!snapshot) {
    return;
  }
  const expired = Date.parse(snapshot.expiresAt) <= input.now().getTime();
  const deadLocalProcess = snapshot.hostname === input.hostname && !input.isProcessAlive(snapshot.pid, snapshot.hostname);
  if (!expired && !deadLocalProcess) {
    return;
  }
  await unlinkIfPresent(input.lockPath);
  await unlinkIfPresent(heartbeatPathFor(input.lockPath));
}

async function readEffectiveLockSnapshot(lockPath: string): Promise<OnlineOperationLockSnapshot | undefined> {
  const snapshot = await readLockSnapshot(lockPath);
  if (!snapshot) {
    return undefined;
  }
  const heartbeat = await readHeartbeatSnapshot(lockPath);
  if (heartbeat?.lockId === snapshot.lockId && Date.parse(heartbeat.expiresAt) > Date.parse(snapshot.expiresAt)) {
    return {
      ...snapshot,
      expiresAt: heartbeat.expiresAt
    };
  }
  return snapshot;
}

async function writeHeartbeatSnapshot(lockPath: string, snapshot: OnlineOperationLockSnapshot): Promise<void> {
  const heartbeatPath = heartbeatPathFor(lockPath);
  const tempPath = heartbeatPath + "." + snapshot.lockId + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tempPath, JSON.stringify(snapshot, null, 2), { flag: "wx" });
    await rename(tempPath, heartbeatPath);
  } finally {
    await unlinkIfPresent(tempPath);
  }
}

async function readHeartbeatSnapshot(lockPath: string): Promise<OnlineOperationLockSnapshot | undefined> {
  const heartbeatPath = heartbeatPathFor(lockPath);
  let raw: string;
  try {
    raw = await readFile(heartbeatPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    await unlinkIfPresent(heartbeatPath);
    return undefined;
  }
  const parsed = lockSnapshotSchema.safeParse(decoded);
  if (!parsed.success) {
    await unlinkIfPresent(heartbeatPath);
    return undefined;
  }
  return parsed.data;
}

function heartbeatPathFor(lockPath: string): string {
  return lockPath + ".heartbeat";
}

async function readLockSnapshot(lockPath: string): Promise<OnlineOperationLockSnapshot | undefined> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    await unlinkCorruptLock(lockPath);
    return undefined;
  }
  const parsed = lockSnapshotSchema.safeParse(decoded);
  if (!parsed.success) {
    await unlinkCorruptLock(lockPath);
    return undefined;
  }
  return parsed.data;
}

async function unlinkCorruptLock(lockPath: string): Promise<void> {
  await unlinkIfPresent(lockPath);
  await unlinkIfPresent(heartbeatPathFor(lockPath));
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function parseOperationResult(value: unknown): OnlineOperationExecutorResult {
  const parsed = operationResultSchema.safeParse(value);
  if (!parsed.success) {
    throw onlineRunnerError("invalid_request", "online operation executor result is invalid", parsed.error.flatten());
  }
  return parsed.data;
}

function createTraceId(accountKey: string, date: Date): string {
  return `trace-online-${accountKey}-${date.toISOString().replace(/[^0-9TZ]/g, "")}-${randomUUID()}`;
}

function parseAccountKey(value: string): string {
  const parsed = accountKeySchema.safeParse(value);
  if (!parsed.success) {
    throw onlineRunnerError("invalid_request", "accountKey is invalid", parsed.error.flatten());
  }
  return parsed.data;
}

function parseNonEmpty(value: string, field: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw onlineRunnerError("invalid_request", `${field} must be non-empty`, parsed.error.flatten());
  }
  return parsed.data;
}

function parsePositiveInteger(value: number, field: string): number {
  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw onlineRunnerError("invalid_request", `${field} must be a positive integer`, parsed.error.flatten());
  }
  return parsed.data;
}

function parseMinimumInteger(value: number, field: string, minimum: number): number {
  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success || parsed.data < minimum) {
    throw onlineRunnerError(
      "invalid_request",
      `${field} must be an integer >= ${minimum}`,
      parsed.success ? { minimum } : parsed.error.flatten()
    );
  }
  return parsed.data;
}

function parseNonNegativeInteger(value: number, field: string): number {
  const parsed = nonNegativeIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw onlineRunnerError("invalid_request", `${field} must be a non-negative integer`, parsed.error.flatten());
  }
  return parsed.data;
}

function parseUtcMinute(value: string, field: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw onlineRunnerError("invalid_request", `${field} must use HH:MM`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw onlineRunnerError("invalid_request", `${field} must be a valid UTC time`);
  }
  return hour * 60 + minute;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function defaultIsProcessAlive(pid: number, lockHostname: string): boolean {
  if (lockHostname !== readHostname()) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EEXIST");
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function onlineRunnerError(code: "invalid_request", message: string, details?: unknown): ApiError {
  return new ApiError({
    code,
    provider: "local",
    stage: "online_operation_runner",
    message,
    details
  });
}
