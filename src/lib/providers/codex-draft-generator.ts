import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ApiError } from "../api/errors";
import type { ProductionDraftGenerationInput, ProductionDraftGenerationResult } from "../llm/production-draft-generator";
import { reportProgress, type ProgressReporter } from "../progress";

export type CodexExecInvocation = {
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
};

export type CodexExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
};

export type CodexExecRunner = (invocation: CodexExecInvocation) => Promise<CodexExecResult>;

export type CodexCliRuntimeCheck = {
  status: "ready";
  command: string;
  version: string;
  loginStatus: string;
};

export type CodexSessionRecord = {
  accountKey: string;
  threadId: string;
  updatedAt: string;
};

export type CodexCliDraftGeneratorOptions = {
  command?: string;
  cwd?: string;
  model?: string;
  enableSearch?: boolean;
  timeoutMs?: number;
  runner?: CodexExecRunner;
  sessionDir?: string;
  sessionMaxAgeHours?: number;
  resetSession?: boolean;
  now?: () => string;
  onProgress?: ProgressReporter;
};

const defaultCodexCommand = "codex";
const defaultTimeoutMs = 180_000;
const defaultCodexSessionDir = "data/codex-sessions";
const maxCapturedOutputLength = 1_000_000;
const threadIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export class CodexCliDraftGenerator {
  readonly providerName = "codex";
  readonly model: string;

  private readonly command: string;
  private readonly cwd?: string;
  private readonly modelOverride?: string;
  private readonly enableSearch: boolean;
  private readonly timeoutMs: number;
  private readonly runner: CodexExecRunner;
  private readonly sessionDir: string;
  private readonly sessionMaxAgeHours?: number;
  private readonly resetSession: boolean;
  private readonly now: () => string;
  private readonly onProgress?: ProgressReporter;

  constructor(options: CodexCliDraftGeneratorOptions = {}) {
    this.command = options.command ?? defaultCodexCommand;
    this.cwd = options.cwd;
    this.modelOverride = options.model;
    this.model = options.model ?? "codex-cli-default";
    this.enableSearch = options.enableSearch ?? true;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.runner = options.runner ?? defaultCodexExecRunner;
    this.sessionDir = options.sessionDir ?? defaultCodexSessionDir;
    this.sessionMaxAgeHours = options.sessionMaxAgeHours;
    if (this.sessionMaxAgeHours !== undefined && (!Number.isFinite(this.sessionMaxAgeHours) || this.sessionMaxAgeHours <= 0)) {
      throw new ApiError({
        code: "invalid_request",
        provider: "local",
        stage: "codex_session_store",
        message: "Codex session max age must be a positive number of hours"
      });
    }
    this.resetSession = options.resetSession ?? false;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onProgress = options.onProgress;
  }

  async generateDraft(input: ProductionDraftGenerationInput): Promise<ProductionDraftGenerationResult> {
    const accountKey = input.inputPackage.account.accountKey;
    const now = this.now();
    reportProgress(this.onProgress, "codex_draft.start", { account: accountKey });
    if (this.resetSession) {
      reportProgress(this.onProgress, "codex_session.reset", { account: accountKey, reason: "manual" });
      await resetCodexSession({ accountKey, sessionDir: this.sessionDir });
    }
    const storedSession = this.resetSession ? undefined : await readCodexSession({ accountKey, sessionDir: this.sessionDir });
    const existingSession =
      storedSession && !isCodexSessionExpired(storedSession, now, this.sessionMaxAgeHours) ? storedSession : undefined;
    if (storedSession && !existingSession) {
      reportProgress(this.onProgress, "codex_session.reset", { account: accountKey, reason: "expired" });
      await resetCodexSession({ accountKey, sessionDir: this.sessionDir });
    }
    reportProgress(this.onProgress, existingSession ? "codex_session.reuse" : "codex_session.new", { account: accountKey });
    const tempDir = await mkdtemp(join(tmpdir(), "post-foundry-codex-draft-"));
    try {
      const schemaPath = join(tempDir, "ai-posting-draft-output.schema.json");
      await writeFile(schemaPath, JSON.stringify(draftOutputJsonSchema(), null, 2), "utf8");
      const args = buildCodexExecArgs({
        schemaPath,
        model: this.modelOverride,
        enableSearch: this.enableSearch,
        sessionId: existingSession?.threadId
      });
      reportProgress(this.onProgress, "codex_exec.start", {
        account: accountKey,
        session: existingSession ? "resume" : "new",
        search: this.enableSearch,
        timeout_ms: this.timeoutMs
      });
      const result = await runCodexInvocation({
        runner: this.runner,
        command: this.command,
        args,
        cwd: this.cwd,
        stdin: buildDraftPrompt(input, this.enableSearch),
        timeoutMs: this.timeoutMs,
        stage: "codex_exec"
      });
      reportProgress(this.onProgress, "codex_exec.done", { account: accountKey });
      const codexOutput = parseCodexJsonlOutput(result.stdout);
      const output = parseCodexJsonOutput(codexOutput.finalMessage);
      reportProgress(this.onProgress, "codex_output.parsed", { account: accountKey });
      const threadId = codexOutput.threadId ?? existingSession?.threadId;
      if (threadId) {
        await writeCodexSession({
          accountKey,
          sessionDir: this.sessionDir,
          threadId,
          updatedAt: now
        });
        reportProgress(this.onProgress, "codex_session.updated", { account: accountKey });
      }
      return {
        output,
        usage: codexOutput.usage,
        providerResponseId: "codex:" + sha256(result.stdout).slice(0, 24)
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function checkCodexCliRuntime(options: {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  runner?: CodexExecRunner;
  onProgress?: ProgressReporter;
} = {}): Promise<CodexCliRuntimeCheck> {
  const command = options.command ?? defaultCodexCommand;
  const runner = options.runner ?? defaultCodexExecRunner;
  const timeoutMs = options.timeoutMs ?? 30_000;
  reportProgress(options.onProgress, "codex_preflight.version.start", { may_download_or_update: true, timeout_ms: timeoutMs });
  const version = await runCodexInvocation({
    runner,
    command,
    args: ["--version"],
    cwd: options.cwd,
    timeoutMs,
    stage: "codex_preflight_version"
  });
  const versionText = normalizeOutput(version.stdout, version.stderr);
  reportProgress(options.onProgress, "codex_preflight.version.ok", { version: versionText });
  reportProgress(options.onProgress, "codex_preflight.login.start", { timeout_ms: timeoutMs });
  const login = await runCodexInvocation({
    runner,
    command,
    args: ["login", "status"],
    cwd: options.cwd,
    timeoutMs,
    stage: "codex_preflight_login"
  });
  const loginStatus = normalizeOutput(login.stdout, login.stderr);
  reportProgress(options.onProgress, "codex_preflight.login.ok", { status: "ready" });
  if (/not\s+(logged|authenticated)|not signed in|no active/i.test(loginStatus)) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "codex",
      stage: "codex_preflight_login",
      message: "Codex CLI is not logged in; run just local-codex-login inside this environment"
    });
  }
  return {
    status: "ready",
    command,
    version: versionText,
    loginStatus
  };
}

export async function readCodexSession(input: { accountKey: string; sessionDir?: string }): Promise<CodexSessionRecord | undefined> {
  const path = codexSessionFilePath(input.sessionDir, input.accountKey);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw new ApiError({
      code: "provider_error",
      provider: "local",
      stage: "codex_session_store",
      message: "Failed to read Codex session record",
      details: error
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw invalidCodexSession("Codex session record is not valid JSON", error);
  }
  const record = sanitizeCodexSessionRecord(parsed);
  if (record.accountKey !== input.accountKey) {
    throw invalidCodexSession("Codex session record account key does not match requested account", {
      requested: input.accountKey,
      stored: record.accountKey
    });
  }
  return record;
}

export async function writeCodexSession(input: {
  accountKey: string;
  sessionDir?: string;
  threadId: string;
  updatedAt: string;
}): Promise<CodexSessionRecord> {
  const record = sanitizeCodexSessionRecord({
    accountKey: input.accountKey,
    threadId: input.threadId,
    updatedAt: input.updatedAt
  });
  const path = codexSessionFilePath(input.sessionDir, input.accountKey);
  await mkdir(resolve(input.sessionDir ?? defaultCodexSessionDir), { recursive: true });
  const tempPath = path + ".tmp-" + process.pid + "-" + Date.now();
  try {
    await writeFile(tempPath, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw new ApiError({
      code: "provider_error",
      provider: "local",
      stage: "codex_session_store",
      message: "Failed to write Codex session record",
      details: error
    });
  }
  return record;
}

export async function resetCodexSession(input: { accountKey: string; sessionDir?: string }): Promise<{ removed: boolean; path: string }> {
  const path = codexSessionFilePath(input.sessionDir, input.accountKey);
  try {
    await unlink(path);
    return { removed: true, path };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { removed: false, path };
    }
    throw new ApiError({
      code: "provider_error",
      provider: "local",
      stage: "codex_session_store",
      message: "Failed to reset Codex session record",
      details: error
    });
  }
}

export function codexSessionFilePath(sessionDir: string | undefined, accountKey: string): string {
  const safePrefix = sanitizeAccountKeyForFilename(accountKey).slice(0, 80) || "account";
  return join(resolve(sessionDir ?? defaultCodexSessionDir), safePrefix + "-" + sha256(accountKey).slice(0, 12) + ".json");
}

function isCodexSessionExpired(session: CodexSessionRecord, now: string, maxAgeHours: number | undefined): boolean {
  if (maxAgeHours === undefined) {
    return false;
  }
  const updatedAtMs = Date.parse(session.updatedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(updatedAtMs) || Number.isNaN(nowMs)) {
    return true;
  }
  return nowMs - updatedAtMs >= maxAgeHours * 60 * 60 * 1000;
}

function buildCodexExecArgs(input: {
  schemaPath: string;
  model?: string;
  enableSearch: boolean;
  sessionId?: string;
}): string[] {
  const globalArgs = ["--ask-for-approval", "never"];
  if (input.enableSearch) {
    globalArgs.push("--search");
  }
  const sharedArgs = ["--json", "--output-schema", input.schemaPath];
  if (!input.enableSearch) {
    sharedArgs.push("--config", "web_search=\"disabled\"");
  }
  if (input.model) {
    sharedArgs.push("--model", input.model);
  }
  if (input.sessionId) {
    return [...globalArgs, "exec", "--sandbox", "read-only", "resume", ...sharedArgs, input.sessionId, "-"];
  }
  return [...globalArgs, "exec", "--sandbox", "read-only", ...sharedArgs, "-"];
}

async function runCodexInvocation(input: {
  runner: CodexExecRunner;
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
  stage: string;
}): Promise<CodexExecResult> {
  let result: CodexExecResult;
  try {
    result = await input.runner({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      stdin: input.stdin,
      timeoutMs: input.timeoutMs,
      env: process.env
    });
  } catch (error) {
    throw new ApiError({
      code: isMissingExecutableError(error) ? "missing_credentials" : "provider_error",
      provider: "codex",
      stage: input.stage,
      message: isMissingExecutableError(error) ? "Codex CLI executable is missing" : "Codex CLI invocation failed at " + input.stage,
      details: error
    });
  }
  if (result.exitCode !== 0) {
    throw new ApiError({
      code: input.stage.startsWith("codex_preflight") ? "missing_credentials" : "provider_error",
      provider: "codex",
      stage: input.stage,
      message: "Codex CLI exited with code " + (result.exitCode ?? "signal") + " at " + input.stage,
      details: {
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: truncate(result.stderr),
        stdout: truncate(result.stdout)
      }
    });
  }
  return result;
}

function defaultCodexExecRunner(invocation: CodexExecInvocation): Promise<CodexExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Codex CLI timed out after " + invocation.timeoutMs + "ms"));
        return;
      }
      resolve({ stdout, stderr, exitCode, signal });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(invocation.stdin ?? "");
  });
}

