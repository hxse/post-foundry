# Online Operation Runner Spec

## Entrypoints

`.016` 必须提供两个手动在线入口：

* `just run-once-online -- --account zh-tech`
* `just run-loop-online -- --account zh-tech --interval-seconds 28800`

两个入口都属于在线/可能计费的人工入口，不能进入 `just test`、CI、自动 Close Gate 或 agent 自主验证流程。通过 `just` 调用时必须使用原生 `--` 分隔 recipe 参数，CLI contract 使用 `--flag value` 分离参数形式，不支持也不要求 `--flag=value`。

## Shared Foundation

核心能力必须集中在一个 once runner：

* `runOnlineOperationOnce(input)`

loop 入口只能调用 once runner，不得复制完整流程。后续真实 source collection、LLM draft、policy、X/TG executor 都必须接入 once runner。

`.016` 的 CLI 当前只接安全 skipped executor，用于验证入口、锁、参数和 loop 语义。真实 provider wiring 后续任务接入，不在本任务中执行在线 API。

## Locking

锁必须按账号隔离，不做全局锁：

* 默认路径：`data/locks/operation.<account_key>.lock`
* 同一账号的 `run-once-online` 和 `run-loop-online` 必须互斥。
* 不同账号可以并行。
* loop 睡眠期间不得持锁。
* once 主动运行时如果 loop 正在执行该账号，once 必须等待锁。
* loop 到点运行时如果 once 正在执行该账号，loop 必须等待锁。

lock 文件必须包含：

* account key
* pid
* hostname
* entrypoint
* trace id
* startedAt
* expiresAt
* lock id

锁必须通过完整 JSON 临时文件加 atomic hard link 创建，目标锁路径不得出现空文件或半写入文件。正常完成、异常抛出时必须释放锁。启动前必须清理损坏 JSON、过期锁和本机已死亡 pid 的锁，避免断电或异常退出造成长期死锁。运行期间必须通过 heartbeat sidecar 刷新有效 `expiresAt`，不得重写主锁文件，避免 release 后锁被 heartbeat 复活。

## Loop Scheduling

`run-loop-online` 必须支持：

* `--interval-seconds`，默认 `28800`，即 8 小时；最小允许值为 `300` 秒，避免误配置成高频循环。
* `--jitter-seconds`，默认 `0`。
* `--sleep-utc HH:MM-HH:MM`，默认关闭。

睡眠时段按 UTC 解释，可以跨午夜。睡眠时段只影响下一轮是否启动，不打断已经开始的 run。

## Decision Semantics

一次完整流程可以发帖，也可以不发帖。runner 不能为了满足 cadence 强行发帖。后续真实 executor 接入时，最终是否发帖必须由 draft gate、policy 和账号配置共同决定。

## Acceptance

离线测试必须证明：

* once runner 会加锁、执行 executor、释放锁。
* 同账号 concurrent once run 不会并发执行。
* stale/corrupt lock 会被清理。
* loop runner 复用 once runner。
* interval jitter 可预测计算，且小于 `300` 秒的 loop interval 会被拒绝。
* UTC sleep window 会延迟下一轮启动。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。
