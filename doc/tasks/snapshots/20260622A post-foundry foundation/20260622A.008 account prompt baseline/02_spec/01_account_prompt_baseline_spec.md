# Account Prompt Baseline Spec

## Storage Boundary

真实初始提示属于本地敏感运营配置：

* 不写入 `config/accounts.example.json`。
* 不写入可提交文档。
* 不提交 `secrets/prompts/*.md`。
* 只允许通过 `secrets/accounts.local.json` 配置。

`secrets/accounts.local.example.json` 只展示占位字段，不包含真实 prompt。

## Account Secrets Schema

账号 secrets 支持：

* `initial_prompt`：内联自然语言提示。
* `initial_prompt_path`：指向 prompt markdown 文件的路径。

规则：

* 同一个账号不得同时配置 `initial_prompt` 和 `initial_prompt_path`。
* `initial_prompt_path` 必须是相对路径。
* `initial_prompt_path` 必须位于 `secrets/` 下。
* `initial_prompt_path` 必须以 `.md` 结尾。
* `initial_prompt_path` 的真实路径解析后仍必须位于真实 `secrets/` 目录下，不能通过 symlink 指向外部文件。
* 文件内容 trim 后不能为空。

推荐路径：

```text
secrets/prompts/<account_key>.md
```

例如：

```text
secrets/prompts/zh-tech.md
```

## Runtime Contract

`loadAccountInitialPrompt` 返回：

* `accountKey`
* `source`: `inline` or `file`
* `prompt`
* `promptSha256`
* `promptPath`，仅文件来源存在

`promptSha256` 用于后续 AI run 写 ledger，避免在 audit record 中复制真实 prompt 内容。

## Acceptance

离线测试必须证明：

* 能加载内联自然语言提示。
* 能加载 `secrets/**/*.md` prompt 文件。
* 同时配置 inline 和 path 会失败。
* 缺少 prompt 会失败。
* `secrets/` 外路径会失败。
* 绝对路径会失败。
* 非 `.md` 路径会失败。
* 空 `.md` 文件会失败。
* symlink 到 `secrets/` 外部的 prompt 文件会失败。

本任务不得执行任何在线 LLM、X API、TwitterAPI.io、Telegram 或真实发帖。
