# JustMutsumi M0.32 实现逆向报告

**调查对象**：`G:/work/LAB/code/releases/Just若叶睦-M0.32/JustMutsumi-M0.32`
**方式**：只读静态分析（解包 + 反编译）。**未运行游戏、未改安装目录、未绕过任何保护、未输出任何密钥值。**
**时间**：2026-10-26

四份过程文档（本报告的行号引用与判定基准都在那里展开）：
`inventory.md`（技术栈与解包）、`model-chain.md`（模型与工具）、`trigger-chain.md`（主动触发）、`file-access.md`（文件与系统访问）、`memory.md`（记忆与连续性）。

---

## 0. 一句话结论

**这是一个「确定性感知 + 模板化表演 + 纯对话式模型」的三层结构。**

角色显得会主动、会观察、会记住，靠的是**定时器和规则表**，不是模型。模型只做一件事：玩家打字时，根据人格提示词生成一段回复。感知系统看到的一切（你开什么程序、桌面有什么文件、便签有没有被打开）**从不进入模型的上下文**，只用来从预写台词里选一句。

---

## 1. 技术栈与解包（判据①）

| 项 | 结论 |
| --- | --- |
| 引擎 | **Ren'Py 8.2.3**（`game/script_version.txt` = `(8, 2, 3)`） |
| 运行时 | 嵌入式 Python 3.9 + SDL2（`lib/py3-*.whl`、`import pygame_sdl2`） |
| 打包 | RPA-3.0，`game/archive.rpa` 945 MB，密钥在文件头明文给出（`42424242`），解包不涉及破解 |
| 归档内容 | `.png` 662 / 394 MB、`.ogg` 195 / 463 MB、`.mp3` 85 / 39 MB、**`.rpyc` 71 / 3.87 MB**、`.jpg` 7；**无 `.rpy` 源码** |
| 反编译产物 | `src/` 共 45 410 行可读 Python（本文全部行号的基准） |
| 非归档文件 | `game/python-packages/mss`（截屏库）、六个话题 zip、两个 0 字节 `.chr` 占位、两个 6 字节玩家自填 txt |
| 本机状态 | `%APPDATA%/RenPy` 下无该游戏目录 → **这份安装从未被运行过** |

没有 .NET / Unity / 原生程序集，全部分析在 Python 层完成。
工具：自写 `rpa_tool.py`（RPA-3.0 解包）、`dump_rpyc.py`（RPC2 + pickle 反编译）、`extract_code.py`（批量还原 Python 块）。

### 1.1 解包出的 71 个模块（★ = 与本报告关注点直接相关）

| 类别 | 模块 |
| --- | --- |
| **模型与对话** | ★ `ai_chat`、★ `round_table`、★ `topics`、`dialogue_replay`、`script`、`main_story_menu`、`mortis_mode_label` |
| **主动与元层面** | ★ `desktop_pet`、★ `meta_deep`、★ `meta_random_talks`、★ `mortis_random_talks`、★ `wakaba_random_talks`、★ `mortis_questions_system`、`meta_mail` |
| **感知与外部世界** | `real_weather`、`weather_app`、`mortis_mode`、`mortis_mode_metamanager`、`mutsumi_runner`、`leaderboard`、`cloud_save`、`utils` |
| **小游戏与日常应用** | `choukadouhua`、`guitar`、`guitar_1`、`greenhouse_farm`、`greenhouse_tasks`、`rhythm_game`、`sliding_puzzle`、`memory_game`、`slot_machine`、`uno_game`、`mini_game`、`minigames_new`、`gacha_system`、`shop_system`、`goodwill_system`、`fortune_app`、`todo_app`、`note_app`、`mutsumi_diary`、`time_capsule`、`tomato`、`rili`、`phone_apps_new`、`phone_and_music`、`phone_music_rewrite`、`music`、`white_noise` |
| **框架与外壳** | `app_animation_patches`、`screens_animation_patch`、`scrollbar_style_patch`、`credits`、`sponsor`、`splash`、`options`、`definitions`、`init`、`transforms`、`gui`、`screens`、`debug_panel`、`jincheng_label`、`script-movie`、`op_stage_1`、`op_stage_2`、`wenhao`、`mortis_run` |

---

## 2. 五条路径的调用链（判据②）

每条链逐行标注证据位置，并标注置信度。

### 2.1 人格与动机

