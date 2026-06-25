import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "./fixtures/accounts";
import { parseAccountRegistryConfig, resolveAccountRef } from "../src/lib/accounts/registry";
import { parseProductionOnlineRunLoopArgs, parseProductionOnlineRunOnceArgs } from "../src/lib/orchestration/production-runner-args";
import { runProductionLocalPreflight } from "../src/lib/orchestration/production-preflight";
import { createProductionSourceCollectionExecutor } from "../src/lib/orchestration/production-source-collection-executor";
import { runOnlineOperationOnce } from "../src/lib/orchestration/online-runner";
import type { PublicXDataProvider, PublicXSearchInput } from "../src/lib/providers/public-x";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations } from "../src/lib/storage/sqlite";

const now = "2026-06-24T04:00:00.000Z";
const zhAccountUuid = "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001";
const promptText = "账号方向：AI、open_source、frontier_tech。\n发帖原则：自然、具体、可复盘。";
const execFileAsync = promisify(execFile);

describe("production run-once source context and topic integration", () => {
  it("parses production online args with real-config guardrails", () => {
    expect(
      parseProductionOnlineRunOnceArgs([
        "--account",
        "zh-tech",
        "--secrets-file",
        "secrets/accounts.local.json",
        "--db-file",
        "/tmp/post-foundry.sqlite",
        "--source-max-requests",
        "2",
        "--source-per-query-limit",
        "3",
        "--codex-session-dir",
        "/tmp/post-foundry-codex-sessions",
        "--codex-session-max-age-hours",
        "72",
        "--one-time-prompt",
        "临时选题方向：BTC ETF"
      ])
    ).toMatchObject({
      account: "zh-tech",
      secretsFile: "secrets/accounts.local.json",
      dbFile: "/tmp/post-foundry.sqlite",
      sourceMaxRequests: 2,
      sourcePerQueryLimit: 3,
      codexSessionDir: "/tmp/post-foundry-codex-sessions",
      codexSessionMaxAgeHours: 72,
      oneTimePrompt: "临时选题方向：BTC ETF"
    });

    expect(parseProductionOnlineRunOnceArgs(["--account", "zh-tech"])).toMatchObject({ account: "zh-tech" });
    expect(() => parseProductionOnlineRunOnceArgs(["--account", "zh-tech", "--config-file", "config/accounts.local.json"]))
      .toThrow("Unknown argument: --config-file");
    expect(() => parseProductionOnlineRunOnceArgs(["--account", "zh-tech", "--source-max-requests", "31"]))
      .toThrow("--source-max-requests must be an integer <= 30");
    expect(() => parseProductionOnlineRunLoopArgs(["--account", "zh-tech", "--interval-seconds", "299"]))
      .toThrow("--interval-seconds must be an integer >= 300");
    expect(() => parseProductionOnlineRunLoopArgs(["--account", "zh-tech", "--one-time-prompt", "临时提示"]))
      .toThrow("Unknown argument: --one-time-prompt");
  });

  it("checks local production launch preflight before opening runtime DB or providers", async () => {
    const registry = registryWithProductionLaunchEnabled();
    let promptLoads = 0;

    await expect(
      runProductionLocalPreflight({
        registry,
        accountKey: "zh-tech",
        accountCredentials: {
          accountKey: "zh-tech",
          twitterApiIoApiKey: "tw-real-key",
          xOfficialAccessToken: "x-real-token"
        },
        telegramCredentials: {
          botToken: "123456:telegram-real-token",
          notificationChannelChatId: "@post_foundry_ops"
        },
        checkCodexRuntime: () => readyCodexRuntime(),
        loadPrompt: () => {
          promptLoads += 1;
          return testPrompt();
        }
      })
    ).resolves.toMatchObject({
      status: "ready",
      accountKey: "zh-tech",
      accountUuid: zhAccountUuid,
      promptSha256: sha256(promptText)
    });
    expect(promptLoads).toBe(1);
  });

  it("allows draft preview preflight without X posting or Telegram credentials", async () => {
    const registry = parseAccountRegistryConfig(accountsExample);
    let promptLoads = 0;

    const result = await runProductionLocalPreflight({
      mode: "draft_preview",
      registry,
      accountKey: "zh-tech",
      accountCredentials: {
        accountKey: "zh-tech",
        twitterApiIoApiKey: "tw-real-key"
      },
      telegramCredentials: {},
      checkCodexRuntime: () => readyCodexRuntime(),
      loadPrompt: () => {
        promptLoads += 1;
        return testPrompt();
      }
    });

    expect(result).toMatchObject({
      status: "ready",
      accountKey: "zh-tech",
      accountUuid: zhAccountUuid,
      promptSha256: sha256(promptText)
    });
    expect(result.checks.map((check) => check.key)).not.toEqual(
      expect.arrayContaining(["real_posting_enabled", "x_official_access_token", "telegram_bot_token", "telegram_notification_channel"])
    );
    expect(promptLoads).toBe(1);
  });

  it("rejects incomplete production launch preflight before loading prompt", async () => {
    const registry = parseAccountRegistryConfig(accountsExample);
    let promptLoads = 0;

    await expect(
      runProductionLocalPreflight({
        registry,
        accountKey: "zh-tech",
        accountCredentials: {
          accountKey: "zh-tech",
          twitterApiIoApiKey: "replace-with-twitterapi-io-api-key",
          xOfficialAccessToken: "replace-with-x-oauth-access-token"
        },
        telegramCredentials: {
          botToken: "replace-with-telegram-bot-token",
          notificationChannelChatId: "@replace_with_channel_username_or_-100_channel_id"
        },
        checkCodexRuntime: () => readyCodexRuntime(),
        loadPrompt: () => {
          promptLoads += 1;
          return testPrompt();
        }
      })
    ).rejects.toMatchObject({
      code: "missing_credentials",
      provider: "local",
      stage: "production_preflight"
    });
    expect(promptLoads).toBe(0);
  });

  it("normalizes production CLI startup failures to production_preflight before creating the runtime DB", async () => {
    const cases: Array<{
      name: string;
      account: string;
      profile?: unknown;
      secrets?: unknown;
    }> = [
      {
        name: "missing secrets",
        account: "zh-tech"
      },
      {
        name: "missing account",
        account: "missing-account",
        profile: productionProfile(),
        secrets: fullProductionSecrets({ withPrompt: true })
      },
      {
        name: "missing prompt",
        account: "zh-tech",
        profile: productionProfile(),
        secrets: fullProductionSecrets({ withPrompt: false })
      },
      {
        name: "bad profile",
        account: "zh-tech",
        profile: "{not-json",
        secrets: fullProductionSecrets({ withPrompt: true })
      }
    ];

    for (const item of cases) {
      await withProductionCliTempFiles(async ({ profilePath, secretsPath, dbPath }) => {
        if (typeof item.profile === "string") {
          await writeFile(profilePath, item.profile, "utf8");
        } else if (item.profile) {
          await writeJson(profilePath, item.profile);
        }
        if (item.secrets) {
          await writeJson(secretsPath, item.secrets);
        }

        const output = await expectProductionCliFailure({
          script: "src/cli/run-once-online.ts",
          account: item.account,
          secretsPath,
          dbPath
        });

        expect(output, item.name).toContain("stage: production_preflight");
        expect(output, item.name).not.toContain("stage: read_secrets");
        expect(output, item.name).not.toContain("stage: account_registry");
        await expect(access(dbPath), item.name).rejects.toThrow();
      });
    }
  });

  it("normalizes production loop preflight startup failures before creating the runtime DB", async () => {
    await withProductionCliTempFiles(async ({ profilePath, secretsPath, dbPath }) => {
      await writeJson(profilePath, productionProfile());
      await writeJson(secretsPath, fullProductionSecrets({ withPrompt: false }));

      const output = await expectProductionCliFailure({
        script: "src/cli/run-loop-online.ts",
        account: "zh-tech",
        secretsPath,
        dbPath,
        extraArgs: ["--max-iterations", "1"]
      });

      expect(output).toContain("stage: production_preflight");
      expect(output).not.toContain("stage: account_initial_prompt");
      await expect(access(dbPath)).rejects.toThrow();
    });
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

  it("skips collection before provider calls when prompt yields no source queries", async () => {
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
        traceId: "trace-production-source-no-query-1",
        now: fixedNow(now),
        enableHeartbeat: false,
        operation: createProductionSourceCollectionExecutor({
          repo,
          registry,
          accountKey: "zh-tech",
          provider,
          loadPrompt: () => {
            promptLoads += 1;
            return emptyQueryPrompt();
          }
        })
      });

      expect(promptLoads).toBe(1);
      expect(provider.calls).toHaveLength(0);
      expect(result).toMatchObject({
        outcome: "skipped",
        finalAction: "source_collection_skipped",
        summary: {
          source_collection_status: "skipped",
          skipped_reason: "no_source_queries",
          request_units: 0,
          material_count: 0
        }
      });
      expect(repo.listAiRunsForAccount(zhAccountUuid)).toMatchObject([{ status: "skipped" }]);
      expect(repo.listApiCallAuditForAccount(zhAccountUuid)).toHaveLength(0);
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

      expect(promptLoads).toBe(1);
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

function registryWithProductionLaunchEnabled() {
  return parseAccountRegistryConfig(productionLaunchConfig());
}

function productionLaunchConfig(): typeof accountsExample {
  const config = JSON.parse(JSON.stringify(accountsExample)) as typeof accountsExample;
  const account = config.accounts.find((candidate) => candidate.account_key === "zh-tech");
  if (!account) {
    throw new Error("missing zh-tech account fixture");
  }
  account.posting.real_posting_enabled = true;
  return config;
}

function productionProfile() {
  return {
    posting: {
      cadence_hours: 6,
      daily_min: 3,
      daily_max: 4,
      cooldown_minutes: 90,
      require_approval: false,
      real_posting_enabled: true
    },
    source: {
      max_requests_per_run: 30
    }
  };
}

function fullProductionSecrets(input: { withPrompt: boolean }) {
  return {
    version: 1,
    global_providers: {
      twitterapi_io: {
        api_key: "tw-real-key"
      },
      telegram: {
        bot_token: "123456:telegram-real-token",
        notification_channel_chat_id: "@post_foundry_ops"
      }
    },
    accounts: {
      "zh-tech": {
        profile_path: "secrets/profiles/zh-tech.json",
        ...(input.withPrompt ? { initial_prompt: promptText } : {}),
        x_official: {
          access_token: "x-real-token"
        }
      }
    }
  };
}

async function withProductionCliTempFiles(
  body: (paths: { root: string; profilePath: string; secretsPath: string; dbPath: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "post-foundry-prod-cli-"));
  try {
    await mkdir(join(root, "secrets", "profiles"), { recursive: true });
    await body({
      root,
      profilePath: join(root, "secrets", "profiles", "zh-tech.json"),
      secretsPath: join(root, "secrets", "accounts.local.json"),
      dbPath: join(root, "runtime.sqlite")
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

async function expectProductionCliFailure(input: {
  script: string;
  account: string;
  secretsPath: string;
  dbPath: string;
  extraArgs?: string[];
}): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env
  };
  delete env.TWITTERAPI_IO_API_KEY;
  delete env.X_DEBUG_ACCESS_TOKEN;
  delete env.X_DEBUG_REFRESH_TOKEN;
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_NOTIFICATION_CHANNEL_CHAT_ID;

  try {
    await execFileAsync(
      "bun",
      [
        "run",
        input.script,
        "--account",
        input.account,
        "--secrets-file",
        input.secretsPath,
        "--db-file",
        input.dbPath,
        ...(input.extraArgs ?? [])
      ],
      {
        cwd: process.cwd(),
        env,
        timeout: 10_000
      }
    );
  } catch (error: unknown) {
    const cliError = error as Error & { code?: number; stdout?: string; stderr?: string };
    const output = `${cliError.stdout ?? ""}\n${cliError.stderr ?? ""}`;
    expect(cliError.code).toBe(1);
    return output;
  }

  throw new Error("production CLI should have failed during local preflight");
}

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

function emptyQueryPrompt(): {
  accountKey: string;
  source: "inline";
  prompt: string;
  promptSha256: string;
} {
  const prompt = "保持自然表达，避免调试痕迹。";
  return {
    accountKey: "zh-tech",
    source: "inline",
    prompt,
    promptSha256: sha256(prompt)
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

function readyCodexRuntime() {
  return {
    status: "ready" as const,
    command: "codex",
    version: "codex test",
    loginStatus: "logged in"
  };
}
