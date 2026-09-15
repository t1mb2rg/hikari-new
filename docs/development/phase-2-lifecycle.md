# Hikari 第二阶段 P2-04 生命周期验收实现

> 状态：**P2-04 已完成**（Functional PASS + Architecture PASS；第二阶段已正式收口）
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的跨 Runtime 生命周期证据。
>
> 本文只覆盖 P2-04。P2-01 / P2-02 / P2-03 见各自实现文档。

## 1. 阶段目标

P2-01 给了「这些经历属于谁」，P2-02 给了「真实发生过什么」，P2-03 给了「怎么把它们组合成一次真实启动」。三者都只被验证在**同一个进程、同一次启动**的范围内。

本阶段只回答一个问题：

> 一个全新的 Runtime 生命周期，能不能恢复出**同一个 Hikari**与**同一条事实**？

```text
Runtime A
→ 恢复 Hikari
→ 挂载 Chronicle
→ append Fact A
→ shutdown

全新 Runtime B
→ 恢复同一 Hikari
→ 挂载同一 Chronicle
→ 读回同一个 Fact A
```

本阶段**不新增任何生产领域机制**。它是验收，不是实现。

## 2. 阶段边界

本阶段明确不做以下事情：

- 不修改 `src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/` 的任何一行；
- 不修改 `src/index.ts`；
- 不为测试修改 Runtime API（Runtime 至今没有公共 Service 读取接口，本阶段也不增加）；
- 不新增任何生产代码文件——本轮 `src/` 零改动；
- 不引入 `LifecycleManager` / `RecoveryManager` / `IdentityManager` / `HikariCore` / `ProcessJournal` / `Resident` / `Profile` / `ServiceContainer` / `ApplicationContext`；
- 不做 distributed runtime、node identity、communication / federation、synchronization；
- 不实现任何「恢复失败后自动修复 / 重试 / 降级」的机制。

如果验收无法在不修改已冻结架构的前提下完成，本阶段的正确动作是**停止并报告**，而不是增加机制。实际结论见 §7。

## 3. 当前目录

P2-04 新增文件 **3 个**：

```text
test/phase-2-lifecycle.test.mjs                                  (1)
docs/development/phase-2-lifecycle.md                            (1)
docs/architecture/phase-2-final-architecture-review.md           (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/` 零改动**：`git diff HEAD --stat -- src/` 输出为空。

## 4. 验收设计：两个测试专用 Probe

Runtime 没有公共 Service 读取接口，而本阶段禁止为了测试修改 Runtime API。因此 Probe 通过**正常的 Plugin Context** 拿到 Service，再用测试闭包把引用交给测试代码。

Probe 只存在于 `test/`，不进入 `src/`。

### 为什么需要两个 Probe

第一版只写了一个 Probe（`requires: continuity.current@1 + chronicle@1`）。它在主路径上工作正常，但在**失败路径上什么都观察不到**——Chronicle 拒绝挂载时，这个 Probe 的依赖永远不满足，它停在 `waiting`，`setup` 从未执行，闭包里全是 `undefined`。

这正是依赖图在正确工作，但也意味着：**一个同时依赖两个 Service 的 Probe，无法用来证明「主体恢复了、只是事实史不可用」**。

因此验收需要两个 Probe，它们观察的是依赖图的两个不同状态：

```text
test.continuity-observer    requires: continuity.current@1
                            → 只要主体恢复就激活，与事实史无关
                              （用于观察失败路径下的主体）

test.probe                  requires: continuity.current@1 + chronicle@1
                            → 只有整条 Phase 2 组合收敛才激活
                              （用于观察完整成功路径）
```

两者都 `provides` 为空，都不改变依赖图，都不写入任何东西。

这一点本身就是本阶段的副产品结论：**Probe 观察到的是依赖图的真实结论，而不是测试想让 Runtime 得出的结论**——因为 Probe 根本没有能力让 Runtime 得出任何结论。

## 5. Runtime A 实测

```text
new Runtime()
loadPlugin(continuityPlugin, { rootDir })    → active
loadPlugin(chroniclePlugin,  { rootDir })    → active
loadPlugin(continuityObserver)               → active
loadPlugin(probe)                            → active

probe.continuity.current   → HikariIdentity
probe.chronicle.append(FACT_A) → DurableFact

runtime.shutdown()
```

实测输出（临时采集脚本，不在仓库内）：

