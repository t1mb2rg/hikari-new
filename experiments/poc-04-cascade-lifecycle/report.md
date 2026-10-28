# PoC-04：Cordis 级联生命周期与最终契约回归

- 日期：2026-10-28
- Hikari：`b2de066`（`src/`、`test/` 本轮零改动）
- DSH / Cordis：DSH `0.2.1-rc.2`，`@deepseek-ai/cordis` `4.0.5`，Node `v24.15.0`，Windows
- 被测对象：`experiments/poc-03-contract-layer/contract-layer.mjs`（PoC-03 的契约适配层，本轮**修了三处缺陷**，见 §7）

## §0 结论

**七个判定里，六项 PASS、一项限定 PASS，零 FAIL、零 BLOCKED。级联生命周期在 Cordis 上可以等价表达，但需要适配层补三处它原本没有的东西——这三处都是本轮实测暴露、当场修掉并回归过的。**

| 项 | 内容 | 判定 | 一句话 |
|---|---|---|---|
| C1 | A→B→C 多级依赖与无关插件 D | PASS | 三链就绪，D 独立计数 |
| C2 | 卸载 A 后 B/C 停用并释放，D 不受影响 | **限定 PASS** | 资源确实释放；但状态查询与簿记两处失真，修复后才可信 |
| C3 | 重新提供 A 后 B/C 以新实例重新激活 | PASS | `setupCount` 2、计时器归零重开、一次 emit 只收一次 |
| C4 | provider 消失时下游仍在异步 setup | PASS | 停在 `waiting`、cleanup 跑过、计时器与订阅清空 |
| C5 | `fiber.await()` 对 PENDING 是否阻塞组合启动 | PASS | 0–1 ms 返回，不阻塞 |
| A | 最终适配层重跑 Event 五项 | PASS | 5/5，含 `AggregateError` 的 message 与 errors |
| B | 部分初始化失败 + cleanup 抛错 | PASS（修复后） | F1 两侧一致；F2 修前丢 cleanup 原因，修后与 Hikari 逐字同形 |

**最重要的一条**：Cordis 的 `inject` 失效语义（停用下游、保留 fiber、可供复活）与 Hikari 的 `#deactivateTree` 级联拆卸**在结果上等价**，在过程上不等价——Cordis 的这条路**不经过适配层的 `unloadPlugin`**，所以凡是适配层自己维护的簿记，都必须能按宿主真实状态自愈。这是路线 C 的通用教训，不是本实验的特例。

## §1 环境与可复现

```text
node experiments/poc-04-cascade-lifecycle/cascade.mjs      # C1–C3
node experiments/poc-04-cascade-lifecycle/race.mjs         # C4–C5
node experiments/poc-04-cascade-lifecycle/event-final.mjs  # A
node experiments/poc-04-cascade-lifecycle/partial-fail.mjs # B
```

前置：hikari-new 已 `npm run build`；`DSH_ROOT` 指向装了 `@deepseek-ai/cordis@4.0.5` 的目录（默认 `G:/work/LAB/code/_poc/poc01`）。

探针用**真实 Hikari 契约 id**，不是自造命名空间：

| 探针 | requires | provides |
|---|---|---|
| `poc04.a` | — | `foreground.current@1` |
| `poc04.b` | `foreground.current@1` | `desktop-session-world.current@1` |
| `poc04.c` | `desktop-session-world.current@1` | `desktop-session-awareness.current@1` |
| `poc04.d` | — | —（无关对照） |

每个探针在 setup 里同时做三件事，这样任何一类资源泄漏都看得见：`events.on` 订阅真实事件 `desktop-session-awareness-loop.assessed@1`、开一个 20 ms 的 `setInterval`、返回 cleanup 去清计时器。

## §2 级联：状态序列与资源（C1、C2）

读数在 `cascade.json`。关键三步（`setup/cleanup/tick/sub/timers`）：

```text
== all loaded + emit ==   states 全 active
   A:1/0/tick20/sub1/t1  B:1/0/tick16/sub1/t1  C:1/0/tick12/sub1/t1  D:1/0/tick8/sub1/t1

== unload A ==            raw fiber: B=0:waiting  C=0:waiting  D=2:active
   A:1/1/tick20/sub1/t0  B:1/1/tick16/sub1/t0  C:1/1/tick12/sub1/t0  D:1/0/tick12/sub1/t1
   host: foreground=false, world=false, awareness=false      bookkeep: {}

== reload A ==            raw fiber: 全 2:active
   A:2/1/tick24/sub1/t1  B:2/1/tick20/sub1/t1  C:2/1/tick16/sub1/t1  D:1/0/tick20/sub2/t1
   host: foreground=true,  world=true,  awareness=true
```

