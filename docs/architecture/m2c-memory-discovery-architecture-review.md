# M2-c · Memory 发现与修订闭环：架构评审

日期：2026-11-05
前置：`docs/development/m2c-memory-discovery-functional-review.md`（七问七答）、`experiments/m2c-code-facts.md`（事实与缺口）、人 2026-11-05 的两条裁决（刷新索引不改产品；**写入工具返回契约不动**）
本文只做架构对照，不冻结接口；冻结面在 `docs/architecture/m2c-memory-discovery-interface-freeze.md`。
状态：已评审（Review，非冻结面）；本片级别 B（普通 Capability：新增两个只读工具，不改 Runtime，不改写入契约）。

---

## 1. 八条冻结前提逐条对照

| # | 冻结前提 | 本片怎么满足 | 代码依据 |
| --- | --- | --- | --- |
| 1 | Memory 由 Hikari 全局拥有 | 两个新工具由 `hikari-memory` 注册，与写入工具同处一个模块族 | `hikari-native/memory/index.js:19-20` |
| 2 | 单一全局 Memory Store | 检索与读取都走同一个 `MemoryStore` 实例，不建第二份索引 | `hikari-native/memory/index.js:69`、`hikari-native/memory/store.mjs:24` |
| 3 | 跨项目、跨 Session 持续 | 读的是同一份 `memory.jsonl`，没有 project/session 过滤条件 | `hikari-native/memory/store.mjs:67-92` |
| 4 | 模型判断是否值得保存 | 本片只读，不产生写入，判断权不转移 | 两个新工具无写路径 |
| 5 | 工程负责校验、ID、时间、持久化 | 检索侧只做参数校验与形状派生，不生成 ID、不写盘 | 见 §5 |
| 6 | append-only | 只读工具不触碰 `append` 白名单与记录形状 | `hikari-native/memory/store.mjs:475-480` |
| 7 | 不自动注入长期记忆 | 新增的是**模型主动调用**的工具，不是上下文注入；Memory 插件仍不注册 `systemPrompt` | `hikari-native/memory/index.js:19-20`（inject 只有 tools 与 hikariWorldFindings） |
| 8 | 不自动提取、不自动判断过期、不改变 Findings 所有权 | 无提取路径；`supersededBy` 只表达「有人改过它」，不表达「过期」；findings 仍由 World 拥有 | 见 §2、§3 |

前提 7 值得说细：仓库里确实存在一条注入通道，findings 用它在每个模型请求里注入**当前 session 的**发现——

```js
// hikari-native/world/findings.js:395-401
if (injectContext) {
  ctx.systemPrompt.context({
    name: 'hikari:findings',
    order: 150,
    text: () => renderFindings(currentFindings()),
  })
}
```

但 `currentFindings()` 读的是 `ctx.sessionProjections.stateOf(session, FINDINGS_PROJECTION_KEY)`（`hikari-native/world/findings.js:390-392`），而 `session` 来自 `ctx.sessions.get(sessionId)`（`:387`）——注入的内容**只属于本 session**。Memory 侧一行都没有注册（`hikari-native/memory/*.js` 里没有 `systemPrompt`），所以「不自动注入长期记忆」不是靠约定，而是代码里根本没有这条线。

---

## 2. 「持久面唯一」：证据

**主张**：跨 Session 唯一持久的是 Memory Store；World findings 只存在于各自 Session 的日志投影里，不会跨会话可见。

1. findings 的安装签名要求单一 `sessionId`，并在安装时校验非空：
   ```js
   // hikari-native/world/findings.js:374-377
   export function installFindings(ctx, { sessionId, root, ... }) {
     if (typeof sessionId !== 'string' || sessionId.length === 0) {
       throw new Error('hikari findings: sessionId is required')
     }
   ```
