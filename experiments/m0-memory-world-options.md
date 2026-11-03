# M0 素材：Memory 与 World 的三个方案

> 只比较，不实现。所有源码行号对应 HEAD `b4c4237`。

## 1. 现状基线

Memory 未来要读的「历史」，今天分成两种，形态完全不同：

| | Findings | Session Episode（未来） |
|---|---|---|
| 载体 | Session 日志的 `plugin:hikari/finding` 记录 | Session 日志的 message / tool 记录 |
| 谁在管 | World | 还没有 owner |
| 当前入口 | `world/findings.js:527` `search_memory`、`:580` `read_memory` | 无 |
| 投影键 | `hikari/world.findings`（`:21`） | 无 |
| 读取方式 | `ctx.sessionProjections.stateOf(session, 'hikari/world.findings')` | — |

两条硬约束来自源码：

1. **World 能读 findings，靠的是 `inject: ['sessions', 'sessionProjections', ...]`**（`hikari-native/world/index.js:20`）。任何想读 findings 的插件，要么走 World，要么自己也 inject `sessionProjections` 并知道那个投影键。
2. **`world` 的 `inject` 里没有 Memory，也不可能有**——任务书要求依赖单向 `Memory → World`。

## 2. 三个方案

### A. 完全独立

World 继续提供 `search_memory` / `read_memory`；Memory 提供 `search_history` / `read_history`。

### B. Memory 统一检索入口

Memory 提供一套 `search_memory` / `read_memory`，内部向 World 取 findings、向自己的数据取历史；World 作为一个只读的 Findings Provider。

**B 有两条实现路径，差别是本质的：**

- **B1（World 暴露只读 Service）**：World 新增一个只读接口（Cordis service），Memory `inject` 它。Memory 不知道 findings 存在哪个投影键、什么数据结构。
- **B2（Memory 直接读投影）**：Memory 自己 `inject: ['sessionProjections']`，读同一个 `hikari/world.findings`。**这等于 Memory 知道了 World 的内部存储格式**——两份代码同时依赖一个内部键，任何一方改结构都会静默破坏另一方。它违反任务书的最高约束（「不能偷偷复制并维护另一份事实」）的精神，只是复制的是**结构知识**而非数据。

### C. 共享契约、各自自治

定义统一的结果形态（一条记忆长什么样、分页怎么表达），但每个来源各自注册自己的工具。模型仍然看到两组工具。

## 3. 六个维度比较

| 维度 | A 完全独立 | B1 统一入口 + 只读 Service | B2 统一入口 + 直读投影 | C 共享契约 |
|---|---|---|---|---|
| **模型看到几个检索工具** | 两组 | 一组 | 一组 | 两组 |
| **Hikari 插件间新增 Service 依赖** | 无 | **有**（Memory → World 只读接口） | 无（但依赖 World 内部投影键） | 无 |
| **中央路由风险** | 无 | 中——Memory 是分发者，不是数据所有者 | 高——Memory 与 World 共享存储格式 | 无 |
| **状态所有者清晰度** | 最高 | 高（World 独占 finding，Memory 独占 history） | **低**（同一份 finding 有两个读者知道它的存储） | 最高 |
| **模型选择负担** | 高（要判断去哪个工具） | 低 | 低 | 高 |
| **新增来源是否改模型接口** | 改（每加一类加一组工具） | 不改（加 provider） | 不改 | 改（但格式一致） |

## 4. 迁移风险（已取证）

**同名工具重复注册不会报错，后注册者静默覆盖前一个。**

证据在 `G:\work\LAB\code\_poc\poc01\node_modules\@deepseek-ai\dsh-tools\lib\index.js`：

- `ToolRuntime.register()`（`:2970-2979`）只校验 `output` 形状、`timeoutMs`、以及 `run_code` 保留名（`:2977`），**没有任何同名冲突检查**；注册动作是 `layer.tools.insert(name, definition)`（`:2978`）。
- `view()` 合成可见工具集时用 `inherited.set(name, definition)`（`:3057`）、`visible.set(name, definition)`（`:3065`、`:3069`）——**Map 覆盖语义**。

后果：若 B 方案下 Memory 注册 `search_memory` 而 World 没关掉自己的注册（`world/findings.js:527`、`:580`），**谁最后加载谁生效，没有警告**。而加载顺序由 `hikari-native/cordis.patch.yml` 的插件列表顺序决定（world 在 :75-88，memory 未来会排在它前后），一次配置调整就能让工具悄悄换掉实现。

**推论**：World 侧的工具注册必须带开关（例如 `registerMemoryTools: false`），且这个开关在 B 落地的那一次提交里必须同时改；不能靠加载顺序。

## 5. 推荐

**推荐 B1，理由是「接口稳定」比「零新增依赖」更值钱。**

- A 和 C 都要求模型在两组工具之间判断「这件事该问 findings 还是问历史」，而这个判断**恰好是任务书交给 LLM 的那部分**（「是否回忆、读哪一条、读多少」）。但把**入口选择**也交给模型，等于让它先猜数据结构再决定读哪里——那是工程认知，不是她的认知。
- B1 让模型只面对一套记忆接口，新增来源（Episode、跨项目）不需改模型可见面。这直接对应任务书「尽量保持当前模型可见接口稳定」。
- B1 的代价是一条新的插件间依赖。它必须是**单向、只读、语义化的**：Memory 能问「有哪些 finding 匹配」，但看不到 finding 存在哪里。

**不推荐 B2**：它让两个插件共享同一个存储键，是「偷偷复制」的结构版。

**不推荐 A/C 作为终态**：可以作为**过渡**（A 几乎零成本，且今天 World 已经在提供这两个工具）。

**B1 的实现形态不需要新框架**：DSH 自己的 tools 服务就是这么做的——`import { Service } from "@deepseek-ai/cordis"`（`dsh-tools/lib/index.js:1`）、`class ToolRuntime extends Service`（`:2756`）、`super(ctx, "tools")`（`:2794`）。Hikari 用同一机制暴露一个只读 service 即可。

## 6. 建在 B1 之上的四条硬约束

1. **工具名与参数不变**：`search_memory(query, limit, offset)`、`read_memory(id, offset, limit)`。变的是描述与结果集——描述里必须写明「包含两类来源」，否则她会以为结果集和以前一样。
2. **World 侧注册可关**：`installFindings` 加开关（当前是硬注册，`findings.js:476-625`），默认关，由 patch 显式开。
3. **只读接口不返回内部结构**：返回「记忆条目形态」，不返回 projection 里的原始 record。
4. **依赖方向单向**：World 的 `inject` 永远不出现 memory。可以加一条测试：`grep` 检查 `world/` 下不出现 `memory`。

## 7. 尚未确定的事

- **`search_memory` 语义扩展后，已有 finding 的可用性**：历史 Session 里记录的是 finding 记录本身，只要投影键不变，读出来照旧。这一点**没有实测**，因为今天还没有第二个来源。
- **分页跨来源怎么合并**：findings 与 history 的 `offset` 语义不同（findings 用行号偏移、history 可能用时间游标）。B1 若不处理，`offset` 在两来源混合时会跳条目。这是 M1 必须解决的第一件事。
- **Memory 是否是独立 npm 包**：任务书只要求「可以不与 World 绑在一起」，没要求现在拆包。当前 `hikari-native` 是单包多子路径（`package.json:7-22` 的 exports），新增 `memory/` 子路径即可，拆包留给真正需要独立版本节奏的时候。
