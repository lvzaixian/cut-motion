# 视觉编排与口播包装升级规范

**状态：** 已确认的设计规范；实现前的唯一长期 Markdown 依据。
**适用范围：** 此规范适用于之后新建、采用 `talking-head-opinion-poster-v2` 的中文口播任务；历史已完成任务保持原有记录与可重渲染能力。
**不在本轮范围：** 自动生成“高级感”评分、替代用户审美判断、或制作视觉方案对比样片。后者在用户要求时，基于本规范另行生成。

## 1. 目标与问题边界

本次升级解决三个已验证的工作流缺口：

1. 粗剪锁定后，用户还看不到完整的动画、素材与纯字幕编排，就会进入正式包装；
2. `beat-map` 的计划时序与模块内实际 GSAP 时序可以各自变化，造成画面提前、迟退、停留过长或与口播错词；
3. 口播包装缺少一套足够克制、可复用、可检查的视觉语法，容易出现大面积墨色/玻璃背板、无意义位移和不一致的高冲击动效。

目标不是增加更多动画，而是建立一条可追溯的闭环：

```text
已确认粗剪
  → 视觉编排表
  → 用户确认视觉编排
  → 可执行对象级时序
  → 抽帧与运行时核验
  → 正式包装与渲染
```

`state/beat-map.json` 仍是机器时序真源；`docs/creative-confirmation.md` 是从它展开、供用户阅读与确认的唯一视觉编排表。不得再新建一份独立的“方案表”来重复记录同一事实。

## 2. 新的包装前检查点

### 2.1 状态路径

对采用本规范的新任务，状态路径调整为：

```text
rough-cut-export → motion-plan → visual-arrangement-review → composition → render
```

- `motion-plan`：生成并通过机器校验的 Beat Map、字幕方案、素材映射和视觉编排确认包；
- `visual-arrangement-review`：在正式写 MG 模块前，向用户展示完整视觉编排表；
- `composition`：仅在视觉编排已确认且指纹仍匹配时可进入；
- `revise-visual-arrangement`：返回 `motion-plan`，重新生成表格、素材映射和批准指纹；
- 字幕切分、MG 节点、上屏文案、素材、视觉语法、轴向或对象级时序发生变化，都属于方案变化，必须重新经过此检查点；只有不改变这些内容的小范围位置、尺寸、色值或缓动参数调整，才可从 `composition` 定向返工。

### 2.2 决策规则

| 工作流模式 | 视觉编排如何通过 | 不允许的情况 |
| --- | --- | --- |
| `review`（默认） | 仅用户可执行 `approve-visual-arrangement`；`visualArrangementReviewDecision` 记录为 `manual-approved`，并附带查看后的决定或修改意见。 | Agent 内部检查、沉默、或只创建文件都不能通过。 |
| `auto` | 仅当用户已明确为该任务选择 `auto` 时，`visualArrangementReviewDecision` 记录为 `automatic-accepted`；仍执行同一套结构、时序与素材校验。 | 将普通 `review` 静默降级为自动通过。 |
| 历史任务 | 保留原状态与现有审批记录；不补造新的用户决定。 | 因引入新规范而阻断已完成任务的只读、重渲染或交付核验。 |

`approve-creative` 保留为 Agent 的结构与指纹校验，不再能绕过用户的视觉编排决定。视觉表、Beat Map、字幕计划或素材哈希任一变化后，旧的视觉确认必须失效。

## 3. 视觉编排确认包

### 3.1 文件职责

| 文件 | 职责 | 真源关系 |
| --- | --- | --- |
| `state/beat-map.json` | 帧级时序、词锚、节点、对象 cue、素材引用、布局与信息角色。 | 机器真源。 |
| `state/creative-confirmation.json` | 当前包的工作流决定、来源与指纹。 | 绑定并保护真源。 |
| `docs/creative-confirmation.md` | 对外标题为“视觉编排确认包”；完整、可读、可审核的表格。 | 由上述状态逐项生成/核对，不独立改写事实。 |
| `docs/motion-plan.md` | 供制作人员阅读的浓缩 Beat 说明。 | 不取代确认包。 |

确认包要覆盖**每一个 Beat**，包括“口播 + 字幕、不加 MG”的段落；不能只列动画节点。表中的时间统一采用 `MM:SS.ff / 帧号（fps）`，与锁定粗剪哈希绑定。

