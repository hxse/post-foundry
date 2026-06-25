import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "./fixtures/accounts";
import { parseAccountRegistryConfig, resolveAccountRef } from "../src/lib/accounts/registry";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T01:00:00.000Z";

describe("audit event ledger baseline", () => {
  it("records AI runs, decisions, evidence, actions, human reviews, and events by account_uuid", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh, en } = seedAccounts(db);

      repo.createJob({
        id: "job-zh-audit-1",
        accountUuid: zh.account_uuid,
        kind: "workflow-posting-decision",
        idempotencyKey: "posting-decision:2026-06-23T01",
        scheduledAt: now,
        now
      });
      repo.recordAiRun({
        id: "run-zh-1",
        accountUuid: zh.account_uuid,
        jobId: "job-zh-audit-1",
        traceId: "trace-zh-1",
        purpose: "posting_decision",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        finishedAt: "2026-06-23T01:00:10.000Z",
        input: { account_uuid: zh.account_uuid, candidates: ["candidate-with-link"] },
        output: { recommendation: "human_review" }
      });
      repo.recordAiDecision({
        id: "decision-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        decisionType: "post_or_hold",
        outcome: "human_review",
        confidence: 0.81,
        requiresHumanReview: true,
        rationale: {
          reason: "candidate contains a link, route to Telegram approval gate",
          evidence_ids: ["evidence-zh-1"]
        },
        createdAt: "2026-06-23T01:00:11.000Z"
      });
      repo.recordEvidenceRef({
        id: "evidence-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        decisionId: "decision-zh-1",
        sourceType: "public_x_search",
        provider: "twitterapi.io",
        sourceRef: "search:ai-infra:2026-06-23T01",
        capturedAt: "2026-06-23T01:00:12.000Z",
        metadata: { query: "ai infra", result_count: 5 }
      });
      repo.recordAiAction({
        id: "action-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        decisionId: "decision-zh-1",
        actionType: "telegram_approval_request",
        status: "succeeded",
        startedAt: "2026-06-23T01:00:13.000Z",
        finishedAt: "2026-06-23T01:00:14.000Z",
        input: { decision_id: "decision-zh-1" },
        output: { external_message_id: "tg-msg-1" }
      });
      repo.recordHumanReview({
        id: "review-zh-1",
        accountUuid: zh.account_uuid,
        decisionId: "decision-zh-1",
        actionId: "action-zh-1",
        channel: "telegram",
        externalMessageId: "tg-msg-1",
        reviewerActor: "operator",
        outcome: "approved",
        reviewedAt: "2026-06-23T01:01:00.000Z",
        payload: { approved_text_hash: "hash-only" }
      });
      repo.recordAuditEvent({
        id: "event-zh-1",
        accountUuid: zh.account_uuid,
        eventType: "ai_decision_recorded",
        subjectType: "ai_decision",
        subjectId: "decision-zh-1",
        actorType: "ai",
        actorId: "codex",
        traceId: "trace-zh-1",
        occurredAt: "2026-06-23T01:00:11.000Z",
        metadata: { outcome: "human_review" }
      });

      expect(repo.listAiRunsForAccount(zh.account_uuid)).toMatchObject([
        {
          id: "run-zh-1",
          account_uuid: zh.account_uuid,
          input_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      ]);
      expect(repo.listAiDecisionsForAccount(zh.account_uuid)).toHaveLength(1);
      expect(repo.listAiActionsForAccount(zh.account_uuid)).toHaveLength(1);
      expect(repo.listEvidenceRefsForAccount(zh.account_uuid)).toHaveLength(1);
      expect(repo.listHumanReviewsForAccount(zh.account_uuid)).toHaveLength(1);
      expect(repo.listAuditEventsForAccount(zh.account_uuid)).toHaveLength(1);

      expect(repo.listAiRunsForAccount(en.account_uuid)).toHaveLength(0);
      expect(repo.listAiDecisionsForAccount(en.account_uuid)).toHaveLength(0);
      expect(repo.listAuditEventsForAccount(en.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("rejects cross-account references in audit ledger records", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh, en } = seedAccounts(db);
      repo.recordAiRun({
        id: "run-zh-1",
        accountUuid: zh.account_uuid,
        traceId: "trace-zh-1",
        purpose: "research",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        input: { topic: "ai" }
      });

      expect(() =>
        repo.recordAiDecision({
          id: "decision-en-bad",
          accountUuid: en.account_uuid,
          aiRunId: "run-zh-1",
          decisionType: "post_or_hold",
          outcome: "auto_post",
          requiresHumanReview: false,
          rationale: {},
          createdAt: now
        })
      ).toThrow(/different account_uuid/);
    } finally {
      db.close();
    }
  });

  it("rejects unrelated same-account decisions and actions in one human review", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      repo.recordAiRun({
        id: "run-zh-1",
        accountUuid: zh.account_uuid,
        traceId: "trace-zh-1",
        purpose: "posting_decision",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        input: { candidate: "one" }
      });
      repo.recordAiRun({
        id: "run-zh-2",
        accountUuid: zh.account_uuid,
        traceId: "trace-zh-2",
        purpose: "research",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        input: { candidate: "two" }
      });
      repo.recordAiDecision({
        id: "decision-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        decisionType: "post_or_hold",
        outcome: "human_review",
        requiresHumanReview: true,
        rationale: {},
        createdAt: now
      });
      repo.recordAiAction({
        id: "action-zh-2",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-2",
        actionType: "telegram_approval_request",
        status: "succeeded",
        startedAt: now
      });

      expect(() =>
        repo.recordHumanReview({
          id: "review-bad-chain",
          accountUuid: zh.account_uuid,
          decisionId: "decision-zh-1",
          actionId: "action-zh-2",
          channel: "telegram",
          reviewerActor: "operator",
          outcome: "approved",
          reviewedAt: now
        })
      ).toThrow(/different aiRunId/);

      repo.recordAiAction({
        id: "action-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        actionType: "telegram_approval_request",
        status: "succeeded",
        startedAt: now
      });
      expect(() =>
        repo.recordHumanReview({
          id: "review-good-chain",
          accountUuid: zh.account_uuid,
          decisionId: "decision-zh-1",
          actionId: "action-zh-1",
          channel: "telegram",
          reviewerActor: "operator",
          outcome: "approved",
          reviewedAt: now
        })
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("validates audit timestamps, actors, confidence, and required causal links", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);

      expect(() =>
        repo.recordAuditEvent({
          id: "event-bad-actor",
          accountUuid: zh.account_uuid,
          eventType: "ai_run_started",
          subjectType: "ai_run",
          subjectId: "run-1",
          actorType: "ai",
          actorId: " ",
          traceId: "trace-1",
          occurredAt: now
        })
      ).toThrow(/actorId must be non-empty/);

      expect(() =>
        repo.recordAiRun({
          id: "run-bad-time",
          accountUuid: zh.account_uuid,
          traceId: "trace-1",
          purpose: "research",
          model: "gpt-5",
          status: "started",
          startedAt: "today",
          input: {}
        })
      ).toThrow(/startedAt must be an ISO datetime/);

      repo.recordAiRun({
        id: "run-zh-1",
        accountUuid: zh.account_uuid,
        traceId: "trace-1",
        purpose: "research",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        input: {}
      });
      expect(() =>
        repo.recordAiDecision({
          id: "decision-bad-confidence",
          accountUuid: zh.account_uuid,
          aiRunId: "run-zh-1",
          decisionType: "post_or_hold",
          outcome: "auto_post",
          confidence: 1.2,
          requiresHumanReview: false,
          rationale: {},
          createdAt: now
        })
      ).toThrow(/confidence must be between 0 and 1/);

      expect(() =>
        repo.recordAiAction({
          id: "action-missing-cause",
          accountUuid: zh.account_uuid,
          actionType: "draft_created",
          status: "succeeded",
          startedAt: now
        })
      ).toThrow(/must reference aiRunId or decisionId/);
    } finally {
      db.close();
    }
  });

  it("validates enum-like fields at runtime", () => {
    const db = openMigratedTestDb();
    try {
      const { repo, zh } = seedAccounts(db);
      repo.recordAiRun({
        id: "run-zh-1",
        accountUuid: zh.account_uuid,
        traceId: "trace-zh-1",
        purpose: "posting_decision",
        model: "gpt-5",
        status: "succeeded",
        startedAt: now,
        input: {}
      });
      repo.recordAiDecision({
        id: "decision-zh-1",
        accountUuid: zh.account_uuid,
        aiRunId: "run-zh-1",
        decisionType: "post_or_hold",
        outcome: "human_review",
        requiresHumanReview: true,
        rationale: {},
        createdAt: now
      });

      expect(() =>
        repo.createJob({
          id: "job-bad-status",
          accountUuid: zh.account_uuid,
          kind: "workflow-posting-decision",
          status: "pending" as never,
          idempotencyKey: "bad-status",
          scheduledAt: now,
          now
        })
      ).toThrow(/status is invalid/);

      expect(() =>
        repo.recordApiCallAudit({
          id: "api-audit-bad-status",
          accountUuid: zh.account_uuid,
          provider: "twitterapi.io",
          operation: "search",
          status: "ok" as never,
          startedAt: now
        })
      ).toThrow(/status is invalid/);

      expect(() =>
        repo.recordAuditEvent({
          id: "event-bad-actor-type",
          accountUuid: zh.account_uuid,
          eventType: "ai_run_started",
          subjectType: "ai_run",
          subjectId: "run-zh-1",
          actorType: "robot" as never,
          actorId: "codex",
          traceId: "trace-zh-1",
          occurredAt: now
        })
      ).toThrow(/actorType is invalid/);

      expect(() =>
        repo.recordAiDecision({
          id: "decision-bad-outcome",
          accountUuid: zh.account_uuid,
          aiRunId: "run-zh-1",
          decisionType: "post_or_hold",
          outcome: "publish" as never,
          requiresHumanReview: false,
          rationale: {},
          createdAt: now
        })
      ).toThrow(/outcome is invalid/);

      expect(() =>
        repo.recordAiAction({
          id: "action-bad-status",
          accountUuid: zh.account_uuid,
          aiRunId: "run-zh-1",
          actionType: "draft_created",
          status: "done" as never,
          startedAt: now
        })
      ).toThrow(/status is invalid/);

      expect(() =>
        repo.recordEvidenceRef({
          id: "evidence-bad-source-type",
          accountUuid: zh.account_uuid,
          aiRunId: "run-zh-1",
          sourceType: "rss" as never,
          sourceRef: "rss:item:1",
          capturedAt: now
        })
      ).toThrow(/sourceType is invalid/);

      expect(() =>
        repo.recordHumanReview({
          id: "review-bad-channel",
          accountUuid: zh.account_uuid,
          decisionId: "decision-zh-1",
          channel: "email" as never,
          reviewerActor: "operator",
          outcome: "approved",
          reviewedAt: now
        })
      ).toThrow(/channel is invalid/);

      expect(() =>
        repo.recordHumanReview({
          id: "review-bad-outcome",
          accountUuid: zh.account_uuid,
          decisionId: "decision-zh-1",
          channel: "telegram",
          reviewerActor: "operator",
          outcome: "maybe" as never,
          reviewedAt: now
        })
      ).toThrow(/outcome is invalid/);
    } finally {
      db.close();
    }
  });
});

function openMigratedTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}

function seedAccounts(db: DatabaseSync): {
  repo: RuntimeRepository;
  zh: { account_uuid: string };
  en: { account_uuid: string };
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
