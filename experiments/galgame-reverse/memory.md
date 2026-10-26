# 记忆与认知连续性（JustMutsumi M0.32）

行号均指 `G:/work/LAB/code/releases/_analysis/JustMutsumi-M0.32/src/<module>.py.txt`。

## 0. 结论先行

**记忆是三层相互不连通的存储，没有「当前认识」这一层，也没有任何「未解决的问题」被保留。**

| 层 | 载体 | 生命周期 | 模型能看见吗 |
| --- | --- | --- | --- |
| 跨会话存档 | Ren'Py `persistent` | 永久（写盘） | 只通过 5 个占位符间接看见 |
| 本次运行 | Ren'Py `store` 变量 | 退出即丢 | 圆桌会议的历史用它 |
| 站外 | 作者服务器（站内信/云存档/排行榜） | 服务端决定 | **不能**，不参与任何提示词 |

## 1. 对话记忆的真实形状

```python
# ai_chat.py.txt:297-301
persistent.ai_chat_history.append({"role":"user",      "content": user_msg})
persistent.ai_chat_history.append({"role":"assistant", "content": reply})
persistent.ai_chat_history = persistent.ai_chat_history[-40:]      # 只留 40 条 = 20 轮
```

```python
# ai_chat.py.txt:268
history = list(persistent.ai_chat_history)[-20:]                   # 请求时再取最近 10 轮
```

**已确认**：写盘保留 40 条（20 轮），发给模型时截到 20 条（10 轮）。超出即静默丢弃，没有摘要、没有归档、没有「这条很重要要记住」的机制。

对照组：`round_table` 的历史在 `store._rt_messages`（内存变量，`:177`、`:198`、`:238`），**不写 persistent**——关闭游戏即消失，连 20 轮都没有。

## 2. persistent 里存了什么

按用途分组（变量名来自各模块 `persistent.xxx` 赋值与 `utils.py.txt:100-231` 的完整导出清单）：

| 组 | 变量（举例） | 内容 | 谁写 |
| --- | --- | --- | --- |
| AI 对话 | `ai_chat_history`、`ai_system_prompt`、`ai_api_key`、`ai_base_url`、`ai_model`、`ai_use_custom_prompt` | 40 条对话、缓存的人格提示词、API 配置 | 模型回复后 / 玩家设置 |
| 好感度 | `gw_wakaba`、`gw_metis`、`gw_last_date`、`gw_daily_counts`、`gw_event_flags` | 数值、每日上限计数、一次性事件标记 | `[GW:±n]` 解析 / 剧情 `add_hgd` |
| 玩家档案 | `playername`、`player_gender`、`player_bday_month/day` | 玩家自填 | 玩家 |
| 元层面 | `meta_online_start`、`meta_desktop_notes_left`、`meta_hostname_reacted`、`meta_screenshot_count` | 在线起点、便签序号、是否已吐槽过电脑名、截图次数 | 各 `meta_*` 函数 |
| 桌面宠物 | `_pet_last_*`、`_pet_seen_file_triggers` | 各检测器上次时间戳、已触发过的文件关键词 | `desktop_pet` |
| 日常应用 | `diary_history`、`diary_streak`、`gh_tasks`、`gh_points`、`todo_list`、`player_notes`、`time_capsule_list`、`calendar_notes` | 日记、温室任务、待办、笔记、时间胶囊、日历 | 对应 App |
| 站外 | `cloud_uid`、`cloud_email`、`redeemed_codes` | 账号与兑换码 | 玩家 / 服务器 |

`meta_mail`（站内信）的内容**不在本地**：`mail_refresh_inbox()`（`meta_mail.py.txt:273`）从作者服务器拉取。

## 3. 这些记忆如何进入模型

只有一条通路：`_build_system_prompt()`（`ai_chat.py.txt:204-258`）用 5 个占位符把这些值填进人格提示词。

```
{player_name}            ← persistent.playername
{player_gender}          ← persistent.player_gender
{gw_wakaba} / {gw_rank}  ← persistent.gw_wakaba（+ 五档映射）
{relationship_detail}    ← 按 gw 分档选五段预写描述之一
{time_period}            ← 本地时钟
{birthday_note}          ← persistent.player_bday_*
```

**除此之外，persistent 里的一切（日记、温室、待办、笔记、便签是否被读过、截图次数、看过哪些程序）都不会出现在模型的上下文里。**

`round_table` 更彻底：system prompt 是三段固定常量，只做 `玩家 → playername` 的字符串替换，连好感度都不注入。

## 4. 认知连续性：能做与不能做

| 期待中的能力 | 实际 |
| --- | --- |
| 记住上一轮对话 | **能**，10 轮窗口内 |
| 记住很久以前说过的话 | **不能**，超出 20 轮即丢 |
| 保留一个「未完成的疑问」并在之后追问 | **不能**，没有这种数据结构，也没有任何代码读取「上次没说完的事」 |
| 依据新证据修订既有认识 | **只有好感度**：`[GW:±n]` 与剧情 `add_hgd` 会覆盖数值，进而改变下次的 `relationship_detail`。**关于玩家、关于世界的事实没有任何可修订的表示** |
| 知道玩家昨天做了什么 | **不能**。日记（`mutsumi_diary.py.txt:336` `diary_generate`）确实按当日 `talk_count` / `played_game` / `online_seconds` / 好感度变化拼出一段文字，但那是**模板拼装**，而且是给人读的日记，不进模型上下文 |
| 跨会话知道「我们上次聊到哪」 | **不能**。历史是原始 40 条，没有摘要、没有主题、没有结论 |

## 5. 一处值得注意的设计：编辑式记忆（不做，但有迹可循）

`mutsumi_diary` 用「数据指纹」避免重复生成（`:393-399`）：

```python
"{}|{}|{}|{}|{}|{}|{}".format(date, talk_count, played_game, gacha, pomodoro, online, gw)
```

指纹不变就复用缓存文本。这说明作者已经有「把一天的交互压缩成一段可复用叙述」的直觉，但**只用在日记这个展示物上**，没有把压缩结果反过来喂给对话。

## 6. 无法确认

- 磁盘上的 `persistent` 实体：本机 `%APPDATA%/RenPy/` 下没有该游戏的目录，说明**这份安装从未被运行过**，因此无法从磁盘验证 persistent 的实际结构与大小。全部结论基于代码读取。
- 作者服务器（`meta_mail`、`cloud_save`、`leaderboard`）的服务端是否保留了更多玩家数据：服务端不可见。
- `persistent` 的读取路径是否被 `config.save_directory` 改动：全仓库检索未命中自定义 `save_directory`（`definitions.py.txt:508` 只设了 `config.name = "Just Mutsumi"`），因此是 Ren'Py 默认路径。