### 3.2 全片总览表（每 Beat 一行）

`docs/creative-confirmation.md` 必须包含 `## 完整视觉编排表`，并至少含以下列：

| 字段 | 要求 |
| --- | --- |
| Beat / 锁定窗口 | Beat ID、起止帧、时码、对应粗剪版本。 |
| 口播与字幕锚点 | 原话摘要、字幕 cue、入口词和退出词。 |
| 处理方式 | `纯字幕`、`A-axis local MG` 或 `B-axis stage`；纯字幕必须说明“不加”的具体理由。 |
| 观众任务 | 此刻帮助观众理解、比较、举证、校准、组织、行动或收束什么。 |
| 视觉方案 | 单一主焦点、信息结构、精确上屏原文、轴向与安全区。 |
| 素材 | 无素材时明确写“无”；有素材时列出资产 ID、相对路径、用途、裁切/遮罩与展示窗口。 |
| 四段节奏 | 入场、首次可读、落定、静态阅读、离场/完全隐藏的帧号和对应锚词。 |
| 审核点 | 字幕/人脸/手势/证据/平台 UI 避让，及用户需判断的主观问题。 |

### 3.3 MG 展开表（每个 local MG 一节）

每个 `mgScope: local` Beat 另列一个紧凑展开表，不能用“大约从这里开始”代替对象时序：

| 字段 | 要求 |
| --- | --- |
| 对象 | 稳定 ID 与语义角色，例如 `primary-copy`、`comparison-node`、`evidence-image`、`connector`。 |
| 语义绑定 | `spokenTriggerWordId`、触发词、`exitTriggerWordId`、退出词。 |
| 实际时间 | `preMotionFrame`、`firstLegibleFrame`、`settledFrame`、`invisibleFrame`。 |
| 内容与位置 | 实际显示的文字/资产、焦点位置、与字幕/人脸/证据的避让。 |
| 动作 | 固定动效语法、缓动、入场/停留/离场长度。 |
| 信息价值 | `supportRole`、当前观众问题、`removalLoss`、仍帧可理解的内容。 |

“首次可读”是观众无需依赖运动即可读到核心信息的第一帧；“落定”是布局完成、可稳定阅读的第一帧；它们不能被容器出现或透明度尚低的帧替代。

### 3.4 V2 视觉论证决策

`visualOrchestrationVersion: 2` 的计划先决定 `none`、`annotation`、`argument` 或 `evidence`，再选择如何运动。`none` 是有效结果：没有被口播或登记素材支持的信息增益时，保持口播加字幕；`mgCadenceExceptions.coveredNoneBeatIds` 只能如实记录这类范围，不能把它改写成凑节奏的 MG。

规划与复核时，`argument` 必须让同一对象族贯穿 3–4 个有词锚的可读状态；`evolve` 只用于 2.4–4.5 秒的因果序列。`evidence` 必须受已登记素材的可见事实和禁止推断边界约束。确定性检查器验证声明的结构、锚点、状态顺序、素材和覆盖关系；既有 `visual-arrangement-review` 在合成前判断计划的构图、节奏、字形和阅读路线，合成后的实际包装仍由既有抽帧/帧级 QA 复核。示例和非目标见 [视觉论证决策设计说明](design/2026-08-21-visual-argument-decision-design.md)。

## 4. 素材、隐私与事实边界

素材不再只存在于自由文本。`state/beat-map.json` 增加受控资产登记与引用：

```json
{
  "materials": [
    {
      "id": "token-usage-record",
      "path": "input/token-usage-record.png",
      "kind": "screenshot",
      "sha256": "<file hash>",
      "sourceOrRights": "user-provided",
      "privacyStatus": "approved-with-mask",
      "visibleFacts": ["个人 Token 使用记录"],
      "forbiddenInferences": ["收入归因", "平台或时间推断"]
    }
  ],
  "beats": [
    {
      "id": "b06",
      "materialRefs": [
        {
          "materialId": "token-usage-record",
          "role": "primary-evidence",
          "displayStartFrame": 2738,
          "displayEndFrame": 2833,
          "crop": "contain",
          "masking": "account-name-and-product-mark"
        }
      ]
    }
  ]
}
```

