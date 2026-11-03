# M1 实施细纲：Memory 检索骨架与工具接管

> 只到「能执行」的粒度，不含实现代码。对应 M0 文档 §7 的 M1-a / M1-b 两阶段。
> 源码引用以 HEAD `172e5e0` 为准；§8 的探针读数是实测的。

## 1. 目标与不做

**做**：让 Memory 成为一个能加载、能被注入、能接管 `search_memory` / `read_memory` 的插件骨架，数据仍然只来自 World 的 findings。

**不做**：不新增数据持久化、不引入检索算法、不写 Session Episode、不做 Finding → Memory 同步、不改 `record_finding` 的语义。

## 2. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `hikari-native/world/findings.js` | 改 | 新增只读接口；两个工具注册包进开关 |
| `hikari-native/world/index.js` | 改 1 行 | 把 `registerMemoryTools` 透传进 `installFindings` |
| `hikari-native/memory/index.js` | **新增** | Memory 插件：注入只读接口、注册两个工具、冲突检测 |
| `hikari-native/memory/tools.js` | **新增** | 两个工具的 schema 与执行体（从 findings.js 搬过来，**逐字保留**） |
| `hikari-native/package.json` | 改 | exports 加 `./memory` |
| `hikari-native/cordis.patch.yml` | 改 | 新增 memory 段；world 段加 `registerMemoryTools: false` |
| `hikari-native/test/memory.test.mjs` | **新增** | 六项断言（见 §5） |

## 3. M1-a：World 暴露只读接口（不动任何工具）

**目的**：先把接口立起来，工具还留在 World，行为零变化。这一步任何结果都可以整段删掉回滚。

### 3.1 `findings.js` 新增

**位置：`installFindings`（`:354`）的**最后**一步**，在 `currentFindings`（`:368-373`）与全部工具注册之后：

```js
// installFindings 末尾
ctx.provide('hikariWorldFindings', Object.freeze({
  // 只读：调用方拿不到 findings 对象本身，只能拿到查询结果
  search: (opts) => searchFindings(currentFindings(), opts),
  read: (opts) => readFinding(currentFindings(), opts),
  // 供 Memory 拼描述用，不含任何条目内容
  describe: () => ({ sources: ['findings'] }),
}))
```

**为什么必须放在最后**：`inject: ['hikariWorldFindings']` 只保证 Memory 等到 **Service 出现**，不保证 World 的 `apply` 已经跑完。如果 `provide` 在工具注册之前，Memory 的 `apply` 可能在 World 注册 `search_memory` 之前就开始执行——此时它的冲突检测读到 `undefined` 而放行，随后 World 再注册，两个提供者静默覆盖（`dsh-tools` 的 `register()` 无同名校验，`:2970-2979`）。把 `provide` 放到最后，让「Service 可见」等价于「World 已完成注册」。
M1-a 阶段末尾就是 `provide` 本身；M1-b 阶段 `provide` 排在 `record_finding` / `search_memory` / `read_memory` 三段注册之后。

**为什么冻结**：`Object.freeze` 阻止消费者给 Service 对象增删方法（`read` 改成写、挂一个 `delete()`），把「只读」从约定变成运行时事实。

**fail-closed 路径也要 provide**：`resolveProject(root)` 返回 `undefined` 时，现有代码提前 return，只保留 projection、不注册任何工具。如果那里不 provide，Memory 的 `inject` 会永远等下去 → 整个 Memory 插件停在 `PENDING` → 模型连 `search_memory` / `read_memory` 都看不到。所以这条路径也调 `provideWorldFindings(ctx, currentFindings, undefined)`，把 fail-closed 收敛为「`describe().available === false`、没有 `record_finding`」，而不是「检索能力整体消失」。历史 findings 仍然可读——它们是会话里已经发生过的判断，与「当前目录是不是仓库」无关。

**实现形态**：抽成具名函数 `provideWorldFindings(ctx, currentFindings, project)`（与 `WORLD_FINDINGS_SERVICE` 常量一起放在 `findings.js` 顶部导出），两条 return 路径各调一次，避免两处重复定义接口。