读出来的四件事：

1. **B 与 C 都停了，不只是直接依赖 A 的 B。** 卸载 A 时 B、C 的 `cleanupCount` 同时从 0 变 1，计时器 `timers` 归 0 —— C 是通过 B 间接依赖 A 的，Cordis 把整条链都拆了。对应 Hikari 的 `src/runtime/runtime.ts:89-92`（`#deactivateTree` 级联拆下游）。
2. **D 一根毛都没动**：`cleanupCount` 始终 0，tick 持续 12→16→20→24，对事件照常响应。
3. **服务注册真被撤了**：卸载 A 后宿主里三个契约全部 `app.get(key, false) === undefined`；重装 A 后三个全部回来。
4. **订阅确实断了**：卸载 A 后再 emit 一次，A/B/C 的 `subscriberCalls` 全部不动（停在 1），D 从 1 变 2。

### 2.1 这一项为什么只能算「限定 PASS」

第一次跑（修复前）暴露了两处适配层缺陷：

- `getPluginState('poc04.b')` 在级联停用后**仍返回 `active`**。原因是旧实现 `if (record.state === 'active' || record.state === 'failed') return record.state` 短路在缓存的装载结论上，而级联停用根本不经过适配层，缓存永远不会被改写。同一时刻宿主真实状态是 `0:waiting`（`lib/index.js:1287-1292` 的 `_getState`）。
- `providedBy` 里留着 `desktop-session-world.current@1 → poc04.b`，而宿主里该服务已不存在。这不止是显示问题：下一个想提供同一契约的插件会被 `ServiceAlreadyProvidedError`「已由 poc04.b 提供」误拒，而 poc04.b 已经停用。

两处都修了（§7），上表读数是修复后的。**修复前这两项会是 FAIL。**

## §3 重激活（C3）

| 读点 | 值 | 含义 |
|---|---|---|
| B `setupCount` | 1 → 2 | 重新跑了 setup，不是复用旧实例 |
| B `cleanupCount` | 1 → 1（重装后仍 1） | 旧实例只清了一次，没有重复清理 |
| B `tickCount` | 16 → 20（之后继续 24） | 计时器是新开的那一个（旧的在 16 停住并清零） |
| 一次 emit 后 B `subscriberCalls` | 1 → 2，恰好 +1 | 没有旧订阅残留；残留会是 +2 |
| B `timers` | 0 → 1 | 一个计时器，不多不少 |
| 宿主 `desktop-session-world.current@1` | false → true | B 重新 provide 成功 |

**结论：重激活是「同 id 新实例」，不是「恢复旧对象」。** 这与 Hikari 的语义一致（`src/runtime/runtime.ts:98-110` 的 `#reconcile` 在依赖重新满足时重新走 `#activate`），并且没有任何旧订阅、旧计时器残留。

## §4 异步激活竞争与 PENDING 等待（C4、C5）

读数在 `race.json`。

| 场景 | 关键读数 | 判定 |
|---|---|---|
| S1 先装依赖方（提供方不存在） | `loadPlugin` 返回 `waiting`，耗时 **1 ms**；setup 未跑、tick 0 | 不阻塞 |
| S2 提供方 200 ms 后才 provide，依赖方先装 | 装载返回 `waiting`，耗时 **0 ms**；提供方就绪后自动 `active`，setup 恰好跑 1 次 | 不阻塞、自动激活 |
| S3 依赖方 setup 300 ms 中途，提供方被卸载 | setup 期间 `loading` → provider 消失后 `waiting`；`loadPlugin` 返回 `waiting`；最终 `waiting`；cleanup 跑 1 次；timers 0；再 emit 订阅回调 **0 次** | 清理正确 |

**C5 的答案**：不阻塞。`fiber.await()` 的实现是 `while (this.inertia) await this.inertia; if (this._error) throw this._error;`（`lib/index.js:1396-1402`），`inertia` 只表示「当前有生命周期工作在进行」，PENDING 的 fiber 没有在跑的活，所以立刻返回。**组合启动不会被一个等依赖的插件卡住**——这消掉了 PoC-03 留下的一条悬置风险。

**C4 有一个必须如实记下的细节**：S3 里依赖方的 setup **跑完了**（`bSetupCompleted: true`，也就是说它那条 `provide` 真的执行过），之后才回到 `waiting` 并跑 cleanup。也就是说**setup 一旦开始就不被取消**。这与 Hikari 完全一致——`src/runtime/runtime.ts:175-191` 的 `#deactivate` 对 `starting` 态的插件只标 `unloading = true`，注释写明 setup 不能被取消。所以这不是差异，是同一条语义的两种实现。副作用：setup 里的真实副作用（读文件、发请求）不会被中断，迁移时这一点必须写进插件作者的约束。

