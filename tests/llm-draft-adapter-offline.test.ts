import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "./fixtures/accounts";
import type { AccountInitialPrompt } from "../src/lib/accounts/account-prompt";
import {
  createAccountConfigSnapshot,
  parseAccountRegistryConfig,
  resolveAccountRef,
  type AccountConfig
} from "../src/lib/accounts/registry";
import type { AccountMemorySnapshot } from "../src/lib/memory/account-memory";
import { ApiError } from "../src/lib/api/errors";
import {
  createDraftRunInputPackage,
  evaluateDraftForPosting,
  type DraftEvidenceMaterial,
  type DraftRunInputPackage,
  type RecentAccountPost
} from "../src/lib/drafts/ai-posting-pipeline";
import {
  buildDraftLlmRequest,
  recordDraftLlmAdapterRun,
  runOfflineDraftLlmAdapter,
  type DraftLlmAdapterResult,
  type DraftLlmRequest,
  type OfflineDraftLlmProvider
} from "../src/lib/llm/draft-adapter";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T01:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("LLM draft adapter boundary", () => {
  it("builds a prompt-safe request and parses offline fixture draft output", async () => {
    const { account, inputPackage } = buildInputPackage();
    const memory = accountMemory(account);
    const provider = fakeProvider(validDraftOutput("draft-llm-1"));

    const result = await runOfflineDraftLlmAdapter({
      provider,
      inputPackage,
      memory,
      requestedAt: now
    });
    const gate = evaluateDraftForPosting({
      draft: result.draft,
      recentPosts: inputPackage.recentPosts
    });

    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(result.request)).not.toContain(promptText);
    expect(JSON.stringify(result.request)).not.toContain("SECRET ACCOUNT PROMPT");
    expect(result.request.prompt.promptSha256).toBe(sha256(promptText));
    expect(result.request.memory).toMatchObject({
      capturedAt: now,
      lifetimeStats: {
        traceCount: 3
      }
    });
    expect(result.draft).toMatchObject({
      id: "draft-llm-1",
      accountUuid: account.account_uuid,
      topicId: inputPackage.topic.id,
      evidenceIds: ["material-ai-agent-x"]
    });
    expect(gate.status).toBe("ready");
  });

  it("records adapter runs without storing prompt plaintext", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, inputPackage } = seedRuntime(db);
      const result = await runOfflineDraftLlmAdapter({
        provider: fakeProvider(validDraftOutput("draft-llm-record-1")),
        inputPackage,
        memory: accountMemory(account),
        requestedAt: now
      });

      recordDraftLlmAdapterRun({
        repo,
        result,
        runId: "run-llm-draft-1",
        auditEventId: "event-llm-draft-1",
        traceId: "trace-llm-draft-1",
        startedAt: now,
        finishedAt: "2026-06-24T01:00:02.000Z"
      });

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs).toMatchObject([
        {
          id: "run-llm-draft-1",
          purpose: "llm_draft_generation",
          model: "offline-fixture-llm-v0",
          status: "succeeded"
        }
      ]);
      expect(runs[0].input_json).not.toContain(promptText);
      expect(runs[0].output_json).not.toContain(promptText);
      expect(runs[0].input_json).toContain(sha256(promptText));
      expect(runs[0].output_json).toContain("draft-llm-record-1");
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "event-llm-draft-1",
          event_type: "llm_draft_generated",
          subject_type: "ai_run",
          subject_id: "run-llm-draft-1"
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects tampered adapter result before ledger write", async () => {
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      provider: {
        ...result.provider,
        provider: promptText
      }
    }));
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      provider: {
        ...result.provider,
        model: promptText
      }
    }));
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      rawOutputSha256: promptText
    }));
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      draft: {
        ...result.draft,
        id: promptText
      }
    }));
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      usage: {
        ...result.usage,
        secret: promptText
      }
    }));
    await expectTamperedAdapterResultRejected((result) => ({
      ...result,
      draft: {
        ...result.draft,
        topicId: "topic-other"
      }
    }));
  });

  it("rejects invalid provider output before draft gate or policy", async () => {
    const { inputPackage } = buildInputPackage();

    await expect(
      runOfflineDraftLlmAdapter({
        provider: fakeProvider({
          draft_id: "draft-bad-evidence",
          post_text: "AI 判断要建立在能回看的资料上。",
          topic_tags: ["AI"],
          evidence_ids: ["missing-material"]
        }),
        inputPackage,
        requestedAt: now
      })
    ).rejects.toMatchObject({
      provider: "local",
      stage: "ai_posting_pipeline",
      code: "invalid_request"
    });
  });

  it("rejects non-offline providers and cross-account memory", async () => {
    const { inputPackage } = buildInputPackage();
    const provider = {
      ...fakeProvider(validDraftOutput("draft-unsafe-provider")),
      mode: "online_debug"
    } as unknown as OfflineDraftLlmProvider;

    await expect(
      runOfflineDraftLlmAdapter({
        provider,
        inputPackage,
        requestedAt: now
      })
    ).rejects.toMatchObject({
      provider: "local",
      stage: "llm_draft_adapter",
      code: "invalid_request"
    });

    expect(() =>
      buildDraftLlmRequest({
        inputPackage,
        memory: accountMemory(accountByKey("en-tech")),
        requestedAt: now
      })
    ).toThrow(ApiError);
  });
});

