import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import type { AccountInitialPrompt } from "../src/lib/accounts/account-prompt";
import {
  createAccountConfigSnapshot,
  parseAccountRegistryConfig,
  resolveAccountRef,
  type AccountConfig,
  type AccountRegistry
} from "../src/lib/accounts/registry";
import type { RecentPostInput, SourceMaterialInput } from "../src/lib/context/source-ingestion";
import {
  buildAccountMemory,
  createAccountReflection,
  recordAccountReflection,
  type AccountReflection
} from "../src/lib/memory/account-memory";
import {
  runOfflineOrchestration,
  type OfflineTelegramNotificationSender
} from "../src/lib/orchestration/offline-run";
import type { TelegramSendMessageInput } from "../src/lib/providers/telegram-notifier";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T10:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("account memory and reflection baseline", () => {
  it("builds account memory from ledger traces without prompt plaintext", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = await seedMemoryLedger(db);
      const memory = buildAccountMemory({
        repo,
        account,
        capturedAt: now
      });

      expect(memory).toMatchObject({
        kind: "account_memory_v1",
        accountUuid: account.account_uuid,
        accountKey: "zh-tech",
        guardrails: {
          accountScoped: true,
          ledgerDerived: true,
          offlineOnly: true,
          promptPlaintextForbidden: true
        }
      });
      expect(memory.traceSummaries).toHaveLength(3);
      expect(memory.promptSha256s).toContain(sha256(promptText));
      expect(JSON.stringify(memory)).not.toContain(promptText);
      expect(JSON.stringify(memory)).not.toContain("SECRET ACCOUNT PROMPT");
      expect(memory.outcomeCounts).toMatchObject({
        autoPost: 1,
        humanReview: 1,
        reject: 1,
        defer: 0,
        draftBlocked: 0
      });
      expect(memory.lifetimeStats).toMatchObject({
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
        }
      });
      expect(memory.lifetimeStats.topTopics[0]).toMatchObject({
        label: "AI agent workflow",
        selectedCount: 3
      });
      expect(memory.actionCounts).toMatchObject({
        x_official_auto_post_planned: 1,
        telegram_notification_sent: 1,
        policy_terminal_noop: 1
      });
      expect(memory.topicMemory[0]).toMatchObject({
        label: "AI agent workflow",
        selectedCount: 3
      });
      expect(memory.nextRunHints.join("\n")).toContain("avoid repeating recent selected topics");

      const limitedMemory = buildAccountMemory({
        repo,
        account,
        capturedAt: now,
        traceLimit: 1
      });
      expect(limitedMemory.traceSummaries).toHaveLength(1);
      expect(limitedMemory.outcomeCounts.autoPost + limitedMemory.outcomeCounts.humanReview + limitedMemory.outcomeCounts.reject).toBe(1);
      expect(limitedMemory.lifetimeStats.traceCount).toBe(3);
      expect(limitedMemory.lifetimeStats.outcomeCounts).toEqual(memory.lifetimeStats.outcomeCounts);

      const enMemory = buildAccountMemory({
        repo,
        account: accountByKey("en-tech"),
        capturedAt: now
      });
      expect(enMemory.traceSummaries).toHaveLength(0);
      expect(enMemory.outcomeCounts).toEqual({
        autoPost: 0,
        humanReview: 0,
        reject: 0,
        defer: 0,
        draftBlocked: 0
      });
    } finally {
      db.close();
    }
  });

  it("records account reflection into ledger without cross-account leakage", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = await seedMemoryLedger(db);
      const memory = buildAccountMemory({
        repo,
        account,
        capturedAt: now
      });
      const reflection = createAccountReflection({
        memory,
        reflectedAt: now
      });

      recordAccountReflection({
        repo,
        memory,
        reflection,
        runId: "memory-reflection-run-1",
        auditEventId: "memory-reflection-event-1",
        traceId: "trace-memory-reflection-1",
        startedAt: now,
        finishedAt: "2026-06-23T10:00:02.000Z"
      });

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      const reflectionRun = runs.find((run) => run.id === "memory-reflection-run-1");
      expect(reflectionRun).toMatchObject({
        purpose: "account_memory_reflection",
        model: "account-memory-offline-v0",
        status: "succeeded"
      });
      expect(reflectionRun?.input_json).not.toContain(promptText);
      expect(reflectionRun?.output_json).not.toContain(promptText);
      expect(reflectionRun?.input_json).toContain(sha256(promptText));
      expect(reflectionRun?.output_json).toContain(reflection.memorySha256);
      expect(repo.listEvidenceRefsForAccount(account.account_uuid).filter((ref) => ref.ai_run_id === "memory-reflection-run-1")).toHaveLength(3);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "memory-reflection-event-1",
            event_type: "account_memory_reflected",
            subject_type: "ai_run",
            subject_id: "memory-reflection-run-1"
          })
        ])
      );
      expect(repo.listAiRunsForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("rejects tampered reflection packages before writing ledger", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = await seedMemoryLedger(db);
      const memory = buildAccountMemory({
        repo,
        account,
        capturedAt: now
      });
      const reflection = createAccountReflection({
        memory,
        reflectedAt: now
      });

      expect(() =>
        recordAccountReflection({
          repo,
          memory,
          reflection: {
            ...reflection,
            accountUuid: accountByKey("en-tech").account_uuid
          } as AccountReflection,
          runId: "memory-reflection-bad-1",
          auditEventId: "memory-reflection-bad-event-1",
          traceId: "trace-memory-bad-1",
          startedAt: now,
          finishedAt: "2026-06-23T10:00:02.000Z"
        })
      ).toThrow();

      expect(() =>
        recordAccountReflection({
          repo,
          memory,
          reflection: {
            ...reflection,
            memorySha256: "0".repeat(64)
          },
          runId: "memory-reflection-bad-2",
          auditEventId: "memory-reflection-bad-event-2",
          traceId: "trace-memory-bad-2",
          startedAt: now,
          finishedAt: "2026-06-23T10:00:02.000Z"
        })
      ).toThrow();

      expect(() =>
        recordAccountReflection({
          repo,
          memory,
          reflection: {
            ...reflection,
            lessons: ["tampered lesson while keeping the same memory hash"]
          },
          runId: "memory-reflection-bad-3",
          auditEventId: "memory-reflection-bad-event-3",
          traceId: "trace-memory-bad-3",
          startedAt: now,
          finishedAt: "2026-06-23T10:00:02.000Z"
        })
      ).toThrow();

      expect(() =>
        recordAccountReflection({
          repo,
          memory,
          reflection: {
            ...reflection,
            summary: {
              ...reflection.summary,
              outcomeCounts: {
                ...reflection.summary.outcomeCounts,
                autoPost: 999
              }
            }
          },
          runId: "memory-reflection-bad-4",
          auditEventId: "memory-reflection-bad-event-4",
          traceId: "trace-memory-bad-4",
          startedAt: now,
          finishedAt: "2026-06-23T10:00:02.000Z"
        })
      ).toThrow();

      expect(() =>
        createAccountReflection({
          memory: {
            ...memory,
            lifetimeStats: {
              ...memory.lifetimeStats,
              topTopics: Array.from({ length: 21 }, (_, index) => ({
                topicId: `topic-${index}`,
                label: `Topic ${index}`,
                selectedCount: 1,
                outcomes: {
                  autoPost: 0,
                  humanReview: 0,
                  reject: 0,
                  defer: 0,
                  draftBlocked: 0
                }
              }))
            }
          },
          reflectedAt: now
        })
      ).toThrow();

      expect(repo.listAiRunsForAccount(account.account_uuid).filter((run) => run.purpose === "account_memory_reflection")).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

async function seedMemoryLedger(db: DatabaseSync): Promise<{
  repo: RuntimeRepository;
  account: AccountConfig;
}> {
  const repo = new RuntimeRepository(db);
  const registry = registryWithRealPostingEnabled("zh-tech");
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
  const snapshot = createAccountConfigSnapshot({
    registry,
    ref: { accountKey: "zh-tech" },
    capturedAt: now
  });
  const sender = fakeOfflineSender();
  const common = {
    repo,
    account,
    configSnapshot: snapshot,
    configSnapshotId: "snapshot-memory-zh-1",
    prompt: initialPrompt(account.account_key),
    materials: sourceMaterials(account),
    recentPosts: recentPosts(account),
    policyContext: basePolicyContext(),
    notificationSender: sender,
    now
  };

  await runOfflineOrchestration({
    ...common,
    draftOutput: naturalDraftOutput("draft-memory-auto-1"),
    runIdPrefix: "memory-auto-1",
    traceId: "trace-memory-auto-1"
  });
  await runOfflineOrchestration({
    ...common,
    draftOutput: {
      draft_id: "draft-memory-link-1",
      post_text: "AI 工作流的讨论可以看这份资料：https://example.com/ai-agent-workflow",
      urls: ["https://example.com/ai-agent-workflow"],
      topic_tags: ["AI", "agent_workflow"],
      evidence_ids: ["material-ai-agent-web"]
    },
    runIdPrefix: "memory-link-1",
    traceId: "trace-memory-link-1"
  });
  await runOfflineOrchestration({
    ...common,
    draftOutput: {
      draft_id: "draft-memory-reject-1",
      post_text: "politics 话题不应该混进这个账号。",
      topic_tags: ["politics"],
      evidence_ids: ["material-ai-agent-x"]
    },
    runIdPrefix: "memory-reject-1",
    traceId: "trace-memory-reject-1"
  });

  return {
    repo,
    account
  };
}

function registryWithRealPostingEnabled(accountKey: string): AccountRegistry {
  const config = JSON.parse(JSON.stringify(accountsExample)) as typeof accountsExample;
  const account = config.accounts.find((candidate) => candidate.account_key === accountKey);
  if (!account) {
    throw new Error(`missing account fixture: ${accountKey}`);
  }
  account.posting.real_posting_enabled = true;
  return parseAccountRegistryConfig(config);
}

function accountByKey(accountKey: string): AccountConfig {
  const registry = parseAccountRegistryConfig(accountsExample);
  return resolveAccountRef(registry, { accountKey }).account;
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
      capturedAt: "2026-06-23T09:45:00.000Z",
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
      capturedAt: "2026-06-23T09:40:00.000Z",
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
      capturedAt: "2026-06-23T09:35:00.000Z",
      topicTags: ["open_source", "devtools"],
      engagement: {
        likeCount: 300,
        repostCount: 50,
        replyCount: 12,
        bookmarkCount: 60,
        viewCount: 40_000
      }
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

function naturalDraftOutput(draftId: string) {
  return {
    draft_id: draftId,
    post_text: "AI 产品能不能长期有用，常常取决于它有没有把一次判断变成下一次可以复用的流程。",
    topic_tags: ["AI", "agent_workflow"],
    evidence_ids: ["material-ai-agent-x"],
    internal_notes: "offline fixture draft"
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

function fakeOfflineSender(): OfflineTelegramNotificationSender & {
  messages: TelegramSendMessageInput[];
} {
  const messages: TelegramSendMessageInput[] = [];
  return {
    mode: "offline_fake",
    messages,
    sendMessage: async (input) => {
      messages.push(input);
      return {
        messageId: 9100 + messages.length,
        chatId: "offline-channel"
      };
    }
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