实现要求：

- 素材文件必须位于任务 `input/` 内；路径不能逃逸任务目录，SHA-256 必须匹配；
- `sourceOrRights` 与 `privacyStatus` 未批准时不得进入 `composition`；
- `visibleFacts` 是画面能支持的唯一事实范围；`forbiddenInferences` 必须同时进入确认包，避免截图因相邻摆放而暗示收入、因果、平台、日期或币种；
- 每一项引用必须有明确对应口播、展示窗口、裁切与遮罩说明；无素材的 MG 仍要登记为空数组，而不是遗漏字段。逐项检查请求的素材在实际编码画面中是否完整出现、是否跨占后一个观点；同组证明图按阅读顺序逐张展开并统一退出，时长与相邻素材协调，不能为了塞全而长期占屏；
- 真实证据优先直接呈现；不够支持的内容不以“概念卡片”伪造成证据。

### 4.1 完整截图与同组阅读预算

执行 [无脚本口播与截图编排规范](unscripted-talking-head-standard.md) 第 4–7 节；此处截图规则也适用于有参考稿的任务。素材入场先逐项说明采用或不采用的去向，个人规划、饮食、健身、录取与复盘截图默认全图等比呈现，仅遮实际敏感字段；局部裁切必须有明确阅读收益并保留全图上下文。源图与源像素遮罩共同变换，不能用切碎图片代替隐私处理。

在既有 `viewerQuestion` / `visualEncoding` / `materialRefs` 中说明是概貌确认、同组规模展示还是细节阅读。按最具体的口播词安排同组子图入场，分别预算逐张间隔、完全建组、最后整组稳定停留及统一退出；读细节不能借快速堆叠宣称可读完，完整图也不能因此长驻占住后续观点。位置与大小按手机观看尺度和字幕安全区检查，不固定继承本期秒数或坐标。

这些说明与时序须从 Beat Map 进入现有生成确认表；仅改模板或生成后的 Markdown 不算落实。首个复杂截图组或已发现的遮罩、重叠、时序风险允许一次最小实际编码上下文诊断，不扩大为默认整片二次 QA，也不新增用户审批点。

## 5. 对象级语义时序

### 5.1 必须记录的 cue

每个采用 `thoughtful-editorial-v1` 的视觉对象记录以下字段，并由构建器传给模块实际使用：

```json
{
  "id": "primary-claim",
  "semanticRole": "primary-copy",
  "spokenTriggerWordId": "w-204",
  "preMotionFrame": 2480,
  "firstLegibleFrame": 2483,
  "settledFrame": 2494,
  "exitTriggerWordId": "w-219",
  "invisibleFrame": 2552
}
```

约束：

- 非语义的预备动作最多可在触发词前 3 帧开始；核心文字、数字、关系或证据不得在触发词开始前泄露；
- `firstLegibleFrame` 必须在触发词开始至其后 6 帧内；
- 同一 `revealGroup` 的连接线和目标容器相差不超过 2 帧；
- 非证据类 A 轴对象的 `invisibleFrame - preMotionFrame` 默认不超过 3.5 秒；
- 超过 3.5 秒只允许 `evidence-reading`、`causal-sequence`、`rhetorical-pause` 三种 `longHoldReason`，并且必须写最大帧数和退出词；
- 下一独立观点的主信息组第一次可读前，前一 A 轴主信息组必须完全隐藏；同一证据组的多张截图可作为子对象依次展开、累积呈现并统一退出，不把每张截图另建为独立主信息组。B 轴跨对象的累积仍限于同一语义页；词锚、阅读时间和安全区检查照常执行。

### 5.2 单一可执行时序

计划中的 cue 不能只写在 JSON：

1. 构建器把当前 Beat 的命名 cue 注入一个受控 `motion` 调度器；模块只能以 `motion.set()` / `motion.to()` 和 cue ID 排定内容性动作，不能再以 `beat.start + 常数` 作为内容时序；
2. 模块只控制带 `data-cue-id` 的子对象，根节点的显示与最终退出由构建器统一控制；模块自行提前淡出根节点是阻断错误；
3. 构建与校验必须证明：每个声明 cue 都在实际时间线被使用，实际退出未早于声明对象的 `invisibleFrame`，且不存在未声明的内容性时间点；
4. 抽帧点从实际 cue 取得：入场、首次可读、落定/停留、退出。仅从 Beat 大窗口抽样不构成验证。

