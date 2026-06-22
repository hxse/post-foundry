# 项目基础规范

## 任务边界

本 root task 冻结 PostFoundry 第一阶段的项目基础规范，不直接实现业务代码。它的交付物是可供人工审阅的设计真值链：项目定位、技术栈、多账号隔离、API 读写边界、配置分层、验证入口和子任务拆分。

当前任务做到以下程度即停止：

* 人工可以从 task 文档看懂 PostFoundry 初始系统要做什么、不做什么。
* 人工可以判断为什么选择 Bun、TypeScript、SvelteKit、SQLite 和 Drizzle。
* 人工可以判断多账号为什么用 `account_uuid` 做内部真值、`account_key` 做可配置标识。
* 人工可以判断外部 API 为什么分成第三方 X 数据只读和 X 官方 API 写入。
* 人工可以判断第一个 API 子任务为什么同时包含离线测试和在线 debug，而不是拆成两个子任务。
* 后续实现不得绕开本 task 冻结的 `just` Gate 和安全边界。

当前任务不冻结完整产品功能，不冻结 UI 细节，不冻结最终数据库全量 schema，不冻结 LLM prompt 全文，不冻结 X 热点算法，不冻结 Podman 镜像实现。

## 任务规范

PostFoundry 是一个本地优先的多账号社交内容运营后台。它服务于少量 X 账号的长期运营，不做水军、不做刷量、不做网页登录自动化、不做反检测浏览器、不托管 X 密码或 cookie。系统的核心价值是把公开信息源、第三方 X 数据、LLM 草稿、排程、统计和复盘串成可审计、可配置、可回放的运营流程。

### 产品愿景

PostFoundry 的最终目标是让 Codex 中的 AI 自动化辅助运营自有 X 账号。这里的“自动化运营”指的是一个可审计的内容工作流，而不是批量账号操控或互动刷量。系统应逐步具备以下闭环：

```text
公开热点和资料源
    -> 账号级主题过滤
    -> 资料查找与核验
    -> 选题排序
    -> 草稿生成
    -> 风格与风险检查
    -> 排程发布
    -> 表现读取
    -> 账号级复盘记忆
```

这个闭环必须像长期经营的真人账号一样自然、有节奏、有观点和记忆，但不能伪造真人操作轨迹，不能批量制造互动，不能自动骚扰陌生人，不能绕过平台风控。AI 可以承担研究、写作、排程和复盘的劳动；账号动作必须通过官方 API 和项目定义的安全边界完成。

后续所有 root task 都应服务这个闭环。基础设施任务如果看起来离“自动运营”较远，也必须能解释它保护了哪一类核心风险，例如账号串号、预算失控、资料来源不可追溯、真实发帖误触发、风格漂移、历史经验污染或在线 API 成本失控。

### 技术栈

项目主语言使用 TypeScript。第一阶段不引入 Python。原因是当前主线是 API 编排、本地后台、多账号配置、OAuth、SQLite、任务调度和 UI 管理台，TypeScript 能让前后端、配置 schema、API 响应校验和测试共享一套类型系统。

运行时和包管理使用 Bun。Bun 负责脚本运行、依赖安装、测试辅助和本地开发执行。项目可以使用 Bun 的 SQLite 能力，但数据库访问的正式抽象通过 Drizzle 承载，避免业务代码直接散落 SQL。

UI 使用 SvelteKit，但必须克制使用。SvelteKit 只承担本地管理台页面、少量 server endpoints、OAuth callback 和表单状态展示。业务真值不能写在 `+page.server.ts` 或 route 里，route 只做参数解析、调用 service 和返回结果。核心业务必须在普通 TypeScript 模块中表达。

Vite 由 SvelteKit 间接使用，负责开发服务器和构建。不单独创建 raw Vite 前端加独立后端的架构。

数据库使用 SQLite 文件，不启 Postgres、MySQL、Redis 等后台服务。默认数据库路径为 `data/post-foundry.sqlite`，路径必须可配置。后期 Podman 部署时，`data/` 应作为 volume 挂载。

ORM 使用 Drizzle。配置校验使用 Zod。离线测试使用 Vitest。项目所有正式检查、测试、debug 和运行入口统一通过 `just` 暴露。

### 目录边界

实现阶段的目录边界应遵循以下形态：

