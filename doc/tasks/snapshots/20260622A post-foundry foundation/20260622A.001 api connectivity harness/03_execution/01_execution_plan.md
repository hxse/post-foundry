# API 子任务执行计划

## 阶段 0：文档 Gate

先审阅 `00_meta.md`、`01_context` 和 `02_spec`。未经人工确认，不进入代码实现。

本阶段需要确认：

* `just test-api-offline` 是否作为正式离线 Gate。
* `just debug-api-online` 是否作为唯一在线 debug 入口，且只能在用户当前明确要求时手动运行。
* 真实发帖是否必须使用 `POST_FOUNDRY_ALLOW_REAL_X_POST=1`。
* 第一子任务是否暂不实现完整 OAuth UI 和多账号 registry。
* TwitterAPI.io 是否作为第一版唯一公开 X 数据 provider adapter。
* 在线、真实外部服务和可能计费的验证是否禁止进入默认测试、CI、定时回归、agent 自主 Close Gate 或自动补验流程。

## 阶段 1：项目最小脚手架

在实现阶段创建 Bun、TypeScript、SvelteKit、Vitest、Drizzle 和 `justfile` 的最小项目结构。

本阶段只需要让以下入口存在并能给出明确输出：

```text
just check
just test
just test-api-offline
just debug-api-online
```

`just debug-api-online` 在没有本地 secrets 文件、账号不存在或账号缺少密钥时应快速失败并提示缺少哪一类配置。它不能在无密钥时伪装成功，也不能被默认测试或 CI 自动调用。

## 阶段 2：API contract 与错误类型

实现 provider-neutral 的错误语义、公开 X 数据 provider port 和两个最小 client / adapter：

```text
PublicXDataProvider
TwitterApiIoPublicXAdapter
XOfficialPublisherClient
```

本阶段先不做泛化 provider registry、运行时 provider 选择或多个 provider adapter。只要保证业务层依赖 `PublicXDataProvider`，TwitterAPI.io 只作为 adapter 存在，后续更换第三方服务商时就可以主要替换 adapter，而不是改 topic、draft、metrics 等业务代码。

错误类型至少覆盖：

```text
missing_credentials
unauthorized
forbidden
rate_limited
network_error
provider_schema_drift
x_schema_drift
provider_error
x_api_error
invalid_request
real_post_not_allowed
missing_post_text
```

## 阶段 3：离线 fixture 测试

建立 fixture 和 mock，使 `just test-api-offline` 能覆盖主链和关键反例。

测试重点：

* TwitterAPI.io adapter 请求构造正确。
* TwitterAPI.io 成功响应能被 schema 校验并转换为 `PublicXDataProvider` 内部类型。
* 空结果不是错误。
* rate limit 有明确错误。
* schema drift 在 adapter 层失败，不会被业务层静默兜底。
* 真实发帖保护开关有效。
* 日志不会泄漏完整 token。

离线测试不依赖 `.env.local`，不访问网络，不执行真实发帖。

## 阶段 4：在线 debug

实现 `debug/` 下的在线 smoke 脚本，并由 `just debug-api-online` 调用。该阶段只产出人工诊断入口，不产出自动化在线测试。

用户明确要求后，手动在线 debug 流程：

```text
1. 校验本地 secrets 文件、账号选择和必要凭据。
2. TwitterAPI.io 搜索一个小样本，默认 limit <= 10。
3. 验证当前账号的 X token 是否可用。
4. 构造 X 发帖 dry-run。
5. 如果硬开关和文本都存在，执行真实发帖；否则跳过真实发帖并说明原因。
```

在线 debug 输出必须低噪声、可审计、脱敏。第三方公开数据查询、X OAuth token endpoint、真实发帖和第三方读回都按可能计费或有真实副作用处理，不得由测试套件、CI、定时回归、agent 自主 Close Gate、"run all" 或自动补验流程触发。

## 阶段 5：审阅与 Close Gate

代码落地后执行 AI post-review，核对文档到代码的映射。

Close Gate 需要：

```text
just check
just test
just test-api-offline
```

如果用户明确要求且在线 debug 已手动运行，`04_review` 记录结果。如果在线 debug 未运行，`04_review` 必须写清原因，例如用户未明确要求、没有密钥、用户不允许联网、可能产生费用、未授权真实发帖或环境受限。

## Legacy Kill List

本子任务是新项目第一批能力，没有旧实现需要删除。但实现阶段不得留下以下临时痕迹：

* 散落在仓库根目录的一次性脚本。
* 绕过 `just` 的正式测试入口。
* 写死的 API key 或 token。
* 把真实 token 写进 task 文档、fixture、普通配置文件或默认提交路径。
* 默认会发真实帖子的 debug 命令。
* 会自动访问真实 provider、可能计费 API、X OAuth token endpoint 或真实发帖 endpoint 的测试命令。
* route 中承载的 provider 业务逻辑。
* topic、draft、metrics 或 account-specific pipeline 直接调用 TwitterAPI.io adapter。
* 未脱敏的在线响应日志。
