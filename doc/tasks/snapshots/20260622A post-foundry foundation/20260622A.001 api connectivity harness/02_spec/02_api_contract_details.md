# API Contract 细节

本文件补充 `01_api_connectivity_harness_spec.md` 的 API contract 细节。它只承载本地 secrets 文件、环境变量覆盖、公开 X 数据 provider port、TwitterAPI.io adapter、client 输入输出、错误语义、日志脱敏和 fixture 规则，不重复任务边界和执行计划。

## 本地 secrets 与环境变量覆盖

日常运行默认从本地 secrets 文件读取真实凭据，不要求用户每次手动配置环境变量。默认路径为：

```text
secrets/accounts.local.json
```

仓库必须自带一个不含真实密钥的模板：

```text
secrets/accounts.local.example.json
```

个人配置通过以下命令从模板复制：

```text
just init-secrets
```

`just init-secrets` 只在 `secrets/accounts.local.json` 不存在时复制模板，不得覆盖已有个人配置。`secrets/accounts.local.json` 必须被 Git / jj 忽略，不能提交，并且本地文件权限必须是 owner read/write only，即 Unix mode `600`。`secrets/accounts.local.example.json` 必须可以提交，用于展示字段结构和占位值。文件内容必须按账号隔离，v0 推荐格式：

```json
{
  "version": 1,
  "global_providers": {
    "twitterapi_io": {
      "api_key": "replace-with-local-secret"
    },
    "x_official": {
      "client_id": "replace-with-x-oauth-client-id",
      "client_secret": "replace-with-x-oauth-client-secret",
      "redirect_uri": "http://localhost:2619/auth/x/callback"
    }
  },
  "accounts": {
    "zh-tech": {
      "providers": {
        "twitterapi_io": {
          "api_key": "optional-account-level-override"
        }
      },
      "x_official": {
        "access_token": "replace-with-local-secret",
        "refresh_token": "optional-local-secret",
        "expires_at": "2026-12-31T00:00:00Z"
      }
    }
  }
}
```

X 官方 token 必须挂在具体账号下，不能作为全局 token 使用。TwitterAPI.io API key 可以使用 `global_providers.twitterapi_io.api_key`，也可以被 `accounts.<account_key>.providers.twitterapi_io.api_key` 覆盖；无论使用哪一种，调用、预算和日志都必须绑定当前 `account_key`。

X OAuth App 凭据放在 `global_providers.x_official`，因为 `client_id`、`client_secret` 和 `redirect_uri` 属于当前 X App，不属于某个账号。账号级 `accounts.<account_key>.x_official` 只保存该账号授权后得到的 `access_token`、`refresh_token` 和 `expires_at`。

凭据解析顺序：

```text
1. 命令行显式指定 --account <account_key>。
2. 读取 POST_FOUNDRY_SECRETS_FILE 指向的本地 secrets 文件；未设置时读取 secrets/accounts.local.json。
3. 解析账号级 provider override。
4. 如果账号没有 provider override，再解析 global provider credential。
5. 离线 CI、一次性 debug 或临时覆盖场景才读取环境变量；CI 不得借环境变量触发真实 provider 请求。
```

环境变量只作为覆盖入口，不是日常运行唯一方式。变量名属于本子任务 contract，后续实现不得随意改名；如果未来改名，必须作为 breaking task 处理。

```text
POST_FOUNDRY_SECRETS_FILE          可选，本地 secrets 文件路径覆盖。
TWITTERAPI_IO_API_KEY              可选，TwitterAPI.io API key 临时覆盖。

X_DEBUG_ACCESS_TOKEN               可选，已授权测试账号的 X OAuth access token 临时覆盖。
X_DEBUG_REFRESH_TOKEN              可选，X refresh token 临时覆盖。
X_DEBUG_ACCOUNT_KEY                可选，调试账号 key 临时覆盖；日常运行应使用 --account。
X_DEBUG_POST_TEXT                  可选，真实发帖文本临时覆盖；日常运行应使用命令参数或项目队列。

POST_FOUNDRY_API_DEBUG_TIMEOUT_MS  在线 debug 超时，可选。
```