## §5 Event 五项回归（收口 A）

`event-final.json`，被测事件是真实契约 `desktop-session-awareness-loop.assessed@1`：

| 项 | 测什么 | 读数 | 判定 |
|---|---|---|---|
| E1 等待 | 订阅者各睡 300 ms、发布间隔 100 ms | 相邻两次 emit 间隔 **421 ms** | PASS |
| E2 并发 | 两个订阅者同时收到一次 emit | 启动时差 **0 ms** | PASS |
| E3 聚合 | 两个订阅者各抛一个错 | `AggregateError`，`message = "Event desktop-session-awareness-loop.assessed@1 had failing subscribers."`，`errors = ["boom-a","boom-b"]` | PASS |
| E4 退订 | `unloadPlugin` 后再 emit | 调用数 1 → 1，不增 | PASS |
| E5 重装 | 装回后再 emit | 调用数 1 → 2，恰好 +1 | PASS |

**一次过程性失败要记下来**：第一次跑 E1/E2 判 FAIL，原因不在适配层——我的发布者用 `setInterval(async () => await emit(...))`，`setInterval` 不等 async 回调，所以第二次 emit 在 100 ms 就发出去了，量到的是定时器节奏而不是事件语义。改成「上一次 emit 完成后再排下一次」后得到 421 ms。**这类判据错误会直接把语义判反**，写在这里提醒：量「是否等待」只能由「上游完成后再发下一次」的节奏来测。

## §6 部分初始化失败与 cleanup 抛错（收口 B）

`partial-fail.json`。探针在 setup 里依次 `provide` → `events.on` → `context.defer(cleanup)` → 抛 `BoomSetup`。

| 场景 | Hikari | Cordis + 契约层（修复后） |
|---|---|---|
| F1 setup 部分初始化后抛错 | `state=failed`，错误 `BoomSetup`（`marker` 保留），cleanup 跑 1 次，服务注销（消费者探针停在 `waiting`），订阅失效 | 完全相同，另加 `bookkeepingLeftover: []` |
| F2 setup 抛错 + cleanup 也抛错 | `AggregateError`，`message = "Plugin hikari.partial failed during setup and cleanup."`，`errors = [BoomSetup, AggregateError("One or more plugin resources failed to clean up.", [BoomCleanup])]` | 同形同结构，`message = "Plugin cordis.partial failed during setup and cleanup."` |

**F2 修复前是丢的**：契约层只读到 `BoomSetup`，cleanup 那个 `BoomCleanup` 被 Cordis 吃掉（effect 清理错误进宿主自己的日志流，不进 fiber 的 `_error`）。修法见 §7.3。

## §7 本轮修的三处适配层缺陷

任务书允许「仅修复实际测试揭示的契约缺口」，以下三处都是实测先失败、再修、再回归的。改动都落在 `experiments/poc-03-contract-layer/contract-layer.mjs`，`src/` 未动。

### 7.1 状态查询被缓存短路

- **现象**：级联停用后 `getPluginState` 仍报 `active`，宿主真实状态 `0:waiting`。
- **修法**：`failed` 仍是装载期定下的结论直接返回，其余状态实时读 `record.fiber.state` 映射。级联停用不会经过适配层，缓存字段不能作为状态来源。
- **回归**：`three-layers` / `discipline` / `rollback` 三个脚本重跑全部维持原判定（`failed` 路径靠 `record.state === 'failed'` 优先，未受影响）。

### 7.2 簿记自愈

- **现象**：级联停用后 `providedBy` 留着属主已死的条目，会让后来者被误拒。
- **修法**：加 `reconcile()`——遍历 `providedBy`，凡 `app.get(key, false) === undefined` 的条目删除，并同步清 `record.provided`。在 `loadPlugin` 入口与 `inspect()` 调用。
- **为什么放在 `loadPlugin` 入口**：误拒发生在「下一个提供者装载时」，在那里校准最早也最省。

### 7.3 cleanup 错误被宿主吃掉

- **现象**：F2 里只读到 setup 原因，cleanup 原因不见了。
- **修法**：`defer` 包一层 try/catch，把 cleanup 抛出的错误记进 `record.cleanupErrors` 后再 rethrow；失败路径 `fail()` 若发现 `cleanupErrors` 非空，按 Hikari 的形状合成 `AggregateError([setupError, AggregateError(cleanupErrors, 'One or more plugin resources failed to clean up.')], 'Plugin <id> failed during setup and cleanup.')`。另外在 `await fiber.await()` 的 catch 里先让出一轮宏任务（`setTimeout 0`），因为 Cordis 是在失败后才跑 effect 清理，不留这个窗口就收集不到。
- **回归**：F2 现在与 Hikari 逐字同形（只有插件 id 不同）。