2. 每次读取都从该 session 取：`const currentSession = () => ctx.sessions.get(sessionId)`（`:387`），并且投影不存在时返回 `{}`（`:390-392`），没有「遍历所有 session」的分支。
3. 记录上的 scope 字段本身就带 `sessionId`：`scope: { project, sessionId }`（`:486`，形状定义在 `:151`）。
4. Memory 是文件型全局存储：`MEMORY_JSONL = 'memory.jsonl'`（`hikari-native/memory/store.mjs:24`），目录由 `resolveMemoryDir` 决定（`:67-92`，不读 `process.cwd()`），生产代码里只有 `hikari-native/memory/index.js:69` 打开它；测试另开临时目录（`hikari-native/test/memory-store.test.mjs:51` 等、`hikari-native/test/memory-writing.test.mjs:56`），不碰真实存储。
5. 除 `hikari-native/memory/store.mjs` 自身的定义（`MEMORY_JSONL` 在 `:24`）之外，在 `hikari-native/**/*.js` 里 grep `MemoryStore|memory.jsonl` 只命中 `hikari-native/memory/index.js:15`、`:69` 与 `hikari-native/memory/writing.js:9`、`:359`（后者是注释）；没有第三个组件持有它。

**推论**：新 session 里能看见的只有「模型自己的上下文」与「Memory Store 里的记录」。findings 不会自己游过来——这正是 M2-a 决定 Memory 不参与检索时要付的代价，也是 M2-c 必须补的入口。

**推翻条件检查**：没有找到任何跨 Session 共享 findings 或被注入到新会话的路径。注入通道（findings 的 `systemPrompt.context`）只喂当前 session 的投影。→ 判断成立。

---

## 3. 「修订闭环不改写入契约」：证据

**主张**：发现与修订闭环可以完全建在现有写入契约与 append-only 语义之上，不需要改 store 的字段或写入规则。

闭环要的四样东西，逐一看现有十字段够不够：

| 闭环需要 | 现有依据 | 够不够 |
| --- | --- | --- |
| 找到候选 | 读 `text` 做子串匹配 + 时间窗（`occurredAt`）+ 链头筛选 | 够；`text` 已在十字段内（`hikari-native/memory/store.mjs:31-42`） |
| 判断新旧关系 | 读 `supersedes` 与链头（无后继者） | 够；链头判定用 `store.all().some((r) => r.supersedes === id)`（`hikari-native/memory/writing.js:272` 的 `store.all().find((record) => record.supersedes === id)` 就是同一判据，`:276` 只是它不成立时抛的那条错误） |
| 发起修订 | `revise_memory(memoryId, text)`，新记录带 `supersedes` | 够；M2-b 已冻结并实现 |
| 以后还能用 | 新记录成为链头，旧记录永久保留 | 够；append-only 不删不改（`hikari-native/memory/store.mjs:468-533`） |

`supersededBy` 是**派生字段**：读取时扫一遍现有 `supersedes` 反查得到，不落盘、不进 `MEMORY_FIELDS`、不改 `validateRecord`（`hikari-native/memory/store.mjs:105-158`）。这一点与 M2 §6.3 的裁定一致：反向关系放内存索引/派生，不写进记录（`docs/architecture/memory-core-m2-architecture-v0.1.md:249-253`）。

**代价**：每次检索要扫全表（`store.all()` 是 O(n)，`hikari-native/memory/store.mjs:259-261`）。在当前规模（单文件、记录数远小于 10⁴）可接受；M2 §6.3 自己也只把反向关系放在内存索引里、不落盘（`docs/architecture/memory-core-m2-architecture-v0.1.md:251`）；本片连内存索引也省掉、每次现扫，是在 M2 之上的进一步简化，代价就是这里的 O(n)。

**推翻条件检查**：没有发现闭环所需的信息落在十字段之外。→ 判断成立。

---

## 4. 与 M2 架构文档的偏离

