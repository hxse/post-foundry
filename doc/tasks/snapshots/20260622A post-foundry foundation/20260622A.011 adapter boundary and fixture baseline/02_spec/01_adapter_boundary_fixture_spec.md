# Adapter Boundary Fixture Spec

## Adapter Outputs

所有 source adapter 必须输出：

* `materials`: `.010` 的 `SourceMaterialInput[]`
* `apiAudit`: 可写入 `api_call_audit` 的对象

`materials` 必须包含 `accountUuid`，并交给 `.010` 做账号归属校验。

## TwitterAPI.io Public X Search

`collectTwitterApiIoSearchMaterials`：

* 输入：
  * `accountUuid`
  * `provider`: `PublicXDataProvider`
  * `query`
  * `limit`
  * `topicTags`
  * `collectedAt`
* 输出：
  * `sourceType = public_x_post`
  * `provider = twitterapi.io`
  * `sourceRef = tweet:<id>`
  * `sourceUrl` 保留公开 URL 字符串，但 agent 不得打开 `x.com`
  * engagement metrics
* `apiAudit`:
  * `provider = twitterapi.io`
  * `operation = public_x_search`
  * `status = succeeded | failed`
  * `requestUnits = 1`
  * metadata 包含 query、limit、raw_count、material_count 或错误摘要

`.011` 测试只能使用 fake `PublicXDataProvider`，不得发起真实网络请求。

## Manual Notes Fixture

`collectManualNoteMaterials`：

* 输出 `sourceType = manual_note`
* `provider = manual_fixture`
* `apiAudit.status = skipped`
* `requestUnits = 0`

## Web/News Fixture

`collectWebNewsFixtureMaterials`：

* 输出 `sourceType = web_page`
* `provider = web_news_fixture`
* `apiAudit.status = skipped`
* `requestUnits = 0`

本任务不抓网页，只接收 fixture 输入。

## API Audit

`recordSourceAdapterApiAudit` 必须校验：

* account uuid
* provider / operation 非空
* status enum
* request units 非负整数
* started/finished time 为 ISO datetime

如果 TwitterAPI.io adapter 被要求传入 `repo` 和 `apiAuditId`，成功和失败都必须写入 audit；失败后仍重新抛出原错误。
如果 provider/mapping 原本失败，failed audit 写入应是 best-effort，不能覆盖原始 provider/mapping 错误。provider 成功后的 success audit 写入失败，不得伪装成 provider failed。

## Acceptance

离线测试必须证明：

* TwitterAPI.io public X search fixture 能映射成 source materials。
* TwitterAPI.io adapter 输出 succeeded API audit。
* failed TwitterAPI.io adapter attempt 会写 failed API audit。
* provider 抛错且 failed audit 写入也失败时，仍抛原始 provider 错误。
* manual note fixture 和 web/news fixture 输出 source materials，且 audit 为 skipped。
* adapter 输出能进入 `.010` `buildSourceContext`。
* invalid adapter input 在调用 provider 前被拒绝。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。
