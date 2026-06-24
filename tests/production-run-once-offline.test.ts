import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import { parseAccountRegistryConfig, resolveAccountRef } from "../src/lib/accounts/registry";
import { parseProductionOnlineRunLoopArgs, parseProductionOnlineRunOnceArgs } from "../src/lib/orchestration/production-runner-args";
import { createProductionSourceCollectionExecutor } from "../src/lib/orchestration/production-source-collection-executor";
import { runOnlineOperationOnce } from "../src/lib/orchestration/online-runner";
import type { PublicXDataProvider, PublicXSearchInput } from "../src/lib/providers/public-x";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T04:00:00.000Z";
const zhAccountUuid = "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001";
const promptText = "OFFLINE TEST PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

describe("production run-once source context and topic integration", () => {
  it("parses production online args with real-config guardrails", () => {
    expect(
      parseProductionOnlineRunOnceArgs([
        "--account",
        "zh-tech",
        "--config-file",
        "config/accounts.local.json",
        "--secrets-file",
        "secrets/accounts.local.json",
        "--db-file",
        "/tmp/post-foundry.sqlite",
        "--source-max-queries",
        "2",
        "--source-per-query-limit",
        "3"
      ])
    ).toMatchObject({
      account: "zh-tech",
      configFile: "config/accounts.local.json",
      secretsFile: "secrets/accounts.local.json",
      dbFile: "/tmp/post-foundry.sqlite",
      sourceMaxQueries: 2,
      sourcePerQueryLimit: 3
    });

    expect(() => parseProductionOnlineRunOnceArgs(["--account", "zh-tech"])).toThrow(
      "--config-file is required for production online runs"
    );
    expect(() =>
      parseProductionOnlineRunOnceArgs(["--account", "zh-tech", "--config-file", resolve("config/accounts.example.json")])
    ).toThrow("--config-file must not be config/accounts.example.json");
    expect(() =>
      parseProductionOnlineRunOnceArgs(["--account", "zh-tech", "--config-file", "config/accounts.local.json", "--source-max-queries", "11"])
    ).toThrow("--source-max-queries must be an integer <= 10");
    expect(() =>
      parseProductionOnlineRunLoopArgs(["--account", "zh-tech", "--config-file", "config/accounts.local.json", "--interval-seconds", "299"])
    ).toThrow("--interval-seconds must be an integer >= 300");
  });

  it("runs source collection, topic radar, and source context through the production once runner", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      const provider = fakePublicXProvider();
      let promptLoads = 0;

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-production-source-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionSourceCollectionExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          provider,
          loadPrompt: () => {
            promptLoads += 1;
            return testPrompt();
          },
          maxQueries: 2,
          perQueryLimit: 2
        })
      });

      expect(result).toMatchObject({
        accountKey: "zh-tech",
        traceId: "trace-production-source-1",
        entrypoint: "prod-online-run-once",
        outcome: "completed",
        finalAction: "topic_selected",
        summary: {
          executor: "production_run_once_source_context_topic_v1",
          online: true,
          provider: "twitterapi.io",
          source_collection_status: "succeeded",
          query_count: 2,
          request_units: 2,
          material_count: 3,
          duplicate_material_count: 1,
          source_context_material_count: 3,
          recent_post_count: 0
        }
      });
      expect(promptLoads).toBe(1);
      expect(provider.calls).toEqual([
        { query: "AI", limit: 2 },
        { query: "open_source", limit: 2 }
      ]);

      const runs = repo.listAiRunsForAccount(zhAccountUuid);
      expect(runs).toHaveLength(3);
      expect(runs.map((run) => run.purpose)).toEqual(
        expect.arrayContaining(["public_x_source_collection", "topic_radar_selection", "source_context_ingestion"])
      );
      expect(JSON.stringify(runs)).not.toContain(promptText);
      expect(JSON.stringify(runs)).toContain(sha256(promptText));
      expect(repo.listAiDecisionsForAccount(zhAccountUuid)).toHaveLength(0);
      expect(repo.listAiActionsForAccount(zhAccountUuid)).toHaveLength(0);
      expect(repo.listEvidenceRefsForAccount(zhAccountUuid)).toHaveLength(9);
      expect(repo.listAuditEventsForAccount(zhAccountUuid).map((event) => event.event_type)).toEqual(
        expect.arrayContaining(["public_x_source_collection_collected", "topic_selected", "source_context_built"])
      );
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses existing API audit usage to skip collection before provider calls", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      repo.upsertAccount(account, now);
      repo.recordApiCallAudit({
        id: "existing-monthly-usage",
        accountUuid: account.account_uuid,
        provider: "twitterapi.io",
        operation: "public_x_search",
        status: "succeeded",
        requestUnits: account.data_sources.public_x.monthly_request_cap,
        startedAt: now
      });
      const provider = fakePublicXProvider();
      let promptLoads = 0;

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-production-source-cap-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionSourceCollectionExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          provider,
          loadPrompt: () => {
            promptLoads += 1;
            return testPrompt();
          }
        })
      });

      expect(promptLoads).toBe(0);
      expect(provider.calls).toHaveLength(0);
      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "source_collection_skipped",
        summary: {
          source_collection_status: "skipped",
          skipped_reason: "public_x_request_cap_reached",
          request_units: 0,
          material_count: 0
        }
      });
      expect(repo.listAiRunsForAccount(zhAccountUuid)).toMatchObject([{ status: "skipped" }]);
      expect(repo.listApiCallAuditForAccount(zhAccountUuid)).toHaveLength(1);
      expect(repo.listAuditEventsForAccount(zhAccountUuid).map((event) => event.event_type)).toEqual([
        "public_x_source_collection_skipped"
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips topic and source context when collection returns no materials", async () => {
    const dir = await tempDir();
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      const provider = emptyPublicXProvider();
      let promptLoads = 0;

      const result = await runOnlineOperationOnce({
        accountKey: "zh-tech",
        lockDir: dir,
        traceId: "trace-production-source-empty-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionSourceCollectionExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          provider,
          loadPrompt: () => {
            promptLoads += 1;
            return testPrompt();
          },
          maxQueries: 1,
          perQueryLimit: 2
        })
      });

      expect(promptLoads).toBe(0);
      expect(provider.calls).toEqual([{ query: "AI", limit: 2 }]);
      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "source_collection_empty",
        summary: {
          source_collection_status: "succeeded",
          skipped_reason: "no_source_materials",
          request_units: 1,
          material_count: 0
        }
      });
      expect(repo.listAiRunsForAccount(zhAccountUuid).map((run) => run.purpose)).toEqual(["public_x_source_collection"]);
      expect(repo.listAuditEventsForAccount(zhAccountUuid).map((event) => event.event_type)).toEqual([
        "public_x_source_collection_collected"
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects account mismatches before source collection side effects", async () => {
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      const provider = fakePublicXProvider();
      const executor = createProductionSourceCollectionExecutor({
        repo,
        registry,
        accountKey: "zh-tech",
        provider,
        loadPrompt: () => testPrompt()
      });

      await expect(
        executor({
          accountKey: "en-tech",
          traceId: "trace-production-source-mismatch-1",
          entrypoint: "prod-online-run-once",
          startedAt: now
        })
      ).rejects.toMatchObject({
        provider: "local",
        stage: "production_source_collection_executor",
        code: "invalid_request"
      });
      expect(provider.calls).toHaveLength(0);
      expect(repo.listAiRunsForAccount(zhAccountUuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

function fakePublicXProvider(): PublicXDataProvider & { calls: PublicXSearchInput[] } {
  const calls: PublicXSearchInput[] = [];
  return {
    calls,
    searchPosts: async (input) => {
      calls.push(input);
      const postsByQuery: Record<string, Array<{ id: string; text: string; authorHandle: string; likeCount: number }>> = {
        AI: [
          {
            id: "tweet-shared",
            text: "Shared source text about durable AI workflow memory.",
            authorHandle: "shared_author",
            likeCount: 100
          },
          {
            id: "tweet-ai-only",
            text: "AI operators are turning judgment into reusable workflow.",
            authorHandle: "ai_author",
            likeCount: 80
          }
        ],
        open_source: [
          {
            id: "tweet-shared",
            text: "Shared source text about durable AI workflow memory.",
            authorHandle: "shared_author",
            likeCount: 100
          },
          {
            id: "tweet-open-only",
            text: "Open source tools make local automation easier to audit.",
            authorHandle: "open_author",
            likeCount: 70
          }
        ]
      };
      return {
        sourceProvider: "twitterapi.io",
        rawCount: postsByQuery[input.query]?.length ?? 0,
        posts: (postsByQuery[input.query] ?? []).slice(0, input.limit).map((post) => ({
          ...post,
          authorId: `${post.authorHandle}-id`,
          createdAt: "2026-06-24T03:50:00.000Z",
          repostCount: 10,
          replyCount: 2,
          quoteCount: 1,
          bookmarkCount: 5,
          viewCount: 1000,
          url: `https://x.com/${post.authorHandle}/status/${post.id}`
        }))
      };
    },
    getPostById: async () => undefined
  };
}

function emptyPublicXProvider(): PublicXDataProvider & { calls: PublicXSearchInput[] } {
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

function testPrompt(): {
  accountKey: string;
  source: "inline";
  prompt: string;
  promptSha256: string;
} {
  return {
    accountKey: "zh-tech",
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
  return mkdtemp(join(tmpdir(), "post-foundry-production-run-once-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
