# 契约键编码的碰撞检查（s4）

**两侧的键**：
- Hikari：`serviceKey = `${id}@${version}``（`src/runtime/contracts.ts:32-34`）
- Cordis 适配层：`id.replace(/[^A-Za-z0-9]/g, '_') + '_v' + version`（`experiments/poc-02-runtime-contract/adapter-events.mjs:11-12`，与 PoC-01 的 `adapter.mjs:6-7` 同一条）

**运行**：`node experiments/poc-02-runtime-contract/key-collision.mjs` → `key-collision.json`

## 1. 真实契约全集（24 个 service）

| 项 | 读数 |
|---|---|
| service 数量 | **24**（`collect-contracts.mjs` 扫 `src/`） |
| 出现过的版本号 | 只有 **1** |
| Hikari 键是否唯一 | **是**（0 个重复） |
| Cordis 名是否唯一 | **是**（0 个重复） |

样例：`changeable-repositories.read@1` → `changeable_repositories_read_v1`，`chronicle@1` → `chronicle_v1`。

**结论**：在**今天这 24 个契约**上，编码无碰撞。原因不是编码函数安全，而是现有 id 恰好都是「小写字母 + 点 / 连字符」，且没有一对 id 只在「点 vs 连字符」上不同。

## 2. 编码函数本身是否单射：构造用例

| 用例 | A | B | Hikari 键不同？ | Cordis 名不同？ |
|---|---|---|---|---|
| 点 vs 连字符 | `github-ci.run-materials@1` | `github-ci.run.materials@1` | 是 | **否**（都是 `github_ci_run_materials_v1`） |
| 点 vs 下划线 | `foo.bar@1` | `foo_bar@1` | 是 | **否**（都是 `foo_bar_v1`） |
| 版本进键 | `foo@1` | `foo@2` | 是 | 是（`foo_v1` / `foo_v2`） |
| 版本当后缀 | `foo@3` | `foo_v3@1` | 是 | 是（`foo_v3` / `foo_v3_v1`） |
| 大版本号双位 | `foo@12` | `foo@1` | 是 | 是（`foo_v12` / `foo_v1`） |

**结论：编码不单射。** 版本维度是安全的（版本号参与键且无歧义）；危险的是 **id 内部的分隔符差异被折叠成同一个下划线**。一共两种可构造的撞车：`点 ↔ 连字符`、`点 ↔ 下划线`（`连字符 ↔ 下划线` 同样）。

今天没有撞，是因为碰巧没有这类 id 对；**只要未来有人同时定义 `a.b` 与 `a-b` 两个 service，就会撞。**

## 3. 撞车时两侧的实际行为

### 3a. Hikari：同名不同版本可以并存

| 项 | 读数 |
|---|---|
| 两个 provider（`poc02.foo@1`、`poc02.foo@2`）同时装 | **成功并存**（`coExists: true`） |
| 消费者 `requires: [poc02.foo@1]` 读到的值 | `value-from-v1` |

因为 `serviceKey` 含版本，两个契约是两个不同的键。**版本隔离由键本身保证，不靠宿主。**

### 3b. Cordis：编码后不同名的同名不同版本可以并存；真正撞车时静默失败

| 情形 | 读数 |
|---|---|
| 同名不同版本（`poc02_foo_v1` / `poc02_foo_v2`） | **并存**，两边都能读到各自的值 |
| 编码撞车（`poc02.a.b@1` 与 `poc02.a-b@1` 都映射成 `poc02_a_b_v1`） | 第二个 provider 的 fiber **`state=3`（FAILED）**，`fiber.error` 为 **`null`**，`get('poc02_a_b_v1')` 返回的仍是 **`from-a`** |

**这是本轮最需要注意的一条**：撞车时的失败**不会抛给装载者**，也不会留下可读的错误信息——它只是让第二个插件静默地变成 `FAILED`，而第一个提供者继续生效。若把它搬到生产，表现是「某个插件莫名其妙不工作，但它提供的服务看起来是好的」。

## 判定

| 判据 | 结果 |
|---|---|
| 真实契约键编码无碰撞 | **PASS**（24/24 唯一） |
| 编码函数对「不同版本」保持区分 | **PASS** |
| 编码函数对「不同 id」保持区分 | **FAIL**（点/连字符/下划线折叠，可构造） |
| 撞车可被上层观察到 | **FAIL**（Cordis 侧静默 FAILED、`error=null`；Hikari 侧不会撞车） |

**收口口径**：C（统一 Cordis 宿主）在契约键上**需要一条比「替换非法字符」更强的编码**——例如保留分隔符类别（`-`→`_h`、`.`→`_d`），或对 `id@version` 做稳定 hash 截断。这不是架构级阻塞，但它是一个**今天没暴露、明天会暴露**的静默失效点。

## 与 u-nmmq8v 的关系

编码撞车时的 `fiber.state=3`、`fiber.error=null`，与 s3 里「插件 setup 内 emit 失败」的表现**完全一致**。这为「Cordis 把失败放进 fiber 状态而不给错误对象」提供了第二处独立证据——说明它不是某一条路径的偶发行为，而是这个宿主的失败上报方式。
