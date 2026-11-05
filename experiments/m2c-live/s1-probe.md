# s1-probe：验证 profile 起得来，六个记忆工具在工具面上

**日期** 2026-11-05 · **profile** `C:\Users\29719\.dsh\profiles\hikari-verify` · **模型** `deepseek-account/deepseek-flash`（`reasoningEffort: low`）

## 建了什么

一个独立 profile，只由三部分组成：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-headless`、以及从仓库 link 进来的 `hikari-native-v0`（只挂 `world` 与 `memory` 两个插件，不挂 bundle 自带的 perception / project-watch / activation 与观察者人格——那是常驻实例的形态，不是一次可对话的运行）。

`package.json` 依赖 `"hikari-native-v0": "link:G:/work/LAB/code/projects/own/hikari-new/hikari-native"`，bundles 只有 base 与 headless；`cordis.patch.yml` 即 `experiments/m2c-live/patch.yml` 的副本。

## 三个必须打开的开关

headless 的 patch 把 `authorization`、`credentials`、`deepseek-account` 三行都关掉了（它假设无人值守不需要账号）。本机没有 `DEEPSEEK_API_KEY`，唯一可用的凭据是 `$DSH_HOME/.credentials.yaml` 里 `deepseek-account-platform/default` 那份 grant，所以三行都要显式打开。不打开时的报错原文：

```
deepseek-account (...): pending (waiting for services: credentials, authorization)
dsh: ACCOUNT_SIGN_IN_REQUIRED: Sign in to DeepSeek to use the account provider. The request destination must allow account authentication.
```

打开后模型列表从 `https://api.deepseek.com/models` 正常加载 2 个模型。

## 读数

第一次极小 prompt（`只回复两个字：可用`），1–2 秒返回 `可用`，同时 stderr 出现：

```
[hkari-memory] ready — provider=hikari-memory,
  tools=search_memory,read_memory,write_memory,revise_memory,search_memories,get_memory,
  source=findings, available=true,
  store=G:\work\LAB\code\projects\own\hikari-new\experiments\m2c-live\store,
  records=0, seq=0, damage=none
```

（首字符 `h` 被 PowerShell 的 stderr 折叠吃掉，原文是 `[hikari-memory]`。）

第二次 prompt 让模型自己报工具名（不给任何提示，只问"与记忆或世界认识有关的工具"），它的回答：

```
get_memory, search_memories, read_memory, search_memory, record_finding, revise_memory, write_memory
```

六个记忆工具齐全，`record_finding` 也在——说明 World 的 findings 层装上了（这正是 `config.root` 的作用）。

存储目录 `experiments/m2c-live/store/` 此时只有 `memory.meta.json`（136 B，`records: 0, seq: 0`），`memory.jsonl` 尚未创建（第一次写入才会创建）。

## 预测对照

预测是"六个记忆工具齐全，ready 行含 records=0"，**符合**。没有出现工具缺失或 schema 报错。

有一点值得记下：模型把 `search_memory`（找 findings）与 `search_memories`（找记忆）都列了出来，说明两者在工具面上并存。风险是名字只差一个字母；本次观察点放在 s3：她会先试哪一个、试错几次。