function buildInputPackage(): {
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
  return {
    account,
    inputPackage: createDraftRunInputPackage({
      account,
      configSnapshot: snapshot,
      configSnapshotId: "snapshot-llm-zh-1",
      prompt: initialPrompt(account.account_key),
      topic: {
        id: "topic-ai-agent-workflow",
        label: "AI agent workflow",
        reason: "近期资料都在讨论 agent 工作流如何沉淀判断。",
        keywords: ["AI", "agent_workflow"]
      },
      materials: draftMaterials(),
      recentPosts: recentPosts()
    })
  };
}

function seedRuntime(db: DatabaseSync): {
  repo: RuntimeRepository;
  account: AccountConfig;
  inputPackage: DraftRunInputPackage;
} {
  const repo = new RuntimeRepository(db);
  const registry = parseAccountRegistryConfig(accountsExample);
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  const { account, inputPackage } = buildInputPackage();
  return {
    repo,
    account,
    inputPackage
  };
}

async function expectTamperedAdapterResultRejected(
  tamper: (result: DraftLlmAdapterResult) => unknown
): Promise<void> {
  const db = openMigratedTestDb();
  try {
    const { repo, account, inputPackage } = seedRuntime(db);
    const result = await runOfflineDraftLlmAdapter({
      provider: fakeProvider(validDraftOutput("draft-llm-tamper-1")),
      inputPackage,
      memory: accountMemory(account),
      requestedAt: now
    });

    expect(() =>
      recordDraftLlmAdapterRun({
        repo,
        result: tamper(result) as DraftLlmAdapterResult,
        runId: "run-llm-draft-tamper-1",
        auditEventId: "event-llm-draft-tamper-1",
        traceId: "trace-llm-draft-tamper-1",
        startedAt: now,
        finishedAt: "2026-06-24T01:00:02.000Z"
      })
    ).toThrow(ApiError);
    expect(repo.listAiRunsForAccount(account.account_uuid)).toEqual([]);
    expect(repo.listAuditEventsForAccount(account.account_uuid)).toEqual([]);
  } finally {
    db.close();
  }
}

function initialPrompt(accountKey: string): AccountInitialPrompt {
  return {
    accountKey,
    source: "inline",
    prompt: promptText,
    promptSha256: sha256(promptText)
  };
}

function draftMaterials(): DraftEvidenceMaterial[] {
  return [
    {
      id: "material-ai-agent-x",
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:ai-agent-workflow",
      title: "High engagement post about AI agent workflows",
      summary: "一条高赞帖讨论 agent 产品需要把上下文和判断沉淀到工作流。",
      capturedAt: "2026-06-24T00:45:00.000Z"
    },
    {
      id: "material-ai-agent-web",
      sourceType: "web_page",
      provider: "web_news_fixture",
      sourceRef: "article:ai-agent-workflow",
      sourceUrl: "https://example.com/ai-agent-workflow",
      title: "AI agent workflow article",
      summary: "文章解释 agent workflows 为什么需要 durable memory and replayable decisions。",
      capturedAt: "2026-06-24T00:50:00.000Z"
    }
  ];
}