| 调用/定义 | 位置 | 说明 | 置信度 |
| --- | --- | --- | --- |
| `_MUTSUMI_SYSTEM` | `ai_chat.py.txt:41-172` | 约 130 行内置人格提示词：身份、自我认知「绝对不承认自己是 AI」、人际关系档案 11 人、两阶段情感机制、好感度指令、回复格式 | 已确认 |
| `_fetch_system_prompt_from_github` | `ai_chat.py.txt:174-202` | 每次构造提示词都尝试从 `raw.githubusercontent.com/ocmi-oscar/just_mutsumi/main/mutsumi_prompt.txt` 拉取覆盖 | 已确认 |
| `_build_system_prompt` | `ai_chat.py.txt:204-258` | 用 7 个占位符注入玩家名/性别/好感度/关系描述/时段/生日 | 已确认 |
| `add_hgd` | `goodwill_system.py.txt:83-100` | 好感度累加，带 `once_id` 一次性标记与 `daily_id` 每日上限 | 已确认 |
| 动机来源 | 全文检索 | **提示词里没有任何一条要求角色主动了解玩家**；动机是对话内的情感反应规则 | 已确认 |

**这一段没有代码规则产生「想了解玩家」的动机**——角色不会因为好奇而发起任何事。

### 2.2 主动触发

| 触发源 | 位置 | 频率 | 内容来源 | 置信度 |
| --- | --- | --- | --- | --- |
| `screen desktop_pet` timer | `desktop_pet.py.txt:722-724` | `20.0` 秒 repeat | `pet_idle_tick()`（`:233`）掷骰分派 | 已确认 |
| `screen meta_deep` timer | `meta_deep.py.txt:470-474` | `2.0` 秒 repeat | `meta_deep_periodic()`（`:455`） | 已确认 |
| 失焦通知 | `meta_deep.py.txt:319` | 失焦后 300 s `threading.Timer` | `_NOTIFY_MESSAGES` 六条随机（`:340-347`） | 已确认 |
| 退出留便签 | `meta_deep.py.txt:464-469`、`:547` | 退出时 30% 概率 | `_DESKTOP_NOTES` 按序取 | 已确认 |
| 电脑名吐槽 | `meta_deep.py.txt:434-443`、`:531` | 启动后 300 s，只一次 | `_HOSTNAME_LINES` 三条随机 | 已确认 |
| 截图键 | `meta_deep.py.txt:396`、`:492-493` | 按 `K_PRINT`/`K_F12` | `_SCREENSHOT_LINES` 六条随机 | 已确认 |
| 桌宠开工具 | `desktop_pet.py.txt` `pet_open_tool` | 玩家点按钮 | 8 个预设工具，`subprocess.Popen` | 已确认 |

**没有任何一处由模型触发**。`threading` 的用途只有：API 请求、天气拉取、Toast 定时器、截图。

### 2.3 自主获取信息

| 读什么 | 位置 | 方式 | 结果去处 | 置信度 |
| --- | --- | --- | --- | --- |
| 桌面文件名 | `desktop_pet.py.txt:627-700` | `os.listdir(~/Desktop)`，限频 600 s（`:634`） | 关键词表 → 预设台词 | 已确认 |
| 窗口标题 | `desktop_pet.py.txt:463-550` | `powershell Get-Process \| ... MainWindowTitle`，限频 60 s | 13 组关键词 → 预设台词 | 已确认 |
| 电量 | `desktop_pet.py.txt:552-625` | `ctypes GetSystemPowerStatus`，限频 300 s | 阈值 → 预设台词 | 已确认 |
| 鼠标速度 | `desktop_pet.py.txt` `pet_detect_mouse` | `GetCursorPos` 差分 | 阈值 → 预设台词 | 已确认 |
| 前台窗口归属 | `meta_deep.py.txt:292-302` | `GetForegroundWindow` + `GetWindowThreadProcessId` 比对自身 PID | 布尔 → 焦点状态 | 已确认 |
| 桌面便签 atime | `meta_deep.py.txt:195-198` | `getatime > getmtime + 2` → `"read"`；文件不存在 → `"deleted"` | 预设台词 | 已确认 |
| 电脑用户名 | `meta_deep.py.txt:417-432` | `os.getlogin()`，退 `socket.gethostname()` | 一次性弹窗台词 | 已确认 |
| 整屏截图 | `mortis_mode_metamanager.py.txt:10-43`、`mutsumi_runner.py.txt:3705-3743` | `mss().shot(mon=1)` → `<gamedir>/desktop_cache.png` | **只作全屏背景显示** | 已确认 |

**没有一处把读到的内容交给模型。** 模型调用的 messages 构造（`ai_chat.py.txt:268-273`）里只有 system + 历史 + 玩家输入。

### 2.4 记忆与认知连续性

