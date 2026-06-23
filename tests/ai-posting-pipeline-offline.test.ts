import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import type { AccountInitialPrompt } from "../src/lib/accounts/account-prompt";
import {
  createAccountConfigSnapshot,
  parseAccountRegistryConfig,
  resolveAccountRef,
  type AccountConfig
} from "../src/lib/accounts/registry";
import { ApiError } from "../src/lib/api/errors";
import {
  createDraftRunInputPackage,
  evaluateDraftForPosting,
  parseAiPostingDraftOutput,
  recordDraftRun,
  type AiPostingDraft,
  type DraftEvidenceMaterial,
  type DraftRunInputPackage,
  type RecentAccountPost
} from "../src/lib/drafts/ai-posting-pipeline";
import { evaluateAutomationPolicy } from "../src/lib/policy/automation";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T05:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("AI posting pipeline baseline", () => {
  it("builds an auditable draft input package without persisting prompt plaintext", () => {
    const { account, inputPackage } = buildDraftInputPackage();
    const serialized = JSON.stringify(inputPackage);

    expect(inputPackage.kind).toBe("ai_posting_draft_input_v1");
    expect(inputPackage.account).toMatchObject({
      accountUuid: account.account_uuid,
      accountKey: "zh-tech",
      configVersion: account.config_version,
      language: "zh-CN"
    });
    expect(inputPackage.account.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inputPackage.prompt).toEqual({
      source: "inline",
      promptSha256: sha256(promptText)
    });
    expect(inputPackage.materials.map((material) => material.id)).toEqual(["material-hot-post-1", "material-news-1"]);
    expect(inputPackage.recentPosts).toHaveLength(2);
    expect(serialized).not.toContain(promptText);
    expect(serialized).not.toContain("SECRET ACCOUNT PROMPT");
  });

  it("parses natural draft output and prepares a policy candidate", () => {
    const { inputPackage } = buildDraftInputPackage();
    const draft = parseAiPostingDraftOutput({
      inputPackage,
      output: {
        draft_id: "draft-zh-1",
        post_text: "很多 AI 产品真正的分水岭，不是模型名，而是它能不能把判断过程沉淀成下次还能复用的工作流。",
        topic_tags: ["AI", "devtools"],
        evidence_ids: ["material-hot-post-1"],
        internal_notes: "内部记录可以结构化，但 post_text 必须自然。"
      }
    });
    const gate = evaluateDraftForPosting({
      draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("ready");
    expect(gate.status === "ready" ? gate.candidate : undefined).toEqual({
      id: "draft-zh-1",
      text: "很多 AI 产品真正的分水岭，不是模型名，而是它能不能把判断过程沉淀成下次还能复用的工作流。",
      urls: [],
      topicTags: ["AI", "devtools"],
      evidenceIds: ["material-hot-post-1"]
    });
  });

  it("blocks formatted or debug-looking external post text before policy evaluation", () => {
    const { inputPackage } = buildDraftInputPackage();
    const draft = parseAiPostingDraftOutput({
      inputPackage,
      output: {
        draft_id: "draft-format-1",
        post_text: "结论：\n- AI 工作流要先记录判断\n- 再复盘结果",
        topic_tags: ["AI"],
        evidence_ids: ["material-hot-post-1"]
      }
    });
    const gate = evaluateDraftForPosting({
      draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("blocked");
    expect(gate.status === "blocked" ? gate.reasons.map((reason) => reason.code) : []).toContain("formatted_post_text");

    const debugDraft = parseAiPostingDraftOutput({
      inputPackage,
      output: {
        draft_id: "draft-debug-1",
        post_text: "PostFoundry .009 smoke test",
        topic_tags: ["AI"],
        evidence_ids: ["material-hot-post-1"]
      }
    });
    const debugGate = evaluateDraftForPosting({
      draft: debugDraft,
      recentPosts: inputPackage.recentPosts
    });
    expect(debugGate.status).toBe("blocked");
    expect(debugGate.status === "blocked" ? debugGate.reasons.map((reason) => reason.code) : []).toContain("debug_post_text");
  });

  it("lets long drafts reach policy so they can route to Telegram human gate", () => {
    const { inputPackage } = buildDraftInputPackage();
    const draft: AiPostingDraft = {
      id: "draft-long-1",
      accountUuid: inputPackage.account.accountUuid,
      accountKey: inputPackage.account.accountKey,
      topicId: inputPackage.topic.id,
      postText: `AI ${"产品判断需要把资料、上下文、假设和复盘都连起来，".repeat(18)}`,
      urls: [],
      topicTags: ["AI"],
      evidenceIds: ["material-hot-post-1"]
    };
    const gate = evaluateDraftForPosting({
      draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("ready");
    const decision = evaluateAutomationPolicy({
      account: withRealPostingEnabled(accountByKey("zh-tech")),
      candidate: gate.status === "ready" ? gate.candidate : undefined,
      context: basePolicyContext()
    });
    expect(decision).toMatchObject({
      outcome: "human_review",
      route: "telegram_human_gate",
      candidateId: draft.id
    });
    expect(decision.reasons.map((reason) => reason.code)).toContain("long_post_requires_human_review");
  });

  it("blocks extreme drafts that are too long for manual review", () => {
    const { inputPackage } = buildDraftInputPackage();
    const draft: AiPostingDraft = {
      id: "draft-extreme-long-1",
      accountUuid: inputPackage.account.accountUuid,
      accountKey: inputPackage.account.accountKey,
      topicId: inputPackage.topic.id,
      postText: `AI ${"很长".repeat(12_501)}`,
      urls: [],
      topicTags: ["AI"],
      evidenceIds: ["material-hot-post-1"]
    };
    const gate = evaluateDraftForPosting({
      draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("blocked");
    expect(gate.status === "blocked" ? gate.reasons.map((reason) => reason.code) : []).toContain("post_text_too_long");
  });

  it("reuses the real-post debug marker policy for draft post text", () => {
    const { inputPackage } = buildDraftInputPackage();
    const examples = [
      ".009",
      "dry-run draft",
      "testing the posting pipeline",
      "这是一条验收发帖",
      "调试一下 AI 发帖"
    ];

    for (const [index, text] of examples.entries()) {
      const draft = parseAiPostingDraftOutput({
        inputPackage,
        output: {
          draft_id: `draft-debug-marker-${index}`,
          post_text: text,
          topic_tags: ["AI"],
          evidence_ids: ["material-hot-post-1"]
        }
      });
      const gate = evaluateDraftForPosting({
        draft,
        recentPosts: inputPackage.recentPosts
      });

      expect(gate.status).toBe("blocked");
      expect(gate.status === "blocked" ? gate.reasons.map((reason) => reason.code) : []).toContain("debug_post_text");
    }
  });

  it("blocks obvious semantic repetition against recent account posts", () => {
    const { inputPackage } = buildDraftInputPackage();
    const duplicateDraft = parseAiPostingDraftOutput({
      inputPackage,
      output: {
        draft_id: "draft-duplicate-1",
        post_text: "AI 工具真正的价值，是把重复劳动变成可以复用的判断。",
        topic_tags: ["AI"],
        evidence_ids: ["material-hot-post-1"]
      }
    });
    const gate = evaluateDraftForPosting({
      draft: duplicateDraft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("blocked");
    expect(gate.duplicateCheck.status).toBe("duplicate");
    expect(gate.status === "blocked" ? gate.reasons.map((reason) => reason.code) : []).toContain("recent_duplicate");
  });

  it("feeds ready candidates into the automation policy schema", () => {
    const { account, inputPackage } = buildDraftInputPackage();
    const draft = naturalDraft(inputPackage);
    const gate = evaluateDraftForPosting({
      draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(gate.status).toBe("ready");
    const decision = evaluateAutomationPolicy({
      account: withRealPostingEnabled(account),
      candidate: gate.status === "ready" ? gate.candidate : undefined,
      context: basePolicyContext()
    });

    expect(decision).toMatchObject({
      outcome: "auto_post",
      route: "x_official_auto",
      candidateId: draft.id
    });
  });

  it("records draft runs, evidence refs, and audit events without storing prompt plaintext", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, inputPackage } = seedDraftRuntime(db);
      const draft = naturalDraft(inputPackage);
      const pollutedInputPackage = {
        ...inputPackage,
        leakedPrompt: promptText,
        account: {
          ...inputPackage.account,
          leakedPrompt: promptText
        },
        prompt: {
          ...inputPackage.prompt,
          prompt: promptText,
          plaintext: promptText
        },
        topic: {
          ...inputPackage.topic,
          leakedPrompt: promptText
        }
      } as unknown as DraftRunInputPackage;

      recordDraftRun({
        repo,
        inputPackage: pollutedInputPackage,
        draft,
        runId: "run-draft-zh-1",
        auditEventId: "event-draft-zh-1",
        traceId: "trace-draft-zh-1",
        startedAt: now,
        finishedAt: "2026-06-23T05:00:05.000Z"
      });

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs).toMatchObject([
        {
          id: "run-draft-zh-1",
          purpose: "ai_posting_draft",
          status: "succeeded"
        }
      ]);
      expect(runs[0].input_json).not.toContain(promptText);
      expect(runs[0].input_json).not.toContain("SECRET ACCOUNT PROMPT");
      expect(runs[0].input_json).not.toContain("leakedPrompt");
      expect(runs[0].input_json).not.toContain("plaintext");
      expect(runs[0].input_json).toContain(sha256(promptText));
      expect(runs[0].output_json).toContain(draft.postText);
      expect(repo.listEvidenceRefsForAccount(account.account_uuid)).toHaveLength(1);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "event-draft-zh-1",
          event_type: "ai_draft_created",
          subject_type: "ai_run",
          subject_id: "run-draft-zh-1"
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects drafts that cite evidence not present in the input package", () => {
    const { inputPackage } = buildDraftInputPackage();

    expectLocalError(() =>
      parseAiPostingDraftOutput({
        inputPackage,
        output: {
          draft_id: "draft-bad-evidence",
          post_text: "AI 判断要建立在能回看的资料上。",
          topic_tags: ["AI"],
          evidence_ids: ["missing-material"]
        }
      })
    );
  });
});

function buildDraftInputPackage(): {
  account: AccountConfig;
  inputPackage: DraftRunInputPackage;
} {
  const registry = parseAccountRegistryConfig(accountsExample);
  const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
  const snapshot = createAccountConfigSnapshot({
    registry,
    ref: { accountKey: "zh-tech" },
    capturedAt: now
  });
  const prompt: AccountInitialPrompt = {
    accountKey: "zh-tech",
    source: "inline",
    prompt: promptText,
    promptSha256: sha256(promptText)
  };

  return {
    account,
    inputPackage: createDraftRunInputPackage({
      account,
      configSnapshot: snapshot,
      configSnapshotId: "snapshot-zh-tech-1",
      prompt,
      topic: {
        id: "topic-ai-workflow-memory",
        label: "AI workflow memory",
        reason: "近期高赞帖和资料都在讨论 agent 如何把经验沉淀到工作流。",
        keywords: ["AI", "workflow", "memory"]
      },
      materials: draftMaterials(),
      recentPosts: recentPosts()
    })
  };
}

function seedDraftRuntime(db: DatabaseSync): {
  repo: RuntimeRepository;
  account: AccountConfig;
  inputPackage: DraftRunInputPackage;
} {
  const repo = new RuntimeRepository(db);
  const registry = parseAccountRegistryConfig(accountsExample);
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }

  const { account, inputPackage } = buildDraftInputPackage();
  return {
    repo,
    account,
    inputPackage
  };
}

function naturalDraft(inputPackage: DraftRunInputPackage): AiPostingDraft {
  return parseAiPostingDraftOutput({
    inputPackage,
    output: {
      draft_id: "draft-zh-record-1",
      post_text: "AI 产品能不能长期有用，常常取决于它有没有把一次判断变成下一次可以复用的流程。",
      topic_tags: ["AI", "devtools"],
      evidence_ids: ["material-hot-post-1"],
      internal_notes: "structured audit note"
    }
  });
}

function draftMaterials(): DraftEvidenceMaterial[] {
  return [
    {
      id: "material-hot-post-1",
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:example-hot-post-1",
      title: "High engagement post about AI workflow memory",
      summary: "一条高赞帖讨论 agent 产品需要把上下文和判断沉淀到工作流。",
      capturedAt: "2026-06-23T04:45:00.000Z"
    },
    {
      id: "material-news-1",
      sourceType: "web_page",
      provider: "manual_fixture",
      sourceRef: "article:workflow-memory-1",
      sourceUrl: "https://example.com/ai-workflow-memory",
      title: "AI workflow memory article",
      summary: "文章从产品角度解释为什么记忆和可复盘的工作流比单次生成更重要。",
      capturedAt: "2026-06-23T04:50:00.000Z"
    }
  ];
}

function recentPosts(): RecentAccountPost[] {
  return [
    {
      id: "recent-post-1",
      text: "AI 工具真正的价值，是把重复劳动变成可以复用的判断。",
      postedAt: "2026-06-22T10:00:00.000Z",
      source: "local_ledger"
    },
    {
      id: "recent-post-2",
      text: "很多开源项目的优势，不只是免费，而是让团队能看见工具背后的取舍。",
      postedAt: "2026-06-22T16:00:00.000Z",
      source: "local_ledger"
    }
  ];
}

function accountByKey(accountKey: string): AccountConfig {
  const registry = parseAccountRegistryConfig(accountsExample);
  return resolveAccountRef(registry, { accountKey }).account;
}

function withRealPostingEnabled(account: AccountConfig): AccountConfig {
  return {
    ...account,
    posting: {
      ...account.posting,
      real_posting_enabled: true
    }
  };
}

function basePolicyContext() {
  return {
    evaluatedAt: now,
    postedTodayCount: 0,
    lastPostedAt: "2026-06-22T20:00:00.000Z",
    monthlyXDataSpendUsd: 1,
    monthlyLlmSpendUsd: 1,
    publicXRequestsThisMonth: 10,
    estimatedXDataSpendUsd: 0,
    estimatedLlmSpendUsd: 0.01,
    estimatedPublicXRequests: 0
  };
}

function openMigratedTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectLocalError(fn: () => unknown): void {
  try {
    fn();
    throw new Error("expected ApiError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.provider).toBe("local");
    expect(apiError.code).toBe("invalid_request");
    expect(apiError.stage).toBe("ai_posting_pipeline");
  }
}