```text
src/lib/core/          领域模型、账号隔离、配置、预算、策略
src/lib/db/            Drizzle schema、repo、migration
src/lib/providers/     公开 X 数据 provider port、TwitterAPI.io adapter、X official API、LLM provider
src/lib/jobs/          scheduler、发帖任务、数据抓取任务
src/lib/services/      topic、draft、publishing、review、metrics
src/routes/            SvelteKit 薄 UI/API glue
debug/                 在线 API smoke scripts
tests/                 离线 contract tests 和 fixtures
data/                  本地 SQLite 文件，默认不提交真实数据
config/                非敏感配置示例和默认配置
```

`src/routes/` 不得成为业务真值源。任何会被 CLI、scheduler、debug 脚本或测试复用的逻辑，都必须放进 `src/lib/**`。

### 多账号隔离

系统必须从第一天支持 N 个账号。账号数量不写死，账号身份、语言、内容策略和运行参数通过配置和数据库记录驱动。

账号有三层身份：

```text
account_uuid    系统内部不可变主键，由系统生成，所有业务表用它关联
account_key     外部可配置标识，可重命名，用于命令、UI 和配置引用
x_identity      X 平台身份，包括 x_user_id、x_handle 和 OAuth token 状态
```

`account_uuid` 是防串号真值。历史帖子、草稿、复盘、预算、API 调用日志和评论审核队列必须绑定 `account_uuid`。即使 `account_key` 从 `zh-tech` 改成 `cn-ai-finance`，历史数据也不能换归属。

`account_key` 是给人看的稳定别名，但不是数据库关系真值。它必须唯一，可配置，可重命名。重命名必须生成审计记录，避免后续分析时不知道历史配置如何变化。

每个账号独立拥有：

* 语言和受众。
* 主题范围和禁止话题。
* 风格提示词和质量标准。
* 选题源和关键词池。
* 发帖节奏、每日上限、冷却时间和真实发帖开关。
* 数据 API 预算和 LLM 预算。
* 草稿池、发帖队列、评论审核队列。
* 历史指标、复盘结论和运营经验。
* X OAuth token 和平台身份状态。

全局模块可以共享 provider、RSS 抓取器、GitHub Trending 抓取器、公开 X 数据 provider port、X official API client、LLM provider 和通用解析工具，但不能共享账号级内容决策。业务层不得直接依赖 TwitterAPI.io 的响应形态；TwitterAPI.io 只是公开 X 数据 provider port 的第一版 adapter。所有内容决策必须进入 account-specific pipeline：

```text
global source data
    -> account-specific filter
    -> account-specific ranking
    -> account-specific draft generation
    -> account-specific approval/schedule
    -> account-specific learning
```

### 配置分层

配置分为三类：

```text
global config      全局默认值、provider、预算默认值、测试开关
account config     账号启用状态、语言、主题、风格、数据源、发帖节奏
runtime state      token、队列、历史帖子、评论队列、指标、复盘记忆
```

非敏感配置可以放在 `config/*.yaml` 或数据库中，并由 Zod schema 校验。敏感配置不能写入普通配置文件，也不能写入 task 文档或测试 fixture。v0 默认从本地 secrets 文件读取敏感配置，默认路径为 `secrets/accounts.local.json`；该文件必须被 Git / jj 忽略，不能提交，本地权限必须是 `600`。环境变量只作为离线 CI、一次性 debug 或临时覆盖入口，不作为日常运行的唯一凭据来源；CI 不得借环境变量访问真实 provider 或执行可能计费的在线验证。

本地 secrets 必须按账号隔离。X 官方 OAuth token 必须挂在具体 `account_key` 下，后续账号 registry 落地后再通过可信 resolver 映射到 `account_uuid`。第三方公开数据 provider 的 API key 可以有全局默认值，也可以被账号级配置覆盖；即使使用全局 provider key，预算归因和抓取行为仍必须绑定账号。task 和测试 fixture 禁止包含真实 token、cookie、手机号、身份证、支付信息或 X 密码。

每次生成草稿、排程、发帖或复盘时，系统必须记录当时使用的账号配置版本。否则后续修改风格配置后，会无法解释历史内容是在什么规则下生成的。

### 外部 API 边界

