# 第一条真实领域迁移验证：带配置插件与带写入插件

日期：2026-10-28 · 目标仓库 `t1mb2rg/hikari-new` · 本轮 `src/`、`test/`、Resident 零改动

## §0 结论

**两项真实装载都跑通了，适配层没有在本轮暴露出新的技术缺口。但"具备把适配层纳入正式源码的条件"这个问题的答案是「还不具备」——缺的不是技术，是一项 Human 已经裁决要补、目前还没实现的语义。**

三条：

1. **带配置的插件**（`desktop-session-awareness-loop`）真实 `config.parse` 在契约层下工作：12 个非法输入在两侧被**逐字相同**的错误消息拒绝，合法配置驱动五层真实激活。裸 Cordis 在这些输入上**一个都没拦住**——两个非法 `rootDir` 甚至让 `human-delivery` 带病 `ACTIVE`（见 §1.1）。
2. **带写入的插件**（`human-delivery`）在契约层下完成「真建命名管道 → 三态投递全部走到 → 卸载后内核对象消失 → 重装再投递」的完整循环。`failed` 是客户端真的不读、缓冲真的灌满、5013 ms 真的超时才出现的（见 §1.2）。
3. **不具备纳入 `src/` 的条件**，唯一缺项是 §4.4 裁决①：级联停用时 cleanup 失败必须给出 `failed` + 合成 `AggregateError`。契约层今天给的是 `waiting`、错误不可读。这一项是 Human 2026-10-28 明确裁决"必须补"的，本轮没有实现（见 §3）。

## §1 两项真实装载

### 1.1 A：`desktop-session-awareness-loop` —— 真实 `config.parse`

产物 `config-matrix.{mjs,json,md}`、`awareness-chain.{mjs,json,md}`。

14 个输入 × 三侧（Hikari 原 Runtime / 裸 Cordis / PoC-03 契约层）：

| 侧 | 拒绝数 | 消息是否逐字相同 |
| --- | --- | --- |
| Hikari | 12 / 14 | —（基准） |
| 契约层 | 12 / 14 | 是，`sameMessageAll = true` |
| 裸 Cordis | **0 / 14** | — |

裸 Cordis 的 12 次"放行"分三档，没有一档是干净的：

- `delayMs` 非法 → 停在 `PENDING(0)`，`setup` 从未运行。**非法配置没有任何一处被看过**，它是靠"依赖没满足"蒙对的。
- `rootDir = ''` / `'   '` → 通过 `typeof` 检查，`humanDeliveryEndpointPath` 照样算出管道名，插件真的到 `ACTIVE(2)` 并开始监听。**带病激活**。
- `rootDir = 123` / 缺字段 / `null` → 撞在后续 `path.resolve` 上，抛的是类型错误（`The "paths[0]" argument must be of type string. Received type number (123)`），与配置语义无关。

错误消息原文两例：

```
desktop-session-awareness-loop requires an integer delayMs between 1 and 2147483647, received 0.
human-delivery requires a non-empty rootDir, received .
```

依赖链与级联（详见 `awareness-chain.md`）：`foreground` / `input-activity` → `desktop-session-world` → `desktop-session-awareness` → `desktop-session-awareness-loop`，**三段真实 `requires` 边**（`src/desktop-session-world/plugin.ts:12-15`、`src/desktop-session-awareness/plugin.ts:65-68`、`src/desktop-session-awareness-loop/plugin.ts:43-51`）。卸掉最上游 `foreground.windows` 后下游三层全部 `waiting`、`assessed` 事件停增、无关的 `input-activity.windows` 不受影响；重装后五层自行恢复 `active`，事件间隔约 500 ms **未减半**（无残留定时器）。

### 1.2 B：`human-delivery` —— 真实命名管道

产物 `human-delivery.{mjs,json,md}`。

| 步骤 | 读数 |
| --- | --- |
| 装载（真实 `config.parse` + `setup` 建监听） | `active` |
| 无人连接投递 | `{outcome:'unavailable'}` |
| 测试客户端连上后投递 3 行 | `{outcome:'delivered'}`，收到 1 帧，`JSON.parse` 后逐字相等 |
| 第二个客户端 | `gotData:false, closedByHost:true` |
| 客户端连上但不读、灌 60×60 KB | `{outcome:'failed'}`，**5013 ms** |
| 卸载 | 服务不可解析、客户端被挂断、重连 `ENOENT` |
| 重装 | `active`，再投递 `delivered`，未撞 `EADDRINUSE` |
| 收尾卸载 | 重连 `ENOENT` |

