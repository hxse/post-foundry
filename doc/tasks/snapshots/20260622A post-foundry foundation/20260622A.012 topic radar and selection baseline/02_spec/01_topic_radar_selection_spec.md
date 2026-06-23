# Topic Radar Selection Spec

## Position In Pipeline

`.012` 位于 `.011` adapter outputs 和 `.010` source context 之间：

* 输入：账号配置、config snapshot、prompt hash、source materials、recent posts。
* 输出：`TopicRadarPackage`，其中包含候选题列表和 `selectedTopic`。
* 下游：`.010 buildSourceContext` 使用 `selectedTopic` 继续整理资料，`.009` 使用 source context 生成草稿。

## Input Rules

`buildTopicRadar` 必须校验：

* config snapshot 和 account 的 `account_uuid` / `account_key` 一致。
* prompt 只按 account key 归属，输出和 ledger 中只保存 prompt hash / source / path，不保存 prompt 明文。
* source material / recent post 必须属于同一账号。
* source material id 和 recent post id 不重复。
* `candidatesLimit` 是正整数。
* `duplicateThreshold` 在 0 到 1 之间。

## Topic Selection

候选题必须：

* 只从账号 include topic 命中的素材中产生。
* 排除账号 exclude topic 命中的素材。
* 对 ASCII topic 使用词边界，避免 `AI` 命中 `daily` / `said`。
* 聚合同账号 topic 和素材 tags，生成稳定 topic id、label、keywords、reason。
* 根据来源类型、engagement、freshness、资料多样性和账号 topic 命中数量打分。
* 和近期已发内容做相似度检查；明显重复的候选题标记为 `suppressed_recent_duplicate`，不能作为 selected topic。

## Output Contract

`TopicRadarPackage` 必须包含：

* `kind = topic_radar_v1`
* `accountUuid` / `accountKey`
* account config version/hash/snapshot id
* prompt source/hash/path
* sanitized evidence materials
* material scores
* recent posts
* ranked candidates
* `selectedTopic`
* selection rationale / discarded reason
* guardrails:
  * no online calls
  * account scoped
  * prompt plaintext forbidden
  * select before source context
  * recent duplicate avoidance

## Ledger

`recordTopicRadarSelection` 必须在一个 transaction 中写入：

* `ai_runs`: purpose `topic_radar_selection`
* `evidence_refs`: topic radar 使用过的 source materials
* `audit_events`: event type `topic_selected`

如果 radar package 被污染，例如 selected topic 不在 candidates 中、material scores 与 materials 不匹配，必须在写 ledger 前拒绝，并保持无半条记录。

## Acceptance

离线测试必须证明：

* topic radar 能从账号相关素材中选出 topic，并能进入 `.010 buildSourceContext`。
* 近期语义重复的候选题会被压制，不会被选中。
* 跨账号素材、重复 material id、非账号 topic 输入会被拒绝。
* ledger 写入不包含 prompt 明文，只包含 prompt hash。
* 污染后的 radar package 会在写 ledger 前被拒绝，且不会留下半条记录。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。
