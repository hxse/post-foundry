import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "../api/errors";
import { defaultSecretsPath, loadSecretsFile, type CredentialEnv } from "../api/secrets";

export type AccountInitialPrompt = {
  accountKey: string;
  source: "inline" | "file";
  prompt: string;
  promptSha256: string;
  promptPath?: string;
};

export async function loadAccountInitialPrompt(params: {
  accountKey?: string;
  secretsPath?: string;
  env?: CredentialEnv;
  cwd?: string;
}): Promise<AccountInitialPrompt> {
  const env = params.env ?? process.env;
  const accountKey = params.accountKey ?? env.X_DEBUG_ACCOUNT_KEY;
  if (!accountKey) {
    throw promptError("missing_credentials", "account_key is required for initial prompt loading");
  }

  const secretsPath = params.secretsPath ?? env.POST_FOUNDRY_SECRETS_FILE ?? defaultSecretsPath;
  const secrets = await loadSecretsFile(secretsPath);
  const account = secrets.accounts[accountKey];
  if (!account) {
    throw promptError("missing_credentials", `account is missing in secrets: ${accountKey}`);
  }

  const inlinePrompt = account.initial_prompt?.trim();
  const promptPath = account.initial_prompt_path?.trim();
  if (inlinePrompt && promptPath) {
    throw promptError("invalid_request", "initial_prompt and initial_prompt_path are mutually exclusive");
  }

  if (inlinePrompt) {
    return {
      accountKey,
      source: "inline",
      prompt: inlinePrompt,
      promptSha256: sha256(inlinePrompt)
    };
  }

  if (!promptPath) {
    throw promptError("missing_credentials", `initial prompt is missing for account: ${accountKey}`);
  }

  const resolved = await resolvePromptPath({
    cwd: params.cwd ?? process.cwd(),
    promptPath
  });
  let raw: string;
  try {
    raw = await readFile(resolved.absolutePath, "utf8");
  } catch (error) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "account_initial_prompt",
      message: `initial prompt file is missing: ${resolved.promptPath}`,
      details: error
    });
  }

  const prompt = raw.trim();
  if (!prompt) {
    throw promptError("invalid_request", `initial prompt file is empty: ${resolved.promptPath}`);
  }

  return {
    accountKey,
    source: "file",
    prompt,
    promptSha256: sha256(prompt),
    promptPath: resolved.promptPath
  };
}

async function resolvePromptPath(params: { cwd: string; promptPath: string }): Promise<{
  absolutePath: string;
  promptPath: string;
}> {
  if (isAbsolute(params.promptPath)) {
    throw promptError("invalid_request", "initial_prompt_path must be relative and under secrets/");
  }

  if (extname(params.promptPath) !== ".md") {
    throw promptError("invalid_request", "initial_prompt_path must point to a .md file");
  }

  const cwd = resolve(params.cwd);
  const secretsRoot = resolve(cwd, "secrets");
  const absolutePath = resolve(cwd, params.promptPath);
  const pathWithinSecrets = relative(secretsRoot, absolutePath);
  if (!pathWithinSecrets || pathWithinSecrets.startsWith("..") || isAbsolute(pathWithinSecrets)) {
    throw promptError("invalid_request", "initial_prompt_path must stay under secrets/");
  }

  let realSecretsRoot: string;
  let realPromptPath: string;
  try {
    realSecretsRoot = await realpath(secretsRoot);
    realPromptPath = await realpath(absolutePath);
  } catch (error) {
    throw new ApiError({
      code: "missing_credentials",
      provider: "local",
      stage: "account_initial_prompt",
      message: `initial prompt file is missing: ${relative(cwd, absolutePath).split(sep).join("/")}`,
      details: error
    });
  }

  const realPathWithinSecrets = relative(realSecretsRoot, realPromptPath);
  if (!realPathWithinSecrets || realPathWithinSecrets.startsWith("..") || isAbsolute(realPathWithinSecrets)) {
    throw promptError("invalid_request", "initial_prompt_path must resolve under secrets/");
  }

  return {
    absolutePath: realPromptPath,
    promptPath: relative(cwd, absolutePath).split(sep).join("/")
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function promptError(code: "invalid_request" | "missing_credentials", message: string): ApiError {
  return new ApiError({
    code,
    provider: "local",
    stage: "account_initial_prompt",
    message
  });
}