function recentPosts(): RecentAccountPost[] {
  return [
    {
      id: "recent-post-1",
      text: "很多开源项目的优势，不只是免费，而是让团队能看见工具背后的取舍。",
      postedAt: "2026-06-23T16:00:00.000Z",
      source: "local_ledger"
    }
  ];
}

function accountMemory(account: AccountConfig): AccountMemorySnapshot {
  return {
    kind: "account_memory_v1",
    accountUuid: account.account_uuid,
    accountKey: account.account_key,
    capturedAt: now,
    source: {
      runCount: 12,
      decisionCount: 3,
      actionCount: 3,
      evidenceCount: 8,
      eventCount: 15
    },
    promptSha256s: [sha256(promptText)],
    outcomeCounts: {
      autoPost: 1,
      humanReview: 1,
      reject: 1,
      defer: 0,
      draftBlocked: 0
    },
    actionCounts: {
      x_official_auto_post_planned: 1,
      telegram_notification_sent: 1,
      policy_terminal_noop: 1
    },
    topicMemory: [
      {
        topicId: "topic-ai-agent-workflow",
        label: "AI agent workflow",
        selectedCount: 3,
        outcomes: {
          autoPost: 1,
          humanReview: 1,
          reject: 1,
          defer: 0,
          draftBlocked: 0
        },
        recentTraceIds: ["trace-memory-auto-1", "trace-memory-link-1"]
      }
    ],
    lifetimeStats: {
      traceCount: 3,
      outcomeCounts: {
        autoPost: 1,
        humanReview: 1,
        reject: 1,
        defer: 0,
        draftBlocked: 0
      },
      actionCounts: {
        x_official_auto_post_planned: 1,
        telegram_notification_sent: 1,
        policy_terminal_noop: 1
      },
      topTopics: [
        {
          topicId: "topic-ai-agent-workflow",
          label: "AI agent workflow",
          selectedCount: 3,
          outcomes: {
            autoPost: 1,
            humanReview: 1,
            reject: 1,
            defer: 0,
            draftBlocked: 0
          }
        }
      ]
    },
    traceSummaries: [
      {
        traceId: "trace-memory-auto-1",
        startedAt: "2026-06-23T10:00:00.000Z",
        eventTypes: ["topic_selected", "automation_policy_decided", "offline_auto_post_planned"],
        selectedTopic: {
          id: "topic-ai-agent-workflow",
          label: "AI agent workflow",
          keywords: ["AI", "agent_workflow"]
        },
        policy: {
          decisionId: "decision-memory-auto-1",
          outcome: "auto_post",
          route: "x_official_auto",
          reasonCodes: ["policy_passed"]
        },
        finalAction: {
          actionId: "action-memory-auto-1",
          actionType: "x_official_auto_post_planned",
          status: "skipped"
        },
        evidenceIds: ["material-ai-agent-x"]
      }
    ],
    nextRunHints: ["avoid repeating recent selected topics: AI agent workflow"],
    guardrails: {
      accountScoped: true,
      ledgerDerived: true,
      offlineOnly: true,
      promptPlaintextForbidden: true
    }
  };
}

function fakeProvider(output: unknown): OfflineDraftLlmProvider & {
  requests: DraftLlmRequest[];
} {
  const requests: DraftLlmRequest[] = [];
  return {
    provider: "offline_fixture_llm",
    model: "offline-fixture-llm-v0",
    mode: "offline_fixture",
    requests,
    generateDraft: async (request) => {
      requests.push(request);
      return {
        output,
        usage: {
          inputTokens: 500,
          outputTokens: 80,
          costUsd: 0
        }
      };
    }
  };
}

function validDraftOutput(draftId: string) {
  return {
    draft_id: draftId,
    post_text: "AI 产品能不能长期有用，常常取决于它有没有把一次判断变成下一次可以复用的流程。",
    topic_tags: ["AI", "agent_workflow"],
    evidence_ids: ["material-ai-agent-x"],
    internal_notes: "offline fixture response"
  };
}

function accountByKey(accountKey: string): AccountConfig {
  const registry = parseAccountRegistryConfig(accountsExample);
  return resolveAccountRef(registry, { accountKey }).account;
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
