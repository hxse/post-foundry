import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "./fixtures/accounts";
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
  runOfflineOrchestration,
  type OfflineTelegramNotificationSender
} from "../src/lib/orchestration/offline-run";
import type { TelegramSendMessageInput } from "../src/lib/providers/telegram-notifier";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T09:00:00.000Z";
const promptText = "SECRET ACCOUNT PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("offline orchestration run baseline", () => {
  it("runs the auto-post branch as an offline planned action with one trace", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, snapshot } = seedRuntime(db);
      const sender = fakeOfflineSender();

      const result = await runOfflineOrchestration({
        repo,
        account,
        configSnapshot: snapshot,
        configSnapshotId: "snapshot-orch-zh-1",
        prompt: initialPrompt(account.account_key),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        draftOutput: naturalDraftOutput("draft-orch-auto-1"),
        policyContext: basePolicyContext(),
        notificationSender: sender,
        runIdPrefix: "orch-auto-1",
        traceId: "trace-orch-auto-1",
        now
      });

      expect(result.finalAction).toEqual({
        kind: "auto_post_planned",
        actionId: "orch-auto-1:final-action"
      });
      expect(result.policyDecision).toMatchObject({
        outcome: "auto_post",
        route: "x_official_auto"
      });
      expect(sender.messages).toHaveLength(0);

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs.map((run) => run.purpose)).toEqual(
        expect.arrayContaining(["topic_radar_selection", "source_context_ingestion", "ai_posting_draft", "automation_policy"])
      );
      expect(JSON.stringify(runs)).not.toContain(promptText);
      expect(JSON.stringify(runs)).toContain(sha256(promptText));
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "orch-auto-1:policy-decision",
          outcome: "auto_post",
          requires_human_review: 0
        }
      ]);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "orch-auto-1:final-action",
          action_type: "x_official_auto_post_planned",
          status: "skipped"
        }
      ]);
      const events = repo.listAuditEventsForAccount(account.account_uuid);
      expect(events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          "topic_selected",
          "source_context_built",
          "ai_draft_created",
          "automation_policy_decided",
          "offline_auto_post_planned"
        ])
      );
      expect(events.every((event) => event.trace_id === "trace-orch-auto-1")).toBe(true);
      expect(repo.listAiRunsForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("runs the link branch through fake Telegram notification only", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, snapshot } = seedRuntime(db);
      const sender = fakeOfflineSender();

      const result = await runOfflineOrchestration({
        repo,
        account,
        configSnapshot: snapshot,
        configSnapshotId: "snapshot-orch-zh-1",
        prompt: initialPrompt(account.account_key),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        draftOutput: {
          draft_id: "draft-orch-link-1",
          post_text: "AI 工作流的讨论可以看这份资料：https://example.com/ai-agent-workflow",
          urls: ["https://example.com/ai-agent-workflow"],
          topic_tags: ["AI", "agent_workflow"],
          evidence_ids: ["material-ai-agent-web"]
        },
        policyContext: basePolicyContext(),
        notificationSender: sender,
        runIdPrefix: "orch-link-1",
        traceId: "trace-orch-link-1",
        now
      });

      expect(result.policyDecision).toMatchObject({
        outcome: "human_review",
        route: "telegram_human_gate",
        requiresHumanReview: true
      });
      expect(result.finalAction).toMatchObject({
        kind: "telegram_notification",
        actionId: "orch-link-1:final-action",
        delivery: {
          status: "sent",
          messageId: 9001
        }
      });
      expect(sender.messages).toHaveLength(1);
      expect(sender.messages[0].text).toContain("https://example.com/ai-agent-workflow");
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "orch-link-1:final-action",
          action_type: "telegram_notification_sent",
          status: "succeeded",
          decision_id: "orch-link-1:policy-decision"
        }
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid).map((event) => event.event_type)).toContain("telegram_notification_delivered");
    } finally {
      db.close();
    }
  });

  it("stops formatted drafts at the draft gate before policy evaluation", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, snapshot } = seedRuntime(db);
      const sender = fakeOfflineSender();

      const result = await runOfflineOrchestration({
        repo,
        account,
        configSnapshot: snapshot,
        configSnapshotId: "snapshot-orch-zh-1",
        prompt: initialPrompt(account.account_key),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        draftOutput: {
          draft_id: "draft-orch-blocked-1",
          post_text: "结论：\n- AI 工作流需要记录判断\n- 再复盘结果",
          topic_tags: ["AI"],
          evidence_ids: ["material-ai-agent-x"]
        },
        policyContext: basePolicyContext(),
        notificationSender: sender,
        runIdPrefix: "orch-blocked-1",
        traceId: "trace-orch-blocked-1",
        now
      });

      expect(result.draftGate.status).toBe("blocked");
      expect(result.policyDecision).toBeUndefined();
      expect(result.finalAction).toEqual({
        kind: "draft_blocked",
        actionId: "orch-blocked-1:final-action"
      });
      expect(sender.messages).toHaveLength(0);
      expect(repo.listAiDecisionsForAccount(account.account_uuid)).toHaveLength(0);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "orch-blocked-1:final-action",
          action_type: "draft_gate_blocked",
          status: "skipped",
          ai_run_id: "orch-blocked-1:draft-run"
        }
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid).map((event) => event.event_type)).not.toContain("automation_policy_decided");
      expect(repo.listAuditEventsForAccount(account.account_uuid).map((event) => event.event_type)).toContain("draft_gate_blocked");
    } finally {
      db.close();
    }
  });

  it("rejects non-offline Telegram senders at runtime", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, snapshot } = seedRuntime(db);
      const sender = fakeOfflineSender();
      const unsafeSender = {
        ...sender,
        mode: "real"
      } as unknown as OfflineTelegramNotificationSender;

      await expect(
        runOfflineOrchestration({
          repo,
          account,
          configSnapshot: snapshot,
          configSnapshotId: "snapshot-orch-zh-1",
          prompt: initialPrompt(account.account_key),
          materials: sourceMaterials(account),
          recentPosts: recentPosts(account),
          draftOutput: {
            draft_id: "draft-orch-unsafe-sender-1",
            post_text: "AI 工作流的讨论可以看这份资料：https://example.com/ai-agent-workflow",
            urls: ["https://example.com/ai-agent-workflow"],
            topic_tags: ["AI", "agent_workflow"],
            evidence_ids: ["material-ai-agent-web"]
          },
          policyContext: basePolicyContext(),
          notificationSender: unsafeSender,
          runIdPrefix: "orch-unsafe-sender-1",
          traceId: "trace-orch-unsafe-sender-1",
          now
        })
      ).rejects.toMatchObject({
        provider: "local",
        stage: "offline_orchestration",
        code: "invalid_request"
      });
      expect(sender.messages).toHaveLength(0);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("records policy terminal noop for rejected candidates", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account, snapshot } = seedRuntime(db);
      const sender = fakeOfflineSender();

      const result = await runOfflineOrchestration({
        repo,
        account,
        configSnapshot: snapshot,
        configSnapshotId: "snapshot-orch-zh-1",
        prompt: initialPrompt(account.account_key),
        materials: sourceMaterials(account),
        recentPosts: recentPosts(account),
        draftOutput: {
          draft_id: "draft-orch-reject-1",
          post_text: "politics 话题不应该混进这个账号。",
          topic_tags: ["politics"],
          evidence_ids: ["material-ai-agent-x"]
        },
        policyContext: basePolicyContext(),
        notificationSender: sender,
        runIdPrefix: "orch-reject-1",
        traceId: "trace-orch-reject-1",
        now
      });

      expect(result.policyDecision).toMatchObject({
        outcome: "reject",
        route: "blocked"
      });
      expect(result.finalAction).toEqual({
        kind: "policy_terminal",
        actionId: "orch-reject-1:final-action",
        outcome: "reject"
      });
      expect(sender.messages).toHaveLength(0);
      expect(repo.listAiActionsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "orch-reject-1:final-action",
          action_type: "policy_terminal_noop",
          status: "skipped",
          decision_id: "orch-reject-1:policy-decision"
        }
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid).map((event) => event.event_type)).toContain("offline_policy_terminal");
    } finally {
      db.close();
    }
  });
});

function seedRuntime(db: DatabaseSync): {
  repo: RuntimeRepository;
  account: AccountConfig;
  snapshot: ReturnType<typeof createAccountConfigSnapshot>;
} {
  const repo = new RuntimeRepository(db);
  const registry = registryWithRealPostingEnabled("zh-tech");
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
  return {
    repo,
    account,
    snapshot: createAccountConfigSnapshot({
      registry,
      ref: { accountKey: "zh-tech" },
      capturedAt: now
    })
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
      capturedAt: "2026-06-23T08:45:00.000Z",
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
      capturedAt: "2026-06-23T08:40:00.000Z",
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
      capturedAt: "2026-06-23T08:35:00.000Z",
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
    lastPostedAt: "2026-06-22T20:00:00.000Z"
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
        messageId: 9000 + messages.length,
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
