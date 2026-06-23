import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import { parseAccountRegistryConfig, resolveAccountRef, type AccountConfig } from "../src/lib/accounts/registry";
import { evaluateAutomationPolicy, recordAutomationPolicyDecision } from "../src/lib/policy/automation";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T02:00:00.000Z";

describe("automation policy engine", () => {
  it("routes compliant no-link posts to automatic posting", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const decision = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-auto-1",
        text: "AI 工具真正的价值，是把重复劳动变成可以复用的判断。",
        topicTags: ["AI"]
      },
      context: baseContext()
    });

    expect(decision).toMatchObject({
      accountUuid: account.account_uuid,
      outcome: "auto_post",
      route: "x_official_auto",
      requiresHumanReview: false,
      canAutoPost: true,
      hasLink: false
    });
    expect(decision.reasons.map((reason) => reason.code)).toEqual(["policy_passed"]);
  });

  it("routes link posts to Telegram human gate", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const decision = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-link-1",
        text: "AI infra 的新变化值得看一下：https://example.com/report",
        topicTags: ["AI"]
      },
      context: baseContext()
    });

    expect(decision).toMatchObject({
      outcome: "human_review",
      route: "telegram_human_gate",
      requiresHumanReview: true,
      canAutoPost: false,
      hasLink: true
    });
    expect(decision.reasons.map((reason) => reason.code)).toContain("link_requires_human_review");
  });

  it("routes long no-link posts to Telegram human gate", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const decision = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-long-1",
        text: `AI ${"产品判断需要把资料、上下文、假设和复盘都连起来，".repeat(18)}`,
        topicTags: ["AI"],
        evidenceIds: ["evidence-long-1"]
      },
      context: baseContext()
    });

    expect(decision).toMatchObject({
      outcome: "human_review",
      route: "telegram_human_gate",
      requiresHumanReview: true,
      canAutoPost: false,
      hasLink: false
    });
    expect(decision.reasons.map((reason) => reason.code)).toContain("long_post_requires_human_review");
  });

  it("rejects content outside account boundaries or with debug/test traces", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const excludedTopic = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-reject-1",
        text: "politics 话题不应该混进这个账号。",
        topicTags: ["politics"]
      },
      context: baseContext()
    });
    const debugText = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-reject-2",
        text: "PostFoundry .005 smoke test",
        topicTags: ["AI"]
      },
      context: baseContext()
    });

    expect(excludedTopic.outcome).toBe("reject");
    expect(excludedTopic.reasons.map((reason) => reason.code)).toContain("excluded_topic");
    expect(debugText.outcome).toBe("reject");
    expect(debugText.reasons.map((reason) => reason.code)).toContain("banned_phrase");
  });

  it("does not match short ASCII topics inside unrelated words", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const decision = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-topic-boundary-1",
        text: "A daily writing routine keeps ideas moving.",
        topicTags: []
      },
      context: baseContext()
    });

    expect(decision.outcome).toBe("reject");
    expect(decision.reasons.map((reason) => reason.code)).toContain("missing_included_topic");
  });

  it("defers otherwise valid posts when operational guards block execution", () => {
    const account = withRealPostingEnabled(accountByKey("zh-tech"));
    const dailyMax = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-defer-1",
        text: "AI 的长期影响，往往先体现在工作流里。",
        topicTags: ["AI"]
      },
      context: {
        ...baseContext(),
        postedTodayCount: account.posting.daily_max
      }
    });
    const budget = evaluateAutomationPolicy({
      account,
      candidate: {
        id: "candidate-defer-2",
        text: "AI 预算也是产品判断的一部分。",
        topicTags: ["AI"]
      },
      context: {
        ...baseContext(),
        monthlyLlmSpendUsd: account.budget.llm_usd_monthly_cap,
        estimatedLlmSpendUsd: 0.01
      }
    });

    expect(dailyMax.outcome).toBe("defer");
    expect(dailyMax.reasons.map((reason) => reason.code)).toContain("daily_max_reached");
    expect(budget.outcome).toBe("defer");
    expect(budget.reasons.map((reason) => reason.code)).toContain("llm_budget_exceeded");
  });

  it("records policy decisions into the audit ledger by account_uuid", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh, en } = seedAccounts(db);
      const decision = evaluateAutomationPolicy({
        account: withRealPostingEnabled(zh),
        candidate: {
          id: "candidate-ledger-1",
          text: "AI infra 的新变化值得看一下：https://example.com/report",
          topicTags: ["AI"]
        },
        context: baseContext()
      });

      repo.recordAiRun({
        id: "run-policy-zh-1",
        accountUuid: zh.account_uuid,
        traceId: "trace-policy-zh-1",
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
        aiRunId: "run-policy-zh-1",
        decisionId: "decision-policy-zh-1",
        auditEventId: "event-policy-zh-1",
        traceId: "trace-policy-zh-1",
        createdAt: now
      });

      expect(repo.listAiDecisionsForAccount(zh.account_uuid)).toMatchObject([
        {
          id: "decision-policy-zh-1",
          outcome: "human_review",
          requires_human_review: 1
        }
      ]);
      expect(repo.listAuditEventsForAccount(zh.account_uuid)).toMatchObject([
        {
          id: "event-policy-zh-1",
          event_type: "automation_policy_decided"
        }
      ]);
      expect(repo.listAiDecisionsForAccount(en.account_uuid)).toHaveLength(0);
      expect(repo.listAuditEventsForAccount(en.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("rolls back policy ledger writes when audit event recording fails", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      const decision = evaluateAutomationPolicy({
        account: withRealPostingEnabled(zh),
        candidate: {
          id: "candidate-ledger-rollback",
          text: "AI 决策要能留下完整审计链。",
          topicTags: ["AI"]
        },
        context: baseContext()
      });

      repo.recordAiRun({
        id: "run-policy-rollback",
        accountUuid: zh.account_uuid,
        traceId: "trace-policy-rollback",
        purpose: "automation_policy",
        model: "policy-engine-v0",
        status: "succeeded",
        startedAt: now,
        input: {},
        output: {}
      });
      repo.recordAuditEvent({
        id: "event-policy-duplicate",
        accountUuid: zh.account_uuid,
        eventType: "preexisting_event",
        subjectType: "ai_run",
        subjectId: "run-policy-rollback",
        actorType: "system",
        actorId: "test",
        traceId: "trace-policy-rollback",
        occurredAt: now
      });

      expect(() =>
        recordAutomationPolicyDecision({
          repo,
          decision,
          aiRunId: "run-policy-rollback",
          decisionId: "decision-policy-rollback",
          auditEventId: "event-policy-duplicate",
          traceId: "trace-policy-rollback",
          createdAt: now
        })
      ).toThrow();

      expect(repo.listAiDecisionsForAccount(zh.account_uuid).map((row) => row.id)).not.toContain("decision-policy-rollback");
      expect(repo.listAuditEventsForAccount(zh.account_uuid).map((row) => row.id)).toEqual(["event-policy-duplicate"]);
    } finally {
      db.close();
    }
  });

  it("rejects recording a policy decision against another account's AI run", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh, en } = seedAccounts(db);
      const decision = evaluateAutomationPolicy({
        account: withRealPostingEnabled(zh),
        candidate: {
          id: "candidate-ledger-2",
          text: "AI 决策要能留下证据链。",
          topicTags: ["AI"]
        },
        context: baseContext()
      });

      repo.recordAiRun({
        id: "run-policy-en-1",
        accountUuid: en.account_uuid,
        traceId: "trace-policy-en-1",
        purpose: "automation_policy",
        model: "policy-engine-v0",
        status: "succeeded",
        startedAt: now,
        input: {},
        output: {}
      });

      expect(() =>
        recordAutomationPolicyDecision({
          repo,
          decision,
          aiRunId: "run-policy-en-1",
          decisionId: "decision-policy-bad",
          auditEventId: "event-policy-bad",
          traceId: "trace-policy-en-1",
          createdAt: now
        })
      ).toThrow(/different account_uuid/);
    } finally {
      db.close();
    }
  });
});

function baseContext() {
  return {
    evaluatedAt: now,
    postedTodayCount: 0,
    lastPostedAt: "2026-06-22T22:00:00.000Z",
    monthlyXDataSpendUsd: 1,
    monthlyLlmSpendUsd: 1,
    publicXRequestsThisMonth: 10,
    estimatedXDataSpendUsd: 0,
    estimatedLlmSpendUsd: 0.01,
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