function buildDraftPrompt(input: ProductionDraftGenerationInput, enableSearch: boolean): string {
  return [
    "You are PostFoundry's Codex CLI draft runtime for one owned X account.",
    "Generate exactly one candidate X post as JSON matching the provided schema.",
    "Do not edit files, do not run shell commands, and do not use browser automation.",
    "Never open x.com. Public X facts must come from the supplied evidence materials only.",
    enableSearch
      ? "You may use non-X web search when the Codex runtime exposes it for verification/background; if a new web fact is central but not represented in evidence, include its source URL in urls so downstream policy routes it to human review."
      : "Do not use web search; rely only on supplied evidence materials and memory.",
    "The external post_text must be natural plain text, concise, Chinese-first, and may keep necessary English technical terms.",
    "Write like a real person on X, not like a consulting report, research note, policy brief, announcement, or slide summary.",
    "Avoid stiff templates such as 'X is often mistaken for Y; it is really Z', 'the timeline looks far away but is not generous', and dense abstract noun piles.",
    "Prefer one concrete observation plus one clear judgement. If the result sounds like a report paragraph, rewrite shorter and more human.",
    "Do not write debug/test/task/PostFoundry markers in post_text.",
    "Prefer a short no-link post when evidence is sufficient. Links are allowed only when necessary and will route to human review.",
    "Return only JSON. No markdown fences, no explanation outside JSON.",
    "",
    JSON.stringify(
      {
        requested_at: input.requestedAt,
        account: input.inputPackage.account,
        initial_prompt: input.prompt.prompt,
        topic: input.inputPackage.topic,
        materials: input.inputPackage.materials,
        recent_posts: input.inputPackage.recentPosts,
        memory: input.memory
          ? {
              captured_at: input.memory.capturedAt,
              outcome_counts: input.memory.outcomeCounts,
              lifetime_stats: input.memory.lifetimeStats,
              topic_memory: input.memory.topicMemory.slice(0, 5),
              recent_trace_hints: input.memory.traceSummaries.slice(0, 5),
              next_run_hints: input.memory.nextRunHints.slice(0, 10)
            }
          : undefined,
        guardrails: input.inputPackage.guardrails,
        output_contract: {
          draft_id: "stable short id",
          post_text: "natural X post text",
          urls: "array of URLs present in or needed for the draft",
          topic_tags: "array of topic tags",
          evidence_ids: "array of ids from materials only",
          internal_notes: "brief private note explaining the decision"
        }
      },
      null,
      2
    )
  ].join("\n");
}

function draftOutputJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["draft_id", "post_text", "urls", "topic_tags", "evidence_ids", "internal_notes"],
    properties: {
      draft_id: { type: "string", minLength: 1 },
      post_text: { type: "string", minLength: 1, maxLength: 25000 },
      urls: { type: "array", items: { type: "string" } },
      topic_tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      evidence_ids: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      internal_notes: { type: "string" }
    }
  };
}

function parseCodexJsonlOutput(stdout: string): {
  threadId?: string;
  finalMessage: string;
  usage?: { inputTokens?: number; outputTokens?: number };
} {
  const text = stdout.trim();
  if (!text) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex JSONL output is empty"
    });
  }

  let threadId: string | undefined;
  let finalMessage: string | undefined;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "codex",
        stage: "codex_output_parse",
        message: "Codex JSONL output contains an invalid JSON event",
        details: error
      });
    }
    if (!event || typeof event !== "object") {
      continue;
    }
    const typedEvent = event as Record<string, unknown>;
    if (typedEvent.type === "thread.started" && typeof typedEvent.thread_id === "string") {
      threadId = sanitizeThreadId(typedEvent.thread_id);
    }
    if (typedEvent.type === "item.completed" && typedEvent.item && typeof typedEvent.item === "object") {
      const item = typedEvent.item as Record<string, unknown>;
      if (item.type === "agent_message" && typeof item.text === "string") {
        finalMessage = item.text;
      }
    }
    if (typedEvent.type === "turn.completed" && typedEvent.usage && typeof typedEvent.usage === "object") {
      usage = sanitizeUsage(typedEvent.usage as Record<string, unknown>);
    }
    if (typedEvent.type === "error") {
      throw new ApiError({
        code: "provider_error",
        provider: "codex",
        stage: "codex_exec",
        message: "Codex JSONL stream reported an error event",
        details: typedEvent
      });
    }
  }

  if (!finalMessage || !finalMessage.trim()) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex JSONL output did not contain a final agent message"
    });
  }
  return { threadId, finalMessage, usage };
}

function parseCodexJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex draft output is empty"
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex draft output is not valid JSON",
      details: error
    });
  }
}

function sanitizeCodexSessionRecord(value: unknown): CodexSessionRecord {
  if (!value || typeof value !== "object") {
    throw invalidCodexSession("Codex session record must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.accountKey !== "string" || !record.accountKey.trim()) {
    throw invalidCodexSession("Codex session record accountKey is invalid");
  }
  if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt)) || !record.updatedAt.includes("T")) {
    throw invalidCodexSession("Codex session record updatedAt is invalid");
  }
  return {
    accountKey: record.accountKey,
    threadId: sanitizeSessionThreadId(record.threadId),
    updatedAt: record.updatedAt
  };
}

function sanitizeSessionThreadId(value: unknown): string {
  if (typeof value !== "string" || !threadIdPattern.test(value)) {
    throw invalidCodexSession("Codex session record threadId is invalid");
  }
  return value;
}

function sanitizeThreadId(value: unknown): string {
  if (typeof value !== "string" || !threadIdPattern.test(value)) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex thread id is invalid"
    });
  }
  return value;
}

function sanitizeUsage(value: Record<string, unknown>): { inputTokens?: number; outputTokens?: number } | undefined {
  const inputTokens = readOptionalNonNegativeInteger(value.input_tokens);
  const outputTokens = readOptionalNonNegativeInteger(value.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse",
      message: "Codex usage token count is invalid"
    });
  }
  return value;
}

function invalidCodexSession(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "provider_schema_drift",
    provider: "local",
    stage: "codex_session_store",
    message,
    details
  });
}

function sanitizeAccountKeyForFilename(accountKey: string): string {
  return accountKey.replace(/[^A-Za-z0-9._-]/g, "_");
}

function normalizeOutput(stdout: string, stderr: string): string {
  return (stdout.trim() || stderr.trim() || "unknown").slice(0, 500);
}

function appendCapped(current: string, next: string): string {
  return truncate(current + next);
}

function truncate(value: string): string {
  if (value.length <= maxCapturedOutputLength) {
    return value;
  }
  return value.slice(value.length - maxCapturedOutputLength);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingExecutableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}
