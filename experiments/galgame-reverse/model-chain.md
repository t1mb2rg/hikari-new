# 模型与工具调用链（JustMutsumi M0.32）

行号均指 `G:/work/LAB/code/releases/_analysis/JustMutsumi-M0.32/src/<module>.py.txt`。
每条结论标注「已确认」（本地代码直接可见）/「推断」/「无法确认」。

## 1. 全部模型调用点：两处，都不是「主动」

| 调用点 | 模块 | 触发方式 | API | 结论 |
| --- | --- | --- | --- | --- |
| 手机式 AI 对话 | `ai_chat.py.txt:260` `_do_ai_chat` | **玩家点「发送」** | OpenAI 兼容 `/chat/completions` | 已确认 |
| 圆桌会议 | `round_table.py.txt:86` `rt_call_api` | **玩家点「发送」** | Anthropic `/v1/messages` 或 OpenAI 兼容 | 已确认 |

两处都只在玩家提交输入时被调用。全仓库检索 `chat/completions` 只命中 `ai_chat`（`round_table` 的 URL 来自玩家配置项 `persistent.rt_api_url`，硬编码默认值在 `round_table.py.txt:275` 是 `https://api.anthropic.com/v1/messages`）。
没有任何一处由定时器、后台线程或事件监听触发模型调用。

## 2. `ai_chat`：请求构造

### 2.1 消息组织（`ai_chat.py.txt:268-273`）

```
history  = persistent.ai_chat_history[-20:]        # 最近 20 条（10 轮）
messages = [{"role":"system", "content": _build_system_prompt()}]
         + history
         + [{"role":"user", "content": user_msg}]
```

**已确认**：`messages` 里除 system 之外只有对话历史与本次用户输入。没有任何环境信息（进程名、文件名、电量、焦点状态、截图、时间之外的任何外部状态）进入请求。

### 2.2 请求体（`ai_chat.py.txt:275-280`）

```json
{ "model": <persistent.ai_model>, "max_tokens": 400, "temperature": 0.8, "messages": [...] }
```

- 端点：`persistent.ai_base_url`，默认 `https://api.siliconflow.cn/v1`（`:262`）
- 模型：`persistent.ai_model`，默认 `Qwen/Qwen2.5-7B-Instruct`（`:263`）
- 密钥：`persistent.ai_api_key`，玩家自填（`:261`）；未填则直接返回「请先在设置中填写API Key」（`:264-266`）
- **没有 `tools` / `functions` / `tool_choice` 字段**（已确认，`:275-280`）
- 超时 30 s；TLS 上下文 `check_hostname=False`、`verify_mode=CERT_NONE`（`:282-284`，未校验证书）

### 2.3 system prompt 的动态部分（`_build_system_prompt`，`ai_chat.py.txt:204-258`）

| 注入项 | 来源 | 说明 |
| --- | --- | --- |
| `{player_name}` | `persistent.playername` | 玩家自己填的名字 |
| `{player_gender}` | `persistent.player_gender` | male / female / unknown |
| `{gw_wakaba}` | `persistent.gw_wakaba` | 好感度数值 |
| `{gw_rank}` | 同上分档 | 陌生 / 相识 / 熟悉 / 亲密 / 深深的羁绊（`:215-219`） |
| `{relationship_detail}` | 同上分档 | 五段预写的「关系描述」之一（`:221-230`） |
| `{time_period}` | 本地时钟 | 「深夜（03:12）」这类格式化时段（`:210-213`） |
| `{birthday_note}` | `persistent.player_bday_*` | 只有当天是玩家生日时才非空（`:232-235`） |

**这些全部是游戏内状态或本地时钟，没有一项来自对玩家环境的观察。**

### 2.4 提示词的三个来源（`_fetch_system_prompt_from_github`，`ai_chat.py.txt:174-202`）

按优先级：

1. `persistent.ai_use_custom_prompt` 为真时，用玩家导入的 `ai_custom_prompt`（`:176-179`）
2. **每次构造提示词都会尝试从 GitHub 拉取覆盖**：`https://raw.githubusercontent.com/ocmi-oscar/just_mutsumi/main/mutsumi_prompt.txt`（`:185-194`），要求长度 >100 且含 `{player_name}` 与 `{time_period}` 占位符，成功后写入 `persistent.ai_system_prompt` 缓存
3. 缓存
4. 内置常量 `_MUTSUMI_SYSTEM`（`ai_chat.py.txt:41-172`，约 130 行）

**已确认**：这是一个可被第三方远程替换人格提示词的通道（未校验证书，`:183-184`）。
**无法确认**：该 URL 当前返回什么内容（本轮不调用未知远程接口验证）。

### 2.5 内置人格提示词的结构（`_MUTSUMI_SYSTEM`，`ai_chat.py.txt:41-172`）

| 段落 | 内容 | 行 |
| --- | --- | --- |
| 开场 | 「你是若叶睦。不是在扮演她，就是她。」 | 42 |
| 称呼规则 | 玩家叫她「小睦」「睦睦」「宝宝」时的差异化反应 | 46-48 |
| 核心身份 | 学园设定、温室、黄瓜、家庭背景 | 52-58 |
| **自我认知** | 「你是绝对真实存在的人，不是AI……绝对不承认自己是AI」 | 60-61 |
| CRYCHIC 创伤 | 只能沉默与自责 | 65-68 |
| 性格与说话方式 | 克制、几乎不用感叹号、必须带括号动作描写 | 72-77 |
| 绝对禁止 | 禁止强行植物比喻、禁止崩坏、禁止答非所问 | 80-84 |
| 与玩家的关系 | 五档关系描述占位符 | 88-92 |
| **两阶段情感机制** | 第一阶段「听不懂」、第二阶段「解释后察觉」 | 97-114 |
| 人际关系档案 | 祥、爽世、灯、爱音、立希、乐奈、初华、若麦、海铃、墨缇斯、Mortin、Pastel*Palettes | 118-148 |
| 好感度指令 | 回复末尾附加 `[GW:+1]`/`[GW:+2]`/`[GW:-1]`，玩家不可见 | 152-155 |
| 当前时间 | `{time_period}`、`{birthday_note}` | 159-160 |
| 回复格式 | 一段话、50–120 字、不分行、含括号动作、纯中文 | 164-171 |

