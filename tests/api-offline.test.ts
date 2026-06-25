import { execFile } from "node:child_process";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ApiError, type ApiErrorCode, type ApiProvider } from "../src/lib/api/errors";
import { restrictOwnerReadWrite } from "../src/lib/api/file-permissions";
import type { FetchLike } from "../src/lib/api/http";
import { redactSecrets } from "../src/lib/api/redaction";
import { findRealDebugPostTextViolation } from "../src/lib/api/real-post-text-policy";
import { resolveAccountCredentials, type SecretsFile } from "../src/lib/api/secrets";
import { applyXOAuthTokenResult } from "../src/lib/api/x-token-store";
import { TwitterApiIoPublicXAdapter } from "../src/lib/providers/twitterapi-io";
import { buildXOAuthAuthorizeUrl } from "../src/lib/providers/x-oauth-auth";
import { refreshXOAuthToken } from "../src/lib/providers/x-oauth-token";
import { XOfficialPublisherClient } from "../src/lib/providers/x-official-publisher";

const execFileAsync = promisify(execFile);

describe("api offline contract", () => {
  it("parses TwitterAPI.io search fixture through PublicXDataProvider", async () => {
    const seen: string[] = [];
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson((url, init) => {
        seen.push(url);
        expect(init?.headers).toEqual({ "X-API-Key": "tw-secret-token" });
        return twitterSearchFixture();
      })
    });

    const output = await adapter.searchPosts({ query: "AI", limit: 2 });

    expect(seen[0]).toContain("/twitter/tweet/advanced_search");
    expect(seen[0]).toContain("query=AI");
    expect(output).toEqual({
      sourceProvider: "twitterapi.io",
      rawCount: 2,
      posts: [
        {
          id: "post-1",
          text: "first public post",
          authorHandle: "author_one",
          authorId: "author-1",
          createdAt: "2026-06-22T00:00:00Z",
          likeCount: 10,
          repostCount: 2,
          replyCount: 3,
          quoteCount: 1,
          viewCount: 100,
          bookmarkCount: 4,
          url: "https://x.com/author_one/status/post-1"
        },
        {
          id: "post-2",
          text: "second public post",
          authorHandle: "author_two",
          authorId: "author-2",
          createdAt: "2026-06-22T00:01:00Z",
          likeCount: 20,
          repostCount: 4,
          replyCount: 6,
          quoteCount: 2,
          viewCount: 200,
          bookmarkCount: 8,
          url: "https://x.com/author_two/status/post-2"
        }
      ]
    });
  });

  it("parses TwitterAPI.io empty result as empty posts", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson(() => ({ tweets: [], has_next_page: false, next_cursor: "" }))
    });

    await expect(adapter.searchPosts({ query: "AI", limit: 10 })).resolves.toEqual({
      sourceProvider: "twitterapi.io",
      rawCount: 0,
      posts: []
    });
  });

  it("reads back a posted tweet by id through TwitterAPI.io", async () => {
    const seen: string[] = [];
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson((url, init) => {
        seen.push(url);
        expect(init?.headers).toEqual({ "X-API-Key": "tw-secret-token" });
        return {
          status: "success",
          message: "success",
          tweets: [
            {
              id: "tweet-1",
              text: "a public post",
              authorHandle: "author_one",
              authorId: "author-1",
              createdAt: "Tue Jan 02 03:04:05 +0000 2024",
              url: "https://x.com/author_one/status/tweet-1"
            }
          ]
        };
      })
    });

    await expect(adapter.getPostById("tweet-1")).resolves.toEqual({
      id: "tweet-1",
      text: "a public post",
      authorHandle: "author_one",
      authorId: "author-1",
      createdAt: "Tue Jan 02 03:04:05 +0000 2024",
      url: "https://x.com/author_one/status/tweet-1"
    });
    expect(seen[0]).toContain("/twitter/tweets");
    expect(seen[0]).toContain("tweet_ids=tweet-1");
  });

  it("reports missing tweet lookup as provider indexing delay", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson(() => ({ status: "success", message: "success", tweets: [] }))
    });

    await expect(adapter.getPostById("tweet-1")).resolves.toBeUndefined();
  });

  it("maps TwitterAPI.io tweet lookup status error to provider_error", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson(() => ({ status: "error", message: "provider failed", tweets: [] }))
    });

    await expectApiError(adapter.getPostById("tweet-1"), "provider_error", "twitterapi.io");
  });

  it("maps TwitterAPI.io 429 to rate_limited", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: jsonResponse(429, { error: "rate limited" })
    });

    await expectApiError(
      adapter.searchPosts({ query: "AI", limit: 10 }),
      "rate_limited",
      "twitterapi.io"
    );
  });

  it("maps TwitterAPI.io tweet lookup 429 to rate_limited", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: jsonResponse(429, { error: "rate limited" })
    });

    await expectApiError(adapter.getPostById("tweet-1"), "rate_limited", "twitterapi.io");
  });

  it("maps TwitterAPI.io schema drift to provider_schema_drift", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      apiKey: "tw-secret-token",
      fetcher: okJson(() => ({ unexpected: [] }))
    });

    await expectApiError(
      adapter.searchPosts({ query: "AI", limit: 10 }),
      "provider_schema_drift",
      "twitterapi.io"
    );
  });

  it("resolves account credentials from local secrets and reports missing account", async () => {
    const dir = await mkdtemp(join(tmpdir(), "post-foundry-test-"));
    const secretsPath = join(dir, "accounts.local.json");
    await writeFile(
      secretsPath,
      JSON.stringify({
        version: 1,
        global_providers: { twitterapi_io: { api_key: "global-twitter-key" } },
        accounts: {
          "zh-tech": {
            providers: {
              twitterapi_io: {
                api_key: "optional-account-level-twitterapi-io-api-key"
              }
            },
            x_official: {
              access_token: "x-account-token"
            }
          }
        }
      })
    );

    await expect(resolveAccountCredentials({ accountKey: "zh-tech", secretsPath, env: {} })).resolves.toMatchObject({
      accountKey: "zh-tech",
      twitterApiIoApiKey: "global-twitter-key",
      xOfficialAccessToken: "x-account-token"
    });

    await expectApiError(
      resolveAccountCredentials({ accountKey: "missing", secretsPath, env: {} }),
      "missing_credentials",
      "local"
    );

    const invalidJsonPath = join(dir, "invalid.json");
    await writeFile(invalidJsonPath, "{invalid-json");
    await expectApiError(
      resolveAccountCredentials({ accountKey: "zh-tech", secretsPath: invalidJsonPath, env: {} }),
      "invalid_request",
      "local"
    );
  });

  it("does not require secrets for offline adapter tests", async () => {
    const adapter = new TwitterApiIoPublicXAdapter({
      fetcher: okJson(() => twitterSearchFixture())
    });

    await expectApiError(
      adapter.searchPosts({ query: "AI", limit: 10 }),
      "missing_credentials",
      "twitterapi.io"
    );
  });

  it("returns X publisher dry-run without network", async () => {
    let calls = 0;
    const publisher = new XOfficialPublisherClient({
      accessToken: "x-account-token",
      fetcher: async () => {
        calls += 1;
        throw new Error("network must not be called");
      }
    });

    await expect(
      publisher.createPost({
        accountKey: "zh-tech",
        text: "dry run",
        dryRun: true
      })
    ).resolves.toEqual({
      status: "dry_run",
      accountKey: "zh-tech",
      textLength: 7,
      requestPreview: {
        method: "POST",
        path: "/2/tweets"
      }
    });
    expect(calls).toBe(0);
  });

  it("blocks real X post when hard switch is disabled", async () => {
    const publisher = new XOfficialPublisherClient({
      accessToken: "x-account-token",
      env: {}
    });

    await expectApiError(
      publisher.createPost({
        accountKey: "zh-tech",
        text: "real post",
        dryRun: false
      }),
      "real_post_not_allowed",
      "x_official"
    );
  });

  it("allows natural real debug post text", () => {
    expect(findRealDebugPostTextViolation("越是急着抵达，越要记得看清脚下的路。")).toBeUndefined();
  });

  it("blocks obvious test/debug real post text", () => {
    const examples = [
      "PostFoundry .001 smoke test.",
      "debug real post",
      "20260622A.001 validation",
      "task 001 validation",
      "这是一条测试发帖"
    ];

    for (const example of examples) {
      expect(findRealDebugPostTextViolation(example)).toBeTruthy();
    }
  });

  it("rejects invalid real debug post text before reading secrets or online smoke", async () => {
    const dir = await mkdtemp(join(tmpdir(), "post-foundry-cli-test-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      POST_FOUNDRY_SECRETS_FILE: join(dir, "missing-accounts.local.json")
    };
    delete env.TWITTERAPI_IO_API_KEY;
    delete env.X_DEBUG_ACCESS_TOKEN;

    try {
      await execFileAsync(
        "bun",
        [
          "run",
          "src/cli/debug-api-online.ts",
          "--account",
          "zh-tech",
          "--allow-real-post",
          "--post-text",
          "PostFoundry .001 smoke test."
        ],
        { cwd: process.cwd(), env, timeout: 10_000 }
      );
      throw new Error("debug-api-online should reject invalid real post text");
    } catch (error: unknown) {
      const cliError = error as Error & { code?: number; stdout?: string; stderr?: string };
      const output = `${cliError.stdout ?? ""}\n${cliError.stderr ?? ""}`;

      expect(cliError.code).toBe(1);
      expect(output).toContain("ERROR real_post_not_allowed");
      expect(output).toContain("obvious test/debug marker");
      expect(output).not.toContain("missing_credentials");
      expect(output).not.toContain("twitterapi.io search smoke");
      expect(output).not.toContain("x auth smoke");
    }
  });

  it("requires X token for real post after hard switch", async () => {
    const publisher = new XOfficialPublisherClient({
      env: { POST_FOUNDRY_ALLOW_REAL_X_POST: "1" }
    });

    await expectApiError(
      publisher.createPost({
        accountKey: "zh-tech",
        text: "real post",
        dryRun: false
      }),
      "missing_credentials",
      "x_official"
    );
  });

  it("parses X real post success fixture", async () => {
    const publisher = new XOfficialPublisherClient({
      accessToken: "x-account-token",
      env: { POST_FOUNDRY_ALLOW_REAL_X_POST: "1" },
      fetcher: okJson((url, init) => {
        expect(url).toBe("https://api.x.com/2/tweets");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({
          Authorization: "Bearer x-account-token",
          "Content-Type": "application/json"
        });
        expect(init?.body).toBe(JSON.stringify({ text: "real post" }));
        return { data: { id: "tweet-1", text: "real post" } };
      })
    });

    await expect(
      publisher.createPost({
        accountKey: "zh-tech",
        text: "real post",
        dryRun: false
      })
    ).resolves.toEqual({
      status: "posted",
      accountKey: "zh-tech",
      tweetId: "tweet-1",
      textLength: 9
    });
  });

  it("maps X API error fixture", async () => {
    const publisher = new XOfficialPublisherClient({
      accessToken: "x-account-token",
      env: { POST_FOUNDRY_ALLOW_REAL_X_POST: "1" },
      fetcher: jsonResponse(500, { title: "Internal error" })
    });

    await expectApiError(
      publisher.createPost({
        accountKey: "zh-tech",
        text: "real post",
        dryRun: false
      }),
      "x_api_error",
      "x_official"
    );
  });

  it("refreshes X OAuth token through token endpoint fixture", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const token = await refreshXOAuthToken({
      app: {
        clientId: "client-id",
        clientSecret: "client-secret"
      },
      refreshToken: "old-refresh-token",
      now: new Date("2026-06-22T00:00:00Z"),
      fetcher: okJson((url, init) => {
        seen.push({ url, init });
        return {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 7200,
          token_type: "bearer",
          scope: "tweet.read tweet.write users.read offline.access"
        };
      })
    });

    expect(seen[0].url).toBe("https://api.x.com/2/oauth2/token");
    expect(seen[0].init?.method).toBe("POST");
    expect(seen[0].init?.headers).toEqual({
      Authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    });
    expect(new URLSearchParams(String(seen[0].init?.body)).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(String(seen[0].init?.body)).get("refresh_token")).toBe("old-refresh-token");
    expect(token).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: "2026-06-22T02:00:00.000Z"
    });
  });

  it("builds X OAuth authorize URL with local callback and offline scope", () => {
    const authorizeUrl = new URL(
      buildXOAuthAuthorizeUrl({
        app: {
          clientId: "client-id",
          redirectUri: "http://localhost:2619/auth/x/callback"
        },
        state: "state-token",
        codeChallenge: "pkce-challenge"
      })
    );

    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("http://localhost:2619/auth/x/callback");
    expect(authorizeUrl.searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access");
    expect(authorizeUrl.searchParams.get("state")).toBe("state-token");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("writes refreshed X token only to the selected account", () => {
    const secrets = {
      version: 1,
      global_providers: {
        x_official: {
          client_id: "client-id",
          client_secret: "client-secret",
          redirect_uri: "http://localhost:2619/auth/x/callback"
        }
      },
      accounts: {
        "zh-tech": {
          x_official: {
            access_token: "old-zh-access",
            refresh_token: "old-zh-refresh"
          }
        },
        "en-tech": {
          x_official: {
            access_token: "old-en-access",
            refresh_token: "old-en-refresh"
          }
        }
      }
    } satisfies SecretsFile;

    const updated = applyXOAuthTokenResult({
      secrets,
      accountKey: "zh-tech",
      token: {
        accessToken: "new-zh-access",
        refreshToken: "new-zh-refresh",
        expiresAt: "2026-06-22T02:00:00.000Z"
      }
    });

    expect(updated.accounts["zh-tech"].x_official).toEqual({
      access_token: "new-zh-access",
      refresh_token: "new-zh-refresh",
      expires_at: "2026-06-22T02:00:00.000Z"
    });
    expect(updated.accounts["en-tech"].x_official).toEqual(secrets.accounts["en-tech"].x_official);
  });

  it("restricts local secrets files to owner read/write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "post-foundry-test-"));
    const secretsPath = join(dir, "accounts.local.json");
    await writeFile(secretsPath, "{}");

    await restrictOwnerReadWrite(secretsPath);

    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
  });

  it("redacts full tokens from log output", () => {
    const output = redactSecrets(
      'api_key="twitter-secret-token" access_token="x-secret-token" refresh_token="refresh-secret-token" client_secret="client-secret-token" Authorization: Bearer bearer-secret-token'
    );

    expect(output).not.toContain("twitter-secret-token");
    expect(output).not.toContain("x-secret-token");
    expect(output).not.toContain("refresh-secret-token");
    expect(output).not.toContain("client-secret-token");
    expect(output).not.toContain("bearer-secret-token");
  });
});

