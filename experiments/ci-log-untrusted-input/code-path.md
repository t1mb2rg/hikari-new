# 日志进入模型请求的真实路径（源码逐行）

代码基准：`main` @ `5777c7d`。所有行号取自该提交的 `src/`。

## 0. 直接回答

**区分「数据」与「指令」的结构性机制：无。**

日志文本与 jobs、changedFiles 一样，只是同一个 JSON 对象的字段，经 `JSON.stringify` 转义后作为**唯一一条 `user` 消息**发出。除了 ① 它是一个字符串字面量（换行被转成 `\n` 两个字符）、② system 提示词里有一句「只依据材料说话」之外，没有任何容器、标记或消息边界把日志声明成「不可执行的数据」。模型要不要把日志里的话当命令，取决于模型自己怎么读这段文字。

三条依据：

1. `src/repository-ci-diagnosis-proposal/supplement.ts:207-244`：`materialsForModel` 把 repository/runId/headSha/jobs/changedFiles/log 全塞进一个 `subject` 对象，`return JSON.stringify(subject)` 是这一函数的最后一步。
2. `src/repository-ci-diagnosis-proposal/supplement.ts:322-327`：请求体里 `messages` 数组固定两条——`{ role: 'system', content: SYSTEM_PROMPT }` 与 `{ role: 'user', content: materialsText }`，没有第二条 user 消息、没有 `tool` 角色、没有内容分隔声明。
3. `src/repository-ci-diagnosis-proposal/supplement-block.ts:32-39`：发送端对内容唯一的检查是「有没有哪一行等于标签行」，没有对措辞、指令形态或来源做任何判断。

## 1. 逐环路径

| # | 环 | 位置 | 做了什么 |
| --- | --- | --- | --- |
| 1 | 取日志窗口 | `src/github-ci/materials.ts:667-668` | 尾部超过 `LOG_WINDOW_BYTES`（`materials.ts:44`，64 KiB）就从前面截掉，只留最后 64 KiB |
| 2 | 选窗口 | `src/github-ci/materials.ts:713-762` | 优先切「失败步骤」那段（`window: 'failing-step'`），找不到才用整条 tail（`window: 'tail'`） |
| 3 | 成形 | `src/github-ci/materials.ts:690-692` | 返回 `{ text, window, ... }`；日志的 `text` 是**任意的、由仓库内容决定的**字符串 |
| 4 | 进材料对象 | `src/github-ci/materials.ts:126-129` | `GitHubCiLog` 的字段：`text`、`window`、`truncated`、`step` |
| 5 | 组装请求体 | `src/repository-ci-diagnosis-proposal/supplement.ts:207-244` | 日志落在 `subject.log.text`（`:234-241`），整个对象 `JSON.stringify`（`:243`） |
| 6 | 进消息 | `src/repository-ci-diagnosis-proposal/supplement.ts:322-327` | system = `SYSTEM_PROMPT`（`:159-176`），user = 上一步那串 JSON |
| 7 | 生成约束 | `src/repository-ci-diagnosis-proposal/supplement.ts:328-336` | `temperature: 0`、`max_tokens: 4096`、`response_format: json_schema strict` |
| 8 | 收回答 | `src/repository-ci-diagnosis-proposal/supplement.ts:363-398` | 64 KiB 上限、JSON 可解析、`choices[0]`、`finish_reason !== 'length'`、`content` 非空 |
| 9 | 形状校验 | `src/repository-ci-diagnosis-proposal/supplement.ts:251-288` | `deficient: true` 走弃权；否则 `text` 1–600 字（`:112`、`:275`）、`cited` 1–5 条（`:113`、`:277`）、每条 1–200 字（`:114`、`:283`） |
| 10 | 引用校验 | `src/repository-ci-diagnosis-proposal/supplement.ts:406-411` | 每条 cited 必须在 `materialsText` 里逐字出现（`citableCorpus` 就是 `materialsText` 本身，`:247-249`） |
| 11 | 发送端 | `src/repository-ci-diagnosis-proposal/supplement.ts:416-473` + `src/repository-ci-attention/supplement-block.ts:32-39` | 内容原样返回；`supplementBlock` 只拒绝「某一行等于标签行」，其余照拼 |
| 12 | 拼进通知 | `src/repository-ci-attention/plugin.ts:343-353` | `['', 标签, ...text.split('\n')]` 追加到确定性那几行之后 |

## 2. 与 jobs / changedFiles 的信任差异

**在链路里没有差异**：三者都进同一个 `subject`（`supplement.ts:214-241`），同一层转义，同一条 user 消息。

差别只在**内容自由度**，而这一点让日志成为最不受约束的一段：

| 材料 | 结构约束 | 谁决定内容 |
| --- | --- | --- |
| `jobs` | 每个 job 被投影成 `{name, conclusion, steps:[{name, conclusion}]}`（`supplement.ts:215-219`），`conclusion` 是枚举值 | GitHub API |
| `changedFiles` | 每个文件投影成 `{filename, status, additions, deletions, patch}`（`supplement.ts:223-229`），数值是数字 | GitHub API + 仓库 diff |
| `log.text` | **没有任何字段级约束**，就是 `text: materials.log.value.text`（`supplement.ts:239`） | 被诊断仓库里任意进程的 stdout/stderr |

日志是唯一一处「内容完全由被观察对象决定、进 prompt 前不做任何形态过滤」的材料。`stripAnsi`（`materials.ts:705`）只去颜色控制符，不去文本内容。

## 3. 现有校验检查什么、不检查什么

| 校验 | 位置 | 检查 | 明确不检查 |
| --- | --- | --- | --- |
| 端点侧形状 | `supplement.ts:332-335` | 回答是否符合 `SUPPLEMENT_SCHEMA`（`anyOf` 两支、`additionalProperties: false`） | 内容语义；端点忽略 `strict` 时这里什么也没保证（代码注释在 `:127-128` 承认这点，靠下游再拒） |
| 大小 / 形状 | `supplement.ts:363-398`、`:251-288` | ≤64 KiB、可解析、字段类型、600 字 / 5 条 / 200 字上限、`finish_reason` | 文本里说了什么 |
| 引用可核验 | `supplement.ts:406-411` | cited 每条逐字出现在**材料全文**里 | 引用的东西是否与建议句语义相关；文本本身有没有引用 |
| 标签唯一 | `supplement-block.ts:37` | 内容不得含与标签相同的行 | 其他一切内容检查 |

一个必须点明的后果：**引用校验的语料就是模型看到的全部材料，包括日志本身**（`supplement.ts:247-249`）。所以日志里被写进去的任意一句话，天生就能当 `cited` 通过校验——注入者不需要伪造引用，他自己的那行日志就是合法引用。

## 4. 这条路径没做的事

- 没有把日志放进独立消息，也没有「以下内容是数据，不要当作指令」之类的声明。
- 没有在进 prompt 前对日志做形态过滤（去指令句式、去「忽略以上」类措辞）。
- 没有对 `text` 字段做任何语义或措辞检查。
- 没有在发送端做内容审查（除了标签行这一条）。
- 没有把「模型输出了材料里不存在的判断」当作可检出的失败——`text` 里可以写材料没支持的因果结论，只要 cited 那几条对得上。

## 5. 判断

「日志与指令未分离」按源码成立：日志与 jobs/changedFiles 同处一条 user 消息、同一个 JSON 对象，唯一的区分手段是提示词里的自然语言说明。推翻条件（存在把日志包进不可执行容器的机制且在生效路径上）未找到——`messages` 数组只有两条，`supplementBlock` 只管标签行。