| id | 文档怎么说 | 本片怎么做 | 理由 |
| --- | --- | --- | --- |
| D-1 | §7.1 的工具表只有四个名字（`search_memory`/`read_memory` 为 [F]，`write_memory`/`revise_memory` 为 [I]），`docs/architecture/memory-core-m2-architecture-v0.1.md:259-266` | 再加两个：`search_memories`、`get_memory` | 文档没有定义「发现」这一层；把检索扩成双作用域会推翻 M2-b 验收第 12 项（检索结果里不得出现 `m-` 记录）。新增独立工具是唯一不改既有契约的做法（人 2026-11-05 裁定选项 A） |
| D-2 | §5.4 要求渲染「不排序、不标已过期」（`:209-214`） | 检索结果按 `seq` 倒序 | §5.4 约束的是**注入到上下文**的渲染；本片返回的是工具结果，模型的检索需要「新的在前」；且 `occurredAt` 大量为 null，按时间排序不可靠 |
| D-3 | §5.4 同一节说不标「已过期」 | 返回 `supersededBy`（只给 id，不给「过期」字样） | 「有人改过它」是结构事实，「过期」是价值判断；两者必须分开 |
| D-4 | §6.3 不做传递闭包（`:383`） | `get_memory` 只给直接前驱/后继各一个 | 遵守，不越界 |
| D-5 | §7.3 检索永远由模型发起（`:279-283`） | 两个工具都不自动调用 | 遵守 |
| D-6 | §11 验收要求「写一条 → 重启 → `search_memory` 找得到」（`:422`） | 该验收在本片由 `search_memories` 承接，`search_memory` 不变 | 与 M2-b 的 D-7 同源：findings 检索不扩，Memory 检索另开入口（`:422` 是 M2-b 的验收条目本身；§11 对 M2-c 的阶段定义另见 D-7） |
| D-7 | §11 把 M2-c 定义为「来源解析与时间渲染」（`docs/architecture/memory-core-m2-architecture-v0.1.md:424-428`：`read_memory` 带 source 可达性、检索结果带 `age`、加 `since`/`until`） | 本片把 M2-c 改成「跨 Session 的记忆发现与修订闭环」：`search_memories` + `get_memory`；不做 source 可达性检查、不渲染 `age` | 阶段定义由人 2026-11-05 改写（原话：「M2-c 的重点是**跨 Session 的记忆发现与修订闭环**」）。source 可达性与时间渲染顺延到后续阶段；本片只在 `get_memory` 里原样返回 `source`，不解析、不判定可达 |

---

## 5. 工程承担什么、不承担什么

| 工程承担 | 落点 |
| --- | --- |
| 参数校验（query 非空、limit 范围、nextOffset 非负、时间窗跨字段顺序） | 工具层，`recall.js` |
| 从记录派生检索视图（snippet、`supersededBy`、链邻居） | 工具层，只读 `all()`/`get()` |
| 错误消息可操作 | `throw new Error('<CODE>: …')`，与 M2-b 同风格 |
| 生命周期（随 fiber 卸载） | `ctx.effect` 由 Runtime 管理；工具注册走 `installMemoryRecallTools` |

| 工程不承担 | 理由 |
| --- | --- |
| 判断「哪条记忆相关」 | 匹配是子串加法，排序是 `seq`；相关性由模型读结果判断 |
| 判断「哪条已过期」 | 只给 `supersededBy` 这一结构事实 |
| 替模型补当前时间 | 人 2026-11-05 裁决：时间感知是更基础的问题，另案 |
| 写入、修订、删除 | 本片只读 |

---

## 6. 风险

1. **命名混淆**：`search_memory`（findings）与 `search_memories`（长时记忆）只差一个字母。缓解：两个工具的 description 第一句就写明作用域（"your own persisted findings about this project" vs "your long-term memories, across projects and sessions"），并在冻结面里把两者并排列出；不合并、不改名（改名等于改 M2-b 契约）。
2. **O(n) 全表扫**：记录上万条时每次检索都要扫一遍。当前可接受；M2 文档把索引留给后续阶段。
3. **`occurredAt` 长期大量为 null**：时间窗过滤会漏掉这些记录。这是 M2-b 已登记的已知局限，不是本片引入的缺陷。冻结面明确写「null 不命中时间窗」，并在 description 里提醒模型。
4. **模型不知道自己在哪个 session**：不影响只读工具（它们是全局的、不带 session 参数），但影响「修订后如何在别的 session 里接上」——这正是本片要补的，属于 M2-c 的价值而不是风险。

---

> D-7 是「阶段定义被改写」的登记：文档写的是「来源解析与时间渲染」，本片做的是「发现与修订闭环」。它不是实现细节上的偏离，而是目标层的变化，所以单独成行，并附上改写出处。

## 7. 结论

- 两个只读工具（`search_memories`、`get_memory`）放在 `hikari-memory` 里、只依赖 `MemoryStore` 的公开成员，owner 与边界不变。
- 「持久面唯一」与「修订闭环不改写入契约」两条均有代码依据，未见反例。
- 与 M2 架构文档有七处偏离（D-1..D-7），每处都有理由，且都不触碰「不自动注入」「不自动提取」「不改 Findings 所有权」。
- 可以进入冻结（`docs/architecture/m2c-memory-discovery-interface-freeze.md`）。

**没有做的事**：没有改任何实现代码；没有跑测试（本片只出文档）；没有提交。
