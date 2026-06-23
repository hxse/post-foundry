import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecrets, tokenFingerprint } from "../src/lib/api/redaction";
import { loadSecretsFile, resolveTelegramNotificationCredentials } from "../src/lib/api/secrets";
import { findTelegramNotificationTextViolation } from "../src/lib/notifications/telegram-text-policy";
import { TelegramNotifier } from "../src/lib/providers/telegram-notifier";

describe("telegram notification connectivity harness", () => {
  it("parses Telegram notification credentials from local secrets and env overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "post-foundry-tg-"));
    const path = join(dir, "accounts.local.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          global_providers: {
            telegram: {
              bot_token: "123456:example-token",
              notification_channel_chat_id: "@example_channel"
            }
          },
          accounts: {}
        })
      );

      const secrets = await loadSecretsFile(path);
      expect(secrets.global_providers?.telegram?.notification_channel_chat_id).toBe("@example_channel");
      await expect(resolveTelegramNotificationCredentials({ secretsPath: path })).resolves.toEqual({
        botToken: "123456:example-token",
        notificationChannelChatId: "@example_channel"
      });
      await expect(
        resolveTelegramNotificationCredentials({
          secretsPath: path,
          env: {
            TELEGRAM_BOT_TOKEN: "654321:env-token",
            TELEGRAM_NOTIFICATION_CHANNEL_CHAT_ID: "-1001234567890"
          }
        })
      ).resolves.toEqual({
        botToken: "654321:env-token",
        notificationChannelChatId: "-1001234567890"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds Telegram getMe and sendMessage requests without a Telegram library", async () => {
    const seen: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      seen.push({ input, init });
      if (input.endsWith("/getMe")) {
        return jsonResponse({
          ok: true,
          result: {
            id: 42,
            is_bot: true,
            first_name: "PostFoundry",
            username: "post_foundry_bot"
          }
        });
      }
      return jsonResponse({
        ok: true,
        result: {
          message_id: 1001,
          chat: {
            id: -1001234567890
          }
        }
      });
    };
    const notifier = new TelegramNotifier({
      botToken: "123456:example-token",
      chatId: "@example_channel",
      fetcher
    });

    await expect(notifier.getMe()).resolves.toEqual({
      id: 42,
      username: "post_foundry_bot",
      firstName: "PostFoundry"
    });
    await expect(
      notifier.sendMessage({
        text: "把复杂的事情记录下来，才有机会让判断慢慢变好。"
      })
    ).resolves.toEqual({
      messageId: 1001,
      chatId: -1001234567890
    });

    expect(seen[0].input).toBe("https://api.telegram.org/bot123456:example-token/getMe");
    expect(seen[1].input).toBe("https://api.telegram.org/bot123456:example-token/sendMessage");
    expect(JSON.parse(String(seen[1].init?.body))).toEqual({
      chat_id: "@example_channel",
      text: "把复杂的事情记录下来，才有机会让判断慢慢变好。",
      disable_web_page_preview: true
    });
  });

  it("maps Telegram API errors and missing credentials to ApiError", async () => {
    const missing = new TelegramNotifier({});
    await expect(missing.getMe()).rejects.toMatchObject({
      code: "missing_credentials",
      provider: "telegram",
      stage: "telegram_credentials"
    });

    const forbidden = new TelegramNotifier({
      botToken: "123456:example-token",
      chatId: "@example_channel",
      fetcher: async () =>
        jsonResponse({
          ok: false,
          error_code: 403,
          description: "Forbidden: bot is not a member of the channel chat"
        })
    });
    await expect(forbidden.sendMessage({ text: "自然一点的通知文本。" })).rejects.toMatchObject({
      code: "forbidden",
      provider: "telegram",
      stage: "send_message_response",
      status: 403
    });
  });

  it("blocks obvious smoke/debug notification text", () => {
    expect(findTelegramNotificationTextViolation("PostFoundry .006 smoke test")).toMatch(/smoke/);
    expect(findTelegramNotificationTextViolation("task 20260622A.006 debug")).toMatch(/smoke/);
    expect(findTelegramNotificationTextViolation("把复杂的事情记录下来，才有机会让判断慢慢变好。")).toBeUndefined();
  });

  it("redacts bot token style secrets", () => {
    expect(tokenFingerprint("123456:example-token")).toBe("1234...oken");
    expect(redactSecrets('bot_token="123456:example-token"')).toBe("[redacted]");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}
