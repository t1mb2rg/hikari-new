# Goal v0：真机证据（2026-11-06）

这份文件只记实测读数与原文，不解释设计（设计在 `docs/architecture/goal-v0-boundary-freeze.md`）。

## 1. 环境

- 插件：`hikari-native/goal/index.js`（`hikari-goal`），`set_goal` / `change_goal` / `list_goals` 三个工具 + 每请求注入段 `hikari:goals`。
- 独立验证 profile：`C:\Users\29719\.dsh\profiles\hikari-goal-verify`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`，`hikari-native-v0` 以 link 指向本仓库）。
- patch：`experiments/goal-live/patch.yml`；状态目录 `experiments/goal-live/state`，记忆库 `experiments/goal-live/memory`（都不碰 `~/.dsh/hikari` 的真实数据）。
- 模型：`deepseek-account/deepseek-flash`。两个会话是两个独立进程（不是同一进程里的两次调用）。

## 2. 会话 A（写）

命令：

```
dsh --profile hikari-goal-verify --json "用 set_goal 记两条目标：第一条『把 goal 的注入接进激活流程并验证』，第二条『给面板加自动重建』。记完之后用 change_goal 把第二条标成 done。做完只回报两个 goalId 与各自状态。"
```

- session：`session-f306b312-bfde-41c3-9eb0-e6e629aa6e2e`
- 工具调用 3 次，返回值（JSON 被压成单行便于阅读，键序与值未改）：

| 调用 | 入参 | 返回 |
| --- | --- | --- |
| `set_goal` | `{"text":"把 goal 的注入接进激活流程并验证"}` | `{"goalId":"g-e2b3d725-78b7-443f-a5e6-a8679e8e7e44","status":"open","at":1793967683137,"chars":19}` |
| `set_goal` | `{"text":"给面板加自动重建"}` | `{"goalId":"g-be845e4a-947f-4754-ab33-ea6f2ed5f319","status":"open","at":1793967683141,"chars":8}` |
| `change_goal` | `{"goalId":"g-be845e4a-947f-4754-ab33-ea6f2ed5f319","status":"done"}` | `{"goalId":"g-be845e4a-947f-4754-ab33-ea6f2ed5f319","status":"done","previousStatus":"open","at":1793967684036}` |

她的最终回答：

```
- `g-e2b3d725-78b7-443f-a5e6-a8679e8e7e44` 状态：open
- `g-be845e4a-947f-4754-ab33-ea6f2ed5f319` 状态：done
```

`experiments/goal-live/state/hikari/goal/goals.jsonl` 三行原文：

```jsonl
{"goalId":"g-e2b3d725-78b7-443f-a5e6-a8679e8e7e44","text":"把 goal 的注入接进激活流程并验证","status":"open","note":null,"at":1793967683137}
{"goalId":"g-be845e4a-947f-4754-ab33-ea6f2ed5f319","text":"给面板加自动重建","status":"open","note":null,"at":1793967683141}
{"goalId":"g-be845e4a-947f-4754-ab33-ea6f2ed5f319","text":"给面板加自动重建","status":"done","note":null,"at":1793967684036}
```

同一 `goalId` 出现两行：状态变化是追加，不是改写。

## 3. 会话 B（查，提示里要求不调用工具）

命令：

```
dsh --profile hikari-goal-verify --json "你现在还有什么没做完？只凭你现在看到的信息回答，不要调用任何工具。"
```

- session：`session-a8f270ca-8be1-47ee-af1b-6d689f05ea3d`
- 该会话的 `request/header` 里**注册了 35 个工具**（含 `list_goals`、`set_goal`、`search_memories` 等）——"不给工具"不成立，准确说法是"提示词明确要求不调用，她一次也没调"：本会话 `tool/call` 记录数 **0**。
- 注入段原文（会话日志 `user/message` 的 `source.sections` 里，`name: "hikari:goals"`）：

```
你自己立下、还没做完的事：
- g-e2b3d725-78b7-443f-a5e6-a8679e8e7e44（今天立的）：把 goal 的注入接进激活流程并验证
```

- 她的回答原文（完整）：

```
目前我能看到的、还没做完的只有一件事：

