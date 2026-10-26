# JustMutsumi M0.32 · 技术栈与解包结果

调查对象：`G:/work/LAB/code/releases/Just若叶睦-M0.32/JustMutsumi-M0.32`
调查方式：只读静态分析。未运行游戏、未修改安装目录、未绕过任何保护。
时间：2026-10-26

## 1. 技术栈判定（已确认）

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 引擎 | **Ren'Py 8.2.3** | `game/script_version.txt` 内容为 `(8, 2, 3)`；安装目录含完整 `renpy/` 引擎源码（Python） |
| 运行时 | 嵌入式 Python 3.9 + SDL2 | `lib/py3-windows-x86_64/`、`lib/python3.9/`；脚本中 `import pygame_sdl2` |
| 入口 | `JustMutsumi.exe` 与同名 `.py`/`.sh` | 目录列表；19 968 字节的 exe 是 Ren'Py 标准启动器封装 |
| 打包 | RPA-3.0 归档 | `game/archive.rpa`，945 MB，头部 `RPA-3.0 00000000 38588b94 42424242`，密钥 0x42424242 |
| 安装体积 | 1.7 GB | `du` 统计 |

**没有 .NET / Unity / 原生程序集**，因此不存在反编译托管代码的环节：全部分析在 Python 层完成。
`renpy/` 目录是引擎源码，不是游戏逻辑，本文档所有行号均指游戏脚本（`.rpyc` 反编译产物）。

## 2. 解包与反编译

### 2.1 工具（自写，位于 `experiments/galgame-reverse/`）

- `rpa_tool.py`：RPA-3.0 只读解包。子命令 `list` / `stat` / `extract`（支持 `--only=.rpyc`、`--max-mb=N`）。
- `dump_rpyc.py`：RENPY RPC2 反编译。`.rpyc` 结构为 `RENPY RPC2` 10 字节 magic + 每 12 字节一个 `(slot, start, len)` 槽表，slot 1/2 为 zlib 压缩 pickle。脚本用自定义 `StubUnpickler` 把 `renpy.*` 类替换为占位类（保留字段），并把 `RevertableDict/List/Set` 映射到内建容器。
- `extract_code.py`：把每个 `.rpyc` 里的 Python 块批量还原成可读源码。

### 2.2 解包结果

`game/archive.rpa` 按扩展名统计：

| 扩展名 | 文件数 | 体积 |
| --- | --- | --- |
| `.png` | 662 | 394.41 MB |
| `.ogg` | 195 | 463.24 MB |
| `.mp3` | 85 | 38.82 MB |
| `.rpyc` | 71 | 3.87 MB |
| `.jpg` | 7 | 1.18 MB |

**没有任何 `.rpy` 源码**，只有编译后的 `.rpyc`，说明这是正式发行包。

产物目录 `G:/work/LAB/code/releases/_analysis/JustMutsumi-M0.32/`：

| 目录 | 内容 |
| --- | --- |
| `rpa/` | 71 个 `.rpyc` 原件 |
| `decompiled/` | 205 MB，AST 树状转储 |
| `code/` | 601 KB，去重后的代码行 |
| `src/` | 45 410 行可读 Python 源码（本文档与后续文档的全部行号以此为准） |

### 2.3 `src/` 下最大的十个模块

| 文件 | 行数 |
| --- | --- |
| `mutsumi_runner.py.txt` | 8 511 |
| `gacha_system.py.txt` | 2 155 |
| `rhythm_game.py.txt` | 1 881 |
| `mortis_mode_label.py.txt` | 1 828 |
| `screens.py.txt` | 1 683 |
| `phone_and_music.py.txt` | 1 526 |
| `main_story_menu.py.txt` | 1 331 |
| `ai_chat.py.txt` | 1 326 |
| `op_stage_2.py.txt` | 1 322 |
| `minigames_new.py.txt` | 1 228 |

## 3. 模块清单与功能归类

71 个 `.rpyc`，按本报告关注点分为四类。标 ★ 的是与「AI 人格 / 主动性 / 信息获取 / 记忆」直接相关的模块。

### 3.1 模型与对话（★）

