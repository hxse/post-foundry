import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "../api/errors";
import type { XOAuthAppCredentials } from "./x-oauth-token";

export const defaultXOAuthScopes = ["tweet.read", "tweet.write", "users.read", "offline.access"] as const;

export type XOAuthPkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

export function createXOAuthPkcePair(): XOAuthPkcePair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildXOAuthAuthorizeUrl(params: {
  app: XOAuthAppCredentials;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  authorizeBaseUrl?: string;
}): string {
  if (!params.app.redirectUri) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "oauth_authorize_url",
      message: "X OAuth redirect_uri is missing"
    });
  }

  const url = new URL(params.authorizeBaseUrl ?? "https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.app.clientId);
  url.searchParams.set("redirect_uri", params.app.redirectUri);
  url.searchParams.set("scope", (params.scopes ?? defaultXOAuthScopes).join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
