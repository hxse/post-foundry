# API 连通性验证规范

## 任务边界

本子任务只建立 API 连通性验证 harness，不实现完整运营业务。它的完成标准是：离线测试能稳定证明 API client contract，在线 debug 能在用户当前明确要求并手动提供密钥时验证真实服务，默认路径不会访问网络或发真实 X 帖子。

当前子任务做到以下程度即停止：

* `just test-api-offline` 成为正式离线 API Gate。
* `just debug-api-online` 成为人工明确触发的在线 API smoke 入口。
* 公开 X 数据 provider port 有稳定内部 contract，TwitterAPI.io 只读 adapter 有请求构造、响应解析、错误语义和 fixture。
* X official publisher client 有发帖请求构造、dry-run、真实发帖硬开关和错误语义。
* 真实发帖后的读回验证只能通过第三方公开数据 API 按 tweet id 查询，不能打开 `x.com` 页面。
* 真实发帖测试文案必须自然、低调、像真人发出的短句；禁止 `smoke test`、`PostFoundry`、task 编号或调试痕迹。
* 缺少密钥、401/403、429、网络失败、schema drift 和真实发帖未授权都有明确错误。
* 在线 debug、OAuth/token 维护、真实发帖和第三方读回不进入默认 `just test`、CI、定时回归、agent 自主 Close Gate、"run all" 或任何自动补验流程。

本子任务不做：

* 完整 OAuth 授权 UI。
* 多账号 registry。
* 正式数据库持久化。
* 定时任务和发帖队列。
* LLM 草稿。
* 评论审核或隐藏回复。
* 任何网页登录自动化或反检测能力。
* 用浏览器、MCP 或 Playwright 打开 `x.com` 做读取、验证、截图验收或排障。
* 把在线、真实外部服务或可能计费的 API 调用做成自动测试。

## 任务规范

### `just` 入口

本子任务冻结两个 API 主入口和两个手动 token 维护入口。

第一个入口是：

```text
just test-api-offline
```

它是正式 Gate。它必须满足：

* 不访问网络。
* 不读取真实 `secrets/accounts.local.json`、`.env.local` 或生产 token。
* 使用 fixture 或 mock 覆盖公开 X 数据 provider port、TwitterAPI.io adapter 和 X official publisher 的核心 contract。
* 能在无密钥环境通过。
* 可以被默认 `just test` 调用。
* 失败时说明是请求构造、响应解析、schema drift、错误映射还是保护开关问题。

第二个入口是：

```text
just debug-api-online
```

它是人工手动 debug 入口。它必须满足：

* 允许访问真实网络。
* 只能在用户当前明确要求在线验证时运行，不得被默认测试、CI、定时回归、agent 自主 Close Gate、"run all" 或自动补验流程调用。
* 第三方 API 可能按请求、分页或返回量计费；任何这类调用都按可能计费处理，不能自动运行。
* 需要显式账号参数，并从本地 secrets 文件按账号解析凭据；环境变量只作为临时覆盖入口。
* 不进入默认 `just test`。
* 默认不发真实 X 帖子。
* 可以通过公开 X 数据 provider port 执行 TwitterAPI.io 搜索 smoke。
* 可以验证 X access token 是否可用于目标账号。
* 可以构造 X 发帖请求并 dry-run 展示。
* 如执行真实发帖，读回验证必须使用第三方公开数据 API，不得打开 `x.com`。
* 如执行真实发帖，文本必须由人工明确提供或确认，并且像普通真人动态；不得使用机器味测试文案。
* 如执行真实发帖，`debug-api-online` 必须在任何 TwitterAPI.io 或 X API 调用前拦截明显测试/调试文案，例如包含 `PostFoundry`、`smoke`、`test`、`debug`、`dry-run`、task id、`测试` 或 `调试` 的文本。
* 只有显式传入 `--allow-real-post` 且文案通过真实发帖保护策略时，才允许 debug 入口真实发帖。

手动 token 维护入口是：

```text
just x-token --account=zh-tech --mode=refresh
```

它访问 X OAuth token endpoint，不进入默认 `just test`、CI、定时回归、agent 自主 Close Gate 或自动补验流程。写回账号必须由 `--account` 显式指定；写回文件默认是 `secrets/accounts.local.json`，也可以通过 `--secrets` 或 `POST_FOUNDRY_SECRETS_FILE` 指定。命令只能写回 `accounts.<account_key>.x_official`，不得修改其他账号 token。

首次 OAuth 授权入口是：

```text
just x-token-auth --account=zh-tech
```

它启动本地 `http://localhost:2619/auth/x/callback`，生成 PKCE 授权 URL，等待用户手动完成授权后的 callback，收到 code 后立即换取 token 并写回 `accounts.zh-tech.x_official`。它访问 X OAuth authorize/token endpoint，不进入默认 `just test`、CI、定时回归、agent 自主 Close Gate 或自动补验流程，输出不得包含完整 token。agent 只能打印授权 URL 和监听本地 callback，不得用浏览器、MCP、Playwright 或截图工具代替用户打开 `x.com`。

### API contract 细节

本地 secrets 文件、环境变量覆盖、公开 X 数据 provider port、TwitterAPI.io 只读 adapter、X official publisher client、日志脱敏和 fixture 规则统一冻结在 `20260622A.001/02_spec/02_api_contract_details.md`。主 spec 只保留任务边界、主规范、示例和测试入口，避免单文件过长导致人工审阅困难。

实现阶段必须同时满足本文件和 `02_api_contract_details.md`。如果二者发生冲突，以本文件的任务边界和保护原则为准，并在实现前回到文档 Gate 修正冲突。

