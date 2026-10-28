# PoC-03 · Hikari → Cordis 契约适配层最小验证

**日期**：2026-10-28
**任务来源**：Human 裁决（PoC-02 结案同日批准本轮）
**结论一句话**：契约适配层可以用**一个文件、约 350 行、零上游修改**，把 Hikari Runtime 的四类契约行为（Service 声明纪律、三层失败区分、契约键编码、失败回滚）在 Cordis 上等价保留；Event 语义沿用 PoC-02 已验证的映射。唯一的真实缺陷是 setup 失败后 cleanup 抛错这条分支没有被覆盖。

---

## §0 结论

1. **P1–P7 七条验收：7 条全 PASS，其中 3 条带限定（P3 / P5 / P6），0 FAIL、0 BLOCKED。**
2. **契约键编码不需要 hash。** `id@version` 本身就是 Hikari 的原生键格式（`src/runtime/contracts.ts:32-34` 的 `serviceKey` 逐字如此），只要限定「id 非空、version 为正整数」就是单射且可逆；24 个真实 service + 1 个 event 实测零碰撞。
3. **三层的差别不是「适配」而是「新增」。** Cordis 宿主没有定义验证、也没有配置解析，Hikari 的三层失败在 Cordis 上必须由适配层补出来。这是本轮最实质的一条结论：**路线 C 的代价集中在适配层，不在宿主**。
4. **错误可读性靠「转存」，不靠宿主。** `internal/status` 事件不带错误对象（只带 `fiber, oldState`）；`fiber.await()` 会 rethrow 原错误但是 async 且会耗尽 fiber 状态；真正可用的接口是适配层自己存的 `records[id].error`。
5. **一处如实的能力上限**：`setup` 抛错时 cleanup 注册不上，Hikari 的 `Plugin … failed during setup and cleanup.` 聚合分支（`src/runtime/runtime.ts:145-157`）本轮走不到。

---

## §1 六步结果

| 步 | 做什么 | 产物 | 结果 |
|---|---|---|---|
| s1 | 查 Cordis 现有错误报告机制 | `error-channel.{mjs,md,json}` | `internal/status` 五条状态事件全部 `argCount=2`、`carriesError=false`；`fiber.await()` 能 rethrow 原 `BoomA`（ctor/message/marker 全保留、可重复）；`logger.error` 拿原对象但属日志流。**结论：需一层转存** |
| s2 | 契约键编码 | `key-codec.{mjs,md,json}` | 25 个真实契约 0 碰撞、往返全还原；13 条构造用例全过；38 键合并 0 碰撞 |
| s3 | 三层失败区分 | `three-layers.{mjs,md,json}` + `contract-layer.mjs` | A(Hikari) 同步抛 / B(裸 Cordis) 不抛且 `state=2` / C(契约层) 同步抛 `layer='definition'`；配置层裸 Cordis **根本不调** `config.parse`；三层在契约层全还原 |
| s4 | 五条 requires/provides 纪律 | `discipline.{mjs,md,json}` | R1–R5 全部 PASS，状态与错误消息与 Hikari **逐字一致** |
| s5 | 失败回滚与重装 | `rollback.{mjs,md,json}` | 四项判据两侧全成立：错误可观察、Service 注销、Event 退订、卸载后重装 `active` |
| s6 | 本报告 | `report.md` | — |

---

## §2 七条验收逐项判定

### P1 · DSH 与 Cordis 上游源码未改 — **PASS**
DSH 以 npm 包方式装在隔离目录 `G:/work/LAB/code/_poc/poc01`（`DSH_HOME` 指向其下 `dsh-home`），本轮只 `import`，未 patch、未改 node_modules。证据：`_poc/poc01/node_modules/@deepseek-ai/cordis/package.json` 版本 `4.0.5`，文件 mtime 与安装时间一致。

