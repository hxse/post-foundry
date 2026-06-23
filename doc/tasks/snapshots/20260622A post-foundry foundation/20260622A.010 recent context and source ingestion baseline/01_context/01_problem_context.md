# Problem Context

`.009` 已经定义了 AI 发帖草稿需要的 input package，但真实运营前还缺一个稳定上游：AI 需要知道近期本账号发过什么、哪些热点值得看、哪些资料已经重新核验过。

这个上游不能直接变成“抓到什么就发什么”。高赞 X 帖只能用于学习选题、信息密度和表达节奏；新闻/网页/人工笔记需要作为可回看的 evidence。所有资料都必须按账号和 topic 归属，避免不同账号主题混在一起。

`.010` 先做离线 baseline：未来任何真实 adapter，无论来自 TwitterAPI.io、新闻源、人工笔记还是本地 ledger，都必须产出统一的 source material contract，再由本任务构造成 `.009` 可消费的 source context。
