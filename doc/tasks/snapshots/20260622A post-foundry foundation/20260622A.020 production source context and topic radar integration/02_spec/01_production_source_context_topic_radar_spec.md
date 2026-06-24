# Production Source Context And Topic Radar Spec

## Contract

Production once executor 必须：

* 先执行 `.018` source collection。
* 如果 source collection skipped，不继续 topic radar/source context。
* 如果 source collection succeeded 但没有 materials，返回 skipped summary，不继续 topic radar/source context。
* 对非空 materials 执行 `.012` `buildTopicRadar` 并写 `topic_radar_selection` ledger。
* 用 selected topic 执行 `.010` `buildSourceContext` 并写 `source_context_ingestion` ledger。
* 所有 AI run / evidence / audit event 使用同一个 trace id。
* ledger 中只保存 prompt hash、material ids、summary/hash/score 等摘要，不保存 prompt 明文。
* 不创建 `ai_decisions` 或 `ai_actions`，因为本任务不做 draft/policy/posting。

Production loop 必须继续复用同一个 once executor。

Production `just` 入口必须使用 just 原生 long arg 声明，用户调用形式为 `just prod-online-run-once --account zh-tech --config-file config/accounts.local.json`；不得要求 `--` 分隔符或 `--flag=value`。

## Explicit Non-Scope

`.020` 不允许：

* 调用在线 LLM。
* 生成草稿或评估发帖策略。
* 发送 Telegram。
* 调用 X official 发帖或 OAuth。
* 打开 `x.com` 或使用浏览器自动化。

## Acceptance

离线测试必须证明：

* fake provider 下，production once runner 写入 source collection、topic radar、source context 三类 AI run。
* 同一 trace 下有 `public_x_source_collection_collected`、`topic_selected`、`source_context_built` audit events。
* prompt 明文不落入 AI run ledger，prompt hash 会出现。
* cap skip 时不调用 provider，也不继续 topic/context。
* account mismatch 在任何 side effect 前被拒绝。
* `just --dry-run prod-online-run-once --account zh-tech --config-file config/accounts.local.json` 和 loop long arg 形式能解析出 CLI 参数，不执行在线请求。