这里不引入通用 JavaScript 解析器。最小实现是由构建器提供 `at("cue-id", "phase")` 与受控 `motion` 调度器，静态拒绝新 profile 模块中裸露的 `timeline`、`root` 和 `beat` 调度；再用小型真实回归覆盖提前淡出、错词触发与漏用 cue。未声明该 profile 的历史模块继续按旧契约重建。

## 6. 口播的编辑型动效语法

默认视觉 profile 为 `thoughtful-editorial-v1`。它适用于有观点、解释或经验分享的真人口播：清晰、克制、以信息顺序组织注意力，而不追求“屏幕一直在动”。

### 6.1 默认只使用四类处理

1. **关键词标注**：排版层级、细下划线、删线、轻量色块或强调色；
2. **关系/对照**：线、箭头、二到三个节点、前后状态或简单比较；
3. **真实证据**：截图、录屏或文件的直接展示，配必要遮罩；
4. **章节与结论**：编号、细线、单一重点词或短结论。

优先直接叠在实拍上。若实拍背景使阅读困难，先改变位置与字形边缘处理；只有密集的真实证据才使用贴合内容本体的小范围浅承载层。

### 6.2 默认禁止与例外

默认禁止：

- 墨色大背板、大面积深灰/玻璃灰罩、全屏模糊或雾化；
- 弹跳、果冻、持续漂浮、无语义旋转、无信息含义的缩放；
- `slam`、`clash`、`stamp`、`flip` 等高冲击动作；
- 假 UI、装饰英文、无信息卡片和持续背景动效；
- 为了“热闹”而与字幕重复同一句话。

只有明确的反驳、否定、真实冲突或情绪峰值，才能申请一次高冲击动作；确认包必须写明它服务的口播句、语义收益和替代方案为何不足。它不能成为整支视频的默认节奏。

### 6.3 60fps 时间预算

以下为本工作流对口播的内部帧数规范。它借鉴交互动效中“有目的、短、分层、退出更轻”的原则，但不把 UI 的毫秒值机械照搬为视频镜头时长。

| 类型 | 入场 | 稳定可读 | 离场 | 默认总可见 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| 关键词/轻强调 | 8–12 帧 | 30–54 帧 | 5–8 帧 | 0.9–1.5 秒 | 只服务一个词或判断。 |
| 二元对照/短关系 | 10–15 帧；子项错开 4–7 帧 | 48–90 帧 | 6–10 帧 | 1.5–2.5 秒 | 先建立关系，再让观众读。 |
| 小型结构图 | 12–18 帧，按阅读顺序 | 60–108 帧 | 8–12 帧 | 2.0–3.4 秒 | 只含一个主链。 |
| 章节牌/结论牌 | 8–12 帧 | 18–30 帧 | 5–8 帧 | 不超过 1.0 秒 | 不做大卡片停留。 |
| 简单真实证据 | 直接切换或 8–15 帧淡入 | 由移动端读图决定 | 6–12 帧 | 1.8–2.6 秒 | 显示事实，不替证据做戏。 |
| 密集真实证据 | 8–15 帧淡入 | 由可读性决定 | 6–12 帧 | 2.5–3.5 秒 | 超出时必须按长停留例外记录。 |
| B 轴信息页 | 12–24 帧按层级建立 | 由阅读任务决定 | 成组离场 | 通常 2.5–4.5 秒 | 仅用于真正需要全画面结构的内容。 |

入口一般使用轻快的 `ease-out`，退出使用比入口短的 `ease-in`；只有原位重组才使用 `ease-in-out`。同一语义角色复用同一动效语法；多个对象按阅读顺序错开，不同时抢首焦点。

## 7. 视觉 QA 与真实验收

机器检查只拦截客观失败；“是否高级”仍由用户的视觉判断决定。

### 7.1 包装前

- 结构检查：所有 Beat 都有确认包行；所有 local MG 都有对象 cue；所有引用素材都有路径、哈希、隐私状态、事实边界与展示窗口；
- 时序检查：cue 与词级转写对齐、长停留例外合法、A 轴替换完整、无早泄露/迟退；
- 风格检查：A 轴承载层不是大面积深色背板；透明度、面积、模糊、文字对比和平台安全区符合本规范；
- 用户检查：阅读完整表，确认素材位置、动画类型、语义时机和“哪些段落保持纯字幕”。

