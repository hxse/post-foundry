# Problem Context

The v0 production loop can now collect public X sources, select a topic, build context, generate a draft, evaluate policy, auto-post eligible short no-link posts, send Telegram notifications for human-handled posts, read back posted tweets through TwitterAPI.io, and feed compact performance into account memory.

Before trying it on a real account, the highest-value work is not another feature. It is making the production entrypoints fail early when local configuration is incomplete and writing down the exact manual operating procedure.

The main risks for first trial are:

* accidentally running with example or placeholder secrets;
* reaching the production loop with missing OpenAI, TwitterAPI.io, X official, Telegram, or prompt configuration;
* forgetting the explicit real-posting environment guard;
* confusing offline tests, online debug commands, and production commands;
* losing the no-browser X boundary during troubleshooting.