| 机制 | 位置 | 保留期 | 进入模型？ | 置信度 |
| --- | --- | --- | --- | --- |
| 对话历史 | `ai_chat.py.txt:297-301`（写盘 40 条）、`:268`（请求取 20 条） | 跨会话，20 轮窗口 | **是**（作为历史消息） | 已确认 |
| 好感度 | `goodwill_system.py.txt:35-66` | 跨会话 | **是**（经 `{gw_rank}`/`{relationship_detail}`） | 已确认 |
| 玩家档案 | `persistent.playername` 等 | 跨会话 | **是**（占位符） | 已确认 |
| 日记 | `mutsumi_diary.py.txt:336-399` | 跨会话 | **否**（模板拼装，只给人看） | 已确认 |
| 温室/待办/笔记/时间胶囊 | 各 App | 跨会话 | **否** | 已确认 |
| 便签是否被读、截图次数、看过哪些程序 | `meta_deep` / `desktop_pet` | 跨会话（计数与标记） | **否** | 已确认 |
| 圆桌会议历史 | `round_table.py.txt:177`、`:198` | **不持久化**（内存 `store`） | 是，但仅本次会话 | 已确认 |
| 站内信内容 | `meta_mail.py.txt:273` | 服务端 | 否 | 无法确认（服务端不可见） |

**没有「未完成的问题」这种数据结构**，也没有任何代码读取「上次没说完的事」。

### 2.5 模型与工具调用

| 项 | 位置 | 事实 | 置信度 |
| --- | --- | --- | --- |
| 调用点 1 | `ai_chat.py.txt:260` `_do_ai_chat` | 玩家点发送才触发；OpenAI 兼容 `/chat/completions` | 已确认 |
| 调用点 2 | `round_table.py.txt:86` `rt_call_api` | 玩家点发送；Anthropic `/v1/messages` 或 OpenAI 兼容（按 URL 判断，`:122-132`） | 已确认 |
| 请求体 | `ai_chat.py.txt:275-280` | `{model, max_tokens:400, temperature:0.8, messages}` —— **无 `tools` / `functions`** | 已确认 |
| 回复解析 | `ai_chat.py.txt:328-360` | 正则抽 `[GW:±n]` 改好感度；`[TOOL:...]` **只剥离不执行**；其余 `[大写:...]` 一并剥掉 | 已确认 |
| 双角色协议 | `round_table.py.txt:226-256` | 用 `[若叶睦]` / `[墨缇斯]` 文本标记切分回复 | 已确认 |
| 密钥 | `persistent.ai_api_key` 玩家自填 | 同时明文写进存档导出（`utils.py.txt:194`） | 已确认 |
| TLS | `ai_chat.py.txt:183-184`、`:282-284` | `check_hostname=False`、`CERT_NONE`（不校验证书） | 已确认 |

**模型不能触发任何动作**：它唯一能改变的持久状态是好感度数值和显示文本。

---

## 3. 三个核心问题（判据③）

### A. 角色为什么会主动产生「我想知道什么」？

**它不会。**

- 模型侧：人格提示词（`ai_chat.py.txt:41-172`）通篇是「怎么说」，没有一句「去了解对方」。模型只在被玩家召唤时运行。
- 代码侧：所有主动行为都由固定规则产生——`pet_idle_tick` 掷一次随机数决定「这次观察什么」（`desktop_pet.py.txt:233`），`meta_deep_periodic` 每 2 秒检查焦点（`meta_deep.py.txt:455`）。
- 因此「我想知道什么」这个判断**在产品中不存在**。存在的是「这次轮到哪个检测器」。

**证据**：全仓库 `chat/completions` 只命中 `ai_chat.py.txt` 一处；两处模型调用都在玩家点击的处理函数里；`desktop_pet` / `meta_deep` 的定时器函数体内没有任何网络调用。

### B. 信息需求如何转化为具体的文件读取或工具调用？

**不存在这个转化环节。**

产品里的路径是**写死**的：

```
随机数落在 [0.32, 0.40)  →  必然是 pet_detect_desktop_files
                          →  必然读 ~/Desktop 一层的文件名
                          →  必然在 _PET_FILE_RULES 的 6 组关键词里匹配
                          →  命中必然 random.choice(该组台词)
```

没有中间层去「决定读什么」或「要不要读」。`pet_open_tool` 的 8 个工具也是玩家点按钮选择，不是模型选择。

**证据**：`desktop_pet.py.txt:233`（分派）、`:627-700`（固定路径 + 固定关键词表）、`pet_open_tool`（按钮 → `subprocess.Popen`）。

### C. 主动探索的结果会不会改变下一次的认识与行为？

**不会。**