后续实现 X OAuth callback 时，本地开发统一使用以下地址，并要求代码、X Developer Portal 和本地配置完全一致：

```text
Callback URI / Redirect URL: http://localhost:2619/auth/x/callback
Website URL: http://localhost:2619
```

### 在线与计费边界

本子任务的默认自动验证只允许离线入口：

```text
just check
just test
just test-api-offline
```

任何访问真实网络、真实 provider、OAuth endpoint、第三方公开数据 API 或 X official API 的命令，都不属于自动测试。以下操作只能在用户当前明确要求时手动执行：

```text
just debug-api-online
just x-token
just x-token-auth
```

同一规则也适用于真实发帖、真实发帖后的第三方读回、TwitterAPI.io 查询、X OAuth token refresh / exchange 和任何后续新增的在线 smoke。第三方 API 的计费规则可能随套餐变化；只要命令会产生真实 provider 请求，就按可能计费处理，不得进入 `just test`、CI、定时回归、agent 自主 Close Gate、"run all" 或自动补验流程。

如果在线验证没有执行，离线 Gate 不因此失败。实现者必须在 review 或最终报告中记录未执行原因，例如用户未明确要求、缺少密钥、网络受限、可能产生费用、未授权真实发帖或 provider 暂时不可用，并记录残余风险。

### X OAuth token 手动维护入口

本子任务提供两个手动 token 维护入口。它们会访问 X OAuth endpoint，只能在用户当前明确要求时运行，不能作为测试套件、CI、agent 自主 Close Gate 或自动补验的一部分。首次授权入口是：

```text
just x-token-auth --account=zh-tech
```

该命令必须：

* 读取 `global_providers.x_official.client_id`、可选 `client_secret` 和 `redirect_uri`。
* 只支持本地 `http://localhost:2619/auth/x/callback` 这类 local redirect。
* 生成一次性 PKCE `code_verifier` / `code_challenge` 和 `state`。
* 打印 X authorize URL，scope 固定包含 `tweet.read tweet.write users.read offline.access`。
* 在本地监听 callback，校验 `state`，收到 `code` 后立即调用 token endpoint。
* 用 `--account` 决定写回 `accounts.<account_key>.x_official`，不得写其他账号。
* 输出 token 指纹和过期时间，不得输出完整 token、client secret 或 refresh token。
* 只允许打印授权 URL 并等待本地 callback；agent 不得用浏览器、MCP、Playwright 或截图工具代替用户打开 `x.com` 授权页面。
* 不得被 CI、定时回归、默认测试或 agent 自主验证自动调用。

刷新入口是：

```text
just x-token --account=zh-tech --mode=refresh
```

写回目标由两部分显式决定：

* `--account=zh-tech` 决定更新 `accounts.zh-tech.x_official`，脚本不得猜账号，也不得写其他账号。
* `--secrets=<path>` 或 `POST_FOUNDRY_SECRETS_FILE` 决定写哪个 secrets 文件；未指定时写 `secrets/accounts.local.json`。

refresh 模式读取 `accounts.<account_key>.x_official.refresh_token`，调用 X OAuth token endpoint 换取新的 `access_token`，并把返回的 `access_token`、新的 `refresh_token` 和 `expires_at` 写回同一个账号。写回后必须把 secrets 文件权限设为 `600`。如果 X 没返回新的 `refresh_token`，保留原有 refresh token。

首次授权如果已经从浏览器 callback 拿到 `code` 和本地保存的 `code_verifier`，可以使用：

```text
just x-token --account=zh-tech --mode=exchange-code --code=<callback-code> --code-verifier=<pkce-code-verifier>
```

该模式用 `global_providers.x_official.client_id`、`client_secret` 和 `redirect_uri` 换取账号 token，并写回 `accounts.zh-tech.x_official`。写回后必须把 secrets 文件权限设为 `600`。命令输出只能打印 token 指纹和过期时间，不能打印完整 token。

