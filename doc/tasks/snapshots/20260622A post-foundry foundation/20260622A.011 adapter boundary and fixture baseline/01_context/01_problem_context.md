# Problem Context

`.010` 定义了 source context，但未来真实数据入口不能各自发明一套格式。公开 X 搜索、高赞帖、网页/新闻资料和人工笔记都需要先转换成统一的 `SourceMaterialInput`，再进入 source context builder。

同时，真实 adapter 后续会产生费用、限流和失败。即使 `.011` 只做离线 fixture，也必须先把 `api_call_audit` contract 固定下来，避免后续在线入口绕过审计。

本任务只做 adapter 边界和 fixture。真实在线 TwitterAPI.io debug 入口放到后续任务。
