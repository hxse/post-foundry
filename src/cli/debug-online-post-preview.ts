import { loadAccountInitialPrompt } from "../lib/accounts/account-prompt";
import { loadAccountRegistryFromSecretsFile } from "../lib/accounts/registry";
import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { resolveAccountCredentials } from "../lib/api/secrets";
import { runOnlineOperationOnce, type OnlineOperationRunResult } from "../lib/orchestration/online-runner";
import { createProductionOperationExecutor, type ProductionAutoPoster } from "../lib/orchestration/production-operation-executor";
import { normalizeProductionPreflightError, runProductionLocalPreflight } from "../lib/orchestration/production-preflight";
import { parseProductionOnlineRunOnceArgs } from "../lib/orchestration/production-runner-args";
import { checkCodexCliRuntime, CodexCliDraftGenerator } from "../lib/providers/codex-draft-generator";
import type { TelegramNotificationSender } from "../lib/notifications/manual-notification";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { RuntimeRepository } from "../lib/storage/repositories";
import { printCliProgress } from "./progress-log";

async function main(): Promise<void> {
  const args = parseProductionOnlineRunOnceArgs(process.argv.slice(2));
  printCliProgress({ event: "debug_online_post_preview.start", fields: { account: args.account } });
  let registry: Awaited<ReturnType<typeof loadAccountRegistryFromSecretsFile>>;
  let credentials: Awaited<ReturnType<typeof resolveAccountCredentials>>;
  const loadPrompt = () => loadAccountInitialPrompt({ accountKey: args.account, secretsPath: args.secretsFile });

  try {
    printCliProgress({ event: "production_preflight.local_files.start", fields: { secrets_file: args.secretsFile } });
    registry = await loadAccountRegistryFromSecretsFile({ secretsPath: args.secretsFile });
    credentials = await resolveAccountCredentials({ accountKey: args.account, secretsPath: args.secretsFile });
    const preflight = await runProductionLocalPreflight({
      mode: "draft_preview",
      registry,
      accountKey: args.account,
      accountCredentials: credentials,
      telegramCredentials: {},
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
      entrypoint: "debug-online-post-preview",
      lockDir: args.lockDir,
      lockTtlSeconds: args.lockTtlSeconds,
      lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
      lockPollIntervalMs: args.lockPollIntervalMs,
      onProgress: printCliProgress,
      operation: createProductionOperationExecutor({
        mode: "preview",
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
        autoPoster: forbiddenAutoPoster(),
        notificationSender: forbiddenNotificationSender(),
        loadPrompt,
        maxQueries: args.sourceMaxRequests,
        perQueryLimit: args.sourcePerQueryLimit,
        oneTimePrompt: args.oneTimePrompt,
        onProgress: printCliProgress
      })
    });

    printPreviewResult(result);
  } finally {
    db.close();
  }
}

function forbiddenAutoPoster(): ProductionAutoPoster {
  return {
    createPost: async () => {
      throw new Error("debug-online-post-preview must not call X official createPost");
    }
  };
}

function forbiddenNotificationSender(): TelegramNotificationSender {
  return {
    sendMessage: async () => {
      throw new Error("debug-online-post-preview must not send Telegram notifications");
    }
  };
}

function printPreflightResult(result: Awaited<ReturnType<typeof runProductionLocalPreflight>>): void {
  console.log("production_preflight=ready");
  console.log("account_uuid=" + result.accountUuid);
  console.log("prompt_sha256=" + result.promptSha256);
  console.log("codex_runtime=ready");
  console.log("codex_version=" + result.codexRuntime.version);
}

function printPreviewResult(result: OnlineOperationRunResult): void {
  const summary = result.summary ?? {};
  console.log("debug online post preview: ok");
  console.log(`account=${result.accountKey}`);
  console.log(`trace_id=${result.traceId}`);
  console.log(`outcome=${result.outcome}`);
  console.log(`final_action=${result.finalAction ?? "none"}`);
  console.log(`executor=${String(summary.executor ?? "unknown")}`);
  console.log(`source_collection_status=${String(summary.source_collection_status ?? "unknown")}`);
  console.log(`request_units=${String(summary.request_units ?? 0)}`);
  console.log(`material_count=${String(summary.material_count ?? 0)}`);
  console.log(`selected_topic=${String(summary.selected_topic_label ?? "unknown")}`);
  console.log(`policy_outcome=${String(summary.preview_policy_outcome ?? summary.policy_outcome ?? "unknown")}`);
  console.log(`policy_route=${String(summary.preview_policy_route ?? summary.policy_route ?? "unknown")}`);
  if (summary.skipped_reason) {
    console.log(`skipped_reason=${String(summary.skipped_reason)}`);
  }
  if (typeof summary.preview_post_text === "string" && summary.preview_post_text.trim().length > 0) {
    console.log("post_text_begin");
    console.log(summary.preview_post_text);
    console.log("post_text_end");
  } else {
    console.log("post_text_unavailable=true");
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
