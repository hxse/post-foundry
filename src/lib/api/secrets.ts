import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "./errors";

const providerCredentialSchema = z
  .object({
    api_key: z.string().min(1).optional()
  })
  .strict();

const xOfficialOAuthAppSchema = z
  .object({
    client_id: z.string().min(1).optional(),
    client_secret: z.string().min(1).optional(),
    redirect_uri: z.string().min(1).optional()
  })
  .strict();

const telegramNotificationSchema = z
  .object({
    bot_token: z.string().min(1).optional(),
    notification_channel_chat_id: z.string().min(1).optional()
  })
  .strict();

const accountSecretsSchema = z
  .object({
    providers: z
      .object({
        twitterapi_io: providerCredentialSchema.optional()
      })
      .strict()
      .optional(),
    x_official: z
      .object({
        access_token: z.string().min(1).optional(),
        refresh_token: z.string().min(1).optional(),
        expires_at: z.string().min(1).optional()
      })
      .strict()
      .optional()
  })
  .strict();

const secretsFileSchema = z
  .object({
    version: z.literal(1),
    global_providers: z
      .object({
        twitterapi_io: providerCredentialSchema.optional(),
        x_official: xOfficialOAuthAppSchema.optional(),
        telegram: telegramNotificationSchema.optional()
      })
      .strict()
      .optional(),
    accounts: z.record(z.string().min(1), accountSecretsSchema)
  })
  .strict();

export type SecretsFile = z.infer<typeof secretsFileSchema>;

export type AccountCredentials = {
  accountKey: string;
  twitterApiIoApiKey?: string;
  xOfficialAccessToken?: string;
  xOfficialRefreshToken?: string;
};

export type TelegramNotificationCredentials = {
  botToken?: string;
  notificationChannelChatId?: string;
};

export type CredentialEnv = Partial<Record<string, string | undefined>>;

export const defaultSecretsPath = "secrets/accounts.local.json";

export async function loadSecretsFile(path: string): Promise<SecretsFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "read_secrets",
      message: `secrets file is missing: ${path}`,
      details: error
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "parse_secrets",
      message: "secrets file JSON is invalid",
      details: error
    });
  }

  const parsed = secretsFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "parse_secrets",
      message: "secrets file schema is invalid",
      details: parsed.error.flatten()
    });
  }

  return parsed.data;
}

export async function resolveAccountCredentials(params: {
  accountKey?: string;
  secretsPath?: string;
  env?: CredentialEnv;
}): Promise<AccountCredentials> {
  const env = params.env ?? process.env;
  const accountKey = params.accountKey ?? env.X_DEBUG_ACCOUNT_KEY;
  if (!accountKey) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "resolve_account",
      message: "--account is required"
    });
  }

  const secretsPath = params.secretsPath ?? env.POST_FOUNDRY_SECRETS_FILE ?? defaultSecretsPath;
  const secrets = await loadSecretsFile(secretsPath);
  const account = secrets.accounts[accountKey];
  if (!account) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "resolve_account",
      message: `account is missing in secrets: ${accountKey}`
    });
  }

  const twitterApiIoApiKey =
    env.TWITTERAPI_IO_API_KEY ??
    account.providers?.twitterapi_io?.api_key ??
    secrets.global_providers?.twitterapi_io?.api_key;

  const xOfficialAccessToken = env.X_DEBUG_ACCESS_TOKEN ?? account.x_official?.access_token;
  const xOfficialRefreshToken = env.X_DEBUG_REFRESH_TOKEN ?? account.x_official?.refresh_token;

  return {
    accountKey,
    twitterApiIoApiKey,
    xOfficialAccessToken,
    xOfficialRefreshToken
  };
}

export async function resolveTelegramNotificationCredentials(params: {
  secretsPath?: string;
  env?: CredentialEnv;
} = {}): Promise<TelegramNotificationCredentials> {
  const env = params.env ?? process.env;
  const secretsPath = params.secretsPath ?? env.POST_FOUNDRY_SECRETS_FILE ?? defaultSecretsPath;
  const secrets = await loadSecretsFile(secretsPath);
  const telegram = secrets.global_providers?.telegram;

  return {
    botToken: env.TELEGRAM_BOT_TOKEN ?? telegram?.bot_token,
    notificationChannelChatId: env.TELEGRAM_NOTIFICATION_CHANNEL_CHAT_ID ?? telegram?.notification_channel_chat_id
  };
}
