# Problem Context

PostFoundry 后续会让 AI 统计热点、查找资料、生成草稿、决定是否自动发帖或通知人工处理。结构化账号配置可以表达主题、预算、频率和硬边界，但它不是给 AI 直接阅读的账号定位提示。

每个账号需要一个自然语言初始提示，描述账号的长期方向、语气、选题偏好、避雷范围和内容判断方式。这个提示可能暴露真实账号定位和运营策略，因此不能放进可提交的公开配置。

本任务把初始提示放到 ignored 的 local secrets 中，并支持两种形态：

* `initial_prompt`：直接把自然语言提示写在 `secrets/accounts.local.json` 的账号段中。
* `initial_prompt_path`：在账号段中引用一个 `.md` 文件路径，文件必须位于 `secrets/` 下，例如 `secrets/prompts/zh-tech.md`。

两种形态只能选一个。推荐文件名使用账号 key，例如 `zh-tech.md`，避免 `zh.md` 这种含糊且后续不可扩展的名字。

`.008` 不做记忆系统。后续 AI 从运行结果里沉淀出的经验应进入账号级 runtime memory 或 ledger，而不是覆盖初始提示。
