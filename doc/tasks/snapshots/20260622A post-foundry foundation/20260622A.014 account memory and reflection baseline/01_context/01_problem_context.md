# Problem Context

`.013` 已经证明单次离线运营闭环可以从素材、选题、source context、draft、policy 到 final action 全部写入 ledger。

但长期自动运营不能每次都从零开始。账号需要记住近期选过什么题、哪些草稿进入自动分支、哪些需要人工处理、哪些被 policy 拒绝，以及这些经验对下一次选题和发帖有什么影响。

`.014` 的目标是把 ledger 中的历史 trace 聚合成账号级 memory，并生成一份 deterministic reflection。它仍然是离线 baseline，不用在线 LLM，不抓真实表现数据，只先把“可沉淀、可复盘”落成代码和测试入口。