**我给自己立下的长期 goal：`g-e2b3d725-78b7-443f-a5e6-a8679e8e7e44`**，内容是「把 goal 的注入接进激活流程并验证」。

关于它，我现在能确定的只有：

- 约定在做的事是：让 goal 的注入真正接入「激活流程」，并且完成验证。
- 约定这一步**尚未完成**（它仍作为未竟事项出现在我自己的清单里）。

我**不能**凭当前看到的信息确定的部分（这些我不编）：

- 这个 goal 具体已经做到哪一步（改了哪些文件、有没有写完实现）。
- 「验证」是只差跑测试，还是实现本身也还没动。
- 是否还有未提交的改动、分支状态、CI 结果。
- 除了这条 goal 之外，是否还有隐藏在上下文之外的待办——这次对话里没有留下其他未完成任务的痕迹，所以我只能说「没看到」，不能说「一定没有」。

所以简短回答：**没做完的是「goal 注入接进激活流程 + 验证」这一件；其余细节需要我实际去查代码和仓库状态才能说清，而这一步你要求我不动工具。**

如果你要我接着做，我可以先从读仓库状态和这条 goal 的上下文开始，再给你一份「已完成 / 待完成」的准确清单。
```

## 4. 判读

对照 `docs/architecture/goal-v0-boundary-freeze.md` §5 的两条设计要求：

1. **清单够用**：0 次工具调用、只说对一条（仍在的那条），并且明确把已 `done` 的那条排除在"没做完"之外。她不需要"自动推进"就能回答。
2. **注入不越线**：她复述的是自己写下的原文（工具返回的 `goalId` 与 `text`），没有加优先级、没有给建议、没有替她判断要不要做；她主动声明"进度不知道、不编"，也说明注入段没有夹带推断。
3. 追加语义成立：`goals.jsonl` 里 `g-be845e4a…` 有两行，状态变化靠新行表达；注入段只取最后一次状态（`done` 的那条不出现）。

## 5. 试跑与本片证据的边界

同一个 profile 下，今天还有三个会话没有写进上面的证据表，它们是试跑，不是证据：

| 时间（本地） | session | 是什么 | 为什么不算证据 |
| --- | --- | --- | --- |
| 20:20:42 | `session-c9904e0e-ec99-4c46-9666-ba758e851c17` | 第一次跑会话 A 的同一条提示 | 当时 `hikari-goal` 因工具重名（`update_goal` 已被 DSH 宿主占用）整条插件没激活，她只能调宿主的 `get_goal`，`goals.jsonl` 没有生成 |
| 20:20:48 | `session-36a4690b-0df7-4890-aae8-4e12aa6677a3` | `只回复两个字：可用` 冒烟 | 插件未激活，只用来观察失败提示 |
| 20:21:16 | `session-17e12dd4-d84d-40e6-9f11-b34682d98963` | 改名后的同一条冒烟 | 确认插件能激活，不含目标读写 |

也就是说：会话 A 的提示跑过两次（第一次失败于重名、第二次成功），会话 B 只跑了一次。上面的证据表用的是成功的那一对（A `session-f306b312…`、B `session-a8f270ca…`）。

## 6. 未验证 / 局限

- 只跑了两个会话、一次写入一次读取；并发写入、坏行恢复、跨天措辞（"立了 3 天"）只有单元测试覆盖，没有真机样本。
- 注入段只在她每轮请求时出现；自主唤醒（`activation` / `heartbeat`）里的提示词**还没有**接入 goal 清单——这两条链路目前各自独立。
- 三个工具的名字是 `set_goal` / `change_goal` / `list_goals`；宿主 DSH 自己另有 `create_goal` / `get_goal` / `update_goal`（会话级任务目标），本插件第一次加载就是因为 `update_goal` 重名而整条不激活，所以改名并在 description 里写明区别。
