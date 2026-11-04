# M2-a Architecture Review

**评审对象**：Memory Store 的引入是否守住了 M0/M2 已经冻结的边界。
**评审方法**：对照 `docs/architecture/hikari-base-plugin-architecture-v0.1.md` 的所有权表与 `docs/architecture/memory-core-m2-architecture-v0.1.md` 的 §1/§2/§9，逐条核对代码落点；看 `git diff --stat` 确认改动范围。
**评审时间**：2026-11-04。

## 一、边界核对

| 边界 | 判定 | 依据 |
|---|---|---|
| Memory 不拥有 Findings | 守住 | `record_finding` 仍在 `hikari-native/world/findings.js`；`store.mjs` 不 import 任何 world 模块 |
| 不复制其他插件的内部状态 | 守住 | `store.mjs` 只依赖 `node:fs`/`node:path`/`node:os`/`node:crypto`/`node:url` |
| 依赖单向 `memory → world` | 守住 | `memory/index.js` 的 `inject` 仍是 `['tools','hikariWorldFindings']`；World 不引用 Memory |
| 不建项目级隔离 | 守住 | `resolveMemoryDir` 只认 `storeDir`/`DSH_HOME`/`homedir()`，三条都不含仓库路径 |
| 不改 Runtime | 守住 | 改动只在 `hikari-native/memory/`、`hikari-native/test/`、`docs/`、`experiments/` |
| 不新增依赖 | 守住 | `package.json` 未改；`store.mjs` 五条 import 全 `node:` 前缀 |
| 不顺手扩展能力 | 守住 | 未新增任何模型可见工具；`search_memory`/`read_memory` 的定义与 `execute` 未动 |

## 二、生命周期

`MemoryStore` 由 `hikari-native/memory/index.js` 在自己的 fiber 里 `open`，并用 `ctx.effect(() => () => void store.close())`（`:67-69`）挂到 fiber 的释放链上。卸载插件 → fiber dispose → effect 回调 → `close()`。不需要手写注销函数，也不存在跨插件共享的句柄。

**`apply` 从同步变 async 是本轮唯一的结构性变化。** 影响有三层：

1. Cordis 的 fiber 会等 Promise resolve 才进 `ACTIVE`，所以存储打开期间插件处于加载中。
2. 存储打不开（目录不可写、schema 不兼容）→ 插件整只拒绝加载，工具一个都不注册。这符合任务书「无法安全恢复的数据明确报错」，但代价是**错误发生在加载期而不是使用期**，模型看不到任何提示，只有启动日志里一行。
3. 任何外部代码若假设「`app.plugin()` 返回即工具可用」会踩空。DSH 自身不这么假设（工具按需调用），但这是一个**新的时序契约**，写在这里备案。

## 三、两处偏离 M2 文档

两处都不是放松，是把 M2 写的时候没区分的风险补上：

1. **§9.4「单行解析失败 → 跳过计数」→ 实现为「尾部跳过、中间报错」。** M2 那张表把「跳过」当默认动作，但跳过中间行会让其后全部记录错位，与任务书「不得静默丢弃有效记忆」冲突。只有在文件末尾才允许猜。
2. **§9.4「memoryId 重复 → 后者覆盖并计数」→ 实现为「内容相同才重放计数，内容不同直接报错」。** 同 id 装两段不同内容时，覆盖等于用未经裁决的猜测抹掉另一段。

另有一处方向相反但同样收紧：**meta 读不出来不再拒绝启动**，改为从 jsonl 重建。这不是放宽——把派生文件的损坏当成致命错误，会让有效记忆全部不可达，那才是真正违反任务书。

## 四、对外契约的变化

- **`memory/index.js` 的 `apply` 从同步变 async**（见二）。
- **ready 日志多了四段**（`store=`/`records=`/`seq=`/`damage=`），走 `console.error`（沿用 M1 的结论：DSH 的 exporter 只放行 warn/error）。
- **`config.storeDir` 是新增的可选配置项**，默认不设。**`cordis.patch.yml` 未改**——这意味着当前形态下存储位置完全由 `$DSH_HOME`/`~/.dsh` 决定，profile 无法覆盖。要改这一点需要动 patch，不在本轮范围。

## 五、待人工确认的三件事

1. **是否接受「存储在插件加载期打开、失败即整只不加载」**。替代方案是懒加载（第一次用工具时才开），好处是加载快、坏处是模型会在使用时才撞上错误。推荐保持现状：记忆存储坏掉属于需要人知道的事，不应该让模型一边用一边猜。
2. **是否接受「`cordis.patch.yml` 本轮不改，因此 profile 无法指定 storeDir」**。当前 `DSH_HOME/hikari/memory` 是唯一的落点。要支持 profile 级覆盖，需要在 patch 里加 `storeDir` 键——那是改配置契约，需要单独裁决。
3. **单写入者假设的边界**。当前 DSH profile 只起一个实例，假设成立。若将来多实例（例如同时开 GUI 与 headless），会交错写同一个 jsonl。本阶段不做锁，也不做检测；需要明确「多实例不同时运行」是不是可以长期成立的前提。

## 六、结论

**架构边界守住（PASS），附一条须记录的时序契约变化（`apply` async）与三件待人工确认事项。** 没有越界实现，没有偷偷扩能力，没有把 World 的状态搬进 Memory。