第一子任务不实现完整 OAuth callback，因此账号级 `x_official.access_token` 由人工通过安全方式写入本地 secrets 文件。后续 `20260622A.002` 或独立 OAuth task 再把 token 归入账号 registry、加密存储或 token refresh 流程。

## 公开 X 数据 provider port

业务层读取公开 X 数据时只能依赖项目内部 provider port，不能直接调用 TwitterAPI.io adapter，也不能读取 TwitterAPI.io 原始响应。第一子任务只冻结搜索 smoke 需要的最小 port；后续 topic task 可以在同一 port 下扩展更多读取能力。

最小输入 contract：

```ts
type PublicXSearchInput = {
  query: string;
  limit: number;
};

type PublicXPostSnapshot = {
  id: string;
  text: string;
  authorHandle?: string;
  authorId?: string;
  createdAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  url?: string;
};

type PublicXSearchOutput = {
  posts: PublicXPostSnapshot[];
  sourceProvider: "twitterapi.io";
  rawCount: number;
};

interface PublicXDataProvider {
  searchPosts(input: PublicXSearchInput): Promise<PublicXSearchOutput>;
  getPostById(id: string): Promise<PublicXPostSnapshot | undefined>;
}
```

`sourceProvider` 只用于日志、审计、成本归因和 debug，不得让业务层根据它分叉执行不同逻辑。未来新增 provider 时，应扩展 `sourceProvider` 的可选值并新增 adapter；topic、draft、metrics 和 account-specific pipeline 仍然只依赖 `PublicXDataProvider`。

## TwitterAPI.io 只读 adapter

TwitterAPI.io adapter 的职责只包括把 TwitterAPI.io 的公开数据接口转换为 `PublicXDataProvider` 内部 contract。本子任务至少冻结一个搜索 smoke contract，不把 TwitterAPI.io 的字段命名、分页语义或错误包直接暴露给业务层。

```ts
class TwitterApiIoPublicXAdapter implements PublicXDataProvider {
  searchPosts(input: PublicXSearchInput): Promise<PublicXSearchOutput>;
  getPostById(id: string): Promise<PublicXPostSnapshot | undefined>;
}
```

`limit` 必须有上限。第一子任务的默认在线 smoke 不得超过 `10` 条结果，且只能由用户当前明确要求后手动运行，避免误消耗第三方数据 API 预算。本子任务不冻结正式热点扫描预算；`20260622A.002` 只冻结每账号预算字段和隔离规则，真实查询频率、分页规模、关键词规模和 provider 调用预算由后续 topic task 冻结。

TwitterAPI.io adapter 不得调用任何账号动作、网页登录、cookie、发帖、点赞、关注、回复或转发相关接口。即使 provider 提供这类能力，也不属于 PostFoundry 第一阶段正式 contract。

真实发帖后的读回验证也归第三方公开数据 API，而不是浏览器访问 `x.com`。当前推荐用 TwitterAPI.io `GET /twitter/tweets` 按 tweet id 查询，验收只记录第三方 API 返回的 `id`、`authorHandle`、`text`、`url` 和 `createdAt`。该 endpoint 的 200 JSON 响应必须校验 `tweets`、`status` 和 `message`；只有 `status: "success"` 且 `tweets` 为空时，才可以把结果解释为 provider 尚未索引。`status: "error"` 必须映射为 `provider_error`，不能当成索引延迟。`debug-api-online --allow-real-post` 在真实发帖成功后必须尝试调用 `getPostById(tweetId)` 读回；如果第三方 API 发生限流、schema drift、network failure、`status: "error"` 或索引延迟，命令必须输出 warning 和 residual risk，不得退回 MCP 浏览器、Playwright、网页登录或页面截图补验。读回验证会访问第三方 API，可能产生费用，只能在用户明确要求时手动执行。

