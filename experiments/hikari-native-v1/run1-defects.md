# 第一次运行（session-hikari-v1）的缺陷与修正

第一次运行在 2026-10-29 22:35 开始，turn 1 跑了 2 分 17 秒（26 step / 47 次只读工具调用），然后被 replay 插件自己的超时掐断。**16 个事件只发出了 1 个**，无法构成 16 轮对照。

以下三条是这次运行的缺陷，均由 Hikari 本人在 turn 1 的输出里指出（原文见 `report.md` §4），逐条核过后确认成立。

## 缺陷 1：replay 的总超时掐断了重放

`hikari-native/replay/index.js` 原实现：`setTimeout(() => finish(...), timeoutMs + startDelayMs)`，`timeoutMs` 默认 60000、`startDelayMs` 8000，即装载后 68 秒无条件结束。

而重放要等每轮 `turn/end` 才发下一条。turn 1 实际跑了 137 秒（v0 的秒级 turn 在 v1 变成了分钟级，因为新增了 read 工具、她又真的去读），所以 68 秒到期时只发出了第 1 条。

**修正**：改为 idle 守卫——每次 `turn/end` 重置一个 10 分钟的空闲计时器；只要还在推进就不打断。

## 缺陷 2：真实的感知事件混进了同一 session

v1 配置保留了 `hikari-perception` 与 `hikari-world`，它们在重放之外照常观察真实桌面并向同一个 `session-hikari-v2`（当时是 v1）发 `hikari/attention/worth`。

**证据**：她读到 session 投影里 `next-turn` 只有一条，是 22:35:30 的真实 World 事件（`Greeting → QQ`），不是重放的第 2 条。

**修正**：`hikari-perception` 与 `hikari-world` 在重放运行里 `disabled: true`，唯一唤醒来源是冻结的事件列表。

## 缺陷 3：时间戳不等价

`config.md` §5 写「对 activation 而言输入与 v0 完全等价」。实际上原实现把 `at` 换成了 `Date.now()`，所以同一事件在 v1 渲染成 `22:35:18`、在 v0 是 `21:42:38`。**「完全等价」这句话不成立。**

**修正**：`at` 改用事件原始时间戳（`event.at`），渲染出的时钟与 v0 逐字一致。

## 保留的东西

`session-hikari-v1` 的完整记录保留在 `.dsh/sessions/.../session-hikari-v1/`，turn 1 的输出原文抄进 `report.md` §4。它不是有效对照数据（只有 1 轮），但它是本轮最强的证据之一：**她拿到「在意的事」之后，第一件事是去查我留给她的实验装置，然后逐条指出了上面三个错误。**

## 第二次运行的配置（session-hikari-v2）

| 项 | 值 |
|---|---|
| sessionId | `session-hikari-v2` |
| perception / world | `disabled: true` |
| replay.startDelayMs | 10000 |
| replay.gapMs | 2000 |
| replay.idleTimeoutMs | 600000（每次 turn/end 重置） |
| replay.at | 事件原始时间戳 |
| persona / activation 提问 | 与 config.md §1–§2 相同，未再改 |
| 工具面 | glob / grep / read，无写、无 shell，未变 |