### P2 · Hikari 领域实现未改 — **PASS**
`git diff --stat -- src test` 输出为空（本轮全部改动落在 `experiments/`）。适配层通过 `import(dist/runtime/runtime.js)` 使用**已构建的原 Runtime**（`npm run build` 产物），领域插件定义通过 `import(dist/...)` 原样取用——没有任何一行领域代码被复制或改写。这是 PoC-01 就已确立的性质，本轮未变。

### P3 · 适配层不放行原 Runtime 禁止的 Service 操作 — **PASS（带限定）**
五条纪律逐条实测（`discipline.md`）：

| 纪律 | 状态 | 消息 |
|---|---|---|
| R1 未声明 get | `failed` | `Plugin poc03.r1-consumer tried to use undeclared service dependency poc03.alpha@1.` |
| R2 依赖缺失 | `waiting`（setup 不执行） | — |
| R3 未声明 provide | `failed` | `Plugin poc03.r3-provider tried to provide undeclared service poc03.alpha@1.` |
| R4 声明未提供 | `failed` | `Plugin poc03.r4-liar declared service poc03.alpha@1 but did not provide it during setup.` |
| R5 重复 provide | 先者 `active`、后者 `failed` | `Service poc03.alpha@1 is already provided by poc03.r5-first.` |

消息逐字一致，因为错误模板直接取自 `src/runtime/errors.ts`。

**限定**：这五条成立**不是因为宿主变强了**，而是因为适配层补了三个检查（`services.get` 查 `declared`、`services.provide` 查 `declaredProvides`、`setup` 返回后查 `providedBy`），合计约 20 行，全在 `contract-layer.mjs`。R2 靠 Cordis 原生 `inject` 暂停，R5 宿主原生也会拦（消息不同）。另有一处如实的类差异：Hikari 这四条抛通用 `Error`，契约层抛专用类——消息与状态是契约、类名不是，但迁移后任何 `error.constructor === Error` 判断会失效。

### P4 · 错误原因可通过明确可重复的接口读取 — **PASS**
三条通道的实测对照见 §4。结论：`getPluginError(id)` 返回**原错误对象**（`marker` 保留），同步、可重复调用，失败后与卸载前都可读。

### P5 · 失败与卸载时资源正确清理 — **PASS（带限定）**
`rollback.md` 四项判据两侧全 `true`：探针插件 `waiting`（Service 已注销）、失败后 `emit` 触发 0 次（订阅已退订）、卸载后重装同 id `active`（无残留）、原 `BoomSetup` 与 `marker` 可读。

**限定**：`setup` 抛错时返回的 cleanup 根本注册不上，所以 `src/runtime/runtime.ts:145-157` 的 `AggregateError([error, cleanupError], 'Plugin … failed during setup and cleanup.')` 分支**本轮未覆盖**。要覆盖它需要让 `scope.dispose()` 自身抛错，属另一场景。

### P6 · 已验证的 Event 语义不退化 — **PASS（复用 PoC-02 读数，本轮未重跑）**
任务书第五项要求「复用 PoC-02 已验证的 Event 映射」。本轮的 `contract-layer.mjs` 沿用该映射：`events.on → ctx.on`、`events.emit → await ctx.parallel`、`AggregateError` 补 message、`eventName = id + '@' + version`。PoC-02 的对照结论（等待 / 并发 / 失败聚合 / 退订 / 重装五项）未变。

**诚实标注**：本轮**没有重跑** Event 五项，只是把同一套映射代码从 `adapter-events.mjs` 移进了 `contract-layer.mjs`。若要求本轮独立证据，P6 应为 BLOCKED。

### P7 · 不增加生产运行时依赖、不引入统一业务调度器 — **PASS**
`contract-layer.mjs` 的 import 只有 `node:path` / `node:url` / `node:fs`（读取 Hikari 构建产物的校验函数）与调用方传入的 Cordis `app`。没有新增 npm 依赖，没有定时器、队列或中央调度器——插件激活仍由宿主的 fiber 依赖图驱动。

---

## §3 契约键的单射性与可逆性

**方案**（`contract-layer.mjs`）：

