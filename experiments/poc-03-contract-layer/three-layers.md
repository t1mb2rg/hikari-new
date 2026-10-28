# s3 · 三层失败：Hikari 分三种，裸 Cordis 连两层都没有

**运行**：`node experiments/poc-03-contract-layer/three-layers.mjs`
**原始读数**：`three-layers.json`
**被测适配层**：`experiments/poc-03-contract-layer/contract-layer.mjs`

任务书要求「保留 Hikari 的定义验证、配置解析与 setup 失败三者区别」。三处各跑同一组三个场景：

- **A. Hikari 原 Runtime**（基准）
- **B. 裸 Cordis Context**（不用适配层，看宿主原生）
- **C. Cordis + 契约层**（本轮实现）

## 结果矩阵

| 场景 | A. Hikari | B. 裸 Cordis | C. 契约层 |
|---|---|---|---|
| **定义验证失败**（id 为空白） | **同步抛** `Error: Plugin id must not be empty.` | **不抛**，`fiberState=2` | **同步抛** `ContractLayerError(layer='definition')` |
| **配置解析失败**（`parse` 抛 `BoomConfig`） | **同步抛** 原 `BoomConfig` | **不抛**，`fiberState=2` | **同步抛** `ContractLayerError(layer='config')` |
| **setup 失败**（provide 之后抛 `BoomSetup`） | **返回 `'failed'`**，`getPluginError` 读到原 `BoomSetup` | **抛出** 原 `BoomSetup`，`fiberState=3` | **返回 `'failed'`**，`getPluginError` 读到原 `BoomSetup` |

## 三个必须说清的事实

**1. 裸 Cordis 根本没有「定义验证」与「配置解析」这两层。**

定义场景里，裸宿主拿到的 id 是空白字符串——它不检查，fiber 正常进入 `state=2`（ACTIVE）。配置场景里，`definition.config.parse` 从未被调用，因为 Cordis 的配置机制是它自己的 `Config` schema（`lib/index.js:957-968` 的 `resolveConfig`），不认 Hikari 的 `definition.config.parse`。

所以任务书里那句话要改一个词：三层区分在 Cordis 上不是「适配」，是**新增**。这两层必须由适配层在 `ctx.plugin()` 之前自己跑（`contract-layer.mjs` 的 `loadPlugin` 第 1、2 段）。

**2. 裸 Cordis 的 setup 失败只能靠「抛出」观察。**

`fiberState=3` 只说明失败，说不出失败原因；错误对象只能从 `await fiber.await()` 的 catch 里拿到（s1 已实测），而宿主没有 `getPluginState` / `getPluginError` 这样的查询接口。这就是 PoC-02 P4 的根源。

**3. 契约层的第三层是「转存」，不是「重建」。**

`BoomSetup` 的自定义字段 `marker = 'poc03-setup'` 在 `getPluginError` 读回时仍在（`three-layers.json` 的 `contractLayerKeepsOriginalObject: true`）。实现上是把 `fiber.await()` 抛出的**那个对象**直接存进记录：

```js
try { await fiber.await(); } catch (error) { fail(definition.id, 'setup', error); }
```

不是 `new Error(error.message)`，所以 `instanceof BoomSetup`、堆栈、自定义字段全部保留。

## 判据

| 判据 | 结果 |
|---|---|
| Hikari 三层可区分 | ✓ 前两层同步抛、第三层返回 `'failed'` + 记录 |
| 裸 Cordis 不做定义与配置检查 | ✓ 两个场景都不抛 |
| 裸 Cordis 的 setup 失败只能靠抛 | ✓ `state=3` 且必须 catch `await()` |
| 契约层三层可区分 | ✓ 前两层抛出的错误带 `layer` 字段，第三层落成 `recordedLayer='setup'` |
| 契约层保留原错误对象 | ✓ `BoomSetup` + `marker` 完整 |

## 一个实现细节值得记下

前两层失败时**不建插件记录**——这与 Hikari 一致：`Runtime.loadPlugin` 里 `validatePluginDefinition`（`runtime.ts:35`）和 `config.parse`（`runtime.ts:38`）都在 `#plugins.set()` 之前，失败后 `getPluginState` 返回 `undefined`。所以契约层里 `getPluginLayer(id)` 在定义/配置失败时也是 `undefined`，层的归属要从**抛出的错误对象**上读（`error.layer`）。

## 剩余风险

- 契约层的 `layer` 字段是我自己定义的分类，不是 Cordis 的概念。任何依赖它的代码都必须通过 `ContractLayerError` 类判断，不能用字符串比较宿主异常。
- Hikari 的 `config.parse` 允许返回 `undefined`（无 config 时）。契约层保留了这一点（`definition.config` 不存在就跳过），但**没有**校验 `parse` 的返回值类型——Hikari 也没校验。