```text
identityA        {"hikariId":"f7d496c5-2fa1-4ae8-99b6-5aa32f6aa935",
                  "createdAt":"2026-09-15T08:12:36.224Z"}
factA            {"factId":"e42d5063-e174-4eb5-8865-75e83243997a",
                  "type":"lifecycle.observed","version":1,
                  "occurredAt":"2026-02-01T08:30:00.000Z",
                  "recordedAt":"2026-09-15T08:12:36.237Z",
                  "source":{"kind":"phase-2-lifecycle","reference":"runtime-a"},
                  "payload":{"note":"Runtime A appended this fact",
                             "nested":{"list":[1,"two",false,null]}}}
```

shutdown 之后：

```text
origin 字节不变
store  字节不变（sha 544551989fa98ce4，与 append 后一致）
```

**Runtime A 的 shutdown 没有删除或修改 Origin / Chronicle**——它只释放 EffectScope，而 EffectScope 里登记的是 Service 注册与订阅，不是文件。

## 6. 全新 Runtime B 实测

```text
new Runtime()                                ← 与 Runtime A 完全无关的新实例
loadPlugin(continuityPlugin, { rootDir })    → active
loadPlugin(chroniclePlugin,  { rootDir })    → active
loadPlugin(continuityObserver)               → active
loadPlugin(probe)                            → active

probe.continuity.current            → HikariIdentity
probe.chronicle.get(factA.factId)   → DurableFact
probe.chronicle.read()              → [DurableFact]

runtime.shutdown()
```

实测结果：

```text
identityB        {"hikariId":"f7d496c5-2fa1-4ae8-99b6-5aa32f6aa935",
                  "createdAt":"2026-09-15T08:12:36.224Z"}
factB            factId 与 factA 相同，全部 7 个字段逐一相同
```

对象同一性（`===`，全部为 `false` 表示完全不复用）：

```text
Runtime 实例        false      两个独立的 Runtime
PluginContext       false      两个独立的 Context
continuity Service  false      两个独立的 Service 对象
chronicle  Service  false      两个独立的 Service 对象
HikariIdentity 对象 false      值相同，但对象不同
```

Runtime B 之后：

```text
origin 字节不变（sha 7a4411f125245042）
store  字节不变
```

## 7. 八项必须证明的逐条结论

| # | 必须证明 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | Runtime A / B 是两个完全独立的新 Runtime 实例 | **成立** | `a.runtime !== b.runtime`；`PluginContext`、两个 Service 对象、`HikariIdentity` 对象全部 `!==` |
| 2 | `hikariId` 跨 Runtime 一致 | **成立** | A/B 的 `hikariId` 与 `createdAt` 均相同，且与 `origin.json` 落盘值、`restoreHikari()` 一致 |
| 3 | Fact A 跨 Runtime 可恢复 | **成立** | B 通过 `chronicle@1` 的 `get()` 与 `read()` 均取回该事实 |
| 4 | `DurableFact` 所有字段保持一致 | **成立** | `factId` / `type` / `version` / `occurredAt` / `recordedAt` / `source` / `payload` 逐一断言，并断言字段集合恰为这 7 个 |
| 5 | Runtime A shutdown 不删除或修改 Origin / Chronicle | **成立** | shutdown 前后 `origin.json`、`chronicle.jsonl` 字节不变 |
| 6 | Runtime B 的纯恢复不改动，恢复前后 byte-for-byte identical | **成立** | 整棵文件树快照（文件集合 + 每个文件字节）前后相等，且精确等于 `chronicle/chronicle.jsonl` + `continuity/origin.json` |
| 7 | 不复用 Runtime A 的 Service / Context / Plugin 实例或内存恢复状态 | **成立** | 对象同一性见 §6；另有独立证据见本节下方 |
| 8 | Chronicle 损坏后新 Runtime 诚实失败，不自动创建 / 修复 / 截断 / 伪装成空历史 | **成立（见 §9 记录的限制）** | 7 种可检测损坏全部 `failed` + 真实领域错误；无任何写入 |

§7 的每一条都由 `npm test` 中的断言直接覆盖，不是人工判断。

### 关于第 7 条的独立证据

对象 `!==` 只能证明「不是同一个对象」，不能证明「没有内存残留」。因此另有两条更直接的证据，它们各自针对不同的失效方式：

**证据 A：事实内容取自磁盘。** Runtime A 结束（其 Service 对象仍被测试代码持有）之后，把 store 里那条 fact 改写成**另一条仍然合法**的 fact（只改 payload，其余字段保持不变），然后让全新 Runtime B 去读：

