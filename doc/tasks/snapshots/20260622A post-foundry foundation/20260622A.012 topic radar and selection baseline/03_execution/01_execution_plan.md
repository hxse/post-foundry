# Execution Plan

1. 新建 `src/lib/topics/topic-radar.ts`。
2. 实现 `buildTopicRadar`：
   * 账号 / snapshot / prompt 归属校验。
   * material / recent post schema 校验。
   * account include/exclude topic filtering。
   * candidate 聚合、打分、近期重复压制和 selected topic 输出。
3. 实现 `recordTopicRadarSelection`：
   * transaction 写 `ai_runs`、`evidence_refs`、`audit_events`。
   * prompt 明文不落盘。
   * 污染 package 写入前拒绝。
4. 新增 `tests/topic-radar-offline.test.ts`。
5. 新增 `just test-topic-radar-offline` 和 package script。
6. 更新 task index 和 review 文档。
