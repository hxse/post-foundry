import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountInitialPrompt } from "../src/lib/accounts/account-prompt";
import { isApiError } from "../src/lib/api/errors";
import type { DraftRunInputPackage } from "../src/lib/drafts/ai-posting-pipeline";
import {
  checkCodexCliRuntime,
  CodexCliDraftGenerator,
  readCodexSession,
  writeCodexSession,
  type CodexExecInvocation,
  type CodexExecResult
} from "../src/lib/providers/codex-draft-generator";

const now = "2026-06-24T04:00:00.000Z";
const promptText = "账号方向：AI、open_source。\n发帖原则：自然、具体、可复盘。";
const draftOutput = {
  draft_id: "draft-codex-1",
  post_text: "AI 工具真正有价值的地方，是把一次判断变成下一次能复用的流程。",
  urls: [],
  topic_tags: ["AI"],
  evidence_ids: ["public-x:tweet-ai-1"],
  internal_notes: "codex offline fixture"
};

describe("Codex CLI draft generator", () => {
  it("starts a persistent Codex session and stores the account thread id", async () => {
    const sessionDir = await tempDir();
    const invocations: CodexExecInvocation[] = [];
    try {
      const generator = new CodexCliDraftGenerator({
        command: "codex-test",
        cwd: "/workspace/post-foundry",
        model: "gpt-codex-test",
        enableSearch: true,
        sessionDir,
        now: () => now,
        runner: async (invocation) => {
          invocations.push(invocation);
          const schemaPath = invocation.args[invocation.args.indexOf("--output-schema") + 1];
          const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { required: string[] };
          expect(schema.required).toEqual(["draft_id", "post_text", "urls", "topic_tags", "evidence_ids", "internal_notes"]);
          return okJsonl("thread-zh-tech-1", draftOutput, { input_tokens: 120, output_tokens: 30 });
        }
      });

      await expect(generator.generateDraft(generationInput())).resolves.toMatchObject({
        output: draftOutput,
        usage: { inputTokens: 120, outputTokens: 30 },
        providerResponseId: expect.stringMatching(/^codex:[a-f0-9]{24}$/)
      });

      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({
        command: "codex-test",
        cwd: "/workspace/post-foundry",
        timeoutMs: 180_000
      });
      expect(invocations[0].args).toEqual([
        "--ask-for-approval",
        "never",
        "--search",
        "exec",
        "--sandbox",
        "read-only",
        "--json",
        "--output-schema",
        expect.stringContaining("ai-posting-draft-output.schema.json"),
        "--model",
        "gpt-codex-test",
        "-"
      ]);
      expect(invocations[0].args).not.toContain("--ephemeral");
      expect(invocations[0].stdin).toContain("Never open x.com");
      expect(invocations[0].stdin).toContain("non-X web search");
      expect(invocations[0].stdin).toContain("账号方向：AI、open_source。");
      expect(invocations[0].stdin).toContain("发帖原则：自然、具体、可复盘。");
      expect(invocations[0].stdin).toContain("public-x:tweet-ai-1");
      await expect(readCodexSession({ accountKey: "zh-tech", sessionDir })).resolves.toEqual({
        accountKey: "zh-tech",
        threadId: "thread-zh-tech-1",
        updatedAt: now
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not expire old account Codex sessions unless max age is configured", async () => {
    const sessionDir = await tempDir();
    const invocations: CodexExecInvocation[] = [];
    try {
      await writeCodexSession({
        accountKey: "zh-tech",
        sessionDir,
        threadId: "thread-old-but-valid",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
      const generator = new CodexCliDraftGenerator({
        command: "codex-test",
        sessionDir,
        now: () => now,
        runner: async (invocation) => {
          invocations.push(invocation);
          return okJsonl("thread-old-but-valid", draftOutput);
        }
      });

      await generator.generateDraft(generationInput());

      expect(invocations).toHaveLength(1);
      expect(invocations[0].args).toContain("resume");
      expect(invocations[0].args).toContain("thread-old-but-valid");
      await expect(readCodexSession({ accountKey: "zh-tech", sessionDir })).resolves.toMatchObject({
        threadId: "thread-old-but-valid",
        updatedAt: now
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("expires stored account Codex sessions after the configured max age", async () => {
    const sessionDir = await tempDir();
    const invocations: CodexExecInvocation[] = [];
    try {
      await writeCodexSession({
        accountKey: "zh-tech",
        sessionDir,
        threadId: "thread-stale",
        updatedAt: "2026-06-20T04:00:00.000Z"
      });
      const generator = new CodexCliDraftGenerator({
        command: "codex-test",
        sessionDir,
        sessionMaxAgeHours: 72,
        now: () => now,
        runner: async (invocation) => {
          invocations.push(invocation);
          return okJsonl("thread-fresh", draftOutput);
        }
      });

      await generator.generateDraft(generationInput());

      expect(invocations).toHaveLength(1);
      expect(invocations[0].args).not.toContain("resume");
      await expect(readCodexSession({ accountKey: "zh-tech", sessionDir })).resolves.toMatchObject({
        threadId: "thread-fresh",
        updatedAt: now
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("resumes the stored account Codex session by default", async () => {
    const sessionDir = await tempDir();
    const invocations: CodexExecInvocation[] = [];
    try {
      await writeCodexSession({
        accountKey: "zh-tech",
        sessionDir,
        threadId: "thread-zh-tech-existing",
        updatedAt: "2026-06-24T03:00:00.000Z"
      });
      const generator = new CodexCliDraftGenerator({
        command: "codex-test",
        cwd: "/workspace/post-foundry",
        sessionDir,
        now: () => now,
        runner: async (invocation) => {
          invocations.push(invocation);
          return okJsonl("thread-zh-tech-existing", draftOutput);
        }
      });

      await generator.generateDraft(generationInput());

      expect(invocations).toHaveLength(1);
      expect(invocations[0].args).toEqual([
        "--ask-for-approval",
        "never",
        "--search",
        "exec",
        "--sandbox",
        "read-only",
        "resume",
        "--json",
        "--output-schema",
        expect.stringContaining("ai-posting-draft-output.schema.json"),
        "thread-zh-tech-existing",
        "-"
      ]);
      await expect(readCodexSession({ accountKey: "zh-tech", sessionDir })).resolves.toMatchObject({
        threadId: "thread-zh-tech-existing",
        updatedAt: now
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("resetSession forgets the stored account session before drafting", async () => {
    const sessionDir = await tempDir();
    const invocations: CodexExecInvocation[] = [];
    try {
      await writeCodexSession({
        accountKey: "zh-tech",
        sessionDir,
        threadId: "thread-old",
        updatedAt: "2026-06-24T03:00:00.000Z"
      });
      const generator = new CodexCliDraftGenerator({
        command: "codex-test",
        sessionDir,
        resetSession: true,
        now: () => now,
        runner: async (invocation) => {
          invocations.push(invocation);
          return okJsonl("thread-new", draftOutput);
        }
      });

      await generator.generateDraft(generationInput());

      expect(invocations).toHaveLength(1);
      expect(invocations[0].args).toContain("exec");
      expect(invocations[0].args).not.toContain("resume");
      await expect(readCodexSession({ accountKey: "zh-tech", sessionDir })).resolves.toMatchObject({
        threadId: "thread-new"
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("maps codex exec nonzero exits to provider errors", async () => {
    const generator = new CodexCliDraftGenerator({
      runner: async () => ({
        stdout: "",
        stderr: "not logged in",
        exitCode: 1
      })
    });

    await expect(generator.generateDraft(generationInput())).rejects.toMatchObject({
      code: "provider_error",
      provider: "codex",
      stage: "codex_exec"
    });
  });

  it("rejects non-JSON final Codex messages", async () => {
    const generator = new CodexCliDraftGenerator({
      runner: async () => okJsonl("thread-1", "not json")
    });

    await expect(generator.generateDraft(generationInput())).rejects.toMatchObject({
      code: "provider_schema_drift",
      provider: "codex",
      stage: "codex_output_parse"
    });
  });

  it("checks Codex CLI version and login status without drafting", async () => {
    const invocations: CodexExecInvocation[] = [];
    const result = await checkCodexCliRuntime({
      command: "codex-test",
      cwd: "/workspace/post-foundry",
      runner: async (invocation) => {
        invocations.push(invocation);
        if (invocation.args.join(" ") === "--version") {
          return ok("codex 1.2.3");
        }
        if (invocation.args.join(" ") === "login status") {
          return ok("Logged in with ChatGPT");
        }
        throw new Error("unexpected codex invocation");
      }
    });

    expect(result).toEqual({
      status: "ready",
      command: "codex-test",
      version: "codex 1.2.3",
      loginStatus: "Logged in with ChatGPT"
    });
    expect(invocations.map((invocation) => invocation.args)).toEqual([["--version"], ["login", "status"]]);
  });

  it("rejects an explicit not-logged-in status", async () => {
    await expect(
      checkCodexCliRuntime({
        runner: async (invocation) => (invocation.args[0] === "--version" ? ok("codex 1.2.3") : ok("Not logged in"))
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) {
        return false;
      }
      expect(error).toMatchObject({
        code: "missing_credentials",
        provider: "codex",
        stage: "codex_preflight_login"
      });
      return true;
    });
  });
});

function generationInput() {
  return {
    inputPackage: inputPackage(),
    prompt: initialPrompt(),
    requestedAt: now
  };
}

function inputPackage(): DraftRunInputPackage {
  return {
    kind: "ai_posting_draft_input_v1",
    account: {
      accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
      accountKey: "zh-tech",
      configVersion: 1,
      configHash: sha256("config"),
      language: "zh-CN",
      topics: {
        include: ["AI"],
        exclude: []
      },
      style: {
        voice: "natural",
        rules: ["concise"],
        banned_phrases: ["PostFoundry"]
      }
    },
    prompt: {
      source: "inline",
      promptSha256: sha256(promptText)
    },
    topic: {
      id: "topic-ai",
      label: "AI workflow memory",
      reason: "high engagement source",
      keywords: ["AI"]
    },
    materials: [
      {
        id: "public-x:tweet-ai-1",
        sourceType: "public_x_post",
        provider: "twitterapi.io",
        sourceRef: "tweet:tweet-ai-1",
        summary: "AI operators are turning judgment into reusable workflow memory.",
        capturedAt: now
      }
    ],
    recentPosts: [],
    guardrails: {
      externalPostTextMode: "natural_plain_text",
      structuredInternalPayloadAllowed: true,
      forbidFormattedExternalPost: true,
      requireEvidenceIds: true,
      requireRecentDuplicateCheck: true,
      linkHandling: "links_route_to_human_review_downstream"
    }
  };
}

function initialPrompt(): AccountInitialPrompt {
  return {
    accountKey: "zh-tech",
    source: "inline",
    prompt: promptText,
    promptSha256: sha256(promptText)
  };
}

function okJsonl(
  threadId: string,
  output: unknown,
  usage: { input_tokens?: number; output_tokens?: number } = { input_tokens: 10, output_tokens: 5 }
): CodexExecResult {
  const finalText = typeof output === "string" ? output : JSON.stringify(output);
  return ok(
    [
      JSON.stringify({ type: "thread.started", thread_id: threadId }),
      JSON.stringify({ type: "item.completed", item: { id: "item-1", type: "agent_message", text: finalText } }),
      JSON.stringify({ type: "turn.completed", usage })
    ].join("\n") + "\n"
  );
}

function ok(stdout: string): CodexExecResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "post-foundry-codex-test-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
