# Problem Context

`.017` 已经把生产入口和离线 fixture executor 分开，但真实生产链路还没有真实资料输入。后续 AI 发帖不能靠空想，必须先从账号自己的主题配置出发，读取公开 X 热点/高赞帖，再把这些资料沉淀进 ledger，供 topic radar、source context 和 LLM draft 使用。

`.018` 的目标是先把 source collection 的生产边界落稳：真实读取只通过第三方公开数据 API TwitterAPI.io；每个 query 都有 API audit；整体收集有 AI run 和 audit event；每条 material 有 evidence ref。这样后续 `.019` / `.020` 接 LLM 和 run-once production executor 时，可以复用同一个可追踪资料输入层。
