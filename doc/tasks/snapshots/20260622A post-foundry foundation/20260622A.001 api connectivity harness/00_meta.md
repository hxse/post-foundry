# 00 Meta

## 任务概括

建立 PostFoundry 的 API 连通性验证子任务。这个子任务只负责证明第三方 X 数据 API 与 X 官方 API 的最小 contract、错误语义、离线测试和人工在线 debug 入口，不实现完整业务功能。

## 正式 task 级别及定级原因

三星任务。原因是它涉及真实外部服务、真实 X 发帖副作用、密钥处理、API 响应 schema、错误语义和项目第一批 `just` 验证入口。如果默认测试误连网络、在线 debug 误发帖子、fixture 与真实 API contract 漂移，后续所有发帖和数据读取能力都会建立在不可信基础上。

## 范围内与范围外

范围内：

* 建立 `just test-api-offline` 离线测试入口。
* 建立 `just debug-api-online` 在线 debug 入口；该入口只能在用户当前明确要求时手动运行。
* 冻结公开 X 数据 provider port，并实现 TwitterAPI.io 只读 adapter 的 client contract。
* 冻结 X 官方 API 发帖 client 的 dry-run、真实发帖保护和错误语义。
* 冻结本地 secrets 文件、账号级凭据解析、环境变量覆盖、密钥缺失、网络失败、rate limit、授权失败和 schema drift 的处理口径。
* 冻结 API fixture、mock 和在线 smoke 的分层，明确在线、真实外部服务和可能计费的验证不得自动化运行。

范围外：

* 不实现完整 OAuth 授权 UI。
* 不实现多账号注册表；本子任务只允许通过本地 secrets 文件中的调试账号验证 API，并用 `account_key` 选择账号。
* 不实现正式发帖队列、调度器、重试系统或业务后台 UI。
* 不实现 TwitterAPI.io 之外的其他 provider adapter、运行时 provider registry 或多 provider 策略选择。
* 不实现评论审核、隐藏回复、点赞、关注、回复或转发。
* 不访问网页登录态，不保存 X 密码或 cookie，不做反检测浏览器。
* 不把 TwitterAPI.io 查询、X OAuth token endpoint、真实发帖或第三方读回做成自动测试。