## 示例

离线测试入口：

```text
just test-api-offline
```

预期行为：

```text
PASS api offline contract
PASS twitterapi.io search fixture
PASS x publisher dry-run fixture
PASS real post guard fixture
```

初始化个人 secrets 文件：

```text
just init-secrets
```

该命令从 `secrets/accounts.local.example.json` 复制出 `secrets/accounts.local.json`，已有个人配置时不覆盖；无论新建还是已存在，都必须确保本地 secrets 文件权限为 `600`。

刷新已有 refresh token。该命令访问 X OAuth token endpoint，只能由用户明确要求后手动运行：

```text
just x-token --account=zh-tech --mode=refresh
```

首次授权推荐使用。该命令需要用户在自己的浏览器中手动授权，只能由用户明确要求后运行：

```text
just x-token-auth --account=zh-tech
```

命令会打印 X 授权 URL；用户在自己的浏览器中手动打开、登录目标 X 账号并授权后，token 会写回 `secrets/accounts.local.json`。agent 不得代开、代登、截图或读取授权页面。

如果只想调试底层 token exchange，也可以把用户手动 OAuth callback 得到的 `code` 换成账号 token：

```text
just x-token --account=zh-tech --mode=exchange-code --code=<callback-code> --code-verifier=<pkce-code-verifier>
```

在线 debug 入口默认只 dry-run。该命令会访问真实外部服务，可能消耗第三方 API 预算，只能由用户明确要求后手动运行：

```text
just debug-api-online --account zh-tech
```

预期行为：

```text
twitterapi.io search smoke: ok, posts <= 10
x auth smoke: ok
x post dry-run: ok
real post: skipped, --allow-real-post was not supplied
```

真实发帖必须显式开启：

```text
just debug-api-online --account zh-tech --allow-real-post --post-text "越是急着抵达，越要记得看清脚下的路。"
```

真实发帖测试禁止使用 `PostFoundry .001 smoke test.`、`API smoke test`、task 编号或任何调试说明。测试帖子也是公开内容，必须像真人动态；优先使用简短、有哲理感但不夸张的句子。

真实发帖成功后，命令必须通过第三方公开数据 API 按 tweet id 读回验证。如果 TwitterAPI.io 发生索引延迟、限流、网络失败或 schema drift，命令输出 warning 和 residual risk；不得使用浏览器、MCP、Playwright 或 `x.com` 页面补验。

如果缺少 `--post-text`：

```text
ERROR real_post_not_allowed
reason: --post-text is required for real posting
```

如果 TwitterAPI.io 返回未知成功结构：

```text
ERROR provider_schema_drift
provider: twitterapi.io
stage: search_response_parse
```

如果 X 返回 429：

```text
ERROR rate_limited
provider: x_official
stage: create_post
retry_hint: provider response headers if available
```

## 测试

`just test-api-offline` 必须覆盖以下正例：

* TwitterAPI.io 搜索 fixture 能通过 adapter 解析为公开 X 数据 provider port 的内部输出类型。
* TwitterAPI.io 空结果能解析为空 `posts`，不是错误。
* TwitterAPI.io 按 tweet id 读回 fixture 能解析为公开 X 数据 provider port 的内部输出类型。
* TwitterAPI.io 按 tweet id 读回空结果能解析为 `undefined`，由在线 debug 报告为 provider 索引延迟或残余风险。
* X publisher dry-run 不访问网络，返回 `status: "dry_run"`。
* X 真实发帖成功 fixture 能解析出 `tweetId`。

`just test-api-offline` 必须覆盖以下反例：

* 本地 secrets 文件缺失、账号不存在或未配置 TwitterAPI.io key 时，在线配置解析会给出 `missing_credentials`，但离线测试不失败。
* TwitterAPI.io 429 fixture 映射为 `rate_limited`。
* TwitterAPI.io 按 tweet id 读回 429 fixture 映射为 `rate_limited`，在线 debug 捕获后输出 warning/residual risk。
* TwitterAPI.io 按 tweet id 读回 `status: "error"` fixture 映射为 `provider_error`，不能被解释为 provider 索引延迟。
* TwitterAPI.io schema drift fixture 映射为 `provider_schema_drift`。
* X 真实发帖未设置硬开关时映射为 `real_post_not_allowed`。
* `debug-api-online` 真实发帖文本包含明显测试/调试标记时，在任何 TwitterAPI.io 或 X API 调用前映射为 `real_post_not_allowed`。
* 账号未配置 X token 时映射为 `missing_credentials`。
* X API 错误 fixture 映射为 `x_api_error` 或更具体错误。
* 本地 secrets 文件创建或 token 写回后权限为 `600`。
* 日志脱敏测试证明完整 token 不会出现在日志输出中。

在线 debug 不进入默认测试、CI、定时回归、agent 自主 Close Gate、"run all" 或自动补验流程。若用户明确要求并人工运行 `just debug-api-online`，验收报告必须记录：

* 是否配置 TwitterAPI.io key。
* 是否确认本次在线调用可能产生费用。
* 是否配置 X debug token。
* 是否执行真实发帖。
* 如果执行真实发帖，返回 tweet id。
* 如果执行真实发帖，第三方读回是否成功；未成功时记录 warning 和 residual risk。
* 如果未执行真实发帖，跳过原因。
* 任何 warning、schema drift 或 rate limit。

如果环境没有网络、用户不提供密钥、用户没有明确要求在线验证，或在线调用可能产生费用但未被确认，本子任务仍可通过离线 Gate，但 `04_review` 必须把在线 debug 列为未覆盖残余风险。
