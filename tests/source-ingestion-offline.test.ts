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
  buildSourceContext,
  createDraftInputPackageFromSourceContext,
  recordSourceContextIngestion,
  type RecentPostInput,
  type SourceMaterialInput
} from "../src/lib/context/source-ingestion";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T06:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("source ingestion baseline", () => {
  it("builds source context for one account and converts it to a draft input package", () => {
    const account = accountByKey("zh-tech");
    const sourceContext = buildSourceContext({
      account,
      topic: aiWorkflowTopic(),
      materials: sourceMaterials(account),
      recentPosts: recentPosts(account),
      collectedAt: now,
      materialsLimit: 2,
      recentPostsLimit: 2
    });
    const draftInput = createDraftInputPackageFromSourceContext({
      account,
      configSnapshot: accountSnapshot("zh-tech"),
      configSnapshotId: "snapshot-source-zh-1",
      prompt: initialPrompt("zh-tech"),
      sourceContext
    });

    expect(sourceContext).toMatchObject({
      kind: "source_context_v1",
      accountUuid: account.account_uuid,
      accountKey: "zh-tech",
      collectedAt: now
    });
    expect(sourceContext.materials.map((material) => material.id)).toEqual(["material-hot-x-1", "material-web-1"]);
    expect(sourceContext.materials.map((material) => material.id)).not.toContain("material-excluded-politics");
    expect(sourceContext.recentPosts.map((post) => post.id)).toEqual(["recent-2", "recent-1"]);
    expect(draftInput.materials.map((material) => material.id)).toEqual(["material-hot-x-1", "material-web-1"]);
    expect(draftInput.recentPosts.map((post) => post.id)).toEqual(["recent-2", "recent-1"]);
    expect(JSON.stringify(draftInput)).not.toContain(promptText);
    expect(JSON.stringify(draftInput)).toContain(sha256(promptText));
  });

  it("rejects cross-account source materials and recent posts", () => {
    const zh = accountByKey("zh-tech");
    const en = accountByKey("en-tech");

    expectLocalError(() =>
      buildSourceContext({
        account: zh,
        topic: aiWorkflowTopic(),
        materials: [
          {
            ...sourceMaterials(zh)[0],
            accountUuid: en.account_uuid
          }
        ],
        recentPosts: recentPosts(zh),
        collectedAt: now
      })
    );

    expectLocalError(() =>
      buildSourceContext({
        account: zh,
        topic: aiWorkflowTopic(),
        materials: [sourceMaterials(zh)[0]],
        recentPosts: [
          {
            ...recentPosts(zh)[0],
            accountUuid: en.account_uuid
          }
        ],
        collectedAt: now
      })
    );
  });

  it("rejects duplicate source material ids and empty post-material context", () => {
    const account = accountByKey("zh-tech");
    const material = sourceMaterials(account)[0];

    expectLocalError(() =>
      buildSourceContext({
        account,
        topic: aiWorkflowTopic(),
        materials: [material, material],
        recentPosts: recentPosts(account),
        collectedAt: now
      })
    );

    expectLocalError(() =>
      buildSourceContext({
        account,
        topic: aiWorkflowTopic(),
        materials: [sourceMaterials(account).find((candidate) => candidate.id === "material-excluded-politics") as SourceMaterialInput],
        recentPosts: recentPosts(account),
        collectedAt: now
      })
    );
  });

  it("rejects invalid source context limits", () => {
    const account = accountByKey("zh-tech");
    for (const materialsLimit of [0, -1, 1.5]) {
      expectLocalError(() =>
        buildSourceContext({
          account,
          topic: aiWorkflowTopic(),
          materials: sourceMaterials(account),
          recentPosts: recentPosts(account),
          collectedAt: now,
          materialsLimit
        })
      );
    }

    for (const recentPostsLimit of [0, -1, 1.5]) {
      expectLocalError(() =>
        buildSourceContext({
          account,
          topic: aiWorkflowTopic(),
          materials: sourceMaterials(account),
          recentPosts: recentPosts(account),
          collectedAt: now,
          recentPostsLimit
        })
      );
    }
  });

  it("records source context ingestion into the audit ledger", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const sourceContext = buildSourceContext({
        account,
        topic: aiWorkflowTopic(),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        collectedAt: now,
        materialsLimit: 2,
        recentPostsLimit: 2
      });

      recordSourceContextIngestion({
        repo,
        sourceContext,
        runId: "run-source-zh-1",
        auditEventId: "event-source-zh-1",
        traceId: "trace-source-zh-1",
        startedAt: now,
        finishedAt: "2026-06-23T06:00:05.000Z"
      });

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs).toMatchObject([
        {
          id: "run-source-zh-1",
          purpose: "source_context_ingestion",
          model: "source-ingestion-offline-v0",
          status: "succeeded"
        }
      ]);
      expect(runs[0].input_json).toContain("material-hot-x-1");
      expect(runs[0].output_json).toContain("recent_post_hashes");
      expect(repo.listEvidenceRefsForAccount(account.account_uuid)).toHaveLength(2);
      expect(repo.listEvidenceRefsForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "event-source-zh-1",
          event_type: "source_context_built",
          subject_type: "ai_run",
          subject_id: "run-source-zh-1"
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects source context packages whose material scores do not match materials", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const sourceContext = buildSourceContext({
        account,
        topic: aiWorkflowTopic(),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        collectedAt: now,
        materialsLimit: 2
      });

      expectLocalError(() =>
        recordSourceContextIngestion({
          repo,
          sourceContext: {
            ...sourceContext,
            materialScores: {
              [sourceContext.materials[0].id]: sourceContext.materialScores[sourceContext.materials[0].id]
            }
          },
          runId: "run-source-bad-score-1",
          auditEventId: "event-source-bad-score-1",
          traceId: "trace-source-bad-score-1",
          startedAt: now,
          finishedAt: "2026-06-23T06:00:05.000Z"
        })
      );

      expectLocalError(() =>
        recordSourceContextIngestion({
          repo,
          sourceContext: {
            ...sourceContext,
            materialScores: {
              ...sourceContext.materialScores,
              "unknown-material": 1
            }
          },
          runId: "run-source-bad-score-2",
          auditEventId: "event-source-bad-score-2",
          traceId: "trace-source-bad-score-2",
          startedAt: now,
          finishedAt: "2026-06-23T06:00:05.000Z"
        })
      );

      expect(repo.listAiRunsForAccount(account.account_uuid)).toHaveLength(0);
      expect(repo.listEvidenceRefsForAccount(account.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

function accountByKey(accountKey: string): AccountConfig {
  const registry = parseAccountRegistryConfig(accountsExample);
  return resolveAccountRef(registry, { accountKey }).account;
}

function accountSnapshot(accountKey: string) {
  const registry = parseAccountRegistryConfig(accountsExample);
  return createAccountConfigSnapshot({
    registry,
    ref: { accountKey },
    capturedAt: now
  });
}

function initialPrompt(accountKey: string): AccountInitialPrompt {
  return {
    accountKey,
    source: "inline",
    prompt: promptText,
    promptSha256: sha256(promptText)
  };
}

function aiWorkflowTopic() {
  return {
    id: "topic-ai-workflow-memory",
    label: "AI workflow memory",
    reason: "近期高赞帖和资料都在讨论 agent 如何把经验沉淀到工作流。",
    keywords: ["AI", "workflow", "memory"]
  };
}

function sourceMaterials(account: AccountConfig): SourceMaterialInput[] {
  return [
    {
      id: "material-web-1",
      accountUuid: account.account_uuid,
      sourceType: "web_page",
      provider: "manual_fixture",
      sourceRef: "article:ai-workflow-memory",
      sourceUrl: "https://example.com/ai-workflow-memory",
      title: "AI workflow memory article",
      summary: "文章重新核验了 agent 产品为什么需要把判断过程沉淀到工作流。",
      capturedAt: "2026-06-23T05:45:00.000Z",
      topicTags: ["AI", "workflow"]
    },
    {
      id: "material-hot-x-1",
      accountUuid: account.account_uuid,
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:hot-ai-workflow",
      title: "High engagement X post about AI workflows",
      text: "AI workflow memory is becoming a visible topic among builders.",
      capturedAt: "2026-06-23T05:50:00.000Z",
      topicTags: ["AI", "workflow"],
      authorHandle: "example_author",
      engagement: {
        likeCount: 800,
        repostCount: 120,
        replyCount: 30,
        bookmarkCount: 140,
        viewCount: 100_000
      }
    },
    {
      id: "material-excluded-politics",
      accountUuid: account.account_uuid,
      sourceType: "manual_note",
      provider: "manual_fixture",
      sourceRef: "note:politics-ai",
      summary: "politics 相关争议不进入这个账号的选题。",
      capturedAt: "2026-06-23T05:55:00.000Z",
      topicTags: ["politics", "AI"]
    }
  ];
}

function recentPosts(account: AccountConfig): RecentPostInput[] {
  return [
    {
      id: "recent-1",
      accountUuid: account.account_uuid,
      text: "AI 工具真正的价值，是把重复劳动变成可以复用的判断。",
      postedAt: "2026-06-22T10:00:00.000Z",
      source: "local_ledger"
    },
    {
      id: "recent-2",
      accountUuid: account.account_uuid,
      text: "很多开源项目的优势，不只是免费，而是让团队能看见工具背后的取舍。",
      postedAt: "2026-06-22T16:00:00.000Z",
      source: "local_ledger"
    },
    {
      id: "recent-3",
      accountUuid: account.account_uuid,
      text: "越是想让系统自动化，越要先把人工判断写清楚。",
      postedAt: "2026-06-21T16:00:00.000Z",
      source: "local_ledger"
    }
  ];
}

function seedAccounts(db: DatabaseSync): {
  repo: RuntimeRepository;
  account: AccountConfig;
} {
  const repo = new RuntimeRepository(db);
  const registry = parseAccountRegistryConfig(accountsExample);
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }

  return {
    repo,
    account: resolveAccountRef(registry, { accountKey: "zh-tech" }).account
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
    expect(apiError.stage).toBe("source_ingestion");
  }
}
