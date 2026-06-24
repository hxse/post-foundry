import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runOnlineOperationLoop, runOnlineOperationOnce } from "../src/lib/orchestration/online-runner";
import { parseDebugRunOnceOfflineFixtureArgs } from "../src/lib/orchestration/offline-fixture-debug-args";
import {
  createFixtureRunOnceOperationExecutor,
  fixtureRunOncePromptText
} from "../src/lib/orchestration/run-once-operation-executor";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T03:00:00.000Z";
const zhAccountUuid = "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001";

describe("run-once operation executor baseline", () => {
  it("parses offline fixture debug args without touching a database", () => {
    expect(
      parseDebugRunOnceOfflineFixtureArgs([
        "--account",
        "zh-tech",
        "--db-file",
        "/tmp/post-foundry-fixture.sqlite",
        "--mode",
        "human_review_link",
        "--trace-id",
        "trace-cli-args-1",
        "--now",
        now
      ])
    ).toEqual({
      account: "zh-tech",
      dbFile: "/tmp/post-foundry-fixture.sqlite",
      mode: "human_review_link",
      traceId: "trace-cli-args-1",
      now
    });
  });

  it("rejects unsafe offline fixture debug args before any DB open", () => {
    expect(() => parseDebugRunOnceOfflineFixtureArgs(["--account", "zh-tech"])).toThrow(
      "--db-file is required for offline fixture debug runs"
    );
    expect(() =>
      parseDebugRunOnceOfflineFixtureArgs(["--account", "zh-tech", "--db-file", "/tmp/fixture.sqlite", "--mode", "bad_mode"])
    ).toThrow("--mode must be one of");
  });

  it("runs the full offline operation through the once runner and writes one trace", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-executor-once-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createFixtureRunOnceOperationExecutor({
          repo,
          accountKey: "zh-tech"
        })
      });

      expect(result).toMatchObject({
        accountKey: "zh-tech",
        traceId: "trace-executor-once-1",
        outcome: "completed",
        finalAction: "auto_post_planned",
        summary: {
          executor: "fixture_run_once_operation_v1",
          offline_only: true,
          draft_gate_status: "ready",
          policy_outcome: "auto_post",
          policy_route: "x_official_auto",
          notification_count: 0,
          ledger_trace_id: "trace-executor-once-1"
        }
      });

      const runs = repo.listAiRunsForAccount(zhAccountUuid);
      expect(runs.map((run) => run.purpose)).toEqual(
        expect.arrayContaining(["topic_radar_selection", "source_context_ingestion", "ai_posting_draft", "automation_policy"])
      );
      expect(JSON.stringify(runs)).not.toContain(fixtureRunOncePromptText);
      expect(JSON.stringify(runs)).toContain(sha256(fixtureRunOncePromptText));

      expect(repo.listAiDecisionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-once-1:policy-decision",
          outcome: "auto_post",
          requires_human_review: 0
        }
      ]);
      expect(repo.listAiActionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-once-1:final-action",
          action_type: "x_official_auto_post_planned",
          status: "skipped",
          decision_id: "trace-executor-once-1:policy-decision"
        }
      ]);
      expect(repo.listAuditEventsForAccount(zhAccountUuid).map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          "topic_selected",
          "source_context_built",
          "ai_draft_created",
          "automation_policy_decided",
          "offline_auto_post_planned"
        ])
      );
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes link drafts to fake Telegram without online delivery", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-executor-link-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createFixtureRunOnceOperationExecutor({
          repo,
          accountKey: "zh-tech",
          mode: "human_review_link"
        })
      });

      expect(result).toMatchObject({
        outcome: "completed",
        finalAction: "telegram_notification",
        summary: {
          offline_only: true,
          policy_outcome: "human_review",
          policy_route: "telegram_human_gate",
          notification_count: 1
        }
      });
      expect(repo.listAiActionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-link-1:final-action",
          action_type: "telegram_notification_sent",
          status: "succeeded",
          decision_id: "trace-executor-link-1:policy-decision"
        }
      ]);
      expect(JSON.stringify(repo.listAiActionsForAccount(zhAccountUuid))).toContain("offline-channel");
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can finish with draft gate blocked before policy evaluation", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-executor-blocked-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createFixtureRunOnceOperationExecutor({
          repo,
          accountKey: "zh-tech",
          mode: "draft_blocked"
        })
      });

      expect(result).toMatchObject({
        outcome: "completed",
        finalAction: "draft_blocked",
        summary: {
          draft_gate_status: "blocked",
          policy_outcome: "not_evaluated",
          notification_count: 0
        }
      });
      expect(repo.listAiDecisionsForAccount(zhAccountUuid)).toHaveLength(0);
      expect(repo.listAiActionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-blocked-1:final-action",
          action_type: "draft_gate_blocked",
          status: "skipped",
          ai_run_id: "trace-executor-blocked-1:draft-run"
        }
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records policy terminal noop for reject fixture mode", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-executor-reject-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createFixtureRunOnceOperationExecutor({
          repo,
          accountKey: "zh-tech",
          mode: "reject"
        })
      });

      expect(result).toMatchObject({
        outcome: "completed",
        finalAction: "policy_terminal",
        summary: {
          draft_gate_status: "ready",
          policy_outcome: "reject",
          policy_route: "blocked",
          notification_count: 0
        }
      });
      expect(repo.listAiDecisionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-reject-1:policy-decision",
          outcome: "reject",
          requires_human_review: 0
        }
      ]);
      expect(repo.listAiActionsForAccount(zhAccountUuid)).toMatchObject([
        {
          id: "trace-executor-reject-1:final-action",
          action_type: "policy_terminal_noop",
          status: "skipped",
          decision_id: "trace-executor-reject-1:policy-decision"
        }
      ]);
      expect(repo.listAuditEventsForAccount(zhAccountUuid).map((event) => event.event_type)).toContain("offline_policy_terminal");
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects executor account mismatches before writing fixture ledger", async () => {
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const executor = createFixtureRunOnceOperationExecutor({
        repo,
        accountKey: "zh-tech"
      });

      await expect(
        executor({
          accountKey: "en-tech",
          traceId: "trace-executor-mismatch-1",
          entrypoint: "prod-online-run-once",
          startedAt: now
        })
      ).rejects.toMatchObject({
        provider: "local",
        stage: "run_once_operation_executor",
        code: "invalid_request"
      });
      expect(repo.listAiRunsForAccount(zhAccountUuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("lets the loop reuse the same once executor without trace collisions", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const sleeps: number[] = [];
      const result = await runOnlineOperationLoop({
        accountKey: "zh-tech",
        lockDir: dir,
        now: fixedNow(now),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0.5,
        intervalSeconds: 300,
        jitterSeconds: 0,
        maxIterations: 2,
        enableHeartbeat: false,
        operation: createFixtureRunOnceOperationExecutor({
          repo,
          accountKey: "zh-tech"
        })
      });

      expect(result.iterations).toBe(2);
      expect(result.results.every((run) => run.entrypoint === "prod-online-run-loop")).toBe(true);
      expect(result.results.every((run) => run.finalAction === "auto_post_planned")).toBe(true);
      expect(sleeps).toEqual([300_000]);

      const actions = repo.listAiActionsForAccount(zhAccountUuid);
      expect(actions).toHaveLength(2);
      expect(actions.map((action) => action.id)).toEqual(
        expect.arrayContaining(result.results.map((run) => `${run.traceId}:final-action`))
      );
      expect(new Set(result.results.map((run) => run.traceId)).size).toBe(2);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

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
  return mkdtemp(join(tmpdir(), "post-foundry-run-once-executor-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
