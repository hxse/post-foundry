# Close Gate Review

## Result

Close Gate 通过。

## What Landed

* `src/lib/api/secrets.ts` 支持账号级 `initial_prompt` / `initial_prompt_path`，二者互斥。
* `src/lib/accounts/account-prompt.ts` 增加 `loadAccountInitialPrompt`，加载内联或 `secrets/**/*.md` prompt，并返回 `promptSha256`。
* prompt 文件路径会做字面路径和真实路径双重校验，防止 symlink 逃逸到 `secrets/` 外部。
* `secrets/accounts.local.example.json` 增加占位 prompt path：`secrets/prompts/zh-tech.md`。
* `tests/account-prompt-offline.test.ts` 覆盖内联、文件、互斥、缺失、路径越界、绝对路径、非 `.md`、空文件和 symlink 逃逸场景。
* `justfile` 和 `package.json` 增加离线测试入口。

## Verification

* `just test-account-prompt-offline`: passed.
* `just check`: passed.
* `just test`: passed.
* `git diff --check`: passed.

## Online Runs

未执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth 或真实发帖。本任务只涉及本地 secrets schema、文件加载和离线测试。

## Residual Risk

后续真正调用 AI 时，必须把 `promptSha256`、账号配置快照和输入证据写入 `.004` ledger，不能把真实 prompt 明文写入可提交文档。
