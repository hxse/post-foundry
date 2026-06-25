import { resolveAccountRef, type AccountRegistry } from "../accounts/registry";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import { ApiError, isApiError, type ApiErrorCode } from "../api/errors";
import { derivePublicXSearchQueriesFromPrompt } from "../context/source-queries";
import { isPlaceholderSecretValue, type AccountCredentials, type OpenAiCredentials, type TelegramNotificationCredentials } from "../api/secrets";

export type ProductionLocalPreflightInput = {
  registry: AccountRegistry;
  accountKey: string;
  accountCredentials: AccountCredentials;
  openAiCredentials: OpenAiCredentials;
  telegramCredentials: TelegramNotificationCredentials;
  loadPrompt: () => Promise<AccountInitialPrompt> | AccountInitialPrompt;
};

export type ProductionLocalPreflightResult = {
  status: "ready";
  accountKey: string;
  accountUuid: string;
  promptSha256: string;
  checks: ProductionLocalPreflightCheck[];
};

export type ProductionLocalPreflightCheck = {
  key: string;
  passed: boolean;
  detail: string;
};

type PreflightFailureKind = "invalid_request" | "missing_credentials";

type PreflightFailure = {
  key: string;
  kind: PreflightFailureKind;
  detail: string;
};

export async function runProductionLocalPreflight(input: ProductionLocalPreflightInput): Promise<ProductionLocalPreflightResult> {
  let account: ReturnType<typeof resolveAccountRef>["account"];
  try {
    account = resolveAccountRef(input.registry, { accountKey: input.accountKey }).account;
  } catch (error) {
    throw normalizeProductionPreflightError(error);
  }
  const checks: ProductionLocalPreflightCheck[] = [];
  const failures: PreflightFailure[] = [];

  addCheck(checks, failures, {
    key: "account_enabled",
    passed: account.enabled,
    kind: "invalid_request",
    detail: "account must be enabled for production runs"
  });
  addCheck(checks, failures, {
    key: "public_x_enabled",
    passed: account.data_sources.public_x.enabled,
    kind: "invalid_request",
    detail: "public X source collection must be enabled"
  });
  addCheck(checks, failures, {
    key: "public_x_max_requests_per_run",
    passed: account.data_sources.public_x.max_requests_per_run > 0,
    kind: "invalid_request",
    detail: "public X max_requests_per_run must be greater than 0"
  });
  addCheck(checks, failures, {
    key: "real_posting_enabled",
    passed: account.posting.real_posting_enabled,
    kind: "invalid_request",
    detail: "account posting.real_posting_enabled must be true for v0 launch runs"
  });
  addCheck(checks, failures, {
    key: "twitterapi_io_api_key",
    passed: isUsable(input.accountCredentials.twitterApiIoApiKey),
    kind: "missing_credentials",
    detail: "TwitterAPI.io API key is required for source collection and post readback"
  });
  addCheck(checks, failures, {
    key: "openai_api_key",
    passed: isUsable(input.openAiCredentials.apiKey),
    kind: "missing_credentials",
    detail: "OpenAI API key is required for production draft generation"
  });
  addCheck(checks, failures, {
    key: "x_official_access_token",
    passed: isUsable(input.accountCredentials.xOfficialAccessToken),
    kind: "missing_credentials",
    detail: "X official access token is required because policy may choose auto-post"
  });
  addCheck(checks, failures, {
    key: "telegram_bot_token",
    passed: isUsable(input.telegramCredentials.botToken),
    kind: "missing_credentials",
    detail: "Telegram bot token is required because policy may choose human review"
  });
  addCheck(checks, failures, {
    key: "telegram_notification_channel",
    passed: isUsable(input.telegramCredentials.notificationChannelChatId),
    kind: "missing_credentials",
    detail: "Telegram notification channel is required because policy may choose human review"
  });

  if (failures.length > 0) {
    throw preflightError(failures);
  }

  let prompt: AccountInitialPrompt;
  try {
    prompt = await input.loadPrompt();
  } catch (error) {
    throw normalizeProductionPreflightError(error);
  }
  addCheck(checks, failures, {
    key: "initial_prompt",
    passed: prompt.accountKey === input.accountKey && isUsable(prompt.prompt) && /^[a-f0-9]{64}$/.test(prompt.promptSha256),
    kind: "missing_credentials",
    detail: "account initial prompt must load from local secrets and expose a sha256 hash"
  });
  const sourceQueries = derivePublicXSearchQueriesFromPrompt(prompt);
  addCheck(checks, failures, {
    key: "public_x_source_queries",
    passed: sourceQueries.length > 0,
    kind: "invalid_request",
    detail: "account initial prompt must yield at least one public X source query"
  });

  if (failures.length > 0) {
    throw preflightError(failures);
  }

  return {
    status: "ready",
    accountKey: account.account_key,
    accountUuid: account.account_uuid,
    promptSha256: prompt.promptSha256,
    checks
  };
}

function addCheck(
  checks: ProductionLocalPreflightCheck[],
  failures: PreflightFailure[],
  check: ProductionLocalPreflightCheck & { kind: PreflightFailureKind }
): void {
  checks.push({
    key: check.key,
    passed: check.passed,
    detail: check.detail
  });
  if (!check.passed) {
    failures.push({
      key: check.key,
      kind: check.kind,
      detail: check.detail
    });
  }
}

function isUsable(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0 && !isPlaceholderSecretValue(value));
}

export function normalizeProductionPreflightError(error: unknown): ApiError {
  if (isApiError(error) && error.stage === "production_preflight") {
    return error;
  }

  return new ApiError({
    code: preflightCodeFor(error),
    provider: "local",
    stage: "production_preflight",
    message: "production preflight failed: " + errorMessage(error),
    details: error
  });
}

function preflightCodeFor(error: unknown): ApiErrorCode {
  if (isApiError(error)) {
    return error.code;
  }
  return "invalid_request";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function preflightError(failures: PreflightFailure[]): ApiError {
  const code: PreflightFailureKind = failures.some((failure) => failure.kind === "missing_credentials") ? "missing_credentials" : "invalid_request";
  return new ApiError({
    code,
    provider: "local",
    stage: "production_preflight",
    message: "production preflight failed: " + failures.map((failure) => failure.key).join(", "),
    details: {
      failures
    }
  });
}
