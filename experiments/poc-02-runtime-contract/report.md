# PoC-02：Hikari × DSH 运行时契约对照（事件面 / 契约键 / 服务拒绝语义）

**日期**：2026-10-28
**Hikari**：`f44cb2f`（PoC-01 收口后的 `main`）
**DSH**：`0.2.1-rc.2`，隔离目录 `G:/work/LAB/code/_poc/poc01`，`DSH_HOME=<该目录>/dsh-home`
**Cordis**：`@deepseek-ai/cordis` `4.0.5`
**Node**：`v24.15.0`
**运行条件**：Hikari 侧从 `dist/` 导入（先 `npm run build`）；Cordis 侧从隔离目录导入。本目录 `src/` 与 `test/` 零改动（见 §6）。

---

## §0 结论

1. **事件面可以等价，但等价是「适配层做对了」的结果，不是宿主自带的。** `events.emit` 必须映射到 `ctx.parallel`（`ctx.emit` 是同步不等的，直接映射会把「发布方等订阅者」这条语义丢掉），失败聚合的 `AggregateError` 还要补 message 才能与 Hikari 逐字一致。
2. **契约键编码在真实契约集上无碰撞（24/24），但编码函数本身不单射。** `点 / 连字符 / 下划线` 会被折叠成同一个下划线；今天没撞，是因为现有 id 恰好没有这类成对的。撞车时 Cordis 静默 `FAILED`、`fiber.error` 为 `null`、先提供者继续生效。
3. **未声明的 get/provide 在当前适配层下**没有**保持原拒绝语义——5 条里有 3 条被放行（R1 未声明读、R3 未声明提供、R4 声明未提供）。补回检查后状态可一致，但**错误对象拿不回来**（`fiber.error` 恒为 `null`）。
4. **「依赖未满足」两侧本来就一致**：Hikari `waiting`、Cordis `PENDING`，都是等待不是拒绝。
5. **对 C（统一 Cordis 宿主）的判断：可以从「候选」升到「可行」，但需要一层自建的契约层**——声明检查与错误对象保存宿主都不提供，而这层不是装饰：不加它，Hikari 现有的「未声明即失败」纪律在迁移后就没了。

## §1 五项判定

| # | 项 | 判定 | 依据 |
|---|---|---|---|
| P1 | 真实发布实现在 Cordis 下工作（事件适配） | **PASS** | `desktop-session-awareness-loop` 插件在 Cordis 下按 `delayMs` 真实发布 `desktop-session-awareness-loop.assessed@1`，五次运行共收到 3 个事件；领域代码零改动（`event-cordis.md`） |
| P2 | 五项事件语义可等价映射 | **PASS**（4 等价 + 1 需适配） | 等待、并发、卸载退订、重新激活四项读数与 Hikari 同量级；失败聚合需补 message（`event-cordis.md`） |
| P3 | 契约键编码无碰撞 | **PASS（限真实契约集）** | 24 个 service 编码后两两不同、版本参与键；但编码函数可构造撞车（`key-collision.md` §2） |
| P4 | 未声明 get/provide 保持原拒绝语义 | **FAIL** | 当前适配层放行 R1/R3/R4；补检查后状态一致但错误对象丢失（`service-reject.md`） |
| P5 | 实验边界与零改动 | **PASS** | `src/` 与 `test/` 零改动；DSH 上游未修改；适配层与脚本全部在本目录（§6） |

## §2 事件语义对照（P1 + P2）

| 语义 | Hikari 实测 | Cordis 实测 | 判定 |
|---|---|---|---|
| 发布等待订阅者 | 间隔 **831 / 790 ms**（订阅者睡 300，`delayMs=100`） | **823 / 793 ms** | **等价**（前提：`emit → ctx.parallel`） |
| 多异步订阅者并发 | `startDeltaMs=0`，跨度 **314 ms** | `startDeltaMs=0`，跨度 **311 ms** | **等价** |
| 失败聚合 | `AggregateError` + `message="Event <key> had failing subscribers."` | 原生 `AggregateError` 但 **`message=""`**；补后逐字一致 | **需适配** |
| 卸载退订 | 卸载后 450 ms 内 **0** 次 | `dispose()` 后 **0** 次 | **等价** |
| 重新激活 | 重装后 **1** 次 | **1** 次 | **等价** |

三条限定（详见 `event-cordis.md`）：

- **C1 的等价依赖分派模式的选择。** Cordis 有 `emit/parallel/serial/bail/waterfall` 五种；只有 `parallel` 是「全部 await 且都跑」。
- **真实插件把错误吞掉了。** `src/desktop-session-awareness-loop/plugin.ts:86-95` 的 `try/catch {}` 使订阅者抛错在产品路径上**不可观察**；本实验是直接对宿主分发器测的。
- **事件键没有版本概念。** Cordis 的事件名是任意 string，`@1` 只是字符串的一部分，版本语义由适配层约定。

## §3 契约键编码（P3）

| 项 | 读数 |
|---|---|
| 真实 service 数 / 版本分布 | **24** / 全部 `version 1` |
| Hikari 键唯一 / Cordis 名唯一 | **是 / 是**（0 重复） |
| 编码函数对版本保持区分 | **是**（`foo@1`→`foo_v1`、`foo@2`→`foo_v2`） |
| 编码函数对不同 id 保持区分 | **否**（`foo.bar@1` 与 `foo_bar@1` 都→`foo_bar_v1`） |
| 撞车时上层能否察觉 | **否**（fiber `state=3`、`error=null`、先提供者继续生效） |