**为什么这样切**：`searchFindings`（`:213`）与 `readFinding`（`:267`）返回的已经是模型可见形态（`{ id, line, at, status, chars }` / 带 `evidence` 指针的条目），不含 projection 内部结构。接口把它们原样转出去，Memory 就永远不需要知道 `hikari/world.findings` 这个键存在。

**命名**：用单段 `hikariWorldFindings`，与 DSH 自身 service（`systemPrompt` / `tools` / `sessions`）同风格。**不要用点分名**——§8 的实测表明点分名只能通过 `ctx['hikari.worldFindings']` 访问，`ctx.hikari.worldFindings` 是 undefined，容易踩。

### 3.2 验证（这一步的验收）

写探针 `experiments/m1-world-service/probe-world.mjs`：内存 Cordis + 假 session + 装 world（`root` 设成本仓库），然后

1. `ctx.hikariWorldFindings` 拿到对象，`search({query:'f-00'})` 与直接调 `searchFindings(sameFindings, opts)` **逐字段相等**；
2. `read({id:'f-002'})` 同理；
3. **接口封闭**：`Object.keys` 只含三个；`Object.isFrozen(service)` 为 true；尝试 `service.delete = () => {}` 与 `service.search = () => {}` 在严格模式下抛 `TypeError`（或静默失败后值不变）；
4. **返回值不是内部引用**：拿到 `search()` 结果，就地改它的 `status` / `id` / 数组本身（`push`），再调一次 `search()` 与 `read()`，读到的仍是原值——证明 Memory 拿到的是查询结果快照，不是 World 内部状态的可变引用。

### 3.3 回滚

删掉 `ctx.provide(...)` 那一段即可，无其它文件依赖它。

## 4. M1-b：Memory 接管两个工具

### 4.1 World 侧：开关

`installFindings` 签名改为：

```js
export function installFindings(ctx, { sessionId, root, injectContext = true, registerMemoryTools = true, append: injectedAppend })
```

把两段 `ctx.tools.register` 包起来：

- `:527` 的 `search_memory` → `if (registerMemoryTools) { ... }`
- `:580` 的 `read_memory` → 同
- `:476` 的 `record_finding` **不动**（它属于 World，不迁移）
- `ctx.provide('hikariWorldFindings', ...)` **排在以上三段之后**（见 §3.1 的顺序要求）

`world/index.js:132-133` 改为：

```js
installFindings(ctx, {
  sessionId,
  root: config.root,
  injectContext: config.injectContext !== false,
  registerMemoryTools: config.registerMemoryTools !== false,
})
```

**默认值必须是 `true`**（旧 profile 不写就保持现状）；新行为由 patch 显式写 `false` 打开。

### 4.2 Memory 侧：插件骨架

```
hikari-native/memory/index.js
```

```js
export const name = 'hikari-memory'
export const inject = ['tools', 'hikariWorldFindings']

export function apply(ctx, config) {
  // 冲突检测：最终工具注册表里每个工具只能有一个提供者
  for (const toolName of ['search_memory', 'read_memory']) {
    if (ctx.tools.get(toolName) !== undefined) {
      throw new Error(
        `hikari-memory: "${toolName}" is already registered — ` +
        `set world's registerMemoryTools: false in the same patch that loads this plugin`,
      )
    }
  }
  installMemoryTools(ctx, config)
}
```

`ctx.tools.get(name, scope)` 用 `undefined` scope 读全局视图（`dsh-tools/lib/index.js:3087`）。这个检查是任务书「确保每个工具只有一个提供者」在运行时的落点——**因为 DSH 自己不做这个检查**（`register()` 无冲突校验，`:2970-2979`）。

`tools.js` 里放两个工具的 schema 与执行体，**从 `findings.js:527-628` 逐字搬过来**，唯一改动是把 `currentFindings()` 换成 `ctx.hikariWorldFindings`（通过 `ctx.get` 拿到并闭包保存）。

### 4.3 装配

`cordis.patch.yml`：

```yaml
world:
  # ...既有配置
  registerMemoryTools: false   # 新增：移交 search_memory / read_memory

