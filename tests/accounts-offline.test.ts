import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/errors";
import accountsExample from "./fixtures/accounts";
import {
  buildAccountRegistryFromSecrets,
  createAccountConfigSnapshot,
  deriveAccountUuidFromAccountKey,
  parseAccountRegistryConfig,
  renameAccountKey,
  resolveAccountRef
} from "../src/lib/accounts/registry";

describe("account registry and config isolation", () => {
  it("parses the example registry and resolves accounts through trusted keys", () => {
    const registry = parseAccountRegistryConfig(accountsExample);
    const zh = resolveAccountRef(registry, { accountKey: "zh-tech" });

    expect(zh.account.account_uuid).toBe("018f8a6d-7f31-7b0a-a8b2-1c0adca0e001");
    expect(zh.account.data_sources.public_x.max_requests_per_run).toBe(30);
    expect(zh.account.data_sources.public_x.provider).toBe("twitterapi.io");
    expect(zh.xIdentity?.oauth_token_status).toBe("missing");

    const same = resolveAccountRef(registry, {
      accountUuid: zh.account.account_uuid,
      accountKey: "zh-tech"
    });
    expect(same.account).toEqual(zh.account);
  });

  it("rejects duplicate account keys and duplicate account uuids", () => {
    const duplicateKey = {
      ...accountsExample,
      accounts: accountsExample.accounts.map((account, index) =>
        index === 1
          ? {
              ...account,
              account_key: "zh-tech"
            }
          : account
      )
    };

    expectLocalError(() => parseAccountRegistryConfig(duplicateKey), "invalid_request");

    const duplicateUuid = {
      ...accountsExample,
      accounts: accountsExample.accounts.map((account, index) =>
        index === 1
          ? {
              ...account,
              account_uuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001"
            }
          : account
      )
    };

    expectLocalError(() => parseAccountRegistryConfig(duplicateUuid), "invalid_request");
  });

  it("rejects sensitive token fields in non-sensitive account config", () => {
    const withToken = {
      ...accountsExample,
      x_identities: [
        {
          ...accountsExample.x_identities[0],
          access_token: "must-not-be-here"
        }
      ]
    };

    expectLocalError(() => parseAccountRegistryConfig(withToken), "invalid_request");
  });

  it("renames account_key without changing account_uuid or x identity ownership", () => {
    const registry = parseAccountRegistryConfig(accountsExample);
    const renamed = renameAccountKey({
      registry,
      accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
      nextAccountKey: "cn-ai-finance",
      actor: "operator",
      at: "2026-06-22T12:00:00.000Z"
    });

    const account = resolveAccountRef(renamed.registry, { accountKey: "cn-ai-finance" });
    expect(account.account.account_uuid).toBe("018f8a6d-7f31-7b0a-a8b2-1c0adca0e001");
    expect(account.account.config_version).toBe(2);
    expect(account.xIdentity?.x_handle).toBe("example_zh");
    expectLocalError(() => resolveAccountRef(renamed.registry, { accountKey: "zh-tech" }), "missing_credentials");
    expect(renamed.auditRecord).toEqual({
      type: "account_key_renamed",
      account_uuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
      previous_account_key: "zh-tech",
      next_account_key: "cn-ai-finance",
      actor: "operator",
      at: "2026-06-22T12:00:00.000Z"
    });
  });

  it("creates account config snapshots keyed by account_uuid and version", () => {
    const registry = parseAccountRegistryConfig(accountsExample);
    const first = createAccountConfigSnapshot({
      registry,
      ref: { accountKey: "zh-tech" },
      capturedAt: "2026-06-22T12:00:00.000Z"
    });

    const changed = parseAccountRegistryConfig({
      ...accountsExample,
      accounts: accountsExample.accounts.map((account) =>
        account.account_key === "zh-tech"
          ? {
              ...account,
              config_version: 2,
              data_sources: {
                ...account.data_sources,
                public_x: {
                  ...account.data_sources.public_x,
                  max_requests_per_run: account.data_sources.public_x.max_requests_per_run + 1
                }
              }
            }
          : account
      )
    });
    const second = createAccountConfigSnapshot({
      registry: changed,
      ref: { accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001" },
      capturedAt: "2026-06-22T12:00:00.000Z"
    });

    expect(first.account_uuid).toBe("018f8a6d-7f31-7b0a-a8b2-1c0adca0e001");
    expect(first.config_version).toBe(1);
    expect(second.config_version).toBe(2);
    expect(second.config_hash).not.toBe(first.config_hash);
  });

  it("rejects invalid snapshot timestamps", () => {
    const registry = parseAccountRegistryConfig(accountsExample);

    expectLocalError(
      () =>
        createAccountConfigSnapshot({
          registry,
          ref: { accountKey: "zh-tech" },
          capturedAt: "not-a-date"
        }),
      "invalid_request"
    );
  });

  it("rejects invalid rename audit actor and timestamp", () => {
    const registry = parseAccountRegistryConfig(accountsExample);

    expectLocalError(
      () =>
        renameAccountKey({
          registry,
          accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
          nextAccountKey: "cn-ai-finance",
          actor: " ",
          at: "2026-06-22T12:00:00.000Z"
        }),
      "invalid_request"
    );

    expectLocalError(
      () =>
        renameAccountKey({
          registry,
          accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
          nextAccountKey: "cn-ai-finance",
          actor: "operator",
          at: "not-a-date"
        }),
      "invalid_request"
    );
  });

  it("rejects mismatched account_uuid and account_key refs", () => {
    const registry = parseAccountRegistryConfig(accountsExample);

    expectLocalError(
      () =>
        resolveAccountRef(registry, {
          accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
          accountKey: "en-tech"
        }),
      "invalid_request"
    );

    expectLocalError(
      () =>
        resolveAccountRef(registry, {
          accountUuid: "018f8a6d-7f31-7b0a-a8b2-1c0adca0ffff",
          accountKey: "zh-tech"
        }),
      "invalid_request"
    );
  });
  it("builds the internal registry from secrets profile without user-supplied UUID", async () => {
    const root = await mkdtemp(join(tmpdir(), "post-foundry-account-profile-"));
    try {
      await mkdir(join(root, "secrets", "profiles"), { recursive: true });
      await writeFile(
        join(root, "secrets", "profiles", "zh-tech.json"),
        JSON.stringify({
          posting: {
            cadence_hours: 6,
            daily_min: 3,
            daily_max: 4,
            cooldown_minutes: 90,
            require_approval: false,
            real_posting_enabled: false
          },
          source: {
            max_requests_per_run: 2
          }
        }),
        "utf8"
      );

      const registry = await buildAccountRegistryFromSecrets({
        cwd: root,
        secrets: {
          version: 1,
          accounts: {
            "zh-tech": {
              profile_path: "secrets/profiles/zh-tech.json",
              initial_prompt_path: "secrets/prompts/zh-tech.md"
            }
          }
        }
      });
      const account = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;

      expect(account.account_uuid).toBe(deriveAccountUuidFromAccountKey("zh-tech"));
      expect(account.account_key).toBe("zh-tech");
      expect(account.data_sources.public_x.max_requests_per_run).toBe(2);
      expect(account.topics.include).toEqual([]);
      expect(account.style.banned_phrases).toEqual(["smoke test", "PostFoundry"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});

function expectLocalError(fn: () => unknown, code: "invalid_request" | "missing_credentials"): void {
  try {
    fn();
    throw new Error("expected ApiError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.provider).toBe("local");
    expect(apiError.code).toBe(code);
  }
}
