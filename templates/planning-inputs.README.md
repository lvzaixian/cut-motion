# 统一方案输入

将 `planning-inputs.example.json` 复制到新任务的 `state/planning-inputs.json`，把示例文案、时间、对象与安全区全部替换为当前录音证据。旧任务继续沿用已确认机器真源；缺少新输入或主时间线快照时不批量迁移。

粗剪与倍率确认后，按 `preview_timeline({views:["transcript"]})` 返回顺序保存完整分页到 `state/chatcut-main-timeline.json`。`main-001` 等编号来自 entry 顺序；`:word-001` 是整条 entry 的范围，不能冒充内部逐词时间。保留听校后的措辞，用 `corrections` 或明确的 `releasedTranscript` 输入表达修订；已有人工逐字稿不会被自动覆盖。

优先保留已有 ChatCut 字幕卡片，只在需要调整的段落填写 `captionEdits`，例如 `{"main-001":["今天我要","演示"]}`。可用 `captionTimingPath` 引用已保存的逐词/卡片结果。完整 `captionCues` 和旧 `cueLines` 仍支持，但不要求每期重复填写所有时间。断句继续遵守本地词组、语义、标点、宽度和阅读时长规范；估计分配的短语时间只能用于字幕。

新视觉编排使用 `visualOrchestrationVersion:2` 和 `materials` 登记表。每个 Beat 保留 `visualDecision`、`objectCues`、`materialRefs`、`surfaceTreatment`、不加 MG 原因与观众任务。生成器填机械字段，不替代编辑判断或凭模板名字制造信息增量。

13 类模板按语义选择，结构化 `templateData.items` 的数量不固定。布局按本期观众理解、字幕、PiP、证据和画面安全区确定，不继承固定 280px、固定卡片或旧视频坐标。新受控模板保留语义结构，使用直接叠加、静态箭头/文字与 `motion.reveal`；旧 GSAP 样例继续供图库与旧任务参考，不能宣称两种动效完全相同。证据模板要求登记素材与实际 `imageWidthPx/imageHeightPx`，保持完整图片，焦点角标按原图比例映射。

多元素 MG 在视觉包审阅前填写 `templateData.revealCues`，利用真实逐词查询运行 `prepare-mg-speech-timing.mjs <job> <word-lookup.json> --write`，再运行 `generate-plan.mjs <job> --write`。生成器将实测结果固化为独立 `transcript.timingAnchors`（`main-001:measured-word-001`）及对象可读帧；它们不进入字幕词表。`atStart`/`after` 只适用于与真实词锚足够接近的非口播装饰，结果、数字和关键概念必须绑定其实际词。新增材料或内容后重新生成并审阅。

生成过程以事务方式输出三份方案，并调用现有视觉编排表生成器，包含素材、事实边界及四段对象时序。`review` 保留四个用户决定；批准视觉编排包且媒体锁有效后才运行 `compose-job.mjs`。composition 消费已批准时间，不补查关键词后偷偷修改计划。已进入视觉审阅或后续状态时，`--replace-existing` 也不能改包；先返回 `motion-plan`。该参数只用于显式备份并替换准备阶段的人工输出。

两种 stage helper 留在图库与共享 host 的兼容路径，不绕过新受控 profile、不创建第二个 speaker，也不授权全帧装饰。封面、标题表、末次完整重录、来源帧率与主题目录归档继续遵守本地协议。
