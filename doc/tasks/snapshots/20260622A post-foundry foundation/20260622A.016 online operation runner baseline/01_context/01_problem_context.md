# Problem Context

`.015` 已经把 LLM draft adapter boundary 固定住，但真实运营不能只靠一个 debug 命令。用户需要两个在线入口：一次性跑完整运营流程，以及按固定间隔循环跑同一流程。

关键不是维护两套流程，而是一个底座两个入口：循环入口只能是一次性入口的调度器。这样后续接真实 source adapter、真实 LLM、真实 Telegram 或真实 X executor 时，只需要接到同一个 once runner 中，不会出现 run-once 和 run-loop 行为分叉。

`.016` 先落 runner/lock/loop baseline，不接真实 provider，避免一次把在线 LLM、X 读写、Telegram 发送和 scheduler 全混入同一个风险面。
