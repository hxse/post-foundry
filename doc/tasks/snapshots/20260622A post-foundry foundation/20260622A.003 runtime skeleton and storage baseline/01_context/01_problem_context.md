# 问题背景

`.001` 已经冻结外部 API contract 和在线/离线验证边界，`.002` 已经冻结账号身份和配置隔离。接下来需要一个本地 runtime 基线，把账号、配置快照、任务状态和审计记录落到 SQLite，否则后续 topic、draft、publishing 和 metrics task 会缺少统一的状态归属。

PostFoundry 初期是本地优先工具，不需要 Postgres 或 Redis。SQLite 足够承载账号 registry 投影、配置快照、job 状态、API 调用审计和健康检查。数据库文件默认放在 `data/post-foundry.sqlite`，后续 Podman 部署时可以挂载 volume。

本阶段仍然不访问真实外部服务。migration、repo 和 health 测试全部用离线 SQLite。真实 TwitterAPI.io、X OAuth、X official API 和真实发帖继续只能由用户明确要求后手动运行，不进入 `.003` Gate。

SvelteKit 在本阶段只作为薄本地页面，读取 runtime health 和账号列表。业务规则、SQL、migration 和 repo 逻辑必须留在 `src/lib/**`，不能散落到 route 里。
