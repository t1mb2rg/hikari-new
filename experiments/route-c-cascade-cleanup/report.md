# 级联停用时 cleanup 失败的契约差异（§4.4 裁决①）

日期：2026-10-28 · 隔离实验，`src/` 与 `test/` 零改动 · Cordis `4.0.5` / DSH `0.2.1-rc.2`

## §0 结论

**这一项做不到等价表达，而且原因不在适配层写得好不好。**

`§4.4 裁决①`要求「级联停用时依赖方 cleanup 失败 → 报 `failed` 并保留错误原因」。但两侧对「Provider 恢复之后怎么办」的回答根本不同：

- **Hikari**：依赖方一旦 `failed` 就停在那里，Provider 回来也不重启（本轮实测 `setup` 次数停在 1）。
- **Cordis**：依赖方只是暂时 `PENDING`，Provider 一回来就**自动把它重新装起来**（本轮实测 `setup` 从 1 变成 2，回到 `ACTIVE`，Service 又可解析）。

所以在 Cordis 上报 `failed` 的真实含义是「它失败了、但它已经又跑起来了」——这不是同一件事。**三路让读数变好看的改法我都试过，全部失败；按任务书第 4 点停在这里报告差异，不用影子状态掩盖。**

## §1 探针与四条路径的读数

探针：Provider `P`（provides `probe.value@1`）+ 依赖方 `D`（requires 它，cleanup 必抛 `BoomCleanup`）。两侧各跑一遍同一套流程。

### 1.1 裸 Cordis

| 路径 | fiber 状态 | setup 次数 | cleanup 次数 | cleanup 抛错 | `fiber._error` | Service 可解析 |
| --- | --- | --- | --- | --- | --- | --- |
| 正常装载 | `2:ACTIVE` | 1 | 0 | — | `null` | 是 |
| Provider 消失（级联停用） | `0:PENDING` | 1 | 1 | 是 | `null`（错被吃掉） | 否 |
| **Provider 恢复** | **`2:ACTIVE`** | **2（自动重跑）** | 1 | — | `null` | **是** |

**Provider 恢复时 Cordis 自动把依赖方重新装了一遍**，并且对「清理失败过」这件事没有任何记忆。

### 1.2 Hikari 原 Runtime

| 路径 | 状态 | setup 次数 | cleanup 次数 | `getPluginError` | Service 可解析 |
| --- | --- | --- | --- | --- | --- |
| 正常装载 | `active` | 1 | 0 | — | — |
| Provider 消失（级联停用） | `failed` | 1 | 1 | `AggregateError`，`message = "One or more plugin resources failed to clean up."`，`errors[0].message = "BoomCleanup: 级联停用时清理失败"` | 否 |
| Provider 恢复 | **仍 `failed`** | **1（未重启）** | 1 | 同上，原对象保留 | 否 |

### 1.3 显式卸载路径（沿用 §4.4 裁决，不存错误历史）

两侧都：`cleanup` 执行 1 次、记录随卸载删除、`getPluginError` 读不到（Hikari 是 `unloadPlugin` 里 `#plugins.delete`，见 `src/runtime/runtime.ts:194-205`；契约层是 `records.delete`）。这一条与既有裁决一致，不是本轮差异。

## §2 两侧行为对照

| 判定项 | Cordis | Hikari | 是否一致 |
| --- | --- | --- | --- |
| cleanup 是否执行 | 是（1 次） | 是（1 次） | ✅ |
| cleanup 抛错后错误是否留在宿主 | 否（`_error` 为 `null`） | 是（合成 `AggregateError`） | ❌ |
| 停用后的状态 | `PENDING` | `failed` | ❌ |
| Provider 恢复后是否重新激活 | **是（setup 1→2）** | **否（setup 仍 1）** | ❌ |
| 恢复后 Service 是否可用 | 是 | 否 | ❌ |

**判定：不一致，且差异在生命周期语义本身，不在状态翻译。**

## §3 三路修法为什么都不成立

目标：让契约层报 `failed`，同时不让读数与宿主真相脱节。

| 路 | 做法 | 实际结果 | 为什么不成立 |
| --- | --- | --- | --- |
| A | 用一个代理对象顶替 fiber，拦住「重新激活」 | Cordis 内部持有原 fiber 引用，代理收不到回调；代理状态与宿主脱节 | 拿不到真实停止点，等于自欺 |
| B | 记录里存 `failed`，宿主若把插件重装起来就「就地改回失败」 | 只改了簿记；插件真的在跑、Service 真的被注册，`inspect()` 一刷新又翻回 `ACTIVE` | **这就是用簿记冒充生命周期语义**（Human 明确禁止） |
| C | 卸载时塞一个「永远 PENDING 的空壳 fiber」占位 | Cordis 不调用它，`app.get` 仍能解析到服务 | 两个真相源并存，比不修更糟 |

三路的共同点：都必须在适配层维护一份与宿主不同的生命周期事实。而 PoC-04 已经把「簿记只能是从宿主重算的派生量」定为原则（`docs/architecture/route-c-migration-prerequisites.md` §3.5）。**要满足 §4.4 裁决①，就得推翻那条原则。**

## §4 适配层改动

`experiments/poc-03-contract-layer/contract-layer.mjs` 的副本 **未做任何修改**——三路都未通过验证，按任务书不把不可接受的实现留在目录里。

`git diff --stat -- src test` 为空；DSH / Cordis 上游未改。

## §5 这意味着什么

「级联停用时 cleanup 失败」这条语义，**在 Cordis 上没有等价物**。原因不是适配层缺一行代码，而是两侧对失败的态度不同：

- Hikari 把失败当**终态**：坏了就停在坏掉的样子，等人来看。
- Cordis 把失败当**过程**：清理没成功，但依赖回来照样能重装。

这两种态度各自自洽。迁移时只能选一个：

1. **接受 Cordis 的语义**（依赖方会自动恢复），把 Hikari 的 `failed` 终态降级为「有过一次清理失败」的注释——`§4.4 裁决①`作废。
2. **在契约层实现终态**，代价是适配层要拦住宿主的重激活路径（A 路需要 Cordis 提供钩子，目前没有）。
3. **不迁移这一类插件**，把「有 cleanup 且会失败」的插件留在 Hikari Runtime。

## §6 复现

```bash
npm run build                      # 探针从 dist/ 导入 Hikari 实现
node experiments/route-c-cascade-cleanup/probe.mjs
```

产物：`probe.json`（两侧完整读数）、`probe-summary.json`（摘要）。
