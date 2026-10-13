# SPEECH SOVEREIGNTY 与 HUMAN 坐标 — BOUNDARY REVIEW

- 日期：2026-10-13
- 性质：**只做 Boundary Review**。未修改任何生产代码，本轮产出仅此一份文档。
- 证据基准：commit `b7e4031`（工作区与 `origin/main` 同步）。
- 上游：`hikari-current.md` §13 待裁决表**第 1 行**（不变量 #4 的读法）与**第 2 行**（`Human → Hikari` 的坐标）。
- **VERDICT = NARROW**：两条都不需要新的产品需求就能裁决——它们是"同一句话的两种读法"与"一句论据站不住"，缺的是表态，不是研究。**本轮不实现任何东西。**

---

## A. 不变量 #4 的读法

### A.1 不变量本身（逐字）

`docs/development/language-tool-use-loop-v1.md` §8「Speech Sovereignty（结构不变量）」的四条：

> - `tool_calls` 非空时，model `content` **不进入** human-visible answer；
> - 一旦成功读取 capability，后续**没有**自由 prose 的 grounded 出口；
> - grounded answer **仅由 deterministic renderer 产生**；
> - **Domain Plugin 不获得 user-facing speaking turn**。

同节 R7.2 指针逐字记录：**第二条与第三条已被收窄**，**第一条与第四条未被触碰**。本轮的争点就是第四条。

### A.2 两种读法（各有具名出处）

| | 主张（逐字） | 出处 |
| --- | --- | --- |
| **读法 A：「谁说话」** | 「**注意这条的措辞**：它不区分「主动说」与「被动说」——它说的是 Domain Plugin **不获得 speaking turn**。今天 Language 之所以合法，是因为说话的是 **Language Plugin 自己**，而 Domain 的判词只是被它转述的材料。」 | `repository-ci-attention-v0-boundary-review.md` §10.2 |
| **读法 B：「谁造句」** | 「**「形成」是这条不变量的对象，不是「搬运」。** 在 B 里，形成文字的是 owner 的 renderer + Language 的 `renderAnswer`；consumer 拿到的是成品，它只有搬运的手，没有造句的嘴。」「第四条与前三條并列，因此**它约束的是「谁造句」**……**上一份 review 把第四条孤立出来读，得到了一个比它所在段落更强的主张。**」 | `outbound-composition-v0-boundary-review.md` §9.4 |

**歧义精确地落在一个名词短语上**：第四条里的 **「user-facing speaking turn」**——A 读作「说话的回合／机会」，B 读作「造句」。两个读法的论据都是文本的：B 靠**并列**（后三条都在讲文字由谁形成），A 靠**字面**（第四条是四条里唯一讲"谁"的，讲的是一个 turn，不是一个造句动作）。

### A.3 为什么现在不痛、何时会痛

- **今天零依赖**（实测）：`src/` 里没有任何一处判断"说话的是人"或"谁获得了说话回合"。四条不变量与今天所有代码相符。
- **会痛的时刻已经写明**：`outbound-composition-v0-boundary-review.md` 自记「**§9.4 那个不变量 #4 的读法分歧**（「形成 vs 搬运」）——**它决定 §12 A 的哪一部分合法**」。也就是说**下一条落在 Domain 一侧的主动能力**会立刻撞上它。

### A.4 建议：取读法 A

依据不在两份评审里，在**宪法**里：

> `principles.md` §15（R1 第一层）：「**领域模块不应自行绕过 Presentation 直接向用户说话。**」

**主语是「说话」，不是「造句」。** 而 `governance-rules-v1.md` R2 规则 3 规定 **MUST 只能来自 R1 的前两层**——R1 第一层的表述取 A 的读法；B 的读法把一个只在前两层之外的文档里出现的区分（「形成 vs 搬运」）提升成了不变量的对象，**这是把低层文档读得比宪法更强**，正是 R2 规则 3 要防的事。

**取 A 的后果**（要说清代价）：更严——Domain 一侧的能力不能靠「文字不是我造句的」来取得对人说话的资格。**今天没有一条这样的能力**，所以代价为零；它约束的是未来。

---

## B. `Human → Hikari` 的坐标

### B.1 现存坐标（逐字）

`outbound-composition-v0-boundary-review.md` §0.5 术语：

> - **入站（inbound）**：组合里的别人 → Language。
> - **出站（outbound）**：Language → 组合里的别人。今天**为零**。

`human-inbound-v0-boundary-review.md` §2.2：

> **`Human → Hikari` 既不在这个「入站」里，也不在这个「出站」里。** 它在两份文档的坐标之外——**这是定义性空白，不是判决。**

### B.2 那个论据站不住（本轮实测）

同节 §2.1 的论据是：

> **三份权威文档**都定义了出站（`principles.md` §15：Domain Result → Presentation → RenderedMessage → Transport），**没有一份为入站写过任何条款**。

实测：三份是 `principles.md` / `core-architecture-v0.md` / `plugin-design-spec.md`。**只有 `principles.md` §15 能逐字对上**；在后两份里搜 `出站|入站|inbound|outbound|RenderedMessage|Transport|Presentation` ——**全 0 命中**。

所以「三份权威文档都定义了出站」这句话**只有三分之一有逐字依据**。**「定义性空白」这个判断本身可能仍然成立，但它现在建立在一个找不到依据的前提上。**

### B.3 为什么现在不痛

- **零依赖**（实测）：没有任何契约以「说话者是人」为成立条件。`src/` 里唯一带 `'human'` 的运行时判别是 CLI 显示层（`src/cli/tui-state.ts` 的 `TranscriptEntry.kind === 'human'`，消费者只有三个 `src/cli/` 文件 + 一个测试）。`src/` 无 `HumanStatement` 类型；`human-delivery` 属交付侧，不是入站。
- **会痛的时刻**：任何需要「证明说话的是人」的能力。

### B.4 建议：先修论据，坐标不扩

**三个选项，我建议 ①+③：**

1. **改正 §2.1 的论据**（无论怎么裁都要做）：把「三份权威文档都定义了出站」改成它实际的样子——`principles.md` §15 定义了出站，另两份**没有**逐字对应。**这是本轮发现的一处缺陷，不需要裁决。**
2. **扩成两轴**（组合内 × 人类面向）。**建议否决**：那会新增一个人可见概念，而今天**零代码依赖**它、也**没有真实 consumer**（R3）。
3. **保留「定义性空白」，但把它降级为「不适用的坐标」而不是「缺一个坐标」**：入站/出站是**组合内部**的坐标（谁 → Language），而人对 Hikari 说话走的是 `human-inbound` 记的两个方向（`Hikari → Human` 与 `Human → Hikari`），**它们是另一条轴**，不是这个坐标的一个洞。**建议取此读法**，因为它不需要发明任何新东西，只是把一个错位的期待放回原位。

---

## 待 Human 裁决

1. **不变量 #4 取读法 A（「谁说话」）还是读法 B（「谁造句」）？** 我建议 **A**，依据是 `principles.md` §15 的主语，加上 R2 规则 3 的层级限制。
2. **`Human → Hikari` 的坐标**：是否按 ①+③ 处理——**改正那处论据**（不需裁决，本轮发现），并把「定义性空白」改述为「**入站/出站是组合内坐标，人对 Hikari 的方向是另一条轴，不属于本坐标**」？还是选 ②（扩成两轴）？

## 本轮不做

不实现任何东西；不改 `src/`；不新增契约；不改四条不变量的原文（任何口径变化按 R7.2 加指针，不改逐字原文）。