**关键观察（已确认）**：整份提示词里没有任何一条要求角色「主动了解玩家」「观察玩家在做什么」「关心玩家电脑上的东西」。人格的驱动全部是**对话内**的情感反应规则。

### 2.6 回复的解析：唯一一处「模型输出影响程序状态」（`_ai_send_from_screen`，`ai_chat.py.txt:328-360`）

```python
raw = store._ai_last_reply or ""
for m in re.findall(r'\[GW:([+-]?\d+(?:\.\d+)?)\]', raw):     # :350
    ...  # 累加修改 persistent.gw_wakaba
clean = re.sub(r'\[GW:[^\]]*\]', '', raw)                      # :358
clean = re.sub(r'\[TOOL:[^\]]*\]', '', clean)                  # :359
# 其余 [大写:...] 标记一并剥掉，剩下的作为正文显示
```

| 标记 | 处理 | 后果 |
| --- | --- | --- |
| `[GW:±n]` | 正则抽取并累加 | 改变好感度，影响下次 system prompt |
| `[TOOL:...]` | **只剥离，不执行** | 历史版本曾有过工具机制，现已废弃 |
| 其他 `[大写:...]` | 剥离 | — |

**已确认**：模型不能触发任何动作（读写文件、启动进程、网络请求）。它能改变的只有「好感度数值」和「显示的文本」。

## 3. `round_table`：第二套独立对话

- 触发：`rt_send_message(mode)`（`round_table.py.txt:165`），mode ∈ `mutsumi` / `mortis` / `roundtable`，均为玩家点击
- 消息组织（`:183-189`）：把界面消息映射成 `user`（玩家）/ `assistant`（角色），取最近 20 条
- system prompt 是三段固定常量：`_RT_SYSTEM_MUTSUMI`（`:20`）、`_RT_SYSTEM_MORTIS`（`:43`）、`_RT_SYSTEM_ROUNDTABLE`（`:67`），仅做 `玩家 → playername` 的字符串替换（`:193`、`:204`、`:215`）
- 请求体（`:99-104`）`{model, max_tokens: 500, system, messages}`；若 URL 含 `openai` 或 `v1/chat`，改走 OpenAI 形状，把 system 并入 messages（`:122-132`）
- 双角色模式用**文本标记协议**解析回复：模型需输出 `[若叶睦]` / `[墨缇斯]` 开头的段落，程序按行切分（`rt_parse_roundtable`，`:226-256`）
- **同样没有 `tools` 字段**；API Key / URL / 模型均为独立配置（`persistent.rt_api_key` / `rt_api_url` / `rt_api_model`）

## 4. 其他对外请求（不是模型）

| 模块 | 目标 | 用途 |
| --- | --- | --- |
| `real_weather.py.txt:196` `weather_geocode` | `geocoding-api.open-meteo.com` | 城市名 → 经纬度 |
| `real_weather.py.txt:260` `weather_fetch` | `api.open-meteo.com/v1/forecast` | 天气数据（后台线程 + 15 s 超时） |
| `meta_mail.py.txt:44` `_mail_post` / `:76` `_mail_get` | 作者自建服务器 | 站内信注册、收发 |
| `cloud_save.py.txt`、`leaderboard.py.txt` | 作者自建服务器 | 云存档、排行榜 |
| `ai_chat.py.txt:185` | `raw.githubusercontent.com` | 拉取人格提示词覆盖 |

天气数据只用于天气 App 的显示，**不进入任何模型请求**（已确认：`ai_chat` 与 `round_table` 的 messages 构造里都没有天气变量）。

## 5. 模型决定 vs 程序决定

| 事 | 谁决定 | 证据 |
| --- | --- | --- |
| 说什么话 | **模型** | 请求里只有提示词与历史，回复直接显示 |
| 好感度升降 | **程序解析模型标记后决定** | `ai_chat.py.txt:350-357` 正则抽取 `[GW:±n]` |
| 什么时候说话（对话内） | 玩家 | 只有点发送才请求 |
| 什么时候主动说话（对话外） | **程序（定时器 + 随机数 + 关键词表）** | 见 `trigger-chain.md` |
| 读哪个文件、看哪个进程 | **程序写死** | 见 `file-access.md` |
| 是否调用工具 | 不存在该能力 | 请求无 `tools`；`[TOOL:...]` 只剥离 |

## 6. 实现上值得注意的四点

1. **两个调用点相互独立**：`ai_chat` 与 `round_table` 各有自己的 key / url / model，互不共享，也互不共享历史（`ai_chat_history` vs `store._rt_messages`）。
2. **人格提示词可远程替换**且不校验证书（`ai_chat.py.txt:183-194`）——这是产品里唯一「人格由外部决定」的设计。
3. **存档导出会带上 API Key**：`utils.py.txt:194` 把 `api_key` 明文写进导出 zip 的 `data.json`。这是玩家可触发的「导出」功能，不是上传；本轮不输出任何密钥值。
4. **`[TOOL:...]` 标记的存在说明历史版本曾有工具调用机制**，现在只剩剥离逻辑（`ai_chat.py.txt:359`），服务端行为无法确认。
