# Execution Plan

1. 扩展 `secrets/accounts.local.json` schema，允许账号段声明 `initial_prompt` 或 `initial_prompt_path`，并拒绝二者同时存在。
2. 增加账号 prompt loader，从指定账号的 secrets 中解析初始提示。
3. 对文件路径加边界校验：相对路径、位于 `secrets/` 下、`.md` 后缀。
4. 对加载结果计算 `sha256`，供后续 ledger 记录 prompt 版本。
5. 更新 secrets example，只放占位路径，不放真实 prompt 内容。
6. 增加离线测试和 `just test-account-prompt-offline`。
7. 跑离线验证，不执行任何在线调用。