### 7.2 包装后、正式渲染前

每个 MG 必须至少检查四个实际帧：入场、首次完整可读/峰值、稳定停留、离场。审核以下内容：

- 口播锚词到首次可读是否自然；
- 字幕、人脸、关键手势、证据素材与平台 UI 是否互相遮挡；
- 单帧是否仍有一个明确主焦点；
- 静音观看时，关系、证据或结构是否仍读得懂；
- 1×速度观察语义同步，0.5×速度观察早入、晚退与突兀切换；
- 真实移动端尺寸下，文字是否可读、证据是否有足够阅读时间。

复杂实拍上的文字对比以 [WCAG 2.2 Contrast Minimum](https://www.w3.org/TR/WCAG22/#contrast-minimum) 的 4.5:1 作为内部目标；大号文字至少达到 3:1。优先用位置、轻描边、柔阴影或贴合字形的局部 halo，不能以整块墨色底板粗暴解决。

## 8. 封面静帧数量

新的 `talking-head-opinion-poster-v2` **2.1.0** Intake 包必须提供**恰好 24 张**来自未剪原片的原始静帧供用户挑选。用户仍只从其中选一张，随后生成**恰好 6 张**完整正式封面图；底图、裁切和固定视觉语法不变。

兼容规则：

- 历史 V1 与已存在的 V2.0 封面包继续要求 8 张，避免已完成任务失效；
- 新建 V2.1 的运行时检查器、Schema、脚手架、现行文档、工作区协议与测试夹具全部以 24 为准；
- 24 不是“至少 24”：23、25 或混入剪后帧都应被拒绝；
- 正式封面候选数仍是 6，不随选帧数量变化。

## 9. 实施范围与验收标准

本规范落地时必须完成以下可验证变更：

1. 状态机新增 `visual-arrangement-review`，默认 `review` 任务未经用户确认无法进入 `composition`；修订能回到 `motion-plan` 并使旧指纹失效；
2. `creative-confirmation.md` 升级为完整视觉编排确认包，并与 Beat Map、素材登记和确认指纹逐项对齐；
3. Beat Map 与构建器拥有同一套命名对象 cue；模块无法提前淡出根节点，实际 GSAP 排程可由 cue 审核；
4. 为素材路径/哈希/隐私/事实边界/展示窗口添加最小结构校验；
5. 为暗色大背板、透明度/面积越界、错词触发、长停留和模块提前退出添加可重复的回归；
6. 新建 `talking-head-opinion-poster-v2` 2.1.0 的 24 张静帧契约在 checker、Schema、模板、文档和测试中一致，历史 V1/V2.0 的 8 张兼容保持有效；
7. 至少用 `b01`、`b09`、`b20` 这三种已有失败形态建立回归：提前根节点退出、对象早于口播词出现、计划末端仍有内容却已消失。

## 10. 设计依据

- [Apple Human Interface Guidelines — Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：动效应有目的、简短且精确；没有信息含义的位移应优先淡出；
- [Atlassian Motion — Applying Motion](https://atlassian.design/foundations/motion/applying-motion)：入口按来源建立层级，退出比入口更短，并保持相同角色的一致性；
- [IBM Carbon — Motion Overview](https://carbondesignsystem.com/elements/motion/overview/) 与 [Choreography](https://v10.carbondesignsystem.com/guidelines/motion/choreography/)：动效服务理解而非装饰，避免 bounce/stretch/突兀停顿，按阅读顺序分层出现；
- [W3C WCAG 2.2 — Contrast Minimum](https://www.w3.org/TR/WCAG22/#contrast-minimum) 与 [G145](https://www.w3.org/WAI/WCAG22/Techniques/general/G145.html)：复杂背景上通过局部处理确保文字可读，而不是默认覆盖整幅画面；
- [W3C — Animation from Interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)：避免非必要持续运动与可能干扰理解的动画。

这些资料提供的是层级、注意力和可读性原则；本规范中的 60fps 帧数、口播语义锚定和包装验收是针对 Cut Motion 竖屏口播的内部推导。