```text
B 读到的是改写后的值     → 说明事实内容来自磁盘
B 读到的不是 Runtime A 的值 → 说明没有回放内存里的旧事实
```

这一条是决定性的：如果新 Runtime 从内存重建了事实，它只会报出 Runtime A 写下的那个值。改写后的值只有磁盘上有。

**证据 B：校验也取自磁盘。** 把 fact 行改**坏**（不再合法）之后，全新 Runtime C 直接 `failed`，连 Service 都不给出。

两条证据不等价，第一版验收**只写了证据 B**，因而对「内容是否来自内存」其实没有判别力——这一点是被变异测试发现的，见 §10。

## 8. 损坏 Chronicle 的失败行为

覆盖 7 种可检测损坏。每一种都在**已经存在 Fact A 的合法 store** 上制造，因此「唯一变量就是这一处损坏」：

```text
store truncated mid-fact          InvalidChronicleStoreError  store does not end with a newline
store is empty                    InvalidChronicleStoreError  store does not end with a newline
header is not valid JSON          InvalidChronicleStoreError  header is not valid JSON
header line is blank              InvalidChronicleStoreError  header is not valid JSON
header kind is wrong              InvalidChronicleStoreError  header kind is not hikari-chronicle
fact line is not valid JSON       InvalidChronicleStoreError  fact line is not valid JSON
store belongs to another Hikari   ChronicleOwnerMismatchError belongs to … not to …
```

每一次都断言：

```text
continuity        = active      ← 主体通过同一条依赖图正常恢复
observer          = active      ← 且观察到的是同一个 hikariId
chronicle         = failed
probe             = waiting     ← 完整组合没有收敛
error             = 真实领域错误类型 + 真实原因
服务的获取         = 没有拿到任何 chronicle Service
store 字节         = 与损坏后逐字节相同（不修复、不截断、不重写）
整棵文件树         = 与损坏后完全相同（不新建任何文件，含 .tmp）
```

另有两条「缺失」路径：

```text
store 被删除  → continuity active / chronicle failed / ChronicleNotInitializedError
                且 store 文件没有被重新创建
origin 被删除 → continuity failed / chronicle waiting / probe waiting
                且 origin 与 store 都没有被重新创建
origin 损坏   → continuity failed / chronicle waiting / InvalidOriginError
                且 origin 与 store 字节不变
```

**失败是诚实的，而且是局部的**：事实史不可用时，主体仍然被正常恢复并可以通过 `continuity.current@1` 观察到——因为 `test.continuity-observer` 只 require continuity，它与 chronicle 的失败无关。这一点只有两个 Probe 的设计才能观察到（见 §4）。

## 9. 明确记录的限制：Chronicle v1 没有完整性标记

**这是本阶段唯一一处「要求 8 没有被完整满足」的地方，必须如实记录。**

Chronicle v1 的 store 格式是：

```text
第一行   header：kind / version / owner
之后每行 一条 fact
```

没有事实条数、没有链式哈希、没有墓碑、没有任何完整性标记。因此：

> **一个 fact 行被删光、header 完好的 store，与 `initializeChronicle()` 刚写出来的 store，在结构上完全一致。**

实测行为：

```text
删光 fact 行 → 新 Runtime: continuity active / chronicle active / probe active
              chronicle.read() → []
              chronicle.get(Fact A 的 id) → undefined
              文件字节不变（Runtime 没有写入任何东西，也没有"修复"）
```

也就是说：**这种特定形状的损坏会被报告成空历史**，而不是失败。

这不是 Runtime 或 Chronicle 的实现缺陷，而是 **v1 存储格式本身分辨不了**。要分辨它必须给格式加东西（事实计数、链式哈希、墓碑），而本轮明确禁止新增生产领域机制，因此**本阶段不做，也不应做**。

它被写成一个明确的、命名为 `documented limit` 的测试，而不是被跳过或被断言成一个我们不拥有的保证：

```text
test('documented limit: a well-formed store with its facts removed
      is indistinguishable from a fresh store')
```

该测试断言的是**实际行为**（报告空历史）与**实际不发生的事**（Runtime 不写入、不删除、不"修复"）。

要求的准确读法因此是：

> 对**所有可检测的损坏**，新 Runtime 诚实失败，不自动创建、修复、截断或伪装成空历史。
> 「所有 fact 行被删光」这一种形状在 v1 格式下不可检测，属于已记录的格式限制，不是实现缺陷。

这是 P2-02 冻结格式时就已存在的事实，P2-04 只是第一次把它**测出来并写下来**。

## 10. 当前测试与变异测试