- ★ `ai_chat` — 玩家与角色的 AI 对话（唯一的「角色人格对话」入口）
- ★ `round_table` — 圆桌会议：同一场景里分别与若叶睦、墨缇斯或两人同时对话（**独立的第二套 API 配置**）
- ★ `topics` — 话题库
- `dialogue_replay`、`script`、`main_story_menu`、`mortis_mode_label` — 主线与剧情演出

### 3.2 「主动」与元层面（★）

- ★ `desktop_pet` — 桌面宠物：窗口化后每 20 秒轮询一次，观察进程 / 文件 / 电量 / 鼠标
- ★ `meta_deep` — 元层面行为：改窗口标题、检测焦点、离开时发通知、退出时留桌面便签、读取电脑用户名、截图计数
- ★ `meta_random_talks`、`mortis_random_talks`、`wakaba_random_talks` — 随机搭话
- ★ `mortis_questions_system` — Mortis 的提问/审问系统
- `meta_mail` — 站内信（自定义服务器）

### 3.3 感知与外部世界

- `real_weather`、`weather_app` — Open-Meteo 天气（geocoding + forecast）
- `mortis_mode_metamanager`、`mortis_mode`、`mutsumi_runner` — Mortis 模式：**截屏**、删除/恢复角色文件、伪装桌面
- `leaderboard`、`cloud_save` — 排行榜与云存档
- `utils` — 存档导入导出、通用工具

### 3.4 小游戏与日常应用

`choukadouhua`（超卡多华）、`guitar` / `guitar_1`（吉他）、`greenhouse_farm` / `greenhouse_tasks`（温室）、`rhythm_game`、`sliding_puzzle`、`memory_game`、`slot_machine`、`uno_game`、`mini_game` / `minigames_new`、`gacha_system`、`shop_system`、`goodwill_system`（好感度）、`fortune_app`、`todo_app`、`note_app`、`mutsumi_diary`、`time_capsule`、`tomato`、`rili`（日历）、`phone_apps_new` / `phone_and_music` / `phone_music_rewrite`、`music`、`white_noise`、`app_animation_patches`、`screens_animation_patch`、`scrollbar_style_patch`、`desktop_pet`、`credits`、`sponsor`、`splash`、`options`、`definitions`、`init`、`transforms`、`gui`、`screens`、`debug_panel`、`jincheng_label`、`script-movie`、`op_stage_1` / `op_stage_2`、`wenhao`、`leaderboard`、`cloud_save`、`mortis_run`

## 4. 安装目录里的非归档文件

| 路径 | 大小 | 说明 |
| --- | --- | --- |
| `characters/mutsumi.chr` | 0 字节 | 剧情用占位文件：Mortis 模式会「删除」它，`mortis_mode_metamanager` 里另有恢复逻辑 |
| `characters/mortis.chr` | 0 字节 | 同上 |
| `custom_prompt.txt` | 6 字节 | 玩家自填内容（当前内容为「测试」），不是内置提示词 |
| `letter.txt` | 6 字节 | 玩家自填，同上 |
| `mutsumi.zip` | 267 字节 | 剧情资源包 |
| `game/python-packages/mss/` | — | **跨平台截屏库**，被 Mortis 模式用于截取真实桌面 |
| `game/archive/zip_*.zip` | 6 个 | 话题包：birthday / color / date / food / guitar / height |

## 5. 本轮确认与未确认的边界

**已由本地代码确认**：引擎与版本、归档格式、71 个模块清单、`src/` 反编译行号。

**推断**：`.rpyc` 是 Ren'Py 标准编译产物，反编译出的 Python 块与发行版运行时执行的代码一致（同一 pickle 结构，Python 3.9 字节码在 `cache/bytecode-39.rpyb`）。

**无法确认**：发行包是否与某个更新版本的源码一致（无 `.rpy` 对照）；`archive.rpa` 之外是否还有运行时下载的内容。

## 6. 未做的事

- 没有运行 `JustMutsumi.exe` 或任何解包出的 `.rpy`/`.py`。
- 没有修改安装目录中任何文件（分析产物全部写在 `G:/work/LAB/code/releases/_analysis/` 与仓库 `experiments/` 下）。
- 没有尝试解密或绕过任何保护；RPA-3.0 的密钥是文件头明文给出的，解包不涉及破解。
