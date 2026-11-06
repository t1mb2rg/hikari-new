# Goal v0：让她知道自己还有什么没做完

> 边界在 `docs/architecture/goal-v0-boundary-freeze.md`，真机读数在 `experiments/goal-live/evidence.md`。这份文件只记"做成了什么、哪里还不够"。

## 它解决的是什么

冻结架构里 Goal 只有两句（`docs/architecture/core-architecture-v0.md:275-281`）：什么期望状态需要跨时间推进；它表示长期承诺，不负责自己查询世界、不自己决策下一步、不自己执行动作。

所以 v0 只做一件事：**她把自己决定要做的长期事项写下来，每轮都能看见，做完就说做完。** 不排期、不拆解、不推进、不叫人。

## 交付物

| 文件 | 作用 |
| --- | --- |
| `hikari-native/goal/index.js` | 插件 `hikari-goal`：三个工具 + 每请求注入段 `hikari:goals` |
| `hikari-native/test/goal.test.mjs` | 13 项单元测试 |
| `hikari-native/package.json` | exports 加 `"./goal"`，files 加 `"goal"` |
| `hikari-native/cordis.patch.yml` | 在 `hikari-activation` 之前挂上 `hikari-goal` |
| `docs/architecture/goal-v0-boundary-freeze.md` | 记录形状、三工具契约、注入规则、与 findings 的分工、明确不做 |
| `experiments/goal-live/evidence.md` | 两个真机会话的原文与读数 |

## 契约要点

- **存储**：`<stateDir>/hikari/goal/goals.jsonl`，只追加，同 `goalId` 以最后一行为准；一行一个状态变化，历史不丢。默认落在 `~/.dsh/hikari/goal/`，与记忆库同一个 `DSH_HOME` 约定。
- **记录**：`{goalId, text, status, note, at}`，`status` ∈ `open` / `done` / `dropped`。
- **工具**：`set_goal`（写一条）、`change_goal`（改状态，可 `done`→`open`）、`list_goals`（读全部，可按状态过滤）。
- **注入**：每轮请求注入一段 `hikari:goals`（`order: 160`），只列 `open`、最多 5 条、按立下的时间升序、每条一行「（今天立的）」或「（立了 N 天）」；空清单**不注入**；超出 5 条时补一句「还有 N 条没列出，用 list_goals 看全部」。稳态开销约 60 token/请求。
- **不做的边界**：不自动推进、不自动关闭、不给优先级、不排期、不跨插件同步、不导出 Service、不改 DSH 自己的 `create_goal` / `get_goal` / `update_goal`。

## 名字为什么换了

真机第一次加载就撞了：`hikari-goal (hikari-native-v0/goal): Error: tool "update_goal" is already registered`。DSH 宿主自己占着 `create_goal` / `get_goal` / `update_goal`（会话级任务目标）。所以第三个名字改成 `change_goal`，并在 `set_goal` / `change_goal` 的 description 第一句就写明"这是你的长期清单，不是会话任务目标"——否则模型会把两件东西混起来。

## 实测读数

- 单元测试：`node --test hikari-native/test/goal.test.mjs` 13 pass；全量 `npm test` 1189 tests / 1185 pass / 0 fail / 4 skip。
- 会话 A（写）：3 次调用（2 次 `set_goal`、1 次 `change_goal`），`goals.jsonl` 3 行，状态变化靠追加。
- 会话 B（查，提示里要求不调用工具）：`request/header` 里其实注册了 35 个工具，但 `tool/call` 记录 **0 条**——她一次也没调；说对了唯一仍在的那条，并明确排除已 `done` 的那条；对"进度做到哪一步"如实说不知道，没有编。
- 注入段原文：`你自己立下、还没做完的事：\n- g-e2b3d725-…（今天立的）：把 goal 的注入接进激活流程并验证`。

## 还不够的地方

1. **只在她每轮请求时出现**。自主唤醒（`activation` 的仓库变化 / 心跳）里还没有接入清单——她被动醒来时看不到自己的未完成事项。这是下一个自然的接缝，但要先决定"醒来时该不该看到全部 5 条"。
2. **没有"上次说做到哪"**。`note` 字段存在但没被注入，所以她能说出"没做完"，说不出"上次停在哪"。要不要注入最后一条 note，是产品判断。
3. **跨天措辞只是"立了 N 天"**，没有"逾期"概念——冻结架构里 Goal 没有时限，这是有意的。
4. **没有 Action**。清单上写着"把注入接进激活流程并验证"，但她不能自己动手改代码；下一步若要长出来，是"行动能力"那一片（先仓库内写 + 只读命令，每次留痕），不是给 Goal 加执行器。
