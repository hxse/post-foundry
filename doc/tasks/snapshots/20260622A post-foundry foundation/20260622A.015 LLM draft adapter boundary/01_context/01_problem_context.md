# Problem Context

`.009` 已经定义 AI 草稿输入包、输出 schema、自然文本 gate 和 ledger 写入；`.014` 已经把账号历史 trace 沉淀成 account memory。

下一步需要把这些上下文交给 LLM，但不能一上来就接真实在线模型。真实 LLM 接入前，必须先固定 adapter boundary：给模型看的 request 只能包含账号配置快照、prompt hash、素材摘要、近期发帖和紧凑 memory；provider 输出必须先被 `.009` schema 解析和 gate 校验；adapter run 必须可审计，且不能把 secrets 或 prompt 明文落盘。

`.015` 因此只做离线 fake provider baseline，证明未来真实 LLM provider 需要遵守的 contract。
