import { readFile } from "node:fs/promises";
import { loadAccountInitialPrompt } from "../lib/accounts/account-prompt";
import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { resolveAccountCredentials, resolveOpenAiCredentials, resolveTelegramNotificationCredentials } from "../lib/api/secrets";
import { parseAccountRegistryConfig } from "../lib/accounts/registry";
import { parseProductionOnlineRunLoopArgs } from "../lib/orchestration/production-runner-args";
import { createProductionOperationExecutor } from "../lib/orchestration/production-operation-executor";
import { runOnlineOperationLoop } from "../lib/orchestration/online-runner";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { OpenAiResponsesDraftGenerator } from "../lib/providers/openai-draft-generator";
import { TelegramNotifier } from "../lib/providers/telegram-notifier";
import { XOfficialPublisherClient } from "../lib/providers/x-official-publisher";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

async function main(): Promise<void> {
  const args = parseProductionOnlineRunLoopArgs(process.argv.slice(2));
  const registry = parseAccountRegistryConfig(JSON.parse(await readFile(args.configFile, "utf8")) as unknown);
  const credentials = await resolveAccountCredentials({ accountKey: args.account, secretsPath: args.secretsFile });
  const openAiCredentials = await resolveOpenAiCredentials({ secretsPath: args.secretsFile });
  const telegramCredentials = await resolveTelegramNotificationCredentials({ secretsPath: args.secretsFile });
  const db = openRuntimeDatabase({ path: args.dbFile });

  console.log("prod online run loop: starting");
  console.log(`account=${args.account}`);
  console.log(`interval_seconds=${args.intervalSeconds}`);
  console.log(`jitter_seconds=${args.jitterSeconds}`);
  console.log(`sleep_utc=${args.sleepUtc ?? "off"}`);

  try {
    const repo = new RuntimeRepository(db);
    const result = await runOnlineOperationLoop({
      accountKey: args.account,
      intervalSeconds: args.intervalSeconds,
      jitterSeconds: args.jitterSeconds,
      sleepUtc: args.sleepUtc,
      maxIterations: args.maxIterations,
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

    console.log("prod online run loop: stopped");
    console.log(`iterations=${result.iterations}`);
    const last = result.results.at(-1);
    if (last) {
      console.log(`last_trace_id=${last.traceId}`);
      console.log(`last_outcome=${last.outcome}`);
      console.log(`last_final_action=${last.finalAction ?? "none"}`);
    }
  } finally {
    db.close();
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