## §7.5 三条候选判断的判定

三条判断在本轮开始前登记，推翻条件在跑之前写下。这里只做一件事：把已经落盘的读数对到推翻条件上，不重新解读。

| 判断 | 推翻条件（跑之前写的） | 读数 | 判定 |
| --- | --- | --- | --- |
| 级联可重建 | 下游停在无法复活的状态，或重激活后仍收到旧订阅回调、旧计时器仍在跑，或 D 也受到影响 | `cascade.json`：卸 A 后 `b`/`c` 的 `getPluginState` 均为 `waiting`，两者 `cleanupCount` 0→1、计时器计数归 0、再 emit 时订阅回调不增；重装 A 后 `setupCount` 1→2、一次 emit 恰好 +1（残留订阅会是 +1→+2）、计时器从 0 重开；无关插件 `d` 的 tick 12→16→20→24 不受影响 | **支持** |
| 等待不阻塞 | 装载一个 PENDING 插件时 `await` 在有限时间内不返回，或返回结果与实际状态不符 | `race.json`：对 PENDING fiber 调 `await()` 在 0–1 ms 内返回；`cordis/lib/index.js:1396-1402` 的 `inertia` 只表示「有生命周期工作在跑」，与依赖是否满足无关 | **支持** |
| 级联簿记残留 | 级联停用后适配层簿记自动清空，与服务注册表的真实状态一致 | 本轮实测到残留确实存在，且是**两处**：① `getPluginState` 缓存短路，级联停用后仍报 `active`（宿主真实 `0:waiting`）；② `providedBy` 留着属主已死的条目，会让后来者被 `ServiceAlreadyProvidedError` 误拒。推翻条件是「自动清空」，实测没有清空 | **支持** |

**第三条的读法**：登记它时的主张就是「级联停用绕过了 `unloadPlugin`，所以适配层自维护的簿记会残留」——本轮不但观察到残留，还观察到第二种（状态缓存）。后续的修复（§7.1、§7.2）是**在判断成立之后**才做的，不改变这项判定；修完再回看，`event-final.json` 五项 5/5、PoC-03 三个脚本判定未翻转，说明修得对，但那是另一件事。

这条判断本身是路线 C 的通用约束：**Cordis 做的事不经过适配层**，所以适配层自维护的一切都必须能按宿主真实状态自愈——不是本实验的特例。

## §8 等价清单（路线 C 的现状）

**可直接表达**：级联停用与复活（`inject` 失效/恢复）、setup 不可取消、失败后资源释放、错误对象原样保留、事件五项语义。

**需要适配层补**：定义验证、配置解析、三条 Service 声明检查、错误转存与同步查询、**状态实时读取**、**簿记自愈**、**cleanup 错误合成**。后三项本轮才出现，说明「契约适配层」的完整形状不是一次能定下来的。

**仍不能等价保证**：

1. **正常卸载时 cleanup 抛错的可见性**。`unloadPlugin` 里 `try { await dispose() } catch {}` 仍然吞掉了这个错误，本轮没修（任务书只要求 setup 失败路径）。Hikari 的 `#tearDown` 会把插件置为 `failed`。
2. **失败记录的占位语义**。重装前必须先 `unloadPlugin`（失败记录仍占着 id），两侧一致，但 Cordis 侧没有「记录残留」的概念，是适配层加的。
3. **`waiting` 的粒度**。Hikari 区分「依赖未满足」与「正在启动」，Cordis 用 `0:PENDING` / `1:LOADING` 也区分，但没有对外语义承诺。适配层目前直接映射数字。

## §9 未覆盖

- 多层（>3）与分叉依赖图；
- 同一插件被两个 ctx 重复装载；
- 正常卸载时 cleanup 抛错（见 §8 第 1 条）；
- `dispose()` 异步完成与 `unloadPlugin` 返回之间的竞态；
- 真实 Hikari 插件（`foreground` 等四层）在级联下的表现——本轮用的是探针，不是那四层；它们没有 requires 链，级联在这里是构造出来的形态。

## §10 复现条件

- Hikari `b2de066`，`npm run build` 后从 `dist/` 导入 `validatePluginDefinition`；
- `@deepseek-ai/cordis` 固定 `4.0.5`；本文所有读数绑定该版本的 `_getState` 映射（`lib/index.js:1287-1292`）、`await()` rethrow（`:1396-1402`）、`inject` 停用语义。宿主升版必须重跑 §1 的四个脚本。
- `src/`、`test/` 零改动：`git diff --stat -- src test` 为空。
