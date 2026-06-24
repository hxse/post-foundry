import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../api/errors";

const accountUuidSchema = z.string().uuid();
const accountKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/, "account_key must use lowercase letters, numbers, '-' or '_'");
const isoDateTimeSchema = z.string().datetime();
const auditActorSchema = z.string().trim().min(1);

function uniqueStringList(minItems = 0): z.ZodEffects<z.ZodArray<z.ZodString>, string[], string[]> {
  return z
    .array(z.string().min(1))
    .min(minItems)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const value of values) {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate value: ${value}`
          });
          return;
        }
        seen.add(value);
      }
    });
}

const topicsSchema = z
  .object({
    include: uniqueStringList(1),
    exclude: uniqueStringList().default([])
  })
  .strict()
  .superRefine((topics, context) => {
    const excluded = new Set(topics.exclude);
    const overlap = topics.include.find((topic) => excluded.has(topic));
    if (overlap) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `topic cannot be both included and excluded: ${overlap}`
      });
    }
  });

const postingPolicySchema = z
  .object({
    cadence_hours: z.number().positive(),
    daily_min: z.number().int().nonnegative(),
    daily_max: z.number().int().nonnegative(),
    cooldown_minutes: z.number().int().nonnegative().default(0),
    require_approval: z.boolean(),
    real_posting_enabled: z.boolean().default(false)
  })
  .strict()
  .superRefine((posting, context) => {
    if (posting.daily_min > posting.daily_max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "daily_min cannot exceed daily_max"
      });
    }
  });

const dataSourcesSchema = z
  .object({
    public_x: z
      .object({
        provider: z.enum(["twitterapi.io"]),
        enabled: z.boolean(),
        search_keywords: uniqueStringList().default([]),
        monthly_request_cap: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const stylePolicySchema = z
  .object({
    voice: z.string().min(1),
    rules: uniqueStringList().default([]),
    banned_phrases: uniqueStringList().default([])
  })
  .strict();

const accountConfigSchema = z
  .object({
    account_uuid: accountUuidSchema,
    account_key: accountKeySchema,
    display_name: z.string().min(1),
    platform: z.literal("x"),
    language: z.string().min(2),
    enabled: z.boolean(),
    config_version: z.number().int().positive(),
    topics: topicsSchema,
    posting: postingPolicySchema,
    data_sources: dataSourcesSchema,
    style: stylePolicySchema
  })
  .strict();

const xIdentitySchema = z
  .object({
    account_uuid: accountUuidSchema,
    x_user_id: z.string().min(1).optional(),
    x_handle: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_]{1,15}$/, "x_handle must not include @")
      .optional(),
    oauth_token_status: z.enum(["missing", "authorized", "expired", "revoked", "unknown"]),
    last_verified_at: z.string().datetime().optional()
  })
  .strict();

const globalAccountConfigSchema = z
  .object({
    default_timezone: z.string().min(1).default("UTC"),
    default_language: z.string().min(2).default("en-US"),
    safety: z
      .object({
        online_debug_requires_user_request: z.literal(true),
        x_browser_access: z.literal("forbidden")
      })
      .strict()
  })
  .strict();

const accountRegistryConfigSchema = z
  .object({
    version: z.literal(1),
    global: globalAccountConfigSchema,
    accounts: z.array(accountConfigSchema).min(1),
    x_identities: z.array(xIdentitySchema).default([])
  })
  .strict()
  .superRefine((config, context) => {
    assertUnique(config.accounts.map((account) => account.account_uuid), "account_uuid", context);
    assertUnique(config.accounts.map((account) => account.account_key), "account_key", context);
    assertUnique(config.x_identities.map((identity) => identity.account_uuid), "x_identity.account_uuid", context);

    const accountUuids = new Set(config.accounts.map((account) => account.account_uuid));
    for (const identity of config.x_identities) {
      if (!accountUuids.has(identity.account_uuid)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `x_identity references unknown account_uuid: ${identity.account_uuid}`
        });
      }
    }
  });

export type AccountConfig = z.infer<typeof accountConfigSchema>;
export type XIdentity = z.infer<typeof xIdentitySchema>;
export type AccountRegistryConfig = z.infer<typeof accountRegistryConfigSchema>;
export type AccountRegistry = {
  config: AccountRegistryConfig;
  accountByUuid: ReadonlyMap<string, AccountConfig>;
  accountUuidByKey: ReadonlyMap<string, string>;
  identityByUuid: ReadonlyMap<string, XIdentity>;
};

export type AccountRef = {
  accountUuid?: string;
  accountKey?: string;
};

export type AccountResolution = {
  account: AccountConfig;
  xIdentity?: XIdentity;
};

export type AccountConfigSnapshot = {
  account_uuid: string;
  account_key: string;
  config_version: number;
  config_hash: string;
  captured_at: string;
  payload: {
    global: AccountRegistryConfig["global"];
    account: AccountConfig;
    x_identity?: XIdentity;
  };
};

export type AccountKeyRenameAuditRecord = {
  type: "account_key_renamed";
  account_uuid: string;
  previous_account_key: string;
  next_account_key: string;
  actor: string;
  at: string;
};

export function parseAccountRegistryConfig(input: unknown): AccountRegistry {
  const parsed = accountRegistryConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "account_registry_config",
      message: "account registry config schema is invalid",
      details: parsed.error.flatten()
    });
  }

  return buildAccountRegistry(parsed.data);
}

export function resolveAccountRef(registry: AccountRegistry, ref: AccountRef): AccountResolution {
  if (!ref.accountUuid && !ref.accountKey) {
    throw accountRegistryError("invalid_request", "account_ref must include account_uuid or account_key");
  }

  const accountFromUuid = ref.accountUuid ? registry.accountByUuid.get(ref.accountUuid) : undefined;
  const uuidFromKey = ref.accountKey ? registry.accountUuidByKey.get(ref.accountKey) : undefined;
  const accountFromKey = uuidFromKey ? registry.accountByUuid.get(uuidFromKey) : undefined;

  if (ref.accountUuid && ref.accountKey) {
    if (!accountFromUuid || !accountFromKey || accountFromUuid.account_uuid !== accountFromKey.account_uuid) {
      throw accountRegistryError("invalid_request", "account_uuid and account_key refer to different accounts");
    }
  }

  const account = accountFromUuid ?? accountFromKey;
  if (!account) {
    throw accountRegistryError("missing_credentials", "account is missing in account registry");
  }

  return {
    account,
    xIdentity: registry.identityByUuid.get(account.account_uuid)
  };
}

export function createAccountConfigSnapshot(params: {
  registry: AccountRegistry;
  ref: AccountRef;
  capturedAt: string;
}): AccountConfigSnapshot {
  const resolution = resolveAccountRef(params.registry, params.ref);
  const capturedAt = parseIsoDateTime(params.capturedAt, "capturedAt");
  const payload = {
    global: params.registry.config.global,
    account: resolution.account,
    x_identity: resolution.xIdentity
  };

  return {
    account_uuid: resolution.account.account_uuid,
    account_key: resolution.account.account_key,
    config_version: resolution.account.config_version,
    config_hash: sha256Stable(payload),
    captured_at: capturedAt,
    payload
  };
}

export function renameAccountKey(params: {
  registry: AccountRegistry;
  accountUuid: string;
  nextAccountKey: string;
  actor: string;
  at: string;
}): { registry: AccountRegistry; auditRecord: AccountKeyRenameAuditRecord } {
  const account = resolveAccountRef(params.registry, { accountUuid: params.accountUuid }).account;
  const parsedKey = accountKeySchema.safeParse(params.nextAccountKey);
  if (!parsedKey.success) {
    throw accountRegistryError("invalid_request", "next account_key is invalid");
  }

  const existingUuid = params.registry.accountUuidByKey.get(params.nextAccountKey);
  if (existingUuid && existingUuid !== account.account_uuid) {
    throw accountRegistryError("invalid_request", `account_key is already used: ${params.nextAccountKey}`);
  }

  const actor = parseAuditActor(params.actor);
  const at = parseIsoDateTime(params.at, "at");
  const nextConfig: AccountRegistryConfig = {
    ...params.registry.config,
    accounts: params.registry.config.accounts.map((candidate) =>
      candidate.account_uuid === account.account_uuid
        ? {
            ...candidate,
            account_key: params.nextAccountKey,
            config_version: candidate.config_version + 1
          }
        : candidate
    )
  };

  return {
    registry: buildAccountRegistry(nextConfig),
    auditRecord: {
      type: "account_key_renamed",
      account_uuid: account.account_uuid,
      previous_account_key: account.account_key,
      next_account_key: params.nextAccountKey,
      actor,
      at
    }
  };
}

function buildAccountRegistry(config: AccountRegistryConfig): AccountRegistry {
  return {
    config,
    accountByUuid: new Map(config.accounts.map((account) => [account.account_uuid, account])),
    accountUuidByKey: new Map(config.accounts.map((account) => [account.account_key, account.account_uuid])),
    identityByUuid: new Map(config.x_identities.map((identity) => [identity.account_uuid, identity]))
  };
}

function assertUnique(values: string[], label: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate ${label}: ${value}`
      });
      return;
    }
    seen.add(value);
  }
}

function accountRegistryError(code: "invalid_request" | "missing_credentials", message: string): ApiError {
  return new ApiError({
    code,
    provider: "local",
    stage: "account_registry",
    message
  });
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw accountRegistryError("invalid_request", `${field} must be an ISO datetime`);
  }

  return parsed.data;
}

function parseAuditActor(value: string): string {
  const parsed = auditActorSchema.safeParse(value);
  if (!parsed.success) {
    throw accountRegistryError("invalid_request", "actor must be non-empty");
  }

  return parsed.data;
}

function sha256Stable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
