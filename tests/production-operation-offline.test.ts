import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import type { AccountInitialPrompt } from "../src/lib/accounts/account-prompt";
import { parseAccountRegistryConfig, resolveAccountRef, type AccountConfig, type AccountRegistry } from "../src/lib/accounts/registry";
import { createProductionOperationExecutor } from "../src/lib/orchestration/production-operation-executor";
import { runOnlineOperationOnce } from "../src/lib/orchestration/online-runner";
import type { ProductionDraftGenerationInput, ProductionDraftGenerator } from "../src/lib/llm/production-draft-generator";
import type { PublicXDataProvider, PublicXSearchInput } from "../src/lib/providers/public-x";
import type { TelegramSendMessageInput, TelegramSentMessage } from "../src/lib/providers/telegram-notifier";
import type { XPostInput, XPostOutput } from "../src/lib/providers/x-official-publisher";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T04:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("production v0 operation loop", () => {
  it("runs source, topic, context, LLM draft, policy, and X auto-post through one production trace", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const publicX = fakePublicXProvider();
      const draftGenerator = fakeDraftGenerator(naturalDraftOutput("draft-prod-auto-1"));
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-auto-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: publicX,
          draftGenerator,
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => initialPrompt("zh-tech"),
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "completed",
        finalAction: "x_official_auto_post",
        summary: {
          executor: "production_operation_v0",
          source_collection_status: "succeeded",
          draft_id: "draft-prod-auto-1",
          draft_gate_status: "ready",
          policy_outcome: "auto_post",
          policy_route: "x_official_auto",
          final_action_kind: "x_auto_post",
          tweet_id: "tweet-prod-1"
        }
      });
      expect(publicX.calls).toEqual([{ query: "AI", limit: 2 }]);
      expect(draftGenerator.requests).toHaveLength(1);
      expect(draftGenerator.requests[0].prompt.prompt).toBe(promptText);
      expect(autoPoster.posts).toEqual([
        {
          accountKey: "zh-tech",
          text: naturalDraftOutput("draft-prod-auto-1").post_text,
          dryRun: false
        }
      ]);
      expect(notifier.messages).toHaveLength(0);

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs.map((run) => run.purpose)).toEqual(
        expect.arrayContaining(["public_x_source_collection", "topic_radar_selection", "source_context_ingestion", "ai_posting_draft", "automation_policy"])
      );
      expect(JSON.stringify(runs)).not.toContain(promptText);
      expect(JSON.stringify(runs)).toContain(sha256(promptText));
      expect(repo.listApiCallAuditForAccount(account.account_uuid).map((audit) => `${audit.provider}:${audit.operation}:${audit.status}`)).toEqual(
        expect.arrayContaining(["twitterapi.io:public_x_search:succeeded", "openai:llm_draft_generation:succeeded"])
      );
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toMatchObject([
        {
          outcome: "auto_post",
          requires_human_review: 0
        }
      ]);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          action_type: "x_official_auto_post",
          status: "succeeded"
        }
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid).map((event) => event.event_type)).toEqual(
        expect.arrayContaining(["topic_selected", "source_context_built", "ai_draft_created", "automation_policy_decided", "x_official_auto_post_created"])
      );
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes link drafts to Telegram human notification without X posting", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-link-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: fakePublicXProvider(),
          draftGenerator: fakeDraftGenerator({
            draft_id: "draft-prod-link-1",
            post_text: "AI 工作流的讨论可以先看这份资料：https://example.com/ai-workflow",
            urls: ["https://example.com/ai-workflow"],
            topic_tags: ["AI"],
            evidence_ids: ["public-x:tweet-ai-1"],
            internal_notes: "link branch"
          }),
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => initialPrompt("zh-tech"),
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "completed",
        finalAction: "telegram_notification_sent",
        summary: {
          policy_outcome: "human_review",
          policy_route: "telegram_human_gate",
          final_action_kind: "telegram_notification",
          telegram_delivery_status: "sent"
        }
      });
      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(1);
      expect(notifier.messages[0].text).toContain("https://example.com/ai-workflow");
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          action_type: "telegram_notification_sent",
          status: "succeeded"
        }
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops formatted drafts at the draft gate before policy and final providers", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-blocked-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: fakePublicXProvider(),
          draftGenerator: fakeDraftGenerator({
            draft_id: "draft-prod-blocked-1",
            post_text: "结论：\n- AI 工作流需要记录判断\n- 再复盘结果",
            urls: [],
            topic_tags: ["AI"],
            evidence_ids: ["public-x:tweet-ai-1"],
            internal_notes: "formatted branch"
          }),
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => initialPrompt("zh-tech"),
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "draft_gate_blocked",
        summary: {
          draft_gate_status: "blocked",
          final_action_kind: "draft_blocked"
        }
      });
      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(0);
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toHaveLength(0);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          action_type: "draft_gate_blocked",
          status: "skipped"
        }
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records a failed draft run when successful LLM output cannot be parsed", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();

      await expect(
        runOnlineOperationOnce({
          accountKey: "zh-tech",
          lockDir: dir,
          traceId: "trace-prod-v0-parse-failed-1",
          now: fixedNow(now),
          enableHeartbeat: false,
          operation: createProductionOperationExecutor({
            repo,
            registry,
            accountKey: "zh-tech",
            publicXProvider: fakePublicXProvider(),
            draftGenerator: fakeDraftGenerator({
              draft_id: "draft-prod-parse-failed-1",
              post_text: "AI 判断需要证据，但证据引用也必须能被回放。",
              urls: [],
              topic_tags: ["AI"],
              evidence_ids: ["missing-evidence-id"],
              internal_notes: "invalid evidence branch"
            }),
            autoPoster,
            notificationSender: notifier,
            loadPrompt: () => initialPrompt("zh-tech"),
            maxQueries: 1,
            perQueryLimit: 2
          })
        })
      ).rejects.toThrow(/draft references unknown evidence id/);

      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(0);
      expect(repo.listApiCallAuditForAccount(account.account_uuid).map((audit) => [audit.provider, audit.operation, audit.status].join(":"))).toEqual(
        expect.arrayContaining(["twitterapi.io:public_x_search:succeeded", "openai:llm_draft_generation:succeeded"])
      );
      expect(repo.listAiRunsForAccount(account.account_uuid)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "trace-prod-v0-parse-failed-1:draft-run",
            purpose: "ai_posting_draft",
            status: "failed"
          })
        ])
      );
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "trace-prod-v0-parse-failed-1:draft-event",
            event_type: "ai_draft_failed"
          })
        ])
      );
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toHaveLength(0);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records policy terminal noop for rejected drafts", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-reject-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: fakePublicXProvider(),
          draftGenerator: fakeDraftGenerator({
            draft_id: "draft-prod-reject-1",
            post_text: "politics 话题不应该混进这个账号。",
            urls: [],
            topic_tags: ["politics"],
            evidence_ids: ["public-x:tweet-ai-1"],
            internal_notes: "reject branch"
          }),
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => initialPrompt("zh-tech"),
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "policy_terminal_noop",
        summary: {
          policy_outcome: "reject",
          policy_route: "blocked",
          final_action_kind: "policy_terminal"
        }
      });
      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(0);
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toMatchObject([
        {
          outcome: "reject",
          requires_human_review: 0
        }
      ]);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          action_type: "policy_terminal_noop",
          status: "skipped"
        }
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("stops before prompt and downstream providers when source collection is skipped", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithPublicXRequestCap("zh-tech", 0);
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const publicX = fakePublicXProvider();
      const draftGenerator = fakeDraftGenerator(naturalDraftOutput("draft-should-not-run"));
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();
      let promptLoads = 0;

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-source-skip-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: publicX,
          draftGenerator,
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => {
            promptLoads += 1;
            return initialPrompt("zh-tech");
          },
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "source_collection_skipped",
        summary: {
          source_collection_status: "skipped",
          skipped_reason: "public_x_request_cap_reached"
        }
      });
      expect(publicX.calls).toHaveLength(0);
      expect(promptLoads).toBe(0);
      expect(draftGenerator.requests).toHaveLength(0);
      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(0);
      expect(repo.listAiRunsForAccount(account.account_uuid).map((run) => run.purpose)).toEqual(["public_x_source_collection"]);
      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops before prompt and downstream providers when source collection returns no materials", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = registryWithRealPostingEnabled("zh-tech");
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const publicX = fakeEmptyPublicXProvider();
      const draftGenerator = fakeDraftGenerator(naturalDraftOutput("draft-should-not-run"));
      const autoPoster = fakeAutoPoster();
      const notifier = fakeNotifier();
      let promptLoads = 0;

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-prod-v0-source-empty-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionOperationExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          publicXProvider: publicX,
          draftGenerator,
          autoPoster,
          notificationSender: notifier,
          loadPrompt: () => {
            promptLoads += 1;
            return initialPrompt("zh-tech");
          },
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "source_collection_empty",
        summary: {
          source_collection_status: "succeeded",
          skipped_reason: "no_source_materials",
          material_count: 0
        }
      });
      expect(publicX.calls).toEqual([{ query: "AI", limit: 2 }]);
      expect(promptLoads).toBe(0);
      expect(draftGenerator.requests).toHaveLength(0);
      expect(autoPoster.posts).toHaveLength(0);
      expect(notifier.messages).toHaveLength(0);
      expect(repo.listAiRunsForAccount(account.account_uuid).map((run) => run.purpose)).toEqual(["public_x_source_collection"]);
      expect(repo.listApiCallAuditForAccount(account.account_uuid).map((audit) => [audit.provider, audit.operation, audit.status].join(":"))).toEqual([
        "twitterapi.io:public_x_search:succeeded"
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function registryWithRealPostingEnabled(accountKey: string): AccountRegistry {
  const config = JSON.parse(JSON.stringify(accountsExample)) as typeof accountsExample;
  const account = config.accounts.find((candidate) => candidate.account_key === accountKey);
  if (!account) {
    throw new Error(`missing account fixture: ${accountKey}`);
  }
  account.posting.real_posting_enabled = true;
  return parseAccountRegistryConfig(config);
}

function registryWithPublicXRequestCap(accountKey: string, monthlyRequestCap: number): AccountRegistry {
  const config = JSON.parse(JSON.stringify(accountsExample)) as typeof accountsExample;
  const account = config.accounts.find((candidate) => candidate.account_key === accountKey);
  if (!account) {
    throw new Error(`missing account fixture: ${accountKey}`);
  }
  account.posting.real_posting_enabled = true;
  account.data_sources.public_x.monthly_request_cap = monthlyRequestCap;
  return parseAccountRegistryConfig(config);
}

function fakePublicXProvider(): PublicXDataProvider & { calls: PublicXSearchInput[] } {
  const calls: PublicXSearchInput[] = [];
  return {
    calls,
    searchPosts: async (input) => {
      calls.push(input);
      const posts = [
        {
          id: "tweet-ai-1",
          text: "AI operators are turning judgment into reusable workflow memory.",
          authorId: "author-ai-1",
          authorHandle: "ai_builder",
          createdAt: "2026-06-24T03:50:00.000Z",
          likeCount: 100,
          repostCount: 10,
          replyCount: 2,
          quoteCount: 1,
          bookmarkCount: 5,
          viewCount: 1000,
          url: "https://x.com/ai_builder/status/tweet-ai-1"
        }
      ].slice(0, input.limit);
      return {
        sourceProvider: "twitterapi.io",
        rawCount: posts.length,
        posts
      };
    },
    getPostById: async () => undefined
  };
}

function fakeEmptyPublicXProvider(): PublicXDataProvider & { calls: PublicXSearchInput[] } {
  const calls: PublicXSearchInput[] = [];
  return {
    calls,
    searchPosts: async (input) => {
      calls.push(input);
      return {
        sourceProvider: "twitterapi.io",
        rawCount: 0,
        posts: []
      };
    },
    getPostById: async () => undefined
  };
}

function fakeDraftGenerator(output: unknown): ProductionDraftGenerator & { requests: ProductionDraftGenerationInput[] } {
  const requests: ProductionDraftGenerationInput[] = [];
  return {
    providerName: "openai",
    model: "offline-production-llm",
    requests,
    generateDraft: async (input) => {
      requests.push(input);
      return {
        output,
        usage: {
          inputTokens: 100,
          outputTokens: 30
        },
        providerResponseId: "resp-offline-1"
      };
    }
  };
}

function fakeAutoPoster(): { posts: XPostInput[]; createPost(input: XPostInput): Promise<XPostOutput> } {
  const posts: XPostInput[] = [];
  return {
    posts,
    createPost: async (input) => {
      posts.push(input);
      return {
        status: "posted",
        accountKey: input.accountKey,
        tweetId: `tweet-prod-${posts.length}`,
        textLength: input.text.length
      };
    }
  };
}

function fakeNotifier(): { messages: TelegramSendMessageInput[]; sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage> } {
  const messages: TelegramSendMessageInput[] = [];
  return {
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

function naturalDraftOutput(draftId: string) {
  return {
    draft_id: draftId,
    post_text: "AI 产品能不能长期有用，常常取决于它有没有把一次判断变成下一次可以复用的流程。",
    urls: [],
    topic_tags: ["AI"],
    evidence_ids: ["public-x:tweet-ai-1"],
    internal_notes: "offline production fixture draft"
  };
}

function initialPrompt(accountKey: string): AccountInitialPrompt {
  return {
    accountKey,
    source: "inline",
    prompt: promptText,
    promptSha256: sha256(promptText)
  };
}

function openMigratedTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}

function fixedNow(value: string): () => Date {
  return () => new Date(value);
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "post-foundry-production-operation-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
