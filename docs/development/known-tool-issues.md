# 已知工具问题登记

> 这里记的是**工具链/基础设施**的问题，不是 Hikari 的产品事实，也不是实验结论。
> 单列一份的原因：这类问题会让人误读成「工作没做成」或「判据不成立」，而它们与代码质量
> 无关。每次遇到新的工具类问题都加到这里，号在那条下面。

## TI-1 · 独立评估者派遣失败（`audit_dispatch_failed`）

**状态**：未恢复（截至 2026-10-28）
**详细登记**：[`docs/development/dsh-audit-defect.md`](dsh-audit-defect.md)（含 16 个受影响
目标的逐行表、已排除原因、处置纪律、恢复条件）

### 症状

`ClearAI` 的结案流程要求独立评估者核判据。本机 DSH 会话里，任何需要派发独立评估者的
动作一律失败，报错原文：

```text
persona+outputSchema+toolFilter: subagents.start is not a function
```

失败发生在**派发**这一步，不是评估本身。自 2026-10-18 起，**每一次以 `achieved` 收尾的
`Conclude` 都失败，无一例外**。

### 既有证据汇总

- `clear/goals/` 下 **16 个目标全部以 `abandoned` 关闭**，每个的 `Conclude` note 都逐条写明
  判据达成情况和产物位置。
- 所有产物、读数、提交与 CI 记录都在原位（最近四个 PoC：`f44cb2f` / `8fc7e04` / `b2de066` /
  `bb3fc11`+`d718287`，对应 CI 全 success）。
- 判据没有被改动过，读数没有被改动过，没有为了「攒够轮次」重复派遣。

### 为什么不再重新派遣

1. **故障在派发层，不在评估层**：报错来自运行时内部的 `subagents.start`，调用方无法
   指定或绕开；重试不会产生新信息。
2. **重试有代价**：每次重试都会消耗一轮完整会话，且可能掩盖真正该做的事。
3. **已排除「判据不成立」**：所有目标的判据都逐条对照过产物；本地自检（见
   `dsh-audit-defect.md` §7）能抓到口径错误，但不构成独立核验。
4. **Human 明确要求**：2026-10-28 裁决写明 `audit_dispatch_failed` 属独立评审工具的环境
   故障，不应冒充代码失败，不重复无效派遣。

### 恢复后要做什么

只需重跑 `Conclude`（已 `abandoned` 的先 `update_goal resume`），不需要重新测量。若那时
代码已变化，旧读数按各自文档的效力条款处理。PoC 系列读数绑定 Cordis `4.0.5`，升版需先
重跑回归脚本（见 `docs/architecture/route-c-migration-prerequisites.md` §7）。

### 已知的边界

普通 `subagent` / `subagent_fork` 派发在本会话里**多次成功**（认知职责审查的四模块源码
审查就是并行 subagent 完成的）。故障只出现在带 `persona + outputSchema + toolFilter`
三参数的评估者派遣路径上，不要把「评估者不可用」扩大成「subagent 机制全坏」。
