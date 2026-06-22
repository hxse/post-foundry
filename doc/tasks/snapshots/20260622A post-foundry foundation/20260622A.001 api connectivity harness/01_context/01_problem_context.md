# API 连通性子任务背景

PostFoundry 后续所有运营能力都依赖两个外部边界：读取公开 X 数据，以及通过 X 官方 API 对自己的账号发帖。如果这两个边界一开始没有可重复验证的 contract，后面做选题、草稿、排程和复盘时，任何问题都会混在业务层里，很难判断是运营逻辑错、provider 返回变了、token 失效，还是测试本身不可信。

因此第一个子任务先做 API 连通性验证。它不追求业务完整，只追求把外部服务的最小 contract 变成可测试、可 debug、可审计的工程入口。

## 为什么离线和在线不拆成两个子任务

离线测试和在线 debug 验证的是同一件事：API client 的请求、响应、错误和保护边界是否可信。把它们拆成两个子任务会带来两个问题。

第一，离线 fixture 和在线真实返回很容易漂移。比如离线测试接受了一个字段形态，在线 debug 又临时解析另一种字段，后续业务层就不知道该信谁。

第二，错误语义会被拆散。缺少 token、401、429、schema drift、网络超时和真实发帖被保护开关拦截，应该由同一个 client contract 解释，而不是离线任务写一套、在线任务写一套。

所以本子任务保留两个 `just` 入口，但不拆成两个 task：

```text
just test-api-offline
just debug-api-online
```

`just test-api-offline` 是正式 Gate。它使用 fixture 和 mock，不访问网络，不需要真实密钥。`just debug-api-online` 是手动诊断入口。它访问真实外部服务，默认从本地 secrets 文件按账号读取凭据，不进入默认测试、CI、定时回归、agent 自主 Close Gate 或自动补验流程。

## API 成本与职责边界

热点扫描和公开 X 数据读取不走 X 官方 API。当前方案通过内部公开 X 数据 provider port 读取公开数据，第一版 adapter 使用 TwitterAPI.io。TwitterAPI.io adapter 只做读取公开数据，不获取 X cookie，不托管登录态，不执行账号动作。第一子任务只做用户明确要求后的手动小样本 smoke，成本边界是确认请求、响应和错误 contract；真实查询频率、分页规模和每账号数据预算留给账号配置子任务与后续 topic task 冻结。

X 官方 API 只用于官方允许的账号动作。本子任务只验证最小发帖能力，并且默认 dry-run。它的风险不是热点扫描读取成本，而是 OAuth 授权、发帖 rate limit、错误语义和真实发帖副作用。真实发帖必须同时满足：用户明确要求、提供调试账号 token、提供测试发帖文本、设置硬开关。这样可以避免开发者误跑 debug 命令就发出真实帖子。

## 设计目标

本子任务的目标不是把 API 封装成完整多 provider 框架，而是先把第一条真值链做稳，同时避免业务层直接依赖 TwitterAPI.io：

```text
配置读取
  -> schema 校验
  -> 公开 X 数据 provider port
  -> TwitterAPI.io adapter 请求构造
  -> TwitterAPI.io 响应 schema 校验
  -> 内部统一输出类型
  -> 统一错误语义
  -> 离线 fixture 测试
  -> 在线 debug smoke
```

后续如果新增 SocialData、Apify 或其他 provider，应在这个 port 之下新增 adapter 或替换 adapter。第一子任务只实现 TwitterAPI.io adapter，不做运行时 provider registry、多 provider 策略选择或多个 provider 的对齐矩阵，避免过早泛化。

## 风险与保护

最重要的风险是真实副作用和外部调用成本。X 发帖是不可当成普通测试的动作，第三方公开数据 API 也可能按请求、分页或返回量计费，因此在线验证不能自动化运行。`just debug-api-online` 只能在用户明确要求时验证请求构造、鉴权和 dry-run 输出；只有设置 `POST_FOUNDRY_ALLOW_REAL_X_POST=1` 且用户确认发帖文本时，才允许调用真实发帖 endpoint。

第二个风险是密钥泄漏。所有日志、错误和 fixture 必须脱敏。离线测试不能依赖真实 `secrets/accounts.local.json` 或 `.env.local`。在线 debug 如果输出配置状态，只能输出“已配置/未配置”和 token 指纹前后少量字符，不得输出完整 token。

第三个风险是 provider schema 漂移。第三方数据 API 可能变字段、变错误格式、变分页语义。adapter 不能把未知结构静默当成功；必须通过 Zod schema 校验，把漂移报告成明确错误。业务层只消费内部统一类型，不读取 provider 原始响应。