本地自动化测试：**98 / 98 PASS**（16 个 P2-04 + 26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime，原有测试全部保持通过）。

编译：`tsc --noEmit` 无错误。

P2-04 的 16 个用例：

```text
主验收      1. Runtime A → 全新 Runtime B 恢复同一 Hikari 与同一 Fact（覆盖要求 2/3/4/5/6）
            2. Runtime A / B 不共享 Runtime / Context / Plugin / Service 实例（覆盖要求 1/7）
            3. Runtime B 报的是磁盘上的事实，而不是 Runtime A 留在内存里的值（覆盖要求 7）
            4. Runtime A 结束后被改坏的 store 会被 Runtime B 拒绝（覆盖要求 7）
            5. CLI 二进制创建的数据能被 Runtime 生命周期恢复，且 hikari start 仍识别它

损坏        6-12. 7 种可检测损坏的诚实失败（覆盖要求 8）
            13. 已记录的格式限制：删光 fact 行的 store 与全新 store 不可区分
            14. store 被删除后不会被重新创建
            15. origin 被删除后不会被重新创建
            16. origin 损坏后不会被修复
```

第 5 条把 P2-03 与 P2-04 接了起来：数据由**真实 CLI 可执行文件**创建，而不是由测试直接调用领域 API 创建，两次跨 Runtime 写入之后 `hikari start` 仍然 `exit 0` 且字节不变。

主验收**没有**用 `restoreHikari()` + `openChronicle()` 代替 Runtime 生命周期：两个 Probe 都是通过 `runtime.loadPlugin()` 走依赖图拿到的 Service。领域 API 只在测试的**期望值**一侧出现（`restoreHikari()` 用来独立算出期望的 `hikariId`），不在观测路径上。

### 变异测试：验收本身有没有判别力

「测试通过」不等于「测试有效」。因此对验收做了一次变异：把 `dist/chronicle/service.js` 的 `read()` 改成返回一个**模块级共享数组**——即精确模拟「跨 Runtime 复用内存恢复状态」这一种缺陷（`src/` 未改动，变异只注入编译产物，事后已重建恢复）。

结果：

```text
第一次变异（对第 3 条还没写出来时的版本）
→ 2 个用例失败：主验收、实例独立性
→ 但第 4 条（改坏 store）仍然通过

补上第 3 条之后重新变异
→ 3 个用例失败：主验收、实例独立性、第 3 条
```

第一次变异暴露的问题：**改坏 store 那条测试对「内容是否来自内存」没有判别力**，因为 `openChronicle` 挂载时的校验本来就经过磁盘，缓存实现照样会被拒绝挂载。它证明的是「校验读磁盘」，不是「内容读磁盘」。第一版文档曾把它当成要求 7 的独立证据，这个说法被变异测试推翻，现已改正为 §7 的证据 A / 证据 B 两条，并补上了真正有判别力的第 3 条。

这条记录本身是本阶段的一个方法结论：**验收代码和被测代码一样需要被证伪**，而证伪它的成本很低。

## 11. 本阶段明确没有实现

- 没有任何生产代码改动：`src/` 零改动、`src/index.ts` 零改动；
- 没有为测试修改 Runtime API，Runtime 仍然没有公共 Service 读取接口；
- 没有 Resident、没有常驻进程、没有后台生命周期；
- 没有自动修复、自动重试、自动降级、自动截断；
- 没有给 Chronicle v1 增加完整性标记（事实计数 / 链式哈希 / 墓碑）；
- 没有多主体、多节点、跨进程、跨机器的生命周期验收；
- 没有 Memory / World / Goal 的生命周期；
- 没有事实的 update / delete / 查询 DSL；
- 没有 `hikari stop` / `status` / `log`。

## 12. 实现原则

本阶段的上位原则仍然是 `core-architecture-v0.md` §1 与 §12.2 的「Runtime 负责机制，不理解领域意义」，没有新增第二套架构原则。P2-04 是这条原则在验收侧的延伸：

> **验收只观察依赖图的结论，不替依赖图下结论。**

Probe 是普通 Plugin，它不能强制任何东西激活，也不能让 Runtime 认为某件事成功了。它能做的只有：声明 `requires`、拿到依赖图决定要给它的东西、把结果交给测试。因此测试里所有「收敛 / 未收敛」的结论都来自 Runtime，而不是来自测试的编排。

这也解释了 §9 的记录方式：如果一项保证在冻结架构里不成立，**验收的职责是把它如实写下来，而不是改造架构去让它成立**。
