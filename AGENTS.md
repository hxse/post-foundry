# PostFoundry Agent Rules

## Project Vision

PostFoundry 的最终目标是让 Codex 中的 AI 成为少量自有 X 账号的长期运营助手：持续统计热点、查找和核验资料、形成选题、生成草稿、排程发布、读取表现数据并复盘经验。

这个项目不是水军系统、刷量系统或批量账号操控系统。它不做自动点赞、关注、骚扰式回复、互赞互转、趋势操纵、网页登录自动化或反检测浏览器。账号内容应像一个长期经营的真人账号一样自然、有观点、有节奏、有记忆，但系统必须保持可审计、可配置、可回放，并且不伪造互动、不绕过平台规则。

后续任务如果在“工程基础设施”和“运营闭环”之间取舍，应优先服务这个闭环：

* 发现公开热点和高质量资料。
* 按账号定位筛选、排序和去重。
* 生成符合账号风格的自然草稿。
* 在安全边界内排程和发帖。
* 用第三方公开数据 API 读取表现和评论。
* 把结果沉淀为账号级复盘记忆。

## X Access Boundary

严禁使用浏览器自动化、MCP 浏览器、Playwright、网页登录态、cookie、密码、反检测浏览器或模拟真人轨迹访问 `x.com` 做读取、验证、发帖或账号操作。

PostFoundry 的 X 边界固定为：

* X 官方 API 只用于发帖、OAuth token 校验、OAuth token 交换 / 刷新等官方允许的账号动作。
* 第三方公开数据 API 只用于读取公开 X 数据；当前第一版 adapter 是 TwitterAPI.io。
* 真实发帖后的读回验证必须使用第三方公开数据 API，例如 TwitterAPI.io `GET /twitter/tweets` 按 tweet id 查询，不得打开 `x.com` 页面人工观察或用 MCP 截图确认。
* 真实发帖测试禁止发布带有 `test`、`smoke test`、`PostFoundry`、task 编号、调试痕迹或明显机器人语气的文案。即使是测试，也必须使用自然、低调、像真人会发出的短句；推荐使用一句有哲理感但不夸张的中文句子。
* 任何默认测试、debug、验收、排障和报告都不得要求 agent 打开 `x.com`。
* OAuth 首次授权如果需要浏览器登录，只能由用户在自己的浏览器中手动完成；agent 只允许生成 / 打印授权 URL 和监听本地 callback，不得代开、代登、截图或读取页面。

如果第三方公开数据 API 暂时未索引新内容，应记录为 provider 延迟或未覆盖风险；不得退回浏览器访问 `x.com`。

## Online And Cost-Bearing Runs

在线测试、真实外部服务调用和可能计费的命令不得自动化运行。`just debug-api-online`、`just x-token`、`just x-token-auth`、X OAuth token endpoint 调用、真实发帖、第三方 API 读回验证和任何 TwitterAPI.io / X official 在线请求，都只能在用户当前明确要求时手动执行。

这些命令不得进入默认 `just test`、CI、定时回归、"run all"、agent 自主 Close Gate 或自动补验流程。默认验证只允许使用离线入口，例如 `just check`、`just test` 和 `just test-api-offline`。如果在线验证没有执行，报告应写清未执行原因和残余风险，而不是自动调用付费或真实 API 补齐。
