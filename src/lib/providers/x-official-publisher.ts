import { z } from "zod";
import { ApiError, mapHttpStatus } from "../api/errors";
import { defaultFetch, type FetchLike, readJson } from "../api/http";

export type XPostInput = {
  accountKey: string;
  text: string;
  dryRun: boolean;
};

export type XPostOutput =
  | {
      status: "dry_run";
      accountKey: string;
      textLength: number;
      requestPreview: {
        method: "POST";
        path: "/2/tweets";
      };
    }
  | {
      status: "posted";
      accountKey: string;
      tweetId: string;
      textLength: number;
    };

export type XOfficialPublisherOptions = {
  accessToken?: string;
  fetcher?: FetchLike;
  baseUrl?: string;
  env?: Partial<Record<string, string | undefined>>;
};

const createTweetResponseSchema = z
  .object({
    data: z.object({
      id: z.string().min(1)
    })
  })
  .passthrough();

const meResponseSchema = z
  .object({
    data: z.object({
      id: z.string().min(1)
    })
  })
  .passthrough();

export class XOfficialPublisherClient {
  private readonly accessToken?: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;
  private readonly env: Partial<Record<string, string | undefined>>;

  constructor(options: XOfficialPublisherOptions) {
    this.accessToken = options.accessToken;
    this.fetcher = options.fetcher ?? defaultFetch();
    this.baseUrl = options.baseUrl ?? "https://api.x.com";
    this.env = options.env ?? process.env;
  }

  async verifyAccessToken(): Promise<{ status: "ok" }> {
    if (!this.accessToken) {
      throw new ApiError({
        code: "missing_credentials",
        provider: "x_official",
        stage: "verify_token",
        message: "X access token is missing"
      });
    }

    const url = new URL("/2/users/me", this.baseUrl);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "x_official",
        stage: "verify_token",
        message: "X token verification request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "x_official",
        stage: "verify_token",
        status: response.status,
        details: body
      });
    }

    const parsed = meResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "x_schema_drift",
        provider: "x_official",
        stage: "verify_token_parse",
        message: "X token verification response schema drift",
        details: parsed.error.flatten()
      });
    }

    return { status: "ok" };
  }

  async createPost(input: XPostInput): Promise<XPostOutput> {
    if (input.dryRun) {
      return {
        status: "dry_run",
        accountKey: input.accountKey,
        textLength: input.text.length,
        requestPreview: {
          method: "POST",
          path: "/2/tweets"
        }
      };
    }

    if (this.env.POST_FOUNDRY_ALLOW_REAL_X_POST !== "1") {
      throw new ApiError({
        code: "real_post_not_allowed",
        provider: "x_official",
        stage: "create_post_guard",
        message: "POST_FOUNDRY_ALLOW_REAL_X_POST must be 1 for real posting"
      });
    }

    if (!input.text.trim()) {
      throw new ApiError({
        code: "missing_post_text",
        provider: "x_official",
        stage: "create_post_guard",
        message: "post text is required for real posting"
      });
    }

    if (!this.accessToken) {
      throw new ApiError({
        code: "missing_credentials",
        provider: "x_official",
        stage: "create_post",
        message: "X access token is missing"
      });
    }

    const url = new URL("/2/tweets", this.baseUrl);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: input.text })
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "x_official",
        stage: "create_post",
        message: "X create post request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "x_official",
        stage: "create_post",
        status: response.status,
        details: body
      });
    }

    const parsed = createTweetResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "x_schema_drift",
        provider: "x_official",
        stage: "create_post_parse",
        message: "X create post response schema drift",
        details: parsed.error.flatten()
      });
    }

    return {
      status: "posted",
      accountKey: input.accountKey,
      tweetId: parsed.data.data.id,
      textLength: input.text.length
    };
  }
}