adapter 必须把 provider 错误映射成项目内部错误语义：

```text
missing_credentials
unauthorized
rate_limited
network_error
provider_schema_drift
provider_error
invalid_request
```

任何无法通过 schema 校验的成功响应都必须是 `provider_schema_drift`，不能静默丢字段后继续成功。schema drift 发生在 adapter 层；业务层不得自己兜底解析 provider 原始响应。

## X official publisher client

X official publisher client 的职责只包括通过官方 API 构造和发送当前账号的帖子。本子任务只冻结单条文本帖，不做 thread、quote、reply、media upload、delete，也不做热点扫描或公开数据读取。

输入 contract：

```ts
type XPostInput = {
  accountKey: string;
  text: string;
  dryRun: boolean;
};

type XPostOutput =
  | {
      status: "dry_run";
      accountKey: string;
      textLength: number;
      requestPreview: {
        method: "POST";
        path: "/2/tweets";
      };
    }
  | {
      status: "posted";
      accountKey: string;
      tweetId: string;
      textLength: number;
    };
```

默认 `dryRun` 必须为 `true`。真实发帖必须同时满足：

```text
dryRun = false
--account 已指定且能解析到本地 secrets 中的账号
账号级 x_official.access_token 已配置，或 X_DEBUG_ACCESS_TOKEN 临时覆盖已配置
--post-text 非空，或 X_DEBUG_POST_TEXT 临时覆盖非空
```

任一条件不满足时，client 必须返回明确错误，不得降级为“看起来成功”的 dry-run，也不得尝试调用真实发帖 endpoint。

真实发帖文本必须来自 `--post-text`、`X_DEBUG_POST_TEXT` 临时覆盖或后续明确的人工确认输入。本子任务禁止使用随机文本、fixture 文本或默认文案发真实帖。真实发帖测试也不得使用 `smoke test`、`PostFoundry`、task 编号、调试说明或明显机器人语气；测试帖应使用自然、低调、像真人会发出的短句，推荐一句有哲理感但不夸张的中文句子。

`debug-api-online --allow-real-post` 在调用任何 TwitterAPI.io 或 X API 前必须执行保守文本拦截。若文本包含明显测试/调试标记，例如 `PostFoundry`、`smoke`、`test`、`debug`、`dry-run`、task id、`测试` 或 `调试`，命令必须返回 `real_post_not_allowed`，不得读取 secrets 后继续进入在线 smoke，也不得发出真实请求。生产发帖队列的内容策略另行设计，本规则只约束 .001 debug 真实发帖入口。

真实发帖和真实发帖后的读回验证都不能作为自动测试运行。即使 debug 入口显式传入 `--allow-real-post`，也只能在用户当前明确要求并提供或确认发帖文本后执行。

X publisher 错误语义：

```text
real_post_not_allowed
missing_credentials
missing_post_text
unauthorized
forbidden
rate_limited
network_error
x_schema_drift
x_api_error
invalid_request
```

## 日志与脱敏

日志可以输出以下内容：

* provider 名称。
* 请求类型。
* 是否 dry-run。
* 返回条数。
* tweet id。
* token 是否配置。
* token 指纹，例如前 4 位和后 4 位。

日志禁止输出：

* 完整 API key。
* 完整 OAuth token。
* refresh token。
* X 密码、cookie、网页登录态。
* 身份证、手机号、支付信息。

## Fixture 规则

离线 fixture 必须放在测试目录下，并只包含脱敏样例。fixture 要覆盖：

* TwitterAPI.io 搜索成功。
* TwitterAPI.io 空结果。
* TwitterAPI.io rate limit。
* TwitterAPI.io 成功响应 schema drift。
* X dry-run 成功。
* X 真实发帖被硬开关拦截。
* X 真实发帖成功响应解析。
* X API 错误响应解析。

fixture 不能从真实在线响应原样复制带敏感信息的内容。如果从真实响应整理 fixture，必须先脱敏并最小化字段。
