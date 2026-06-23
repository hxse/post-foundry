# Execution Plan

1. 新增 draft pipeline 模块，定义 draft input package、AI draft output、posting gate 和 ledger helper。
2. 复用 `.008` prompt hash contract，确保真实 prompt 明文不进入 ledger input。
3. 复用 `.004` ledger 表，不新增 migration。
4. 在 policy 前增加自然文本 gate，拦截格式化、debug、task 和 smoke-test 文案。
5. 增加近期重复检测 v0，先用归一化文本和字符 bigram Jaccard。
6. 增加离线测试入口 `just test-ai-posting-pipeline-offline`。
7. 跑离线验证，不执行任何在线服务调用。