收口口径：C 路线需要一条比「替换非法字符」更强的编码（保留分隔符类别，或对 `id@version` 做稳定 hash）。这不是架构阻塞，但是**今天不暴露、明天会暴露**的静默失效点。

## §4 未声明服务的拒绝语义（P4）

| # | 场景 | Hikari | Cordis · 当前适配层 | Cordis · 补检查后 |
|---|---|---|---|---|
| R1 | 未声明就 `get` | `UndeclaredServiceDependencyError`（逐字消息） | **放行（ACTIVE）** | failed，错误对象丢失 |
| R2 | 依赖没人提供 | `waiting` | `PENDING` | `PENDING` |
| R3 | 未声明就 `provide` | `UndeclaredServiceProviderError` | **放行（ACTIVE）** | failed，错误对象丢失 |
| R4 | 声明了没提供 | `MissingDeclaredServiceError` | **放行（ACTIVE）** | failed，错误对象丢失 |
| R5 | 重复提供 | `ServiceAlreadyProvidedError` | failed（宿主原生拒绝） | failed，错误对象丢失 |

一条必须记住的更正：**Hikari 的 `loadPlugin` 也不抛异常**（只有 `DuplicatePluginError` 抛），它用 `state='failed'` + `getPluginError(id)` 上报。两侧真实差异只有一处——**错误对象可不可取**。

## §5 哪些东西要重做

| 类别 | 内容 |
|---|---|
| **可原样复用** | 全部领域实现：`src/desktop-session-awareness/**`、`src/desktop-session-world/**`、`src/foreground/**`、`src/input-activity/**`——两次实验里一行未改。PoC-01 的 P1 与 PoC-02 的 P1 都是直接 `import` `dist/` 跑通的。 |
| **必须是适配层，不能指望宿主** | ①`requires/provides` 声明检查（R1/R3/R4）②插件错误对象的保存（`fiber.error` 为 null）③`AggregateError` 的 message ④契约键编码（要单射）⑤`events.emit → parallel` 的选择 |
| **宿主直接给** | 插件装载 / 依赖触发激活 / 级联失效 / 重装恢复 / effect 生命周期（`ctx.on`、`ctx.effect` 自动清理）/ 服务注册与查重 / 事件分发五模式 |
| **Hikari Runtime 需要保留的契约** | `ServiceContract` 的 `id@version` 键（版本进键是它唯一的版本隔离手段）· `requires/provides` 纪律 · 插件状态机（`waiting/active/failed`）· `EventBus.emit` 的「等全部订阅者再返回」 |

## §6 复现

```bash
cd /g/work/LAB/code/projects/own/hikari-new
npm run build                                   # Hikari 侧从 dist/ 导入
export DSH_ROOT=G:/work/LAB/code/_poc/poc01

node experiments/poc-02-runtime-contract/collect-contracts.mjs   # 24 service / 1 event
node experiments/poc-02-runtime-contract/event-hikari.mjs        # s2 → event-hikari.json
node experiments/poc-02-runtime-contract/event-cordis.mjs        # s3 → event-cordis.json
node experiments/poc-02-runtime-contract/key-collision.mjs       # s4 → key-collision.json
node experiments/poc-02-runtime-contract/service-reject.mjs      # s5 → service-reject.json
```

**零改动证明**：本轮只写了 `experiments/poc-02-runtime-contract/` 下的文件，`src/` 与 `test/` 未动（可用 `git status --short` 与 `git diff --stat -- src test` 核对）。DSH 装在隔离目录，未修改其上游源码；PoC-01 的 `poc01.patch.yml` / `poc01-p5.patch.yml` 用的是官方 PatchOptions，本轮不需要 patch。

## §7 范围与限制

- **只测了只读领域能力。** 没有任何写操作、没有 Action、没有 Chronicle 写入。
- **只有一个真实事件**。Hikari 今天只有 `desktop-session-awareness-loop.assessed@1` 一个事件定义、一个生产订阅者（`desktop-content-read`）。事件面的证据面很窄；多事件、跨插件事件链未测。
- **订阅者是隔离测试探针**，不是生产消费者。生产消费者 `desktop-content-read` 未装载。
- **契约键只有一个版本（全 v1）**，「同名不同版本并存」只在构造用例上测过，真实集里没有第二版本。
- **失败聚合测的是宿主分发器**，不是产品路径——真实插件会吞错，两侧都吞。
- **没有测**：`internal/status` 事件能否替代 `fiber.error`、Cordis 的错误通道能否稳定拿到错误类型、热重载/多宿主并存、DSH Agent 侧的 P3–P5（PoC-01 已覆盖）。

## §8 对下一步的建议

先把 **C 路线缺的那一层契约层**做出来（声明检查 + 错误对象 + 单射编码 + 事件桥接），再谈迁移；不要先迁移再补层。理由是：这一层是**纯增量、可单独测**的，做完之后「迁移」几乎是机械操作；反过来，先迁移再补层会把「哪些失败被吞掉了」变成事后追查。

A（双 Runtime 桥接）仍然只作为过渡态：它要求两个宿主同时活着，而本轮证明两个宿主在**失败上报**上的形状不同，桥接层得同时处理两套。
