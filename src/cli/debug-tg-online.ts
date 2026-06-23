import { ApiError, isApiError } from "../lib/api/errors";
import type { FetchLike } from "../lib/api/http";
import { redactSecrets, tokenFingerprint } from "../lib/api/redaction";
import { resolveTelegramNotificationCredentials } from "../lib/api/secrets";
import { findTelegramNotificationTextViolation } from "../lib/notifications/telegram-text-policy";
import { TelegramNotifier } from "../lib/providers/telegram-notifier";

type CliArgs = {
  send: boolean;
  message?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message ?? process.env.TELEGRAM_DEBUG_MESSAGE;

  if (!args.send) {
    console.log("telegram notification: dry-run");
    console.log(`message_length=${message?.trim().length ?? 0}`);
    console.log("send: skipped, --send was not supplied");
    return;
  }

  const violation = findTelegramNotificationTextViolation(message ?? "");
  if (violation) {
    throw new ApiError({
      code: "invalid_request",
      provider: "telegram",
      stage: "notification_text_policy",
      message: violation
    });
  }

  const credentials = await resolveTelegramNotificationCredentials();
  console.log(
    `telegram credentials: bot=${tokenFingerprint(credentials.botToken)}, notification_channel=${credentials.notificationChannelChatId ? "configured" : "missing"}`
  );

  const notifier = new TelegramNotifier({
    botToken: credentials.botToken,
    chatId: credentials.notificationChannelChatId,
    fetcher: buildDebugFetcher(process.env)
  });

  const bot = await notifier.getMe();
  console.log(`telegram getMe: ok, bot=@${bot.username ?? "unknown"}, id=${bot.id}`);

  const sent = await notifier.sendMessage({
    text: message ?? "",
    disableWebPagePreview: true
  });
  console.log(`telegram sendMessage: ok, message_id=${sent.messageId}`);
  console.log("manual_confirmation: please confirm the notification appeared in the Telegram channel");
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    send: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--send") {
      args.send = true;
    } else if (arg === "--message") {
      args.message = readValue(argv, ++index, "--message");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function buildDebugFetcher(env: NodeJS.ProcessEnv): FetchLike | undefined {
  const timeoutMs = resolveDebugTimeoutMs(env);
  if (!timeoutMs) {
    return undefined;
  }

  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function resolveDebugTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.POST_FOUNDRY_TG_DEBUG_TIMEOUT_MS;
  if (!raw) {
    return undefined;
  }

  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new ApiError({
      code: "invalid_request",
      provider: "telegram",
      stage: "debug_timeout",
      message: "POST_FOUNDRY_TG_DEBUG_TIMEOUT_MS must be a positive integer"
    });
  }

  return timeoutMs;
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error(`ERROR ${error.code}`);
    console.error(`provider: ${error.provider}`);
    console.error(`stage: ${error.stage}`);
    if (error.status) {
      console.error(`status: ${error.status}`);
    }
    console.error(`reason: ${redactSecrets(error.message)}`);
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
