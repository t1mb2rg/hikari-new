# P1：真实 Hikari 领域实现在 Cordis 生命周期下工作

判定：**PASS**（含一处必须适配的差异，见 §4）。

## 1. 这次没有造一个"Hikari 兼容层"

被测对象是 `dist/` 里的真实现：`foregroundPlugin`、`inputActivityPlugin`、`desktopSessionWorldPlugin`、`desktopSessionAwarenessPlugin`，全部用 `import` 直接装载（`experiments/poc-01-dsh-cordis/p1-cordis.mjs` 的 `HIKARI(...)` 常量指向 `dist/`）。

适配器 `toCordisPlugin`（同文件）只转发四件事：

| Hikari | Cordis | 适配器做了什么 |
| --- | --- | --- |
| `context.services.provide(contract, impl)` | `ctx.provide(name, impl)` | 转发，把返回的 disposer 收集起来 |
| `context.services.get(contract)` | `ctx.get(name, false)` | 转发，取不到就抛错（与 Hikari 的 fail-fast 同义） |
| `context.defer(cleanup)` | 收集到 `disposers` | 不执行，等 fiber 释放时按逆序跑 |
| `def.requires` | `plugin.inject = [...]` | 映射成 Cordis 的依赖注入 |
| `def.setup()` 返回值 | 追加进 `disposers` | 保留 Hikari 的「setup 可返回 cleanup」约定 |

**适配器里没有任何领域判断。** `compareForeground`、`compareInputActivity`、`overallChange` 都只存在于 `src/desktop-session-awareness/plugin.ts:22-60`，实验目录没有它们的副本——这是判据里「不许复制」的那一条。

## 2. 对照结果

同一台机器、同一时段，两边各跑一次 `peek → peek → current → peek`：

| 观测点 | Hikari 原 Runtime | Cordis 宿主 |
| --- | --- | --- |
| 四层插件状态 | 全部 `active` | 全部 `ACTIVE`（`FiberState.ACTIVE = 2`） |
| `peek()` 第一次 | `kind: baseline` | `kind: baseline` |
| `peek()` 第二次 | `kind: baseline`（baseline 未推进） | `kind: baseline`（同样未推进） |
| `current()` | `kind: baseline`（首次消费） | `kind: baseline`（首次消费） |
| 推进后的 `peek()` | `kind: comparison`，`change: stable` | `kind: comparison`，`change: changed` |
| 真实读数 | `title: "QQ"`、`processName: "QQ"`、`lastInputTick: 188752000` | `title: "QQ"`、`processName: "QQ"`、`lastInputTick: 188764468` |

原始读数在 `experiments/poc-01-dsh-cordis/p1-result.json`。

两边的 `title` / `processName` 完全一致，说明**读的是同一个真实窗口**，不是缓存也不是编造。`lastInputTick` 不同是因为两次运行相差约 12 秒，是平台计数器在真实前进。

最后一格 `stable` vs `changed` **不是语义分歧**：Hikari 那次两次读数之间没有输入，Cordis 那次恰好有输入（tick 从 188764468 涨到 188764843）。同一个判断函数，输入不同，结论不同。

## 3. 三个语义都保住了

1. **peek 不推进 baseline**：两次连续 `peek` 都返回 `baseline`，第三次才变成 `comparison`。这条是 `src/desktop-session-awareness/contracts.ts` 里专门写的语义，Cordis 下没有走样。
2. **current 推进 baseline**：`current()` 之后 `peek()` 立刻能看到 comparison，说明消费确实发生了。
3. **activation-local state**：baseline 是 `setup` 里的局部变量，两边都表现一致（首次调用都是 `baseline`）。

## 4. 必须适配的一处：契约键

Hikari 的契约键是 `id@version`（`src/runtime/contracts.ts:26-28`），Cordis 的服务名是一个字符串键，且会被当作 context 属性访问。带 `@` 和 `.` 的名字不是合法标识符，所以适配器编码成：

```
desktop-session-awareness.peek@1  →  desktop_session_awareness_peek_v1
```

**版本号还在，只是从键的一部分变成了名字的一部分。** 这意味着 Cordis 侧**没有**「同名不同版本可以并存」的能力——这一点在 P2 与报告里要作为契约差异写明，不能算等价。

## 5. 这一格不能说明什么

- 只证明了 4 个插件、3 层依赖能起来，不代表 Hikari 的 17 个 service 都能照此办理（含事件、配置、跨进程的那些没测）。
- 没有测 provider 卸载后依赖方的行为（P2 负责）。
- 事件面（`context.events`）在适配器里是**故意未实现**的，抛错比假装支持更诚实；本次四个插件都不发事件，所以不影响结论。
