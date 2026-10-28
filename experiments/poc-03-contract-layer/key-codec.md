# s2 · 契约键编码：单射、可逆、无 hash

**运行**：`node experiments/poc-03-contract-layer/key-codec.mjs`
**原始读数**：`key-codec.json`
**真实契约来源**：复用 `experiments/poc-02-runtime-contract/collect-contracts.mjs`（同一份扫描器，避免两轮各扫一遍还扫出不同数字）

## 方案

```
encode(id, version) -> `${id}@${version}`
decode(key)         -> 按最后一个 `@` 切分
```

**不用 hash、不截断。** PoC-02 的旧编码是 `id.replace(/[.\-]/g, '_') + '_v' + version`，它把点号与连字符都折成下划线，于是 `foo.bar@1` 和 `foo_bar@1` 撞成同一个 `foo_bar_v1`。本轮直接保留原始字符。

## 单射性靠约束，不靠运气

约束两条，编码时校验，不满足就抛：

1. `id` 是非空字符串；
2. `version` 是正整数。

在这两条前提下：`version` 是纯数字、不含 `@`，所以键里**最后一个 `@` 一定是分隔点**；给定键必唯一还原成 `(id, version)`，反过来给定 `(id, version)` 必唯一得到键。这就是单射，并且 `decode` 是 `encode` 的左逆。

`id` 里允许出现 `@`——因为切分取的是最后一个，`weird@id@nested@3` 还原成 `("weird@id@nested", 3)`，实测通过。

## 实测

**真实全集 25 个**（24 个 service + 1 个 event，全部 `version: 1`）：

- 编码后两两不同：**0 碰撞**
- `decode(encode(x))` 全部还原：**0 不一致**
- 样例：`changeable-repositories.read@1`、`chronicle@1`、`continuity.current@1`

（PoC-02 报的「24 个」是 service 数，event 单列；本轮把 event 一并算进全集，所以是 25。）

**构造用例 13 条**，全过：

| 用例 | 输入 | 输出 | 结果 |
|---|---|---|---|
| 点 vs 下划线 | `foo.bar` / `foo_bar` | `foo.bar@1` / `foo_bar@1` | 不同 ✓（PoC-02 的旧编码在这里撞车） |
| 同 id 不同版本 | `…awareness.current` v1/v2/v10 | `…@1` / `…@2` / `…@10` | 三条互不相同 ✓ |
| id 含分隔符 | `weird@id` v3 | `weird@id@3` | 往返 ok ✓ |
| id 含多个分隔符 | `weird@id@nested` v3 | `weird@id@nested@3` | 往返 ok ✓ |
| id 自带版本样式 | `service.v1` v2 | `service.v1@2` | 往返 ok ✓ |
| 空 id | `''` | — | 拒绝 ✓ |
| 版本 0 / 负数 / 小数 / 字符串 | `0` / `-1` / `1.5` / `'1'` | — | 全拒 ✓ |

**分隔符两两组合穷举**（`a.b` / `a_b` / `a-b` / `a:b` / `a/b` / `a b` / `a@b` 共 7×6 对）：**0 碰撞**。

**真实 + 构造合并**（38 个键）：**0 碰撞**。

## 与 Cordis 原生命名空间的关系

Cordis 的服务名是任意字符串（`lib/index.js:763-771` 的 `_getImpl(name)`），没有版本概念、也没有命名约束。所以 `id@version` 这个键放进 Cordis 的 registry 是合法的——它就是个普通字符串，`@` 在 JS 对象键里不需要转义。

PoC-02 的对照结论之一是「Cordis 里同名不同版本会撞」。本轮编码解决了这一点：`x@1` 与 `x@2` 是两个不同的键，两个 provider 可以并存。但要如实说明：**并存之后 Cordis 侧没有「按版本解析」的语义**——消费者拿到的仍是 `id@version` 这个字面键，需要它自己指定版本。这与 Hikari 的 `serviceKey(contract)`（`src/runtime/contracts.ts:32-34`）一致，不构成退化。

## 剩余风险

- 编码是**纯字面拼接**，键会变长（真实最长的 id 是 `repository-ci-diagnosis-proposal.supplement@1`，37 字符），不构成问题。
- 单射性依赖「version 必须是正整数」这条约束。如果将来出现字符串版本号（如 `beta`），编码必须改成带转义的形式，或换用长度前缀。当前 Hikari 的 `Contract` 类型只允许数字版本，所以本轮不预先实现。
