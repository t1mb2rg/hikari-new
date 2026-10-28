# DSH 独立审计器故障登记

> 性质：**工程基础设施缺陷**，不是 Hikari 产品事实，也不是实验结论。
> 登记原因：它一度让已经做完的目标无法结案，并且每次都被误读成「判据不成立」。单独记
> 在这里，避免和产品文档混在一起。
>
> **判定口径（Human 2026-10-28 裁决）**：`audit_dispatch_failed` 属于独立评审工具的环境
> 故障，**不应冒充代码失败**；按既定方式记录，不重复无效派遣。

## 1. 症状

`ClearAI` 的结案流程要求独立评估者核判据。在本机 DSH 会话里，**任何需要派发独立评估者
的动作一律失败**：

- `Conclude`（结案）——自 2026-10-18 起，**每一次以 `achieved` 收尾的调用都失败，无一例外**；
- `AdvancePlan`（带 `tests` 的 L3 步骤）——三次；
- `Frame` 判据修订的独立裁决——两次。

失败发生在**派发**这一步，不是评估本身。

## 2. 报错原文

```text
persona+outputSchema+toolFilter: subagents.start is not a function
```

失败的调用一律返回 `audit_dispatch_failed`，附同一条报错。

## 3. 影响范围（截至 2026-10-28）

`clear/goals/` 下共 **16 个目标文件，全部以 `abandoned` 关闭**（第 16 个是本轮进行中的
收口目标，尚未结案）。没有任何一个目标改判据、改读数，或为了「攒够轮次」重复派遣。

| 目标 | id | 已完成到什么程度 | 处置 |
| --- | --- | --- | --- |
| §13.13 第 1 条（180 s 预算是否产品路径测量值） | `g-mve0mp30mzt1` | 代码路径审清 | `abandoned` |
| 产品路径上测补充预算 | `g-mve3tnhgfvmr` | 五轮真链路测量 + 报告 | Human 批准暂停；`abandoned`，报告 §8.1 记录 |
| CI 日志作为不可信输入的边界 | `g-mvem6ijcq1t2` | 判据 ①–④ 已交付 | `abandoned`；**不标 achieved** |
| Q1 隔离后的日志注入对抗验证 | `g-mvewwojq3rc5` | 15 次真调用 + 报告 | `abandoned`，报告 §10 记录 |
| 模型补充相对基线通知的增量 | `g-mvey8gs2uvqd` | 五次真调用 + 判分（commit `48ca29e`，CI `39220927088` success） | `abandoned`，报告 §6 记录 |
| 三组对照：补充 vs 机械摘要 | `g-mvf9409ypmh4` | 五样本三组对照 + 报告（commit `c5d9fa6`） | `abandoned`，报告 §9 记录 |
| Hikari 认知职责审查 | `g-mvgucdbl6sfg` | 五条判据逐条达成（commit `1fc7f30`，CI `39450041755` success） | `abandoned`；**不标 achieved** |
| 按裁决修正 §7/§9 + 四组对照 | `g-mvguxhl12ice` | 报告 + 四组实验完成 | `abandoned` |
| 非饱和场景最后一轮四组对照 | `g-mvgvowu90hw0` | 报告 + 入库（commit `0c66a4f`，CI `39455861792` success） | `abandoned` |
| JustMutsumi M0.32 逆向 | `g-mvp69a19p9do` | 六份产物（`experiments/galgame-reverse/`） | `abandoned` |
| 最小认知连续性实验 | `g-mvpflyyrmtjf` | 报告 + 入库（commit `58123e6`，CI `40355283299` success） | `abandoned` |
| PoC-01 最小兼容性 | `g-mvqwt4ovynj6` | 五项 PASS，入库（commit `f44cb2f`，CI `40544755166` success） | `abandoned` |
| PoC-02 运行时契约 | `g-mvravi8nkwl0` | 五项判定，入库（commit `8fc7e04`，CI `40601396958` success） | `abandoned` |
| PoC-03 契约适配层 | `g-mvry4dmmjk7f` | 七条验收 7 PASS，入库（commit `b2de066`，CI `40669920063` success） | `abandoned` |
| PoC-04 级联生命周期 | `g-mvryoklghmzr` | 六 PASS + 一限定 PASS，入库（commit `bb3fc11`、`d718287`） | `abandoned` |

**这张表的读法**：`abandoned` 在这里的含义是「判据已达成、独立核验通道不可用」，不是
「工作没做完」。每个目标的 `Conclude` note 里都逐条写明了判据达成情况。

## 4. 已排除的原因

- **不是判据不成立**：所有目标的判据都逐条对照过产物（文件存在、含指定表格、含可回溯
  的行号、含独立样本对照），本地 L2 自判均为「支持」；`Conclude` 的 `basis` 里逐条落到
  章节与行号。
- **不是网络或端点问题**：同一会话里 `ops_bash`、`gh api`、`web_fetch`、模型端点探测全部
  正常。
- **不是工具名写错**：报错来自 `subagents.start`，是运行时内部的派发函数，调用方无法指定。
- **不是任务太大**：一次只核一条判据的最小改动也失败。
- **不是普通 subagent 不可用**：本会话里手工 `subagent` / `subagent_fork` 派遣多次成功
  （认知职责审查、四模块源码审查都是并行 subagent 完成的）。故障只出现在带
  `persona + outputSchema + toolFilter` 三参数的**评估者**派遣路径上。

## 5. 处置纪律（下次遇到同样故障时照此执行）

1. **区分两件事**：「测量/实现失败」与「独立裁决不可用」。后者不是前者。
2. **不修改验收标准**去迎合可用的裁决路径。
3. **不重复派遣**超过一次；失败即停。
4. **保留证据**：产物、时间戳、报错原文。
5. **交 Human**：写明「已完成什么、缺的是哪一步、为什么不是判据的问题」。
6. **不自行宣布验收通过**。
7. **不以「攒够轮次」为由反复重试**（Human 2026-10-19 明确要求）。

## 6. 恢复条件

独立评估者恢复可用后：

- 表中目标**不需要重新测量**——产物与读数都还在原位；
- 只是**重跑 `Conclude`**：已按 `abandoned` 关闭的需先 `update_goal resume`；
- 若那时产品代码已经变化（例如又改了提示词/协议/适配层），则旧读数按各自文档的效力
  条款处理，**不再当作独立验证**；
- PoC 系列（01–04）的读数绑定 Cordis `4.0.5`；恢复后若 Cordis 已升版，需先重跑八条回归
  脚本（见 `docs/architecture/route-c-migration-prerequisites.md` §7）再结案。

## 7. 本地替代自检（已做，不等于独立核验）

在没有独立评估者的前提下，本会话对关键判定做过的本地补强：

- 每条判断的推翻条件**在跑之前**写进计划，跑完只做「对着推翻条件读读数」；
- 产物同时保留原始 JSON 与可读 MD，读数可逐项回查；
- 关键数值在报告里给出源码位置（`文件:行号`），便于第三方复核；
- 一处口径错误（`experiments/poc-02-runtime-contract/event-cordis.md` 原写「Hikari 把 setup
  失败抛给加载者」）是**实测发现后自行更正**的，说明本地自检能抓出至少这类问题。

这些做法提升了可复核性，但**不构成独立核验**，不能替代 `Conclude achieved`。
