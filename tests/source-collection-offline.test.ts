import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "./fixtures/accounts";
import { parseAccountRegistryConfig, resolveAccountRef, type AccountConfig } from "../src/lib/accounts/registry";
import { ApiError } from "../src/lib/api/errors";
import { parseDebugOnlineSourceCollectionArgs } from "../src/lib/context/source-collection-debug-args";
import { derivePublicXSearchQueriesFromPrompt } from "../src/lib/context/source-queries";
import { collectAccountPublicXSourceBatch } from "../src/lib/context/source-collection";
import type { PublicXDataProvider, PublicXSearchInput } from "../src/lib/providers/public-x";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T04:00:00.000Z";

describe("production source collection v0", () => {
  it("derives public X source queries only from explicit topic direction lines", () => {
    const queries = derivePublicXSearchQueriesFromPrompt(
      [
        "账号方向：前沿科技、AI 进展、BTC、美股 AI 相关股票。",
        "语气要求：学习参考账号的“情绪氛围”，不要冷冰冰，也不要写 PostFoundry debug test。",
        "不要使用‘时间表看着远……并不宽裕’这种报告模板。",
        "X 数据只能通过 TwitterAPI.io API 获取。"
      ].join("\n"),
      { maxQueries: 30 }
    );

    expect(queries).toEqual(["前沿科技", "AI 进展", "BTC", "美股 AI 相关股票"]);
    expect(queries).not.toEqual(expect.arrayContaining(["情绪氛围", "PostFoundry", "debug", "test", "TwitterAPI.io", "API"]));
  });

  it("parses online source collection debug args with explicit collect guardrails", () => {
    expect(
      parseDebugOnlineSourceCollectionArgs([
        "--account",
        "zh-tech",
        "--secrets-file",
        "secrets/accounts.local.json",
        "--collect",
        "--max-requests",
        "2",
        "--per-query-limit",
        "3"
      ])
    ).toMatchObject({
      account: "zh-tech",
      collect: true,
      secretsFile: "secrets/accounts.local.json",
      maxRequests: 2,
      perQueryLimit: 3
    });
    expect(parseDebugOnlineSourceCollectionArgs(["--account", "zh-tech"])).toMatchObject({
      collect: false,
      secretsFile: undefined
    });
  });

  it("rejects unsafe online source collection debug args before side effects", () => {
    expect(() => parseDebugOnlineSourceCollectionArgs(["--account", "zh-tech", "--config-file", "config/accounts.local.json"]))
      .toThrow("Unknown argument: --config-file");
    expect(() => parseDebugOnlineSourceCollectionArgs(["--account", "zh-tech", "--max-requests", "31"]))
      .toThrow("--max-requests must be an integer <= 30");
    expect(() => parseDebugOnlineSourceCollectionArgs(["--account", "zh-tech", "--per-query-limit", "11"]))
      .toThrow("--per-query-limit must be an integer <= 10");
  });

  it("collects account-scoped public X materials and writes compact ledger", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const provider = fakePublicXProvider();

      const result = await collectAccountPublicXSourceBatch({
        repo,
        account,
        provider,
        traceId: "trace-source-collection-1",
        runId: "source-collection-run-1",
        auditEventId: "source-collection-event-1",
        configSnapshotId: "snapshot-source-collection-1",
        collectedAt: now,
        sourceQueries: ["AI", "open_source", "frontier_tech"],
        maxQueries: 2,
        perQueryLimit: 2
      });

      expect(provider.calls).toEqual([
        { query: "AI", limit: 2 },
        { query: "open_source", limit: 2 }
      ]);
      expect(result).toMatchObject({
        kind: "public_x_source_collection_v1",
        accountUuid: account.account_uuid,
        accountKey: "zh-tech",
        provider: "twitterapi.io",
        status: "succeeded",
        queries: ["AI", "open_source"],
        apiAuditIds: ["source-collection-run-1:api:1", "source-collection-run-1:api:2"],
        requestUnits: 2,
        rawCount: 4,
        duplicateMaterialCount: 1
      });
      expect(result.materials.map((material) => material.id)).toEqual([
        "public-x:tweet-shared",
        "public-x:tweet-ai-only",
        "public-x:tweet-open-only"
      ]);

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-run-1:api:1",
          provider: "twitterapi.io",
          operation: "public_x_search",
          status: "succeeded",
          request_units: 1
        },
        {
          id: "source-collection-run-1:api:2",
          provider: "twitterapi.io",
          operation: "public_x_search",
          status: "succeeded",
          request_units: 1
        }
      ]);

      const runs = repo.listAiRunsForAccount(account.account_uuid);
      expect(runs).toMatchObject([
        {
          id: "source-collection-run-1",
          purpose: "public_x_source_collection",
          model: "source-collection-v0",
          status: "succeeded",
          trace_id: "trace-source-collection-1"
        }
      ]);
      const runOutput = JSON.parse(runs[0].output_json ?? "{}");
      expect(runOutput).toMatchObject({
        status: "succeeded",
        request_units: 2,
        material_count: 3,
        duplicate_material_count: 1,
        material_ids: ["public-x:tweet-shared", "public-x:tweet-ai-only", "public-x:tweet-open-only"]
      });
      expect(JSON.stringify(runOutput)).not.toContain("Shared source text");
      expect(Object.keys(runOutput.material_text_sha256)).toEqual([
        "public-x:tweet-shared",
        "public-x:tweet-ai-only",
        "public-x:tweet-open-only"
      ]);

      expect(repo.listEvidenceRefsForAccount(account.account_uuid).map((ref) => ref.id)).toEqual([
        "source-collection-run-1:public-x:tweet-ai-only",
        "source-collection-run-1:public-x:tweet-open-only",
        "source-collection-run-1:public-x:tweet-shared"
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-event-1",
          event_type: "public_x_source_collection_collected",
          subject_type: "ai_run",
          subject_id: "source-collection-run-1",
          trace_id: "trace-source-collection-1"
        }
      ]);
      expect(repo.listAiRunsForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("limits collection requests per run from account profile", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      account.data_sources.public_x.max_requests_per_run = 1;
      const provider = fakePublicXProvider();

      const result = await collectAccountPublicXSourceBatch({
        repo,
        account,
        provider,
        traceId: "trace-source-collection-cap-1",
        runId: "source-collection-cap-run-1",
        auditEventId: "source-collection-cap-event-1",
        collectedAt: now,
        sourceQueries: ["AI", "open_source"],
        maxQueries: 2,
        perQueryLimit: 1
      });

      expect(provider.calls).toEqual([{ query: "AI", limit: 1 }]);
      expect(result).toMatchObject({
        status: "succeeded",
        queries: ["AI"],
        requestUnits: 1
      });
    } finally {
      db.close();
    }
  });

  it("skips collection without provider calls when no source queries are available", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const provider = fakePublicXProvider();

      const result = await collectAccountPublicXSourceBatch({
        repo,
        account,
        provider,
        traceId: "trace-source-collection-no-query-1",
        runId: "source-collection-no-query-run-1",
        auditEventId: "source-collection-no-query-event-1",
        collectedAt: now,
        sourceQueries: []
      });

      expect(provider.calls).toHaveLength(0);
      expect(result).toMatchObject({
        status: "skipped",
        skippedReason: "no_source_queries",
        requestUnits: 0,
        materials: []
      });
      expect(repo.listEvidenceRefsForAccount(account.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("records failed provider attempts while preserving the original provider error", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const providerError = new ApiError({
        code: "rate_limited",
        provider: "twitterapi.io",
        stage: "search_response",
        message: "rate limited"
      });
      const provider: PublicXDataProvider = {
        searchPosts: async () => {
          throw providerError;
        },
        getPostById: async () => undefined
      };

      await expect(
        collectAccountPublicXSourceBatch({
          repo,
          account,
          provider,
          traceId: "trace-source-collection-failed-1",
          runId: "source-collection-failed-run-1",
          auditEventId: "source-collection-failed-event-1",
          collectedAt: now,
          sourceQueries: ["AI"],
          maxQueries: 1,
          perQueryLimit: 1
        })
      ).rejects.toMatchObject({
        code: "rate_limited",
        provider: "twitterapi.io",
        stage: "search_response"
      });

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-failed-run-1:api:1",
          provider: "twitterapi.io",
          operation: "public_x_search",
          status: "failed"
        }
      ]);
      expect(repo.listAiRunsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-failed-run-1",
          status: "failed",
          error: "twitterapi.io:search_response:rate_limited"
        }
      ]);
      expect(repo.listAuditEventsForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-failed-event-1",
          event_type: "public_x_source_collection_failed"
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("continues with partial materials when a later provider call is rate limited", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const baseProvider = fakePublicXProvider();
      const providerError = new ApiError({
        code: "rate_limited",
        provider: "twitterapi.io",
        stage: "search_response",
        message: "rate limited"
      });
      const provider: PublicXDataProvider & { calls: PublicXSearchInput[] } = {
        calls: baseProvider.calls,
        searchPosts: async (input) => {
          if (input.query === "open_source") {
            baseProvider.calls.push(input);
            throw providerError;
          }
          return baseProvider.searchPosts(input);
        },
        getPostById: async () => undefined
      };

      const result = await collectAccountPublicXSourceBatch({
        repo,
        account,
        provider,
        traceId: "trace-source-collection-partial-1",
        runId: "source-collection-partial-run-1",
        auditEventId: "source-collection-partial-event-1",
        collectedAt: now,
        sourceQueries: ["AI", "open_source", "frontier_tech"],
        maxQueries: 3,
        perQueryLimit: 2
      });

      expect(provider.calls).toEqual([
        { query: "AI", limit: 2 },
        { query: "open_source", limit: 2 }
      ]);
      expect(result).toMatchObject({
        status: "succeeded",
        stoppedReason: "rate_limited",
        queries: ["AI", "open_source"],
        apiAuditIds: ["source-collection-partial-run-1:api:1", "source-collection-partial-run-1:api:2"],
        requestUnits: 2,
        rawCount: 2,
        duplicateMaterialCount: 0
      });
      expect(result.materials.map((material) => material.id)).toEqual(["public-x:tweet-shared", "public-x:tweet-ai-only"]);
      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toMatchObject([
        {
          id: "source-collection-partial-run-1:api:1",
          status: "succeeded"
        },
        {
          id: "source-collection-partial-run-1:api:2",
          status: "failed"
        }
      ]);
      const runOutput = JSON.parse(repo.listAiRunsForAccount(account.account_uuid)[0].output_json ?? "{}");
      expect(runOutput).toMatchObject({
        status: "succeeded",
        stopped_reason: "rate_limited",
        request_units: 2,
        material_count: 2
      });
      const auditMetadata = JSON.parse(repo.listAuditEventsForAccount(account.account_uuid)[0].metadata_json ?? "{}");
      expect(auditMetadata).toMatchObject({
        status: "succeeded",
        stopped_reason: "rate_limited",
        request_units: 2,
        material_count: 2
      });
    } finally {
      db.close();
    }
  });

  it("rejects invalid collection limits before provider calls", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const provider = fakePublicXProvider();

      await expect(
        collectAccountPublicXSourceBatch({
          repo,
          account,
          provider,
          traceId: "trace-source-collection-invalid-1",
          runId: "source-collection-invalid-run-1",
          auditEventId: "source-collection-invalid-event-1",
          collectedAt: now,
          sourceQueries: ["AI"],
          maxQueries: 31
        })
      ).rejects.toMatchObject({
        provider: "local",
        stage: "source_collection",
        code: "invalid_request"
      });
      expect(provider.calls).toHaveLength(0);
      expect(repo.listAiRunsForAccount(account.account_uuid)).toHaveLength(0);
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
      const posts = (postsByQuery[input.query] ?? []).slice(0, input.limit).map((post) => ({
        ...post,
        authorId: `${post.authorHandle}-id`,
        createdAt: "2026-06-24T03:50:00.000Z",
        repostCount: 10,
        replyCount: 2,
        quoteCount: 1,
        bookmarkCount: 5,
        viewCount: 1000,
        url: `https://x.com/${post.authorHandle}/status/${post.id}`
      }));
      return {
        sourceProvider: "twitterapi.io",
        rawCount: posts.length,
        posts
      };
    },
    getPostById: async () => undefined
  };
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
  for (const identity of registry.config.x_identities) {
    repo.upsertXIdentity(identity);
  }
  return {
    repo,
    account: resolveAccountRef(registry, { accountKey: "zh-tech" }).account
  };
}

function accountByKey(accountKey: string): AccountConfig {
  const registry = parseAccountRegistryConfig(accountsExample);
  return resolveAccountRef(registry, { accountKey }).account;
}

function openMigratedTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}