function twitterSearchFixture() {
  return {
    tweets: [
      {
        id: "post-1",
        url: "https://x.com/author_one/status/post-1",
        text: "first public post",
        retweetCount: 2,
        replyCount: 3,
        likeCount: 10,
        quoteCount: 1,
        viewCount: 100,
        bookmarkCount: 4,
        createdAt: "2026-06-22T00:00:00Z",
        author: {
          userName: "author_one",
          id: "author-1"
        }
      },
      {
        id: "post-2",
        url: "https://x.com/author_two/status/post-2",
        text: "second public post",
        retweetCount: 4,
        replyCount: 6,
        likeCount: 20,
        quoteCount: 2,
        viewCount: 200,
        bookmarkCount: 8,
        createdAt: "2026-06-22T00:01:00Z",
        author: {
          userName: "author_two",
          id: "author-2"
        }
      }
    ],
    has_next_page: false,
    next_cursor: ""
  };
}

function okJson(buildBody: (url: string, init?: RequestInit) => unknown): FetchLike {
  return async (url, init) => makeJsonResponse(200, buildBody(url, init));
}

function jsonResponse(status: number, body: unknown): FetchLike {
  return async () => makeJsonResponse(status, body);
}

function makeJsonResponse(status: number, body: unknown): Pick<Response, "ok" | "status" | "json" | "text" | "headers"> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiErrorCode,
  provider: ApiProvider
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
    provider
  } satisfies Partial<ApiError>);
}