- 探索结果只写进一个显示用变量（如 `store._pet_line`），然后被 screen 渲染成一句话。
- 唯一被持久化的探索结果是一个计数（`persistent.meta_screenshot_count`）和一个序号（`meta_desktop_notes_left`），它们只影响「下次说话用第几条预设」。
- 最精巧的 `meta_check_note_read`（`meta_deep.py.txt:177-200`）能从 atime 推断玩家是否打开过便签——推断结果是三个字符串之一，只决定下次用哪句台词。
- **探索结果从不写进模型上下文，因此不可能改变模型的后续认知。**

**证据**：`ai_chat.py.txt:268-273`（messages 里没有任何探索结果）；persistent 中与探索相关的变量只有计数与标记。

---

## 4. 模型决定 vs 预设脚本（判据④）

| 事 | 谁决定 | 证据 |
| --- | --- | --- |
| 对话里说什么 | **模型** | `ai_chat.py.txt:268-280` |
| 好感度升降多少 | **程序解析模型标记后决定** | `ai_chat.py.txt:350-357` |
| 是否主动开口 | **程序**（定时器） | `desktop_pet.py.txt:722-724`、`meta_deep.py.txt:470-474` |
| 主动说什么 | **程序**（随机选预设表） | `_PET_*_LINES`、`_NOTIFY_MESSAGES`、`_DESKTOP_NOTES`、`topics.py.txt` |
| 看哪个程序 / 哪个目录 | **程序**（写死） | `desktop_pet.py.txt:640`、`:463-550` |
| 什么时候看 | **程序**（20 s tick + 60/300/600 s 限频） | `desktop_pet.py.txt:469/558/634` |
| 是否读文件内容 | **从不** | 只用 `os.listdir` 返回的文件名 |
| 是否调用工具 | **不存在该能力** | 请求体无 `tools`；`[TOOL:...]` 只剥离 |
| 画面演出 | **程序**（截图当背景） | `mortis_mode_metamanager.py.txt:35` → `renpy.cache_pin` |

一句话：**「像活着」的部分全是脚本，「有智能」的部分只在对话里。**

---

## 5. 值得 Hikari 借鉴的四点

1. **「在场感」可以很便宜**。窗口标题、失焦通知、退出便签——三件事加起来不到 200 行代码，却撑起了「她一直在」的体验。这类机制的共同点是：**不需要理解，只需要持续存在**。
2. **间接证据的隐私成本极低**。`atime > mtime + 2` 这一招，不读任何内容就能知道「玩家打开过那个文件」。对 Hikari 的意义：获得「玩家做了什么」的信号，不必获得「玩家看了什么」的内容。
3. **用占位符把状态注入人格，而不是把历史塞进上下文**。`{gw_rank}` / `{relationship_detail}` 用五档预写描述表达关系状态，比塞 20 轮聊天记录更省 token，也更稳定。
4. **模型输出的结构化标记 → 程序状态变化**（`[GW:±n]`）是一个极小的「模型驱动状态」闭环。它比工具调用简单得多，但方向是对的：模型的输出确实改变了下一次的条件。

**反面教材同样清楚**：
- 规则表 ≠ 理解。13 组关键词匹配出来的「关心」经不起一次对话追问。
- 感知与模型解耦意味着：她「看到」你在写作业，但你问她「你觉得我刚才在干什么」，她**不可能知道**。

## 6. 无法确认的部分

| 项 | 为什么无法确认 |
| --- | --- |
| 服务端行为（`meta_mail`、`cloud_save`、`leaderboard`） | 服务端不可见；本轮未调用未知远程接口 |
| GitHub 人格提示词覆盖的实际内容 | 需访问远程 URL，按指令未验证 |
| 运行时真实节奏 | 未运行游戏；所有间隔来自脚本常量（20 s / 2 s / 60 s / 300 s / 600 s） |
| `mss` 截图是否真的成功 | 依赖运行时环境，脚本 `try/except` 静默失败 |
| 发行包与某个源码版本是否一致 | 无 `.rpy` 对照；反编译基于 `.rpyc` 内嵌的 pickle |
| `atime` 判断在关闭 last-access 更新的系统上 | 脚本无兜底，会全部返回 `"unread"` |

## 7. 安全与合规声明

- 未运行 `JustMutsumi.exe` 或任何解包出的脚本。
- 未修改安装目录中任何文件；全部产物写在 `G:/work/LAB/code/releases/_analysis/` 与仓库 `experiments/galgame-reverse/` 下。
- RPA-3.0 的密钥由文件头明文给出，解包不涉及破解、不绕过 DRM 或访问控制。
- 未输出任何 API Key、Token、账号或个人信息的具体值；涉及密钥的位置只写字段名与行号。
