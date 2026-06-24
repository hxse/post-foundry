import { readFile } from "node:fs/promises";
import { loadAccountInitialPrompt } from "../lib/accounts/account-prompt";
import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { resolveAccountCredentials, resolveOpenAiCredentials, resolveTelegramNotificationCredentials } from "../lib/api/secrets";
import { parseAccountRegistryConfig } from "../lib/accounts/registry";
import { parseProductionOnlineRunOnceArgs } from "../lib/orchestration/production-runner-args";
import { createProductionOperationExecutor } from "../lib/orchestration/production-operation-executor";
import { runOnlineOperationOnce } from "../lib/orchestration/online-runner";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { OpenAiResponsesDraftGenerator } from "../lib/providers/openai-draft-generator";
import { TelegramNotifier } from "../lib/providers/telegram-notifier";
import { XOfficialPublisherClient } from "../lib/providers/x-official-publisher";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

async function main(): Promise<void> {
  const args = parseProductionOnlineRunOnceArgs(process.argv.slice(2));
  const registry = parseAccountRegistryConfig(JSON.parse(await readFile(args.configFile, "utf8")) as unknown);
  const credentials = await resolveAccountCredentials({ accountKey: args.account, secretsPath: args.secretsFile });
  const openAiCredentials = await resolveOpenAiCredentials({ secretsPath: args.secretsFile });
  const telegramCredentials = await resolveTelegramNotificationCredentials({ secretsPath: args.secretsFile });
  const db = openRuntimeDatabase({ path: args.dbFile });

  try {
    const repo = new RuntimeRepository(db);
    const result = await runOnlineOperationOnce({
      accountKey: args.account,
      lockDir: args.lockDir,
      lockTtlSeconds: args.lockTtlSeconds,
      lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
      lockPollIntervalMs: args.lockPollIntervalMs,
      operation: createProductionOperationExecutor({
        repo,
        registry,
        accountKey: args.account,
        publicXProvider: new TwitterApiIoPublicXAdapter({ apiKey: credentials.twitterApiIoApiKey }),
        draftGenerator: new OpenAiResponsesDraftGenerator({
          apiKey: openAiCredentials.apiKey,
          model: openAiCredentials.model,
          baseUrl: openAiCredentials.baseUrl
        }),
        autoPoster: new XOfficialPublisherClient({ accessToken: credentials.xOfficialAccessToken }),
        notificationSender: new TelegramNotifier({
          botToken: telegramCredentials.botToken,
          chatId: telegramCredentials.notificationChannelChatId
        }),
        loadPrompt: () => loadAccountInitialPrompt({ accountKey: args.account, secretsPath: args.secretsFile }),
        maxQueries: args.sourceMaxQueries,
        perQueryLimit: args.sourcePerQueryLimit
      })
    });

    printRunResult("prod online run once", result.accountKey, result.traceId, result.outcome, result.finalAction, result.summary);
  } finally {
    db.close();
  }
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
