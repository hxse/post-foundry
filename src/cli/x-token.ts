import { writeFile } from "node:fs/promises";
import { ApiError, isApiError } from "../lib/api/errors";
import { restrictOwnerReadWrite } from "../lib/api/file-permissions";
import { redactSecrets, tokenFingerprint } from "../lib/api/redaction";
import { applyXOAuthTokenResult } from "../lib/api/x-token-store";
import { defaultSecretsPath, loadSecretsFile } from "../lib/api/secrets";
import { exchangeXOAuthCode, refreshXOAuthToken, type XOAuthAppCredentials } from "../lib/providers/x-oauth-token";

type TokenMode = "refresh" | "exchange-code";

type CliArgs = {
  account?: string;
  code?: string;
  codeVerifier?: string;
  mode: TokenMode;
  secretsPath?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.account) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_token_args",
      message: "--account is required; it selects accounts.<account>.x_official to update"
    });
  }

  const secretsPath = args.secretsPath ?? process.env.POST_FOUNDRY_SECRETS_FILE ?? defaultSecretsPath;
  const secrets = await loadSecretsFile(secretsPath);
  const account = secrets.accounts[args.account];
  if (!account) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_token_account",
      message: `account is missing in secrets: ${args.account}`
    });
  }

  const app = resolveXOAuthApp(secrets, process.env);
  const token =
    args.mode === "refresh"
      ? await refreshXOAuthToken({
          app,
          refreshToken: process.env.X_DEBUG_REFRESH_TOKEN ?? requireValue(account.x_official?.refresh_token, "accounts.<account>.x_official.refresh_token")
        })
      : await exchangeXOAuthCode({
          app,
          code: requireValue(args.code, "--code"),
          codeVerifier: requireValue(args.codeVerifier, "--code-verifier")
        });

  const updated = applyXOAuthTokenResult({
    secrets,
    accountKey: args.account,
    token
  });
  await writeFile(secretsPath, `${JSON.stringify(updated, null, 2)}\n`);
  await restrictOwnerReadWrite(secretsPath);

  console.log(`updated: ${secretsPath}`);
  console.log(`account: ${args.account}`);
  console.log(`access_token: ${tokenFingerprint(token.accessToken)}`);
  console.log(`refresh_token: ${token.refreshToken ? tokenFingerprint(token.refreshToken) : "kept_existing"}`);
  console.log(`expires_at: ${token.expiresAt ?? "unchanged"}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "refresh"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg.startsWith("--account=")) {
      args.account = readInlineValue(arg, "--account");
    } else if (arg === "--code") {
      args.code = readValue(argv, ++index, "--code");
    } else if (arg.startsWith("--code=")) {
      args.code = readInlineValue(arg, "--code");
    } else if (arg === "--code-verifier") {
      args.codeVerifier = readValue(argv, ++index, "--code-verifier");
    } else if (arg.startsWith("--code-verifier=")) {
      args.codeVerifier = readInlineValue(arg, "--code-verifier");
    } else if (arg === "--mode") {
      args.mode = parseMode(readValue(argv, ++index, "--mode"));
    } else if (arg.startsWith("--mode=")) {
      args.mode = parseMode(readInlineValue(arg, "--mode"));
    } else if (arg === "--secrets") {
      args.secretsPath = readValue(argv, ++index, "--secrets");
    } else if (arg.startsWith("--secrets=")) {
      args.secretsPath = readInlineValue(arg, "--secrets");
    } else {
      throw new ApiError({
        code: "invalid_request",
        provider: "local",
        stage: "x_token_args",
        message: `Unknown argument: ${arg}`
      });
    }
  }

  return args;
}

function parseMode(value: string): TokenMode {
  if (value === "refresh" || value === "exchange-code") {
    return value;
  }

  throw new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "x_token_args",
    message: "--mode must be refresh or exchange-code"
  });
}

function resolveXOAuthApp(secrets: Awaited<ReturnType<typeof loadSecretsFile>>, env: NodeJS.ProcessEnv): XOAuthAppCredentials {
  const app = secrets.global_providers?.x_official;
  const clientId = env.X_OAUTH_CLIENT_ID ?? app?.client_id;
  if (!clientId) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_oauth_app",
      message: "X OAuth client_id is missing"
    });
  }

  return {
    clientId,
    clientSecret: env.X_OAUTH_CLIENT_SECRET ?? app?.client_secret,
    redirectUri: env.X_OAUTH_REDIRECT_URI ?? app?.redirect_uri
  };
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_token_args",
      message: `${name} is required`
    });
  }

  return value;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "x_token_args",
      message: `${flag} requires a value`
    });
  }

  return value;
}

function readInlineValue(arg: string, flag: string): string {
  const value = arg.slice(flag.length + 1);
  if (!value) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "x_token_args",
      message: `${flag} requires a value`
    });
  }

  return value;
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error(`ERROR ${error.code}`);
    console.error(`provider: ${error.provider}`);
    console.error(`stage: ${error.stage}`);
    if (error.status) {
      console.error(`status: ${error.status}`);
    }
    if (error.retryHint) {
      console.error(`retry_hint: ${error.retryHint}`);
    }
    console.error(`reason: ${redactSecrets(error.message)}`);
    if (error.details !== undefined) {
      console.error(`details: ${redactSecrets(JSON.stringify(error.details))}`);
    }
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
