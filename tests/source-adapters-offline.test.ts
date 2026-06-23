import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import { parseAccountRegistryConfig, resolveAccountRef, type AccountConfig } from "../src/lib/accounts/registry";
import { ApiError } from "../src/lib/api/errors";
import {
  collectManualNoteMaterials,
  collectTwitterApiIoSearchMaterials,
  collectWebNewsFixtureMaterials,
  recordSourceAdapterApiAudit
} from "../src/lib/context/source-adapters";
import { buildSourceContext } from "../src/lib/context/source-ingestion";
import type { PublicXDataProvider } from "../src/lib/providers/public-x";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-23T07:00:00.000Z";

describe("source adapter boundary", () => {
  it("maps TwitterAPI.io public X search fixtures to source materials", async () => {
    const account = accountByKey("zh-tech");
    const provider = fakePublicXProvider();

    const result = await collectTwitterApiIoSearchMaterials({
      accountUuid: account.account_uuid,
      provider,
      query: "AI workflow",
      limit: 2,
      topicTags: ["AI", "workflow"],
      collectedAt: now
    });

    expect(result.materials).toEqual([
      {
        id: "public-x:tweet-1",
        accountUuid: account.account_uuid,
        sourceType: "public_x_post",
        provider: "twitterapi.io",
        sourceRef: "tweet:tweet-1",
        sourceUrl: "https://x.com/author_one/status/tweet-1",
        title: "X post by @author_one",
        text: "AI workflow memory is becoming a useful product boundary.",
        summary: "AI workflow memory is becoming a useful product boundary.",
        capturedAt: now,
        topicTags: ["AI", "workflow"],
        authorHandle: "author_one",
        engagement: {
          likeCount: 100,
          repostCount: 20,
          replyCount: 5,
          quoteCount: 2,
          bookmarkCount: 12,
          viewCount: 5000
        }
      },
      {
        id: "public-x:tweet-2",
        accountUuid: account.account_uuid,
        sourceType: "public_x_post",
        provider: "twitterapi.io",
        sourceRef: "tweet:tweet-2",
        sourceUrl: "https://x.com/author_two/status/tweet-2",
        title: "X post by @author_two",
        text: "Teams are turning agent experiments into repeatable work.",
        summary: "Teams are turning agent experiments into repeatable work.",
        capturedAt: now,
        topicTags: ["AI", "workflow"],
        authorHandle: "author_two",
        engagement: {
          likeCount: 50,
          repostCount: 10,
          replyCount: 3,
          quoteCount: 1,
          bookmarkCount: 8,
          viewCount: 3000
        }
      }
    ]);
    expect(result.apiAudit).toMatchObject({
      accountUuid: account.account_uuid,
      provider: "twitterapi.io",
      operation: "public_x_search",
      status: "succeeded",
      requestUnits: 1,
      metadata: {
        query: "AI workflow",
        limit: 2,
        raw_count: 2,
        material_count: 2
      }
    });
  });

  it("records source adapter API audit by account", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const result = await collectTwitterApiIoSearchMaterials({
        accountUuid: account.account_uuid,
        provider: fakePublicXProvider(),
        query: "AI workflow",
        limit: 1,
        topicTags: ["AI"],
        collectedAt: now
      });

      recordSourceAdapterApiAudit({
        repo,
        id: "api-audit-source-adapter-1",
        apiAudit: result.apiAudit
      });

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toMatchObject([
        {
          id: "api-audit-source-adapter-1",
          provider: "twitterapi.io",
          operation: "public_x_search",
          status: "succeeded",
          request_units: 1
        }
      ]);
      expect(repo.listApiCallAuditForAccount(accountByKey("en-tech").account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("records failed TwitterAPI.io adapter attempts when repo audit is requested", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      const provider: PublicXDataProvider = {
        searchPosts: async () => {
          throw new ApiError({
            code: "rate_limited",
            provider: "twitterapi.io",
            stage: "search_response",
            message: "rate limited"
          });
        },
        getPostById: async () => undefined
      };

      await expect(
        collectTwitterApiIoSearchMaterials({
          accountUuid: account.account_uuid,
          provider,
          query: "AI workflow",
          limit: 1,
          collectedAt: now,
          repo,
          apiAuditId: "api-audit-source-adapter-failed"
        })
      ).rejects.toBeInstanceOf(ApiError);

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toMatchObject([
        {
          id: "api-audit-source-adapter-failed",
          provider: "twitterapi.io",
          operation: "public_x_search",
          status: "failed",
          request_units: 1
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("preserves provider errors when failed audit recording also fails", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      repo.recordApiCallAudit({
        id: "api-audit-duplicate",
        accountUuid: account.account_uuid,
        provider: "manual",
        operation: "preexisting",
        status: "succeeded",
        requestUnits: 0,
        startedAt: now
      });
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
        collectTwitterApiIoSearchMaterials({
          accountUuid: account.account_uuid,
          provider,
          query: "AI workflow",
          limit: 1,
          collectedAt: now,
          repo,
          apiAuditId: "api-audit-duplicate"
        })
      ).rejects.toMatchObject({
        code: "rate_limited",
        provider: "twitterapi.io",
        stage: "search_response"
      });

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("does not convert successful provider results into failed provider attempts when success audit fails", async () => {
    const db = openMigratedTestDb();
    try {
      const { repo, account } = seedAccounts(db);
      repo.recordApiCallAudit({
        id: "api-audit-success-duplicate",
        accountUuid: account.account_uuid,
        provider: "manual",
        operation: "preexisting",
        status: "succeeded",
        requestUnits: 0,
        startedAt: now
      });

      await expect(
        collectTwitterApiIoSearchMaterials({
          accountUuid: account.account_uuid,
          provider: fakePublicXProvider(),
          query: "AI workflow",
          limit: 1,
          collectedAt: now,
          repo,
          apiAuditId: "api-audit-success-duplicate"
        })
      ).rejects.toThrow();

      expect(repo.listApiCallAuditForAccount(account.account_uuid)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("maps manual notes and web/news fixtures to source materials without online calls", () => {
    const account = accountByKey("zh-tech");
    const manual = collectManualNoteMaterials({
      accountUuid: account.account_uuid,
      collectedAt: now,
      topicTags: ["AI"],
      notes: [
        {
          id: "operator-note-1",
          title: "Operator note",
          note: "近期可以关注 agent 如何把经验沉淀到流程。"
        }
      ]
    });
    const web = collectWebNewsFixtureMaterials({
      accountUuid: account.account_uuid,
      collectedAt: now,
      topicTags: ["AI", "workflow"],
      pages: [
        {
          id: "article-1",
          url: "https://example.com/ai-workflow",
          title: "AI workflow article",
          summary: "一篇解释 agent workflow memory 的资料。"
        }
      ]
    });

    expect(manual.materials).toMatchObject([
      {
        id: "manual-note:operator-note-1",
        sourceType: "manual_note",
        provider: "manual_fixture",
        sourceRef: "manual:operator-note-1",
        topicTags: ["AI"]
      }
    ]);
    expect(manual.apiAudit).toMatchObject({
      provider: "manual",
      operation: "manual_notes_fixture",
      status: "skipped",
      requestUnits: 0
    });
    expect(web.materials).toMatchObject([
      {
        id: "web-news:article-1",
        sourceType: "web_page",
        provider: "web_news_fixture",
        sourceRef: "web:https://example.com/ai-workflow",
        sourceUrl: "https://example.com/ai-workflow",
        topicTags: ["AI", "workflow"]
      }
    ]);
    expect(web.apiAudit).toMatchObject({
      provider: "web_news_fixture",
      operation: "web_news_fixture",
      status: "skipped",
      requestUnits: 0
    });

    const context = buildSourceContext({
      account,
      topic: {
        id: "topic-ai-workflow",
        label: "AI workflow",
        reason: "fixture context",
        keywords: ["AI", "workflow"]
      },
      materials: [...manual.materials, ...web.materials],
      recentPosts: [],
      collectedAt: now
    });
    expect(context.materials.map((material) => material.id)).toEqual(["web-news:article-1", "manual-note:operator-note-1"]);
  });

  it("rejects invalid adapter inputs before provider calls", async () => {
    const account = accountByKey("zh-tech");
    let calls = 0;
    const provider: PublicXDataProvider = {
      searchPosts: async () => {
        calls += 1;
        return { sourceProvider: "twitterapi.io", rawCount: 0, posts: [] };
      },
      getPostById: async () => undefined
    };

    await expectLocalError(
      collectTwitterApiIoSearchMaterials({
        accountUuid: account.account_uuid,
        provider,
        query: " ",
        limit: 1,
        collectedAt: now
      })
    );
    await expectLocalError(
      collectTwitterApiIoSearchMaterials({
        accountUuid: account.account_uuid,
        provider,
        query: "AI",
        limit: 0,
        collectedAt: now
      })
    );
    const db = openMigratedTestDb();
    try {
      const { repo } = seedAccounts(db);
      await expectLocalError(
        collectTwitterApiIoSearchMaterials({
          accountUuid: account.account_uuid,
          provider,
          query: "AI",
          limit: 1,
          collectedAt: now,
          repo
        })
      );
      await expectLocalError(
        collectTwitterApiIoSearchMaterials({
          accountUuid: account.account_uuid,
          provider,
          query: "AI",
          limit: 1,
          collectedAt: now,
          apiAuditId: "api-audit-without-repo"
        })
      );
    } finally {
      db.close();
    }
    await expectLocalError(() =>
      collectManualNoteMaterials({
        accountUuid: account.account_uuid,
        collectedAt: now,
        notes: [
          {
            id: "duplicate",
            note: "first"
          },
          {
            id: "duplicate",
            note: "second"
          }
        ]
      })
    );
    expect(calls).toBe(0);
  });
});

function fakePublicXProvider(): PublicXDataProvider {
  return {
    searchPosts: async (input) => {
      expect(input).toEqual({
        query: "AI workflow",
        limit: expect.any(Number)
      });
      return {
        sourceProvider: "twitterapi.io",
        rawCount: 2,
        posts: [
          {
            id: "tweet-1",
            text: "AI workflow memory is becoming a useful product boundary.",
            authorHandle: "author_one",
            authorId: "author-1",
            createdAt: "2026-06-23T06:50:00.000Z",
            likeCount: 100,
            repostCount: 20,
            replyCount: 5,
            quoteCount: 2,
            bookmarkCount: 12,
            viewCount: 5000,
            url: "https://x.com/author_one/status/tweet-1"
          },
          {
            id: "tweet-2",
            text: "Teams are turning agent experiments into repeatable work.",
            authorHandle: "author_two",
            authorId: "author-2",
            createdAt: "2026-06-23T06:55:00.000Z",
            likeCount: 50,
            repostCount: 10,
            replyCount: 3,
            quoteCount: 1,
            bookmarkCount: 8,
            viewCount: 3000,
            url: "https://x.com/author_two/status/tweet-2"
          }
        ].slice(0, input.limit)
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

async function expectLocalError(promise: Promise<unknown> | (() => unknown)): Promise<void> {
  try {
    if (typeof promise === "function") {
      promise();
    } else {
      await promise;
    }
    throw new Error("expected ApiError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.provider).toBe("local");
    expect(apiError.code).toBe("invalid_request");
    expect(apiError.stage).toBe("source_adapter");
  }
}
