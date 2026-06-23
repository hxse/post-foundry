import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/errors";
import { loadAccountInitialPrompt } from "../src/lib/accounts/account-prompt";

describe("account initial prompt loading", () => {
  it("loads inline natural-language prompt from local account secrets", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt: "  你是一个长期运营中文科技账号的助手。关注 AI、开源和工具链，输出要自然克制。  "
        }
      });

      await expect(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        })
      ).resolves.toEqual({
        accountKey: "zh-tech",
        source: "inline",
        prompt: "你是一个长期运营中文科技账号的助手。关注 AI、开源和工具链，输出要自然克制。",
        promptSha256: sha256("你是一个长期运营中文科技账号的助手。关注 AI、开源和工具链，输出要自然克制。")
      });
    });
  });

  it("loads markdown prompt files only from ignored secrets paths", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await mkdir(join(root, "secrets", "prompts"), { recursive: true });
      await writeFile(join(root, "secrets", "prompts", "zh-tech.md"), "\n长期关注 AI 产品化和开发者工具。\n\n避免像测试机器人。\n", "utf8");
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: "secrets/prompts/zh-tech.md"
        }
      });

      const prompt = await loadAccountInitialPrompt({
        accountKey: "zh-tech",
        secretsPath,
        cwd: root
      });

      expect(prompt).toEqual({
        accountKey: "zh-tech",
        source: "file",
        prompt: "长期关注 AI 产品化和开发者工具。\n\n避免像测试机器人。",
        promptSha256: sha256("长期关注 AI 产品化和开发者工具。\n\n避免像测试机器人。"),
        promptPath: "secrets/prompts/zh-tech.md"
      });
    });
  });

  it("rejects accounts that configure both inline prompt and prompt path", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt: "inline prompt",
          initial_prompt_path: "secrets/prompts/zh-tech.md"
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );
    });
  });

  it("rejects missing prompt config for the requested account", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await writeSecrets(secretsPath, {
        "zh-tech": {}
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "missing_credentials"
      );
    });
  });

  it("rejects prompt paths outside secrets or not ending in .md", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: "config/zh-tech.md"
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );

      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: "secrets/prompts/zh-tech.txt"
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );

      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: join(root, "secrets", "prompts", "zh-tech.md")
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );
    });
  });

  it("rejects empty markdown prompt files", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await mkdir(join(root, "secrets", "prompts"), { recursive: true });
      await writeFile(join(root, "secrets", "prompts", "zh-tech.md"), " \n\t\n", "utf8");
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: "secrets/prompts/zh-tech.md"
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );
    });
  });

  it("rejects symlinked prompt files that resolve outside secrets", async () => {
    await withTempWorkspace(async ({ root, secretsPath }) => {
      await mkdir(join(root, "secrets", "prompts"), { recursive: true });
      await writeFile(join(root, "outside.md"), "external prompt should not be loaded", "utf8");
      await symlink(join(root, "outside.md"), join(root, "secrets", "prompts", "zh-tech.md"));
      await writeSecrets(secretsPath, {
        "zh-tech": {
          initial_prompt_path: "secrets/prompts/zh-tech.md"
        }
      });

      await expectLocalError(
        loadAccountInitialPrompt({
          accountKey: "zh-tech",
          secretsPath,
          cwd: root
        }),
        "invalid_request"
      );
    });
  });
});

async function withTempWorkspace(body: (paths: { root: string; secretsPath: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "post-foundry-account-prompt-"));
  const secretsDir = join(root, "secrets");
  const secretsPath = join(secretsDir, "accounts.local.json");
  try {
    await mkdir(secretsDir, { recursive: true });
    await body({ root, secretsPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSecrets(path: string, accounts: Record<string, unknown>): Promise<void> {
  await writeFile(
    path,
    JSON.stringify(
      {
        version: 1,
        accounts
      },
      null,
      2
    ),
    "utf8"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function expectLocalError(
  promise: Promise<unknown>,
  code: "invalid_request" | "missing_credentials"
): Promise<void> {
  try {
    await promise;
    throw new Error("expected ApiError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.provider).toBe("local");
    expect(apiError.code).toBe(code);
  }
}
