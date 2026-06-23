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
import { buildSourceContext, type RecentPostInput, type SourceMaterialInput } from "../src/lib/context/source-ingestion";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";
import { buildTopicRadar, recordTopicRadarSelection, type TopicRadarPackage } from "../src/lib/topics/topic-radar";

const now = "2026-06-23T08:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("topic radar baseline", () => {
  it("selects an account-scoped topic and feeds source context", () => {
    const account = accountByKey("zh-tech");
    const radar = buildTopicRadar({
      account,
      configSnapshot: accountSnapshot("zh-tech"),
      configSnapshotId: "snapshot-topic-zh-1",
      prompt: initialPrompt("zh-tech"),
      materials: sourceMaterials(account),
      recentPosts: recentPosts(account),
      observedAt: now,
      candidatesLimit: 4
    });

    expect(radar).toMatchObject({
      kind: "topic_radar_v1",
      accountUuid: account.account_uuid,
      accountKey: "zh-tech",
      observedAt: now,
      guardrails: {
        noOnlineCalls: true,
        accountScoped: true,
        promptPlaintextForbidden: true
      }
    });
    expect(radar.selectedTopic.label).toBe("AI agent workflow");
    expect(radar.selectedTopic.keywords).toEqual(expect.arrayContaining(["AI", "agent_workflow"]));
    expect(radar.candidates.find((candidate) => candidate.topic.id === radar.selectedTopic.id)).toMatchObject({
      status: "eligible",
      materialIds: expect.arrayContaining(["material-ai-agent-x"])
    });
    expect(radar.candidates.map((candidate) => candidate.topic.label)).not.toContain("AI daily");
    expect(JSON.stringify(radar)).not.toContain(promptText);
    expect(JSON.stringify(radar)).toContain(sha256(promptText));

    const context = buildSourceContext({
      account,
      topic: radar.selectedTopic,
      materials: sourceMaterials(account),
      recentPosts: recentPosts(account),
      collectedAt: now,
      materialsLimit: 3
    });
    expect(context.topic.id).toBe(radar.selectedTopic.id);
    expect(context.materials.map((material) => material.id)).toContain("material-ai-agent-x");
  });

  it("suppresses recently repeated topics and selects an alternative", () => {
    const account = accountByKey("zh-tech");
    const radar = buildTopicRadar({
      account,
      configSnapshot: accountSnapshot("zh-tech"),
      prompt: initialPrompt("zh-tech"),
      materials: sourceMaterials(account),
      recentPosts: [
        {
          id: "recent-duplicate-ai-agent",
          accountUuid: account.account_uuid,
          text: "AI agent workflow is becoming a visible topic among builders because teams want repeatable judgement.",
          postedAt: "2026-06-23T07:30:00.000Z",
          source: "local_ledger"
        }
      ],
      observedAt: now,
      duplicateThreshold: 0.28
    });

    const suppressed = radar.candidates.find((candidate) => candidate.topic.label === "AI agent workflow");
    expect(suppressed).toMatchObject({
      status: "suppressed_recent_duplicate"
    });
    expect(radar.selectedTopic.label).toBe("open source devtools");
  });

  it("rejects cross-account and non-account-scoped topic inputs", () => {
    const zh = accountByKey("zh-tech");
    const en = accountByKey("en-tech");

    expectLocalError(() =>
      buildTopicRadar({
        account: zh,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: [
          {
            ...sourceMaterials(zh)[0],
            accountUuid: en.account_uuid
          }
        ],
        recentPosts: recentPosts(zh),
        observedAt: now
      })
    );

    expectLocalError(() =>
      buildTopicRadar({
        account: zh,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: [
          {
            ...sourceMaterials(zh)[0],
            accountUuid: undefined
          } as SourceMaterialInput
        ],
        recentPosts: recentPosts(zh),
        observedAt: now
      })
    );

    expectLocalError(() =>
      buildTopicRadar({
        account: zh,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: sourceMaterials(zh),
        recentPosts: [
          {
            ...recentPosts(zh)[0],
            accountUuid: undefined
          } as RecentPostInput
        ],
        observedAt: now
      })
    );

    expectLocalError(() =>
      buildTopicRadar({
        account: zh,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: [sourceMaterials(zh)[0], sourceMaterials(zh)[0]],
        recentPosts: recentPosts(zh),
        observedAt: now
      })
    );

    expectLocalError(() =>
      buildTopicRadar({
        account: zh,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: [
          {
            id: "material-daily-only",
            accountUuid: zh.account_uuid,
            sourceType: "manual_note",
            provider: "manual_fixture",
            sourceRef: "note:daily-only",
            summary: "daily habits and said notes should not match a short topic token.",
            capturedAt: now,
            topicTags: ["daily"]
          }
        ],
        recentPosts: [],
        observedAt: now
      })
    );
  });

  it("records topic radar selection into the audit ledger without prompt plaintext", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const radar = buildTopicRadar({
        account,
        configSnapshot: accountSnapshot("zh-tech"),
        configSnapshotId: "snapshot-topic-zh-1",
        prompt: initialPrompt("zh-tech"),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        observedAt: now
      });

      recordTopicRadarSelection({
        repo,
        radar,
        runId: "run-topic-zh-1",
        auditEventId: "event-topic-zh-1",
        traceId: "trace-topic-zh-1",
        startedAt: now,
        finishedAt: "2026-06-23T08:00:04.000Z"
      });

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs).toMatchObject([
        {
          id: "run-topic-zh-1",
          purpose: "topic_radar_selection",
          model: "topic-radar-offline-v0",
          status: "succeeded"
        }
      ]);
      expect(runs[0].input_json).not.toContain(promptText);
      expect(runs[0].output_json).not.toContain(promptText);
      expect(runs[0].input_json).toContain(sha256(promptText));
      expect(runs[0].output_json).toContain(radar.selectedTopic.id);
      expect(repo.listEvidenceRefsForAccount(account.account_uuid)).toHaveLength(radar.materials.length);
      expect(repo.listEvidenceRefsForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "event-topic-zh-1",
          event_type: "topic_selected",
          subject_type: "ai_run",
          subject_id: "run-topic-zh-1",
          actor_type: "ai"
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects tampered radar packages before writing ledger", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const radar = buildTopicRadar({
        account,
        configSnapshot: accountSnapshot("zh-tech"),
        prompt: initialPrompt("zh-tech"),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        observedAt: now
      });

      expectLocalError(() =>
        recordTopicRadarSelection({
          repo,
          radar: {
            ...radar,
            materialScores: {
              [radar.materials[0].id]: radar.materialScores[radar.materials[0].id]
            }
          } as TopicRadarPackage,
          runId: "run-topic-bad-1",
          auditEventId: "event-topic-bad-1",
          traceId: "trace-topic-bad-1",
          startedAt: now,
          finishedAt: "2026-06-23T08:00:04.000Z"
        })
      );

      expectLocalError(() =>
        recordTopicRadarSelection({
          repo,
          radar: {
            ...radar,
            selection: {
              ...radar.selection,
              selectedTopicId: "different-topic"
            }
          },
          runId: "run-topic-bad-2",
          auditEventId: "event-topic-bad-2",
          traceId: "trace-topic-bad-2",
          startedAt: now,
          finishedAt: "2026-06-23T08:00:04.000Z"
        })
      );

      expectLocalError(() =>
        recordTopicRadarSelection({
          repo,
          radar: {
            ...radar,
            selectedTopic: {
              ...radar.selectedTopic,
              label: "tampered selected label"
            }
          },
          runId: "run-topic-bad-3",
          auditEventId: "event-topic-bad-3",
          traceId: "trace-topic-bad-3",
          startedAt: now,
          finishedAt: "2026-06-23T08:00:04.000Z"
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

function sourceMaterials(account: AccountConfig): SourceMaterialInput[] {
  return [
    {
      id: "material-ai-agent-x",
      accountUuid: account.account_uuid,
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:ai-agent-workflow",
      title: "High engagement X post about AI agent workflows",
      text: "AI agent workflow is becoming a visible topic among builders because teams want repeatable judgement.",
      capturedAt: "2026-06-23T07:45:00.000Z",
      topicTags: ["AI", "agent_workflow"],
      authorHandle: "example_builder",
      engagement: {
        likeCount: 900,
        repostCount: 130,
        replyCount: 40,
        bookmarkCount: 160,
        viewCount: 120_000
      }
    },
    {
      id: "material-ai-agent-web",
      accountUuid: account.account_uuid,
      sourceType: "web_page",
      provider: "web_news_fixture",
      sourceRef: "article:ai-agent-workflow",
      sourceUrl: "https://example.com/ai-agent-workflow",
      title: "AI agent workflow article",
      summary: "A source that verifies why agent workflows need durable memory and replayable decisions.",
      capturedAt: "2026-06-23T07:40:00.000Z",
      topicTags: ["AI", "agent_workflow"]
    },
    {
      id: "material-open-source-devtools",
      accountUuid: account.account_uuid,
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:open-source-devtools",
      title: "Open source devtools release",
      text: "An open_source devtools project is getting attention because it makes local automation easier to audit.",
      capturedAt: "2026-06-23T07:35:00.000Z",
      topicTags: ["open_source", "devtools"],
      engagement: {
        likeCount: 300,
        repostCount: 50,
        replyCount: 12,
        bookmarkCount: 60,
        viewCount: 40_000
      }
    },
    {
      id: "material-daily-only",
      accountUuid: account.account_uuid,
      sourceType: "manual_note",
      provider: "manual_fixture",
      sourceRef: "note:daily-only",
      summary: "daily writing habits and said examples should not match a short topic token.",
      capturedAt: "2026-06-23T07:20:00.000Z",
      topicTags: ["daily"]
    },
    {
      id: "material-excluded-politics",
      accountUuid: account.account_uuid,
      sourceType: "manual_note",
      provider: "manual_fixture",
      sourceRef: "note:politics-ai",
      summary: "politics 相关争议不进入这个账号的选题。",
      capturedAt: "2026-06-23T07:10:00.000Z",
      topicTags: ["politics", "AI"]
    }
  ];
}

function recentPosts(account: AccountConfig): RecentPostInput[] {
  return [
    {
      id: "recent-1",
      accountUuid: account.account_uuid,
      text: "很多开源项目的优势，不只是免费，而是让团队能看见工具背后的取舍。",
      postedAt: "2026-06-22T16:00:00.000Z",
      source: "local_ledger"
    },
    {
      id: "recent-2",
      accountUuid: account.account_uuid,
      text: "越是想让系统自动化，越要先把人工判断写清楚。",
      postedAt: "2026-06-22T10:00:00.000Z",
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
    expect(apiError.stage).toBe("topic_radar");
  }
}
