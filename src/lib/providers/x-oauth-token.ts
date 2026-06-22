import { z } from "zod";
import { ApiError, mapHttpStatus } from "../api/errors";
import { defaultFetch, type FetchLike, readJson } from "../api/http";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    token_type: z.string().optional(),
    scope: z.string().optional()
  })
  .passthrough();

export type XOAuthAppCredentials = {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
};

export type XOAuthTokenResult = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
};

export async function refreshXOAuthToken(params: {
  app: XOAuthAppCredentials;
  refreshToken: string;
  fetcher?: FetchLike;
  baseUrl?: string;
  now?: Date;
}): Promise<XOAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken
  });
  return requestToken({
    app: params.app,
    body,
    stage: "oauth_refresh_token",
    fetcher: params.fetcher,
    baseUrl: params.baseUrl,
    now: params.now
  });
}

export async function exchangeXOAuthCode(params: {
  app: XOAuthAppCredentials;
  code: string;
  codeVerifier: string;
  fetcher?: FetchLike;
  baseUrl?: string;
  now?: Date;
}): Promise<XOAuthTokenResult> {
  if (!params.app.redirectUri) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "oauth_exchange_code",
      message: "X OAuth redirect_uri is missing"
    });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.app.redirectUri,
    code_verifier: params.codeVerifier
  });
  return requestToken({
    app: params.app,
    body,
    stage: "oauth_exchange_code",
    fetcher: params.fetcher,
    baseUrl: params.baseUrl,
    now: params.now
  });
}

async function requestToken(params: {
  app: XOAuthAppCredentials;
  body: URLSearchParams;
  stage: string;
  fetcher?: FetchLike;
  baseUrl?: string;
  now?: Date;
}): Promise<XOAuthTokenResult> {
  const fetcher = params.fetcher ?? defaultFetch();
  const url = new URL("/2/oauth2/token", params.baseUrl ?? "https://api.x.com");
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (params.app.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${params.app.clientId}:${params.app.clientSecret}`).toString("base64")}`;
  } else {
    params.body.set("client_id", params.app.clientId);
  }

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(url.toString(), {
      method: "POST",
      headers,
      body: params.body.toString()
    });
  } catch (error) {
    throw new ApiError({
      code: "network_error",
      provider: "x_official",
      stage: params.stage,
      message: "X OAuth token request failed",
      details: error
    });
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw mapHttpStatus({
      provider: "x_official",
      stage: params.stage,
      status: response.status,
      details: body
    });
  }

  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: "x_schema_drift",
      provider: "x_official",
      stage: params.stage,
      message: "X OAuth token response schema drift",
      details: parsed.error.flatten()
    });
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresInSeconds: parsed.data.expires_in,
    expiresAt: buildExpiresAt(parsed.data.expires_in, params.now),
    scope: parsed.data.scope,
    tokenType: parsed.data.token_type
  };
}

function buildExpiresAt(expiresInSeconds: number | undefined, now = new Date()): string | undefined {
  if (!expiresInSeconds) {
    return undefined;
  }

  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}