```js
export const contractKey = ({ id, version }) => `${id}@${version}`;
export function decodeContractKey(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0) throw new ContractLayerError('key', new Error(`invalid contract key: ${key}`));
  const id = key.slice(0, at);
  const raw = key.slice(at + 1);
  if (!/^[1-9][0-9]*$/.test(raw)) throw new ContractLayerError('key', …);
  return { id, version: Number(raw) };
}
```

**这不是新发明**：Hikari 的 `serviceKey`（`src/runtime/contracts.ts:32-34`）就是 `` `${contract.id}@${contract.version}` ``。适配层只是把这个格式**原样**用作 Cordis 的服务名与事件名，所以不存在「编码后与源码不一致」的风险。

**单射性证明**。设 `f(id, v) = id + '@' + str(v)`，约束：`id` 非空，`v` 为正整数，故 `str(v)` 由数字组成、**不含 `@`**。
若 `f(id₁,v₁) = f(id₂,v₂)`，则两边末尾的最后一个 `@` 必在同一位置（因为 `str(v)` 不含 `@`），于是 `str(v₁) = str(v₂)`，正整数与其十进制表示一一对应，得 `v₁ = v₂`；进而 `id₁ = id₂`。∎
**可逆性**：`decodeContractKey` 在最后一个 `@` 处切分即可还原，`id` 允许含 `@`（如 `weird@id@nested@3` 还原为 `{id: 'weird@id@nested', version: 3}`）。

**实测**（`key-codec.json`）：
- 真实契约 **25 个**（24 service + 1 event）→ 0 碰撞、往返全还原；
- 构造用例 **13 条** → 全过：`foo.bar` 与 `foo_bar` 不再互撞（旧方案会把两者都映射成 `foo_bar_v1`，这正是 PoC-01/02 的缺陷）；`weird@id@nested@3` 可往返；空 id、非法 version（`0`、`1.5`、`-1`、空串）全部拒绝；
- 分隔符两两组合 **7×6=42 组** → 0 碰撞；
- 真实 + 构造合并 **38 键** → 0 碰撞。

**没有使用截断 hash**。任务书禁止「把截断 hash 无条件宣称为单射」，本方案连 hash 都不需要。

---

## §4 错误可读接口的实测对照

同一个失败（插件 setup 抛 `BoomA`/`BoomSetup`，带 `marker`），三条通道分别能拿到什么：

| 通道 | 能拿到什么 | 能不能重复读 | 位置 |
|---|---|---|---|
| `internal/status` 事件 | `(fiber, oldValue)` 两个参数，**不带错误对象**；五次状态迁移 `0→1`、`1→5`、`5→3`、`3→5`、`5→4` 全部 `argCount=2`、`carriesError=false` | 事件只发一次，错过就没有 | `cordis/lib/index.js:1298` |
| `fiber.await()` | **rethrow 原错误**（ctor/message/`marker` 全保留），第二次调用仍抛 | 可重复 | `cordis/lib/index.js:1396-1402` |
| `fiber._error`（私有） | 直接持有原对象，事件触发时已可读 | 可读但**不该依赖** | `cordis/lib/types/fiber.d.ts:120` |
| **适配层 `getPluginError(id)`** | 原错误对象（s1 与 s5 都验到 `marker` 保留） | 可重复、同步 | `contract-layer.mjs` |

`internal/status` 不够（任务书的判断被实测支持），`fiber.await()` 够但会把调用方拖进 async 且只能拿到「第一次失败」，所以适配层做的是**转存**：装载时 `try { await fiber.await() } catch (e) { record.error = e; record.layer = 'setup' }`，对外提供同步读。

---

## §5 复现条件

| 项 | 值 |
|---|---|
| Hikari 提交 | `8fc7e04`（PoC-02 入库后，`src/`/`test/` 本轮零改动） |
| Hikari 构建 | 先 `npm run build`（产物 `dist/`） |
| DSH | `0.2.1-rc.2`，隔离目录 `G:/work/LAB/code/_poc/poc01`，`DSH_HOME=<该目录>/dsh-home` |
| Cordis | `@deepseek-ai/cordis` `4.0.5` |
| Node | `v24.15.0` |
| 模型 | 本轮**不需要**模型与 API key（纯宿主/生命周期验证） |