`failed` 走到 5013 ms 这件事本身是判据：5000 ms 的写超时是 `src/human-delivery/endpoint.ts:14` 的真常量，说明写路径是真的卡住了，不是立刻放弃。

## §2 三项判断的裁决

| 判断 | 裁决 | 依据 |
| --- | --- | --- |
| 配置拦截可等价 | **支持** | 12 个非法输入逐字相同拒绝 + 合法配置五层真实激活 |
| 真实写入可等价 | **支持** | 三态全走到 + 卸载后内核对象消失（`ENOENT`）+ 重装可复用同名管道 |
| 文档依赖链描述有误 | **支持** | 三段 `requires` 源码 + 级联实测；文档原句已删 |

## §3 「是否具备纳入 `src/` 的条件」

**不具备。缺一项：§4.4 裁决①。**

Human 2026-10-28 的决定是：显式卸载不增加历史错误转存；**级联停用时 cleanup 失败仍需保留失败结论与错误原因**。契约层当前的读数是：

| 情形 | Hikari | 契约层 | 差 |
| --- | --- | --- | --- |
| 显式卸载 + cleanup 抛错 | 错误不可读（记录被删） | 错误不可读 | **等价**（已裁决照抄） |
| 级联停用 + cleanup 抛错 | `failed` + `AggregateError('One or more plugin resources failed to clean up.')` | `waiting`，错误不可读 | **不等价** |

差的那一格是 `experiments/route-c-consolidation/unload-cleanup.md` 早就测出来的，PoC-04 也复现过。本轮的任务书只要求「两项真实装载读数 + 是否具备条件」，没有要求实现它，所以我停在这里报告，没有改动适配层。

补它的成本很小（把级联停用路径上的 cleanup 失败转成 `failed` + 合成 `AggregateError`，约 20 行），但那是**改代码**，而 Human 的边界写的是「只针对实际失败修复隔离适配层」——这一项是裁决要补，不是本轮失败暴露，所以我把它作为待决策项交回。

其余在 §1 暴露的问题都不是适配层的缺口：

- `app.stop()` 收尾漏关管道（s1 撞过一次 `EADDRINUSE`）——改用 `await fiber.dispose()` 即可，属脚本用法。
- 客户端 `connect` 与服务端 `connection` 不同 tick——脚本要等一拍，属脚本用法。

## §4 哪些 Hikari 契约必须保留

本轮再次确认的三条（与 `route-c-migration-prerequisites.md` §3 一致，没有新增）：

1. **`config.parse` 是激活的一部分**，不能下放给宿主。裸 Cordis 的 `ACTIVE(2)` 带病状态说明：配置错误必须在**装载期同步拒绝**，否则错误会漂移到运行期。
2. **契约身份是完整 `id@version`**，不做自动版本协商。`human-delivery` 这类 provides 单一项的插件里，版本隔离的代价看不出来；但它一旦丢了，多版本并存就无从谈起。
3. **生命周期权威是 Cordis fiber**，适配层只能记派生量。这直接决定了 §3 那一项怎么补：不是再建一套状态机，而是把 fiber 的 disposition 结果**翻译**成 Hikari 的 `failed`。

## §5 未覆盖

- 向**真实**人类投递（`src/cli/resident.ts` 那侧接的终端）——本轮只用合成客户端。
- `rootDir` 指向不可创建管道的路径时的失败语义。
- 多版本真实插件并发装载（24 个真实 service 全 v1）。
- 超过五层的分叉依赖。
- `desktop-session-awareness.current()` 的内容一致性（PoC-01 测过一次，本轮未重测）。

## §6 复现

```bash
npm run build
node experiments/route-c-first-domain/config-matrix.mjs      # A1：配置矩阵
node experiments/route-c-first-domain/awareness-chain.mjs    # A2：依赖链与级联
node experiments/route-c-first-domain/human-delivery.mjs     # B：命名管道（约 6 s，含一次真实写超时）
```

运行条件：Windows（`human-delivery` 依赖命名管道）；Node v24.15.0；DSH `0.2.1-rc.2`（`DSH_ROOT` 默认 `G:/work/LAB/code/_poc/poc01`）；Cordis `4.0.5`。`config-matrix` 与 `awareness-chain` 会真实读取当前前台窗口，读数里的窗口标题随运行时刻变化，属预期。
