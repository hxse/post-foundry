import { z } from "zod";
import { ApiError, mapHttpStatus } from "../api/errors";
import { defaultFetch, type FetchLike, readJson } from "../api/http";

export type TelegramNotifierOptions = {
  botToken?: string;
  chatId?: string;
  fetcher?: FetchLike;
  baseUrl?: string;
};

export type TelegramBotIdentity = {
  id: number;
  username?: string;
  firstName: string;
};

export type TelegramSendMessageInput = {
  text: string;
  disableWebPagePreview?: boolean;
};

export type TelegramSentMessage = {
  messageId: number;
  chatId: number | string;
};

const telegramGetMeResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z
      .object({
        id: z.number(),
        is_bot: z.boolean(),
        first_name: z.string(),
        username: z.string().optional()
      })
      .optional(),
    description: z.string().optional(),
    error_code: z.number().optional()
  })
  .passthrough();

const telegramSendMessageResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z
      .object({
        message_id: z.number(),
        chat: z
          .object({
            id: z.union([z.number(), z.string()])
          })
          .passthrough()
      })
      .passthrough()
      .optional(),
    description: z.string().optional(),
    error_code: z.number().optional()
  })
  .passthrough();

export class TelegramNotifier {
  private readonly botToken?: string;
  private readonly chatId?: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: TelegramNotifierOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetcher = options.fetcher ?? defaultFetch();
    this.baseUrl = options.baseUrl ?? "https://api.telegram.org";
  }

  async getMe(): Promise<TelegramBotIdentity> {
    const body = await this.request("getMe", {}, "get_me");
    const parsed = telegramGetMeResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "telegram",
        stage: "get_me_response_parse",
        message: "Telegram getMe response schema drift",
        details: parsed.error.flatten()
      });
    }
    if (!parsed.data.ok || !parsed.data.result) {
      throw telegramApiError("get_me_response", parsed.data.error_code, parsed.data.description);
    }

    return {
      id: parsed.data.result.id,
      username: parsed.data.result.username,
      firstName: parsed.data.result.first_name
    };
  }

  async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage> {
    const text = input.text.trim();
    if (!text) {
      throw new ApiError({
        code: "missing_post_text",
        provider: "telegram",
        stage: "send_message_request",
        message: "Telegram notification text is required"
      });
    }
    if (text.length > 4096) {
      throw new ApiError({
        code: "invalid_request",
        provider: "telegram",
        stage: "send_message_request",
        message: "Telegram notification text must be at most 4096 characters"
      });
    }

    const body = await this.request(
      "sendMessage",
      {
        chat_id: requireValue(this.chatId, "notification_channel_chat_id"),
        text,
        disable_web_page_preview: input.disableWebPagePreview ?? true
      },
      "send_message"
    );
    const parsed = telegramSendMessageResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "telegram",
        stage: "send_message_response_parse",
        message: "Telegram sendMessage response schema drift",
        details: parsed.error.flatten()
      });
    }
    if (!parsed.data.ok || !parsed.data.result) {
      throw telegramApiError("send_message_response", parsed.data.error_code, parsed.data.description);
    }

    return {
      messageId: parsed.data.result.message_id,
      chatId: parsed.data.result.chat.id
    };
  }

  private async request(method: string, payload: Record<string, unknown>, stage: string): Promise<unknown> {
    const botToken = requireValue(this.botToken, "bot_token");
    const url = new URL(`/bot${botToken}/${method}`, this.baseUrl);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "telegram",
        stage,
        message: "Telegram Bot API network request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "telegram",
        stage,
        status: response.status,
        details: body
      });
    }

    return body;
  }
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "telegram",
      stage: "telegram_credentials",
      message: `Telegram ${label} is missing`
    });
  }
  return value;
}

function telegramApiError(stage: string, errorCode: number | undefined, description: string | undefined): ApiError {
  return new ApiError({
    code: errorCode === 401 ? "unauthorized" : errorCode === 403 ? "forbidden" : errorCode === 429 ? "rate_limited" : "provider_error",
    provider: "telegram",
    stage,
    status: errorCode,
    message: description ? `Telegram Bot API error: ${description}` : "Telegram Bot API error"
  });
}