第三方 X 数据 API 只读公开数据。第一候选是 TwitterAPI.io，它适合关键词搜索、用户公开 posts、评论和公开资料读取。热点扫描、公开账号观察和 topic source 相关读取都归公开 X 数据 provider port 承载，不走 X 官方 API。第三方数据 API 的成本风险来自查询次数、返回条数、分页规模和 provider 计费规则；第一子任务只允许人工明确触发的小样本 smoke，正式查询预算在账号配置和后续 topic task 中冻结。第三方数据 API 不能获得 X 密码、cookie 或登录态，也不能执行点赞、关注、回复或发帖。

公开 X 数据 provider port 是业务层唯一依赖的读取入口。TwitterAPI.io adapter 负责把 provider 原始请求、响应、分页、错误和字段命名转换为项目内部类型。后续如果替换到 SocialData、Apify 或其他 provider，应新增 adapter 或替换 adapter，而不是让 topic、draft、metrics 或 account-specific pipeline 直接改调用 TwitterAPI.io 的代码。

X 官方 API 只做账号动作和官方允许的写入能力，例如发帖。它不是热点扫描或公开数据读取的主数据源。发帖使用 OAuth 授权后的账号 token。一个 Developer App 可以服务多个账号，但每个账号必须单独 OAuth 授权，系统按 `account_uuid` 隔离 token 和发布队列。X 官方 API 的第一阶段风险主要是授权、发帖 rate limit、错误语义和真实发帖副作用，不承载第三方数据 API 的查询预算。

任何实现、验证、debug 和验收都禁止用浏览器自动化、MCP 浏览器、Playwright、网页登录态或人工观察 `x.com` 页面来读取、确认或操作 X 内容。真实发帖后的读回验证必须通过第三方公开数据 API，例如 TwitterAPI.io 按 tweet id 查询；如果第三方 provider 尚未索引新内容，只能记录为 provider 延迟或残余风险，不能退回浏览器访问 `x.com`。OAuth 首次授权若需要浏览器登录，只能由用户在自己的浏览器中手动完成；agent 只能生成授权 URL、监听本地 callback 和调用官方 token endpoint，不得代开、代登、截图或读取授权页面。

真实发帖测试本身也属于对外内容，不能发布 `smoke test`、`PostFoundry .001`、task 编号、调试说明或任何明显机器味测试文案。即使是验证链路，也必须使用自然、低调、像真人会发出的短句；推荐使用一句有哲理感但不夸张的中文句子。测试文案仍必须由人工明确提供或确认，不能由脚本随机生成。

在线测试、真实外部服务调用和可能计费的命令不能自动化运行。`just debug-api-online`、`just x-token`、`just x-token-auth`、X OAuth token endpoint 调用、真实发帖、第三方 API 读回验证和任何 TwitterAPI.io / X official 在线请求，都只能在用户当前明确要求时手动执行。它们不得进入默认 `just test`、CI、定时回归、agent 自主 Close Gate、"run all" 或自动补验流程；如果未执行，只能在报告中记录未覆盖原因和残余风险。

评论处理第一阶段只允许做分类和人工确认队列。X API 有 hide reply 能力，但 X 自动化规则不允许无人自动 hide replies。PostFoundry 可以把广告、色情、人身攻击和正常评论分类，也可以在后台默认勾选高置信垃圾评论，但最终隐藏动作必须由人确认触发。无人后台自动隐藏回复不是本项目默认能力。

项目禁止实现以下能力：

* 反检测浏览器。
* 用 MCP 或 Playwright 模拟真人轨迹操作 x.com 发帖。
* 用浏览器、MCP 或 Playwright 打开 `x.com` 做内容读取、发帖结果验证、截图验收或排障。
* 托管 X 密码、cookie 或网页登录态。
* 代理轮换、浏览器指纹伪装、验证码绕过。
* 自动点赞、自动关注、自动回复陌生人。
* 多账号互赞、互转、互评或发高度相似内容。
* 无人自动隐藏回复。
* 发布明显机器味的测试帖，例如包含 `smoke test`、`PostFoundry`、task 编号或调试说明的真实帖子。
* 把在线、真实外部服务或可能计费的测试加入默认测试、CI、定时回归、agent 自主 Close Gate 或自动补验流程。

### 第一主任务拆分

