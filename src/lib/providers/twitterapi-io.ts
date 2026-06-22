import { z } from "zod";
import { ApiError, mapHttpStatus } from "../api/errors";
import { defaultFetch, type FetchLike, readJson } from "../api/http";
import type { PublicXDataProvider, PublicXPostSnapshot, PublicXSearchInput, PublicXSearchOutput } from "./public-x";

const twitterApiIoTweetSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().optional(),
    text: z.string(),
    retweetCount: z.number().optional(),
    replyCount: z.number().optional(),
    likeCount: z.number().optional(),
    quoteCount: z.number().optional(),
    viewCount: z.number().optional(),
    bookmarkCount: z.number().optional(),
    createdAt: z.string().optional(),
    authorHandle: z.string().optional(),
    authorId: z.string().optional(),
    author: z
      .object({
        userName: z.string().optional(),
        id: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const twitterApiIoSearchResponseSchema = z
  .object({
    tweets: z.array(twitterApiIoTweetSchema)
  })
  .passthrough();

const twitterApiIoTweetLookupResponseSchema = z
  .object({
    tweets: z.array(twitterApiIoTweetSchema),
    status: z.enum(["success", "error"]),
    message: z.string()
  })
  .passthrough();

export type TwitterApiIoPublicXAdapterOptions = {
  apiKey?: string;
  fetcher?: FetchLike;
  baseUrl?: string;
};

export class TwitterApiIoPublicXAdapter implements PublicXDataProvider {
  private readonly apiKey?: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: TwitterApiIoPublicXAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? defaultFetch();
    this.baseUrl = options.baseUrl ?? "https://api.twitterapi.io";
  }

  async searchPosts(input: PublicXSearchInput): Promise<PublicXSearchOutput> {
    if (!this.apiKey) {
      throw new ApiError({
        code: "missing_credentials",
        provider: "twitterapi.io",
        stage: "search_request",
        message: "TwitterAPI.io API key is missing"
      });
    }

    if (!input.query.trim()) {
      throw new ApiError({
        code: "invalid_request",
        provider: "twitterapi.io",
        stage: "search_request",
        message: "query is required"
      });
    }

    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
      throw new ApiError({
        code: "invalid_request",
        provider: "twitterapi.io",
        stage: "search_request",
        message: "limit must be an integer from 1 to 10"
      });
    }

    const url = new URL("/twitter/tweet/advanced_search", this.baseUrl);
    url.searchParams.set("query", input.query);
    url.searchParams.set("queryType", "Latest");
    url.searchParams.set("cursor", "");

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey
        }
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "twitterapi.io",
        stage: "search_request",
        message: "TwitterAPI.io network request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "twitterapi.io",
        stage: "search_response",
        status: response.status,
        details: body
      });
    }

    const parsed = twitterApiIoSearchResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "twitterapi.io",
        stage: "search_response_parse",
        message: "TwitterAPI.io search response schema drift",
        details: parsed.error.flatten()
      });
    }

    const posts = parsed.data.tweets.slice(0, input.limit).map(mapTweet);
    return {
      posts,
      sourceProvider: "twitterapi.io",
      rawCount: parsed.data.tweets.length
    };
  }

  async getPostById(id: string): Promise<PublicXPostSnapshot | undefined> {
    if (!this.apiKey) {
      throw new ApiError({
        code: "missing_credentials",
        provider: "twitterapi.io",
        stage: "tweet_lookup_request",
        message: "TwitterAPI.io API key is missing"
      });
    }

    if (!id.trim()) {
      throw new ApiError({
        code: "invalid_request",
        provider: "twitterapi.io",
        stage: "tweet_lookup_request",
        message: "tweet id is required"
      });
    }

    const url = new URL("/twitter/tweets", this.baseUrl);
    url.searchParams.set("tweet_ids", id);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey
        }
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "twitterapi.io",
        stage: "tweet_lookup_request",
        message: "TwitterAPI.io tweet lookup request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "twitterapi.io",
        stage: "tweet_lookup_response",
        status: response.status,
        details: body
      });
    }

    const parsed = twitterApiIoTweetLookupResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "twitterapi.io",
        stage: "tweet_lookup_response_parse",
        message: "TwitterAPI.io tweet lookup response schema drift",
        details: parsed.error.flatten()
      });
    }

    if (parsed.data.status !== "success") {
      throw new ApiError({
        code: "provider_error",
        provider: "twitterapi.io",
        stage: "tweet_lookup_response",
        message: `TwitterAPI.io tweet lookup returned error: ${parsed.data.message}`,
        details: {
          status: parsed.data.status,
          message: parsed.data.message
        }
      });
    }

    const tweet = parsed.data.tweets.find((candidate) => candidate.id === id);
    return tweet ? mapTweet(tweet) : undefined;
  }
}

function mapTweet(tweet: z.infer<typeof twitterApiIoTweetSchema>): PublicXPostSnapshot {
  return {
    id: tweet.id,
    text: tweet.text,
    authorHandle: tweet.author?.userName ?? tweet.authorHandle,
    authorId: tweet.author?.id ?? tweet.authorId,
    createdAt: tweet.createdAt,
    likeCount: tweet.likeCount,
    repostCount: tweet.retweetCount,
    replyCount: tweet.replyCount,
    quoteCount: tweet.quoteCount,
    viewCount: tweet.viewCount,
    bookmarkCount: tweet.bookmarkCount,
    url: tweet.url
  };
}
