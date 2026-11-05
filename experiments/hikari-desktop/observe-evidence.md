# 「观察只有一半」的证据

日期：2026-11-05。核对对象是判断「观察只有一半」：**仓库变化有结构化轨迹；窗口切换的观察不落盘，只在会话日志里留下改写成提示的文本**。两条都不成立时判推翻。

## 1. 窗口侧：没有落盘

三个相关模块里，窗口快照只被 `emit`、被消费、被改写成提示：

| 位置 | 事实 |
| --- | --- |
| `hikari-native/perception/index.js:72` | `ctx.emit('hikari/perception/window', { … })` —— 窗口侧唯一的出口，事件名带在参数里，没有文件写入 |
| `hikari-native/world/index.js:98` | `ctx.on('hikari/perception/window', (snapshot) => { … })` —— 只消费 |
| `hikari-native/world/index.js:118` | `ctx.on('session/event', (session, event) => { … })` —— 另一条输入，读会话日志而不是写 |
| `hikari-native/activation/index.js:97` | `ctx.on('hikari/attention/worth', activate)` —— 接收注意决策 |
| `hikari-native/activation/index.js:87` | `agent.followup(message)` —— 把观察改写成的提示投给 session，这就是它离开内存的方式 |

对这三个文件做写入面检索，命中数为零：

```
Select-String -Path hikari-native/perception/index.js -Pattern 'appendFile|writeFile|writeSync|createWriteStream'
Select-String -Path hikari-native/world/index.js      -Pattern 'appendFile|writeFile|writeSync|createWriteStream'
Select-String -Path hikari-native/activation/index.js -Pattern 'appendFile|writeFile|writeSync|createWriteStream'
→ 无匹配
```

所以窗口侧唯一的痕迹是会话日志里的提示文本（`hikari-native/activation/index.js:19`、`:37` 拼出的 `[Hikari 自主观察 …]`），它是给人看的句子，不是可聚合的结构化记录。

## 2. 仓库侧：有结构化轨迹

`hikari-native/project-watch/index.js`：

- `:17` `import { appendFileSync, mkdirSync } from 'node:fs'`
- `:32-36` 注释与 `trace(path, row)`：「采样轨迹（可选）。默认不写；显式给 `tracePath` 时才落盘」
- `:40` `appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8')`
- `:81` `const tracePath = typeof config?.tracePath === 'string' ? config.tracePath : undefined`
- 调用点：`:92`（`sample-failed`）、`:99`（`baseline`）、`:108`（`quiet`）、`:114`（`cooldown`）、`:119`（`emitted`）

产线配置确实打开了它（`hikari-native/cordis.patch.yml`，`hikari-project-watch` 段的 `config`）：

```
tracePath: 'G:\work\LAB\code\projects\own\hikari-new\experiments\hikari-project-watch\tmp\trace.jsonl'
```

实测该文件（2026-11-05）：**567 行、36,978 B**。前两行：

```json
{"at":1793695337698,"kind":"baseline","head":"b4e9c56","dirty":11}
{"at":1793695367360,"kind":"emitted","changed":["head","workingTree"],"headFrom":"b4e9c56","headTo":"e3b7393"}
```

字段集合：`at`、`kind`、`head`、`dirty`、`changed`、`headFrom`、`headTo`（不同 `kind` 用到其中一部分）。

## 3. 对本判断的结论：**支持**

两侧不对称：仓库侧有能聚合的结构化记录，窗口侧只有提示文本。这正是「只答一半」的意思。

## 4. 这份文件没做的事

- 没核 trace 的写入频率上限与轮转：`appendFileSync` 每 30 秒最多一条，文件目前没有上限也没有轮转，长期跑会一直长。
- 没核窗口提示文本能否还原「窗口标题的变化序列」：只知道它是句子，不知道粒度够不够。这条留给 P1 做面板时再定。
- 没核 trace 里各类 `kind` 的时序结构（只统计了条数：`quiet` 539、`emitted` 13、`baseline` 9、`cooldown` 6，`sample-failed` 0）。13 次 `emitted` 是否对应真实改动，需要和 `git log` 对齐才能说，这份文件没有对齐。