第一主任务拆成三个子任务。当前只详细展开第一个子任务，后续子任务在 root task 中冻结范围，等第一个子任务完成后再补正式 task 文档。

```text
20260622A.001 api connectivity harness
    API 连通性、离线 fixture 测试、在线 debug 入口、真实发帖保护。

20260622A.002 account registry and config isolation
    多账号注册表、account_uuid/account_key/x_identity、配置版本和每账号预算字段隔离。

20260622A.003 runtime skeleton and storage baseline
    SQLite/Drizzle 迁移、repo 基线、日志、审计、job 状态和本地运行骨架。
```

第二和第三子任务暂不实现以下内容：正式选题、LLM 草稿、发帖排程、复盘算法、评论审核 UI。这些能力属于后续 root task。

## 示例

账号配置示例：

```yaml
accounts:
  - key: zh-tech
    display_name: 中文技术号
    platform: x
    language: zh-CN
    enabled: true
    topics:
      include:
        - AI
        - finance
        - open_source
        - frontier_tech
        - digital_nomad
      exclude:
        - politics
        - gender_war
        - social_issues
    posting:
      cadence_hours: 6
      daily_min: 3
      daily_max: 4
      require_approval: false
    budget:
      x_data_usd_monthly_cap: 10
      llm_usd_monthly_cap: 20

  - key: en-tech
    display_name: English Tech
    platform: x
    language: en-US
    enabled: true
    topics:
      include:
        - ai_infra
        - fintech
        - open_source
        - devtools
        - silicon_valley
      exclude:
        - election_process_claims
        - culture_war
    posting:
      cadence_hours: 6
      daily_min: 3
      daily_max: 4
      require_approval: false
    budget:
      x_data_usd_monthly_cap: 15
      llm_usd_monthly_cap: 30
```

内部账号记录示例：

```json
{
  "account_uuid": "018f8a6d-7f31-7b0a-a8b2-1c0adca0e001",
  "account_key": "zh-tech",
  "display_name": "中文技术号",
  "platform": "x",
  "x_user_id": "123456789",
  "x_handle": "example_zh",
  "enabled": true,
  "config_version": 4
}
```

重命名账号时，业务表仍然关联 `account_uuid`：

```text
before: account_key = zh-tech
after:  account_key = cn-ai-finance

posts.account_uuid        不变
drafts.account_uuid       不变
metrics.account_uuid      不变
learnings.account_uuid    不变
audit_log                 记录 account_key rename
```

第一阶段预期 `just` 入口示例：

```text
just check
just test
just test-api-offline
just debug-api-online
```

`just test-api-offline` 是正式 Gate，可以进入默认测试链路。`just debug-api-online` 是人工手动入口，需要本地 secrets 文件或显式临时覆盖，不进入默认测试、CI、定时回归、agent 自主 Close Gate 或任何自动补验流程。

## 测试

第一主任务的正式实现必须遵守以下测试口径：

* 默认验证使用离线入口，不依赖网络、真实 X、真实 TwitterAPI.io 或人工观察。
* 在线 API 诊断必须放在 `debug/` 或等价目录，只能在用户当前明确要求时通过 `just debug...` 命令手动运行。
* 任何可能计费的第三方 API 请求、X OAuth token endpoint 调用、真实发帖和读回验证都不能作为自动测试、CI 或 agent 自主验证步骤。
* 真实发帖必须默认关闭，必须同时指定测试账号和硬开关后才允许执行。
* 缺少 API key、token 或网络权限时，在线 debug 必须清晰失败，不能伪装成离线测试失败。
* 所有 API 响应必须通过 schema 校验；第三方返回结构漂移必须变成明确错误。
* 测试 fixture 不能包含真实 token、真实 cookie 或个人身份信息。

第一主任务完成代码落地后的 Close Gate 至少需要：

```text
just check
just test
just test-api-offline
```

如果用户当前明确要求执行在线验收，需要额外手动运行：

```text
just debug-api-online
```

在线验收不替代离线 Gate，也不得由 CI、默认测试、agent 自主 Close Gate 或自动补验流程触发。若环境没有 API key、用户不允许联网、用户没有明确要求在线验证，或在线调用可能产生费用，最终报告必须写清未执行在线 debug 的原因和残余风险。
