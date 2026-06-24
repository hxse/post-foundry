import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import { parseAccountRegistryConfig, resolveAccountRef, type AccountConfig } from "../src/lib/accounts/registry";
import { evaluateAutomationPolicy, recordAutomationPolicyDecision, type AutomationPolicyDecision } from "../src/lib/policy/automation";
import {
  deliverManualNotification,
  planManualNotification,
  type ManualNotificationCandidate,
  type TelegramNotificationSender
} from "../src/lib/notifications/manual-notification";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T03:00:00.000Z";

describe("manual notification workflow", () => {
  it("plans Telegram notifications only for human_review telegram gate decisions", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const humanReview = evaluateAutomationPolicy({
      account,
      candidate: linkCandidate(),
      context: baseContext()
    });
    const autoPost = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-auto",
        text: "AI 工具的价值在于把判断流程沉淀下来。",
        urls: [],
        topicTags: ["AI"],
        evidenceIds: ["evidence-auto"]
      },
      context: baseContext()
    });

    const plan = planManualNotification({
      decision: humanReview,
      candidate: linkCandidate()
    });

    expect(plan).toMatchObject({
      shouldNotify: true,
      reason: "manual_review_required"
    });
    expect(plan.shouldNotify ? plan.text : "").toContain("人工处理通知");
    expect(plan.shouldNotify ? plan.text : "").toContain("账号: zh-tech");
    expect(plan.shouldNotify ? plan.text : "").toContain("link_requires_human_review");
    expect(plan.shouldNotify ? plan.text : "").toContain("这条不会自动发布");
    expect(
      planManualNotification({
        decision: autoPost,
        candidate: {
          id: "candidate-auto",
          text: "AI 工具的价值在于把判断流程沉淀下来。",
          urls: [],
          evidenceIds: ["evidence-auto"]
        }
      })
    ).toEqual({
      shouldNotify: false,
      reason: "policy_not_notifiable"
    });
  });

  it("sends human_review notifications and writes action plus audit event", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh, en } = seedAccounts(db);
      const decision = await recordPolicyDecision(repo, zh, "run-notify-1", "decision-notify-1", "event-policy-1");
      const sender = fakeSender();

      await expect(
        deliverManualNotification({
          repo,
          sender,
          decision,
          candidate: linkCandidate(),
          policyDecisionId: "decision-notify-1",
          actionId: "action-notify-1",
          auditEventId: "event-notify-1",
          traceId: "trace-notify-1",
          now
        })
      ).resolves.toEqual({
        status: "sent",
        messageId: 501
      });

      expect(sender.messages).toHaveLength(1);
      expect(sender.messages[0].text).toContain("https://example.com/report");
      expect(repo.listAiActionsForAccount(zh.account_uuid)).toMatchObject([
        {
          id: "action-notify-1",
          decision_id: "decision-notify-1",
          action_type: "telegram_notification_sent",
          status: "succeeded"
        }
      ]);
      expect(repo.listAuditEventsForAccount(zh.account_uuid).map((event) => event.event_type)).toContain("telegram_notification_delivered");
      expect(repo.listAiActionsForAccount(en.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("does not send or write notification actions for auto_post, reject, or defer decisions", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      const account = withRealPostingEnabled(zh);
      const decisions = [
        evaluateAutomationPolicy({
          account,
          candidate: {
            id: "candidate-auto",
            text: "AI 工具的价值在于把判断流程沉淀下来。",
            urls: [],
            topicTags: ["AI"],
            evidenceIds: []
          },
          context: baseContext()
        }),
        evaluateAutomationPolicy({
          account,
          candidate: {
            id: "candidate-reject",
            text: "politics 话题不该混入这个账号。",
            urls: [],
            topicTags: ["politics"],
            evidenceIds: []
          },
          context: baseContext()
        }),
        evaluateAutomationPolicy({
          account,
          candidate: {
            id: "candidate-defer",
            text: "AI 判断也需要避开冷却窗口。",
            urls: [],
            topicTags: ["AI"],
            evidenceIds: []
          },
          context: {
            ...baseContext(),
            postedTodayCount: account.posting.daily_max
          }
        })
      ];
      const sender = fakeSender();

      for (const [index, decision] of decisions.entries()) {
        await expect(
          deliverManualNotification({
            repo,
            sender,
            decision,
            candidate: {
              id: decision.candidateId,
              text: "placeholder",
              urls: [],
              evidenceIds: []
            },
            policyDecisionId: `decision-skip-${index}`,
            actionId: `action-skip-${index}`,
            auditEventId: `event-skip-${index}`,
            traceId: `trace-skip-${index}`,
            now
          })
        ).resolves.toEqual({
          status: "skipped",
          reason: "policy_not_notifiable"
        });
      }

      expect(sender.messages).toHaveLength(0);
      expect(repo.listAiActionsForAccount(zh.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("does not send duplicate notifications for the same policy decision", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      const decision = await recordPolicyDecision(repo, zh, "run-dup-1", "decision-dup-1", "event-policy-dup-1");
      const sender = fakeSender();

      await deliverManualNotification({
        repo,
        sender,
        decision,
        candidate: linkCandidate(),
        policyDecisionId: "decision-dup-1",
        actionId: "action-dup-1",
        auditEventId: "event-dup-1",
        traceId: "trace-dup-1",
        now
      });
      await expect(
        deliverManualNotification({
          repo,
          sender,
          decision,
          candidate: linkCandidate(),
          policyDecisionId: "decision-dup-1",
          actionId: "action-dup-2",
          auditEventId: "event-dup-2",
          traceId: "trace-dup-1",
          now
        })
      ).resolves.toEqual({
        status: "skipped",
        reason: "already_notified"
      });

      expect(sender.messages).toHaveLength(1);
      expect(repo.listAiActionsForAccount(zh.account_uuid).filter((action) => action.action_type === "telegram_notification_sent")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("records failed notification actions without throwing", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      const decision = await recordPolicyDecision(repo, zh, "run-fail-1", "decision-fail-1", "event-policy-fail-1");
      const sender: TelegramNotificationSender = {
        sendMessage: async () => {
          throw new Error("telegram unavailable");
        }
      };

      await expect(
        deliverManualNotification({
          repo,
          sender,
          decision,
          candidate: linkCandidate(),
          policyDecisionId: "decision-fail-1",
          actionId: "action-fail-1",
          auditEventId: "event-fail-1",
          traceId: "trace-fail-1",
          now
        })
      ).resolves.toEqual({
        status: "failed",
        error: "telegram unavailable"
      });

      expect(repo.listAiActionsForAccount(zh.account_uuid)).toMatchObject([
        {
          id: "action-fail-1",
          action_type: "telegram_notification_failed",
          status: "failed",
          error: "telegram unavailable"
        }
      ]);
      expect(repo.listAuditEventsForAccount(zh.account_uuid).map((event) => event.event_type)).toContain("telegram_notification_failed");
    } finally {
      db.close();
    }
  });
});

async function recordPolicyDecision(
  repo: RuntimeRepository,
  account: AccountConfig,
  aiRunId: string,
  decisionId: string,
  auditEventId: string
): Promise<AutomationPolicyDecision> {
  const decision = evaluateAutomationPolicy({
    account: withRealPostingEnabled(account),
    candidate: linkCandidate(),
    context: baseContext()
  });
  repo.recordAiRun({
    id: aiRunId,
    accountUuid: account.account_uuid,
    traceId: `trace-${aiRunId}`,
    purpose: "automation_policy",
    model: "policy-engine-v0",
    status: "succeeded",
    startedAt: now,
    input: { candidate_id: decision.candidateId },
    output: { outcome: decision.outcome }
  });
  recordAutomationPolicyDecision({
    repo,
    decision,
    aiRunId,
    decisionId,
    auditEventId,
    traceId: `trace-${aiRunId}`,
    createdAt: now
  });
  return decision;
}

function linkCandidate(): ManualNotificationCandidate & { topicTags: string[] } {
  return {
    id: "candidate-link-1",
    text: "AI infra 的新变化值得看一下：https://example.com/report",
    urls: ["https://example.com/report"],
    topicTags: ["AI"],
    evidenceIds: ["evidence-link-1"]
  };
}

function baseContext() {
  return {
    evaluatedAt: now,
    postedTodayCount: 0,
    lastPostedAt: "2026-06-22T22:00:00.000Z",
    publicXRequestsThisMonth: 10,
    estimatedPublicXRequests: 0
  };
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

function openMigratedTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}

function seedAccounts(db: DatabaseSync): {
  repo: RuntimeRepository;
  zh: AccountConfig;
  en: AccountConfig;
} {
  const repo = new RuntimeRepository(db);
  const registry = parseAccountRegistryConfig(accountsExample);
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }

  return {
    repo,
    zh: resolveAccountRef(registry, { accountKey: "zh-tech" }).account,
    en: resolveAccountRef(registry, { accountKey: "en-tech" }).account
  };
}

function fakeSender(): TelegramNotificationSender & { messages: Array<{ text: string }> } {
  const messages: Array<{ text: string }> = [];
  return {
    messages,
    sendMessage: async (input) => {
      messages.push({ text: input.text });
      return {
        messageId: 501,
        chatId: "@example_channel"
      };
    }
  };
}