memory:                        # 新增段，放在 world 之后
  enabled: true
```

`package.json` 的 exports 加 `"./memory": "./memory/index.js"`。

**顺序**：memory 段排在 world 之后只是可读性要求。真正的保证是 `inject: ['hikariWorldFindings']`——§8 的场景 2 实测：消费者先注册、提供者后到，消费者的 `apply` 会等到提供者就绪才执行。

### 4.4 旧 Profile

`C:\Users\29719\.dsh\profiles\hikari\package.json` 通过 `link:` 指向仓库，patch 是仓库里的 `cordis.patch.yml`。**新旧行为由同一份 yaml 的 `registerMemoryTools` 决定**，不存在「旧 profile 自动保留旧行为」——除非复制一份 yaml。所以：

- 若要让旧 profile 保持不动，必须在**另一份** patch 里维持 `registerMemoryTools: true`，或者接受旧 profile 一起切换。
- 我的建议：**接受一起切换**。理由：这两个工具的行为在 M1 里逐字不变，切换的唯一可见差别是「谁注册的」，没有用户可见风险。

## 5. 验证清单

| # | 断言 | 方法 |
|---|---|---|
| 1 | 工具名与参数逐字段一致 | 把迁移前后的 `parameters` 对象做深比较（`assert.deepEqual`） |
| 2 | `search_memory` 结果一致 | 同一 session、同一 query、同一 limit，迁移前后结果 `deepEqual` |
| 3 | `read_memory` 结果一致 | 同上，固定 id |
| 4 | **冲突被拦住（两种装配顺序）** | ①先装 world（`registerMemoryTools: true`）后装 memory；②先装 memory 后装 world。两种都断言抛错、消息含 "already registered"，且**最终注册表里 `search_memory` 仍只有 World 那一个** |
| 5 | **真实卸载后工具消失** | `fiber.dispose()` 卸载 memory（不是调手动注销函数）→ `ctx.tools.get('search_memory')` 变 `undefined`，`record_finding` 仍在，World 的 `search`/`read` 仍可用 |
| 6 | `record_finding` 未受影响 | 注册前后 schema 深比较 + 一次真实调用 |
| 7 | Service 不暴露内部状态 | `Object.keys` 只三个、`Object.isFrozen` 为 true、赋值抛错 |
| 8 | 改返回值不影响 World | 改 `search()` 结果的字段与数组，再读仍是原值 |
| 9 | **重新加载后工具恢复** | 卸载后重新 `app.plugin(memoryPlugin)`，`ctx.tools.get('search_memory')` 又有定义，且调用结果与首次一致（无残留旧闭包） |
| 10 | **非仓库目录不饿死 Memory** | `root` 指向非 git 目录时，Service 仍出现（`available: false`），Memory 正常激活、工具可注册；`record_finding` 不存在 |

第 4 项是任务书要求的「CI 检查最终工具注册表」的可执行版本——它比 CI 更早发现问题，且不依赖 DSH 暴露注册表。**两种装配顺序都要测**：§8 场景 2 已证明消费者先声明时 `inject` 会等；要验的是「等到 Service 出现」是否足以保证「World 已完成注册」——这正是 §3.1 把 `provide` 移到最后要消除的竞态。

第 5、9 项必须走**真实插件生命周期**。§8 的生命周期探针已确认：`ctx.effect` 的 disposer 在 `fiber.dispose()` 时被调用；`ctx.provide` 的 service 在 dispose 后变 `undefined`；重新 `app.plugin()` 后 service 与 effect 都重新建立。`ctx.tools.register` 返回的正是 `ctx.effect(...)` 的 disposer（`dsh-tools` 的 `ScopedLayers.effect` 注释：「returns the exact disposer returned by `ctx.effect()`」，`dsh-scope/lib/types/store.d.ts:137`），所以**工具注册自动跟随插件 fiber 生命周期，不需要手写注销函数**。第 5 项要验证的正是这条推论在真 tools service 上成立。

## 6. 回滚

| 从哪退回 | 动作 |
|---|---|
| M1-b → M1-a | 删 memory 段；world 段去掉 `registerMemoryTools: false`（回默认 true）；删 `memory/index.js` |
| M1-a → 现状 | 删 `ctx.provide` 段 |
| 任一阶段 | 都是单次提交，`git revert` 即可 |

## 7. 剩余风险

1. **`ctx.tools.get` 的检查时机**：`inject: ['hikariWorldFindings']` 只让 Memory 等到 **Service 出现**，不保证 World 跑完工具注册。**已通过「`provide` 放在 `installFindings` 最后」消除**（§3.1）：Service 可见 ⇒ World 已完成注册。测试 4 的两种装配顺序就是这条的端到端验证，必须实测，不能只靠推理。
2. **同名 service 有 Cordis 兜底，同名工具没有**：§8 场景 3 实测 `ctx.provide` 重名会抛 `service "hikariWorldFindings" has been registered at <p1>`；而 `ctx.tools.register` 重名静默覆盖（M0 取证）。所以防护必须写在工具侧，不能指望框架。
3. **分页语义**：M1 只有 findings 一个来源，`offset` 仍是行号偏移，与今天一致。混合来源的分页留到 M2。
4. **`inject` 写的是 service 名**：`inject: ['hikariWorldFindings']` 依赖 service 名，不是插件名 `hikari-world`——§8 场景 2 实测通过。

## 8. 探针读数（已实测）

`node experiments/m1-world-service/probe.mjs`，四个场景：

| 场景 | 读数 | 结论 |
|---|---|---|
| 点分名 `hikari.worldFindings` + inject | `apply` 执行，`ctx['hikari.worldFindings']` 可取，`ctx.get()` 可取，`ctx.hikari.worldFindings` 是 undefined | 点分名可用但反直觉，**弃用** |
| 单段名 + 消费者先注册、提供者后到 | `applyRan=true`，`seen=["flat-late"]` | **inject 会等**，与加载顺序无关 |
| 两个插件 provide 同名 service | 第二个抛 `service "hikariWorldFindings" has been registered at <p1>`，先注册者胜出 | **Cordis 有重名保护** |
| 无 inject 直接读 | 能读到 | 能被读到 ≠ 应该被读到；注入声明仍是纪律 |

### 生命周期探针（`experiments/m1-world-service/probe-lifecycle.mjs`）

| 时刻 | 读数 |
|---|---|
| 装载后 | `svc_world` 是 `function`；插件日志 `effect-registered` + `applied` |
| `fiber.dispose()` 后 | 日志出现 `effect-disposed`；`svc_world` 变 `undefined` |
| 重新 `app.plugin()` 后 | `effect-registered` + `applied` 再次出现；`svc_world` 恢复成 `function` |

结论：Cordis 的 `effect` 与 `provide` 都绑定在插件 fiber 上，`dispose()` 会回滚二者，重新装载会重建二者。`ctx.tools.register` 用的就是 `ctx.effect` 的 disposer（见 §5 说明），因此测试 5、9 可以直接用 `fiber.dispose()`，不需要手写注销逻辑。**若真 tools service 上这条推论不成立，那本身就是要报告的契约缺口**，不能改成手动注销掩盖过去。

## 9. 提交切分

M1-a 与 M1-b **各一次独立提交**，任一阶段可单独回滚：

| 提交 | 内容 | 判据 |
|---|---|---|
| `M1-a: World 只读 Service` | `findings.js` 末尾 `provide` + `Object.freeze`；探针 `probe-world.mjs`；测试 7、8 | 不涉及任何工具注册变化，六项工具定义前后 `deepEqual` |
| `M1-b: Memory 接管检索工具` | `memory/` 两个新文件、`registerMemoryTools` 开关、`cordis.patch.yml`、`test/memory.test.mjs` | 测试 1–6、9 全过 |

M1-a 的提交**不应**包含 `registerMemoryTools` 开关——那是 M1-b 的事。这样 M1-a 回滚只需删一段 `provide`，不会牵动工具路径。
