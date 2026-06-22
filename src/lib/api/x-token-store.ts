import { ApiError } from "./errors";
import type { SecretsFile } from "./secrets";
import type { XOAuthTokenResult } from "../providers/x-oauth-token";

export function applyXOAuthTokenResult(params: {
  secrets: SecretsFile;
  accountKey: string;
  token: XOAuthTokenResult;
}): SecretsFile {
  const account = params.secrets.accounts[params.accountKey];
  if (!account) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "write_x_token",
      message: `account is missing in secrets: ${params.accountKey}`
    });
  }

  return {
    ...params.secrets,
    accounts: {
      ...params.secrets.accounts,
      [params.accountKey]: {
        ...account,
        x_official: {
          ...account.x_official,
          access_token: params.token.accessToken,
          refresh_token: params.token.refreshToken ?? account.x_official?.refresh_token,
          expires_at: params.token.expiresAt ?? account.x_official?.expires_at
        }
      }
    }
  };
}