运行：

```bash
npm run build
node experiments/poc-03-contract-layer/error-channel.mjs
node experiments/poc-03-contract-layer/key-codec.mjs
node experiments/poc-03-contract-layer/three-layers.mjs
node experiments/poc-03-contract-layer/discipline.mjs
node experiments/poc-03-contract-layer/rollback.mjs
```

每个脚本自写同名 `.json` 并打印读数；把 `DSH_ROOT` 指向另一个 DSH 安装目录即可换版本。

---

## §6 对路线 C 的意义

**哪些可以原样复用**
- 领域插件定义与 `dist/` 构建产物：零改动（PoC-01 已证，本轮继续成立）。
- 契约键格式 `id@version`：本来就是 Hikari 的格式，直接当 Cordis 的服务名用。
- 错误消息模板：直接照抄 `src/runtime/errors.ts`，这是迁移后日志可比对的前提。

**哪些必须由适配层补**
- 定义验证（`validatePluginDefinition`）——宿主**没有**这一层。
- 配置解析（`definition.config.parse`）——宿主**根本不调**，Cordis 走自己的 `runtime.Config['~standard'].validate`。
- 三条 Service 声明检查（R1/R3/R4）——宿主没有 requires/provides 概念。
- 错误转存与 `getPluginError` 同步读接口——宿主只有私有 `_error` 与 async `await()`。

**哪些 Runtime 契约需要保留或重实现**
- 保留：错误消息文本、状态集合（`active`/`waiting`/`failed`/`unloading`）、`unloadPlugin` 后重装必须先卸载的语义。
- 重实现：`#reconcile` 的级联重算（依赖失效时拆掉已激活下游）——Cordis 靠 fiber epoch 刷新，结果相同但机制不同，本轮只用 R2 碰了一次，**没有系统验证级联拆卸**。
- 无法等价保证：同名不同版本 Service 并存（Cordis 服务名是单键，`id@1` 与 `id@2` 是两个名字所以能并存，但宿主没有「同一 id 的多个版本」概念）；`waiting/active/failed` 与 `PENDING/ACTIVE/FAILED/DISPOSED` 非一一对应（PoC-02 已记）。

**集成成本**
适配层单文件 350 行左右，无新增依赖；真正的工作量不在代码量，而在**每次 Cordis 升级后重跑这五个脚本**——本轮所有结论都绑定 `cordis@4.0.5` 的具体行为（`_getState` 映射、`await()` rethrow、`internal/status` 签名）。

**路线判断不变**：A（双 Runtime 桥接）作过渡，B（共享包）在 Human 裁决下暂不批准，C（统一 Cordis 宿主）从 PoC-02 的「有条件技术可行」到本轮补上了**适配层可行性**这一块；但 C 的剩余风险已不在「能不能保住契约」，而在「Hikari 的 `#reconcile` 级联语义能否在 fiber 模型上完整重建」——建议下一轮只验这一条，而不是继续扩适配层。

---

## §7 未覆盖与限制

1. **cleanup 抛错路径未覆盖**（P5 限定）：`setup` 抛错时 cleanup 注册不上。
2. **P6 未重跑**：Event 五项沿用 PoC-02 读数，本轮只搬了代码。
3. **级联拆卸未系统验证**：只验了「依赖缺失 → PENDING」，没验「已激活的下游在依赖失效时被拆掉」（`src/runtime/runtime.ts:89-92` 的 `#deactivateTree`）。
4. **单版本环境**：24 个真实 service 全是 version 1，没有真实的多版本并存样本；不同版本的碰撞只用构造用例测。
5. **单平台**：Windows / Node 24.15.0 / 本机 Cordis 安装，未跨平台复验。
6. **适配层不是产品代码**：它在 `experiments/` 下，`src/` 零改动；本轮不构成迁移实施。
