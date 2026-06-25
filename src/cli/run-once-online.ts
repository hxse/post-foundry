import { loadAccountInitialPrompt } from "../lib/accounts/account-prompt";
import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { resolveAccountCredentials, resolveTelegramNotificationCredentials } from "../lib/api/secrets";
import { loadAccountRegistryFromSecretsFile } from "../lib/accounts/registry";
import { parseProductionOnlineRunOnceArgs } from "../lib/orchestration/production-runner-args";
import { normalizeProductionPreflightError, runProductionLocalPreflight } from "../lib/orchestration/production-preflight";
import { createProductionOperationExecutor } from "../lib/orchestration/production-operation-executor";
import { runOnlineOperationOnce } from "../lib/orchestration/online-runner";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { checkCodexCliRuntime, CodexCliDraftGenerator } from "../lib/providers/codex-draft-generator";
import { TelegramNotifier } from "../lib/providers/telegram-notifier";
import { XOfficialPublisherClient } from "../lib/providers/x-official-publisher";
import { RuntimeRepository } from "../lib/storage/repositories";
import { printCliProgress } from "./progress-log";

async function main(): Promise<void> {
  const args = parseProductionOnlineRunOnceArgs(process.argv.slice(2));
  printCliProgress({ event: "prod_online_run_once.start", fields: { account: args.account } });
  let registry: Awaited<ReturnType<typeof loadAccountRegistryFromSecretsFile>>;
  let credentials: Awaited<ReturnType<typeof resolveAccountCredentials>>;
  let telegramCredentials: Awaited<ReturnType<typeof resolveTelegramNotificationCredentials>>;
  const loadPrompt = () => loadAccountInitialPrompt({ accountKey: args.account, secretsPath: args.secretsFile });
  try {
    printCliProgress({ event: "production_preflight.local_files.start", fields: { secrets_file: args.secretsFile } });
    registry = await loadAccountRegistryFromSecretsFile({ secretsPath: args.secretsFile });
    credentials = await resolveAccountCredentials({ accountKey: args.account, secretsPath: args.secretsFile });
    telegramCredentials = await resolveTelegramNotificationCredentials({ secretsPath: args.secretsFile });
    const preflight = await runProductionLocalPreflight({
      registry,
      accountKey: args.account,
      accountCredentials: credentials,
      telegramCredentials,
      checkCodexRuntime: () => checkCodexCliRuntime({ cwd: process.cwd(), onProgress: printCliProgress }),
      loadPrompt,
      onProgress: printCliProgress
    });
    printPreflightResult(preflight);
  } catch (error) {
    throw normalizeProductionPreflightError(error);
  }

  printCliProgress({ event: "runtime_db.open.start", fields: { db_file: args.dbFile } });
  const { openRuntimeDatabase } = await import("../lib/storage/sqlite");
  const db = openRuntimeDatabase({ path: args.dbFile });
  printCliProgress({ event: "runtime_db.open.ok", fields: { db_file: args.dbFile } });

  try {
    const repo = new RuntimeRepository(db);
    const result = await runOnlineOperationOnce({
      accountKey: args.account,
      lockDir: args.lockDir,
      lockTtlSeconds: args.lockTtlSeconds,
      lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
      lockPollIntervalMs: args.lockPollIntervalMs,
      onProgress: printCliProgress,
      operation: createProductionOperationExecutor({
        repo,
        registry,
        accountKey: args.account,
        publicXProvider: new TwitterApiIoPublicXAdapter({ apiKey: credentials.twitterApiIoApiKey }),
        draftGenerator: new CodexCliDraftGenerator({
          cwd: process.cwd(),
          sessionDir: args.codexSessionDir,
          sessionMaxAgeHours: args.codexSessionMaxAgeHours,
          onProgress: printCliProgress
        }),
        autoPoster: new XOfficialPublisherClient({ accessToken: credentials.xOfficialAccessToken }),
        notificationSender: new TelegramNotifier({
          botToken: telegramCredentials.botToken,
          chatId: telegramCredentials.notificationChannelChatId
        }),
        loadPrompt,
        maxQueries: args.sourceMaxRequests,
        perQueryLimit: args.sourcePerQueryLimit,
        oneTimePrompt: args.oneTimePrompt,
        onProgress: printCliProgress
      })
    });

    printRunResult("prod online run once", result.accountKey, result.traceId, result.outcome, result.finalAction, result.summary);
  } finally {
    db.close();
  }
}

function printPreflightResult(result: Awaited<ReturnType<typeof runProductionLocalPreflight>>): void {
  console.log("production_preflight=ready");
  console.log("account_uuid=" + result.accountUuid);
  console.log("prompt_sha256=" + result.promptSha256);
  console.log("codex_runtime=ready");
  console.log("codex_version=" + result.codexRuntime.version);
}

function printRunResult(
  label: string,
  accountKey: string,
  traceId: string,
  outcome: string,
  finalAction: string | undefined,
  summary: Record<string, unknown> | undefined
): void {
  console.log(`${label}: ok`);
  console.log(`account=${accountKey}`);
  console.log(`trace_id=${traceId}`);
  console.log(`outcome=${outcome}`);
  console.log(`final_action=${finalAction ?? "none"}`);
  if (summary) {
    console.log(`executor=${String(summary.executor ?? "unknown")}`);
    console.log(`source_collection_status=${String(summary.source_collection_status ?? "unknown")}`);
    console.log(`request_units=${String(summary.request_units ?? 0)}`);
    console.log(`material_count=${String(summary.material_count ?? 0)}`);
    if (summary.skipped_reason) {
      console.log(`skipped_reason=${String(summary.skipped_reason)}`);
    }
  }
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error(`ERROR ${error.code}`);
    console.error(`provider: ${error.provider}`);
    console.error(`stage: ${error.stage}`);
    console.error(`reason: ${redactSecrets(error.message)}`);
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
