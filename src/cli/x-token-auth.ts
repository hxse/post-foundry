import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { ApiError, isApiError } from "../lib/api/errors";
import { restrictOwnerReadWrite } from "../lib/api/file-permissions";
import { redactSecrets, tokenFingerprint } from "../lib/api/redaction";
import { defaultSecretsPath, loadSecretsFile } from "../lib/api/secrets";
import { applyXOAuthTokenResult } from "../lib/api/x-token-store";
import { buildXOAuthAuthorizeUrl, createXOAuthPkcePair } from "../lib/providers/x-oauth-auth";
import { exchangeXOAuthCode, type XOAuthAppCredentials } from "../lib/providers/x-oauth-token";

type CliArgs = {
  account?: string;
  secretsPath?: string;
  timeoutMs: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.account) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_token_auth_args",
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
      stage: "x_token_auth_account",
      message: `account is missing in secrets: ${args.account}`
    });
  }

  const app = resolveXOAuthApp(secrets, process.env);
  const redirect = parseLocalRedirectUri(app.redirectUri);
  const pkce = createXOAuthPkcePair();
  const state = randomBytes(24).toString("base64url");
  const authorizeUrl = buildXOAuthAuthorizeUrl({
    app,
    state,
    codeChallenge: pkce.codeChallenge
  });

  console.log(`listening: ${app.redirectUri}`);
  console.log("copy this URL and complete OAuth manually in your own browser; do not ask an agent/MCP/browser automation to open x.com:");
  console.log(authorizeUrl);

  const code = await waitForOAuthCode({
    redirect,
    state,
    timeoutMs: args.timeoutMs
  });
  const token = await exchangeXOAuthCode({
    app,
    code,
    codeVerifier: pkce.codeVerifier
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
  console.log(`refresh_token: ${token.refreshToken ? tokenFingerprint(token.refreshToken) : "missing"}`);
  console.log(`expires_at: ${token.expiresAt ?? "unknown"}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    timeoutMs: Number(process.env.POST_FOUNDRY_X_AUTH_TIMEOUT_MS ?? "300000")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg.startsWith("--account=")) {
      args.account = readInlineValue(arg, "--account");
    } else if (arg === "--secrets") {
      args.secretsPath = readValue(argv, ++index, "--secrets");
    } else if (arg.startsWith("--secrets=")) {
      args.secretsPath = readInlineValue(arg, "--secrets");
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = parseTimeoutMs(readValue(argv, ++index, "--timeout-ms"));
    } else if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = parseTimeoutMs(readInlineValue(arg, "--timeout-ms"));
    } else {
      throw new ApiError({
        code: "invalid_request",
        provider: "local",
        stage: "x_token_auth_args",
        message: `Unknown argument: ${arg}`
      });
    }
  }

  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "x_token_auth_args",
      message: "--timeout-ms must be an integer >= 1000"
    });
  }

  return args;
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

function parseLocalRedirectUri(redirectUri: string | undefined): URL {
  if (!redirectUri) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "x_oauth_app",
      message: "X OAuth redirect_uri is missing"
    });
  }

  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "http:" || (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1")) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "x_oauth_app",
      message: "x-token-auth only supports local http redirect_uri"
    });
  }

  return redirect;
}

function waitForOAuthCode(params: { redirect: URL; state: string; timeoutMs: number }): Promise<string> {
  let server: Server | undefined;
  const port = params.redirect.port ? Number(params.redirect.port) : 80;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new ApiError({
          code: "invalid_request",
          provider: "local",
          stage: "oauth_callback",
          message: "timed out waiting for X OAuth callback"
        })
      );
    }, params.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      server?.close();
    }

    server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", params.redirect);
      if (requestUrl.pathname !== params.redirect.pathname) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        cleanup();
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("X authorization failed. You can close this tab.");
        reject(
          new ApiError({
            code: "invalid_request",
            provider: "x_official",
            stage: "oauth_callback",
            message: `X authorization failed: ${error}`
          })
        );
        return;
      }

      if (requestUrl.searchParams.get("state") !== params.state) {
        cleanup();
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("OAuth state mismatch. You can close this tab.");
        reject(
          new ApiError({
            code: "invalid_request",
            provider: "local",
            stage: "oauth_callback",
            message: "OAuth state mismatch"
          })
        );
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        cleanup();
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing OAuth code. You can close this tab.");
        reject(
          new ApiError({
            code: "invalid_request",
            provider: "local",
            stage: "oauth_callback",
            message: "OAuth callback code is missing"
          })
        );
        return;
      }

      cleanup();
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("PostFoundry received X authorization. You can close this tab.");
      resolve(code);
    });

    server.once("error", (error) => {
      cleanup();
      reject(
        new ApiError({
          code: "network_error",
          provider: "local",
          stage: "oauth_callback_listen",
          message: `failed to listen on localhost:${port}`,
          details: error
        })
      );
    });
    server.listen(port, params.redirect.hostname);
  });
}

function parseTimeoutMs(value: string): number {
  return Number(value);
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "x_token_auth_args",
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
      stage: "x_token_auth_args",
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
