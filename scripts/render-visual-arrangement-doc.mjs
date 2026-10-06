import fs from "node:fs";
import path from "node:path";
import { durationToFrames, quantizeFrameWindow } from "./frame-window-utils.mjs";
import { transcriptWordsById } from "./motion-window-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";
import { isVisualOrchestrationActive, isVisualOrchestrationV2 } from "./visual-orchestration-version.mjs";

const [jobDirectoryArgument] = process.argv.slice(2);
if (!jobDirectoryArgument) {
  console.error("Usage: node render-visual-arrangement-doc.mjs <job-directory>");
  process.exit(64);
}

const jobRoot = path.resolve(jobDirectoryArgument);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(jobRoot, relativePath), "utf8"));
const required = (relativePath) => {
  const absolutePath = path.join(jobRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`${relativePath} is required`);
  return absolutePath;
};
const safe = (value) => String(value ?? "未声明").replaceAll("|", "\\|").replaceAll("\n", " ").trim() || "未声明";
const list = (values, empty = "无") => Array.isArray(values) && values.length > 0
  ? values.map(safe).join("<br>")
  : empty;

required("state/beat-map.json");
required("state/transcript.json");
required("state/creative-confirmation.json");
required("state/workflow.json");
const beatMap = readJson("state/beat-map.json");
if (!isVisualOrchestrationActive(beatMap)) {
  throw new Error("render-visual-arrangement-doc requires visualOrchestrationVersion: 1 or 2");
}
const visualOrchestrationV2 = isVisualOrchestrationV2(beatMap);
const transcript = readJson("state/transcript.json");
const confirmation = readJson("state/creative-confirmation.json");
const workflow = readJson("state/workflow.json");
const fps = Number(beatMap.fps);
const totalFrames = durationToFrames(beatMap.duration, fps);
if (!(fps > 0 && totalFrames > 0)) throw new Error("Beat Map requires positive fps and duration");
const wordsById = transcriptWordsById(transcript);
const materialById = new Map((beatMap.materials ?? []).map((material) => [material.id, material]));
const captionPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
const captionsPath = path.join(jobRoot, "captions", "captions.json");
let captions = [];
if (fs.existsSync(captionPlanPath)) {
  captions = resolveCaptionCues(readJson("captions/caption-review-plan.json"), transcript);
} else if (fs.existsSync(captionsPath)) {
  captions = readJson("captions/captions.json").cues ?? [];
}
const captionsById = new Map(captions.map((cue) => [cue.id, cue]));
const annotationsPath = path.join(jobRoot, "state", "reference-script-annotations.json");
const annotations = fs.existsSync(annotationsPath) ? readJson("state/reference-script-annotations.json").annotations ?? [] : [];
const decisionsByAnnotationId = new Map((confirmation.scriptAnnotations?.decisions ?? []).map((decision) => [decision.id, decision]));

const formatFrame = (value) => {
  if (!Number.isInteger(value) || value < 0) return "未声明";
  const seconds = Math.floor(value / fps);
  const frames = value - seconds * fps;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(frames).padStart(2, "0")} / ${value} 帧`;
};
const frameRange = (startFrame, endFrame) => `${formatFrame(startFrame)} → ${formatFrame(endFrame)}`;
const wordLabel = (wordId) => {
  if (typeof wordId !== "string" || !wordId.trim()) return "未声明";
  const word = wordsById.get(wordId);
  if (!word) return `未解析：${safe(wordId)}`;
  const startFrame = Math.ceil(Number(word.start) * fps - 1e-6);
  return `${safe(word.text)}（${safe(wordId)}；${formatFrame(startFrame)}）`;
};
const captionLabel = (beat) => {
  const ids = beat.captionCueIds ?? [];
  if (ids.length === 0) return "无独立字幕 cue";
  return ids.map((id) => {
    const cue = captionsById.get(id);
    return `${safe(id)}：${safe(cue?.resolvedText ?? cue?.text ?? cue?.lines?.[0] ?? "未解析")}`;
  }).join("<br>");
};
const materialReferenceLabel = (reference) => {
  const material = materialById.get(reference.materialId);
  const asset = material
    ? `${safe(material.id)} / ${safe(material.path)}`
    : `未解析：${safe(reference.materialId)}`;
  return `${asset}<br>用途：${safe(reference.role)}<br>${frameRange(reference.displayStartFrame, reference.displayEndFrame)}<br>裁切：${safe(reference.crop)}；遮罩：${safe(reference.masking)}`;
};
const cueRhythm = (cue) => `${safe(cue.id)}：入场 ${formatFrame(cue.preMotionFrame)}；首次可读 ${formatFrame(cue.firstLegibleFrame)}；落定 ${formatFrame(cue.settledFrame)}；完全隐藏 ${formatFrame(cue.invisibleFrame)}；停留类型 ${safe(cue.holdKind)}`;
const noMgReason = (beat) => safe(beat.noMgReason);
const beats = [...(beatMap.beats ?? [])].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
const localBeats = beats.filter((beat) => beat.mgScope === "local");
const decision = (beat) => beat.visualDecision ?? null;
const supportingWords = (beat) => decision(beat)?.informationDelta?.supportingWordIds ?? decision(beat)?.supportingWordIds ?? [];
const decisionSummary = (beat) => {
  if (beat.mgScope === "none") return `不加 MG 原因：${noMgReason(beat)}`;
  return decision(beat)?.mode === "annotation"
    ? `记忆锚点：${safe(decision(beat).memoryAnchor)}`
    : `信息增量：${safe(decision(beat)?.informationDelta?.statement)}`;
};
const phaseFrame = (state, beat) => {
  const word = wordsById.get(state.anchorWordId);
  const anchorFrame = word ? Math.ceil(Number(word.start) * fps - 1e-6) : null;
  const cueById = new Map((beat.objectCues ?? []).map((cue) => [cue.id, cue]));
  const settledFrames = (state.activeObjectCueIds ?? []).map((cueId) => cueById.get(cueId)?.settledFrame).filter(Number.isInteger);
  return anchorFrame === null ? null : Math.max(anchorFrame, ...settledFrames);
};
const cadenceExceptionsForBeat = (beat) => (beatMap.mgCadenceExceptions ?? [])
  .filter((exception) => exception.coveredNoneBeatIds?.includes(beat.id));

const lines = [
  "# 视觉编排确认包",
  "",
  "> 本文由 `state/beat-map.json` 展开；它是包装前供用户核对的唯一视觉编排表，不是独立的第二份计划。",
  "",
  "## 用户选择",
  "",
  "| 项目 | 当前记录 |",
  "| --- | --- |",
  `| 字幕模式 | ${safe(confirmation.captionMode)} |`,
  `| 视觉轴 | ${safe(confirmation.visualAxisMode)} |`,
  `| 锁定粗剪 | ${safe(workflow.authoritativeMediaPath)}；SHA-256：${safe(workflow.authoritativeMediaSha256)} |`,
  `| 当前包状态 | ${safe(confirmation.review?.status)}；视觉编排决定：${safe(workflow.visualArrangementReviewDecision)} |`,
  "",
  "## 逐字稿对齐",
  "",
  `- 录音转写：\`state/transcript.json\`；当前 Beat Map：\`state/beat-map.json\`；帧率：${fps} fps。`,
  "- 所有时间同时列出 `MM:SS.ff / 帧号`；未在 Beat Map 中声明的值明确写为“未声明”，不以推测补齐。",
  "",
  "## 逐字稿画面批注",
  "",
  "| ID | 原批注 | 处理结果 | 对应 Beat |",
  "| --- | --- | --- | --- |"
];

if (annotations.length === 0) {
  lines.push("| 无 | 无已登记批注 | 不适用 | 无 |");
} else {
  for (const annotation of annotations) {
    const decision = decisionsByAnnotationId.get(annotation.id);
    lines.push(`| ${safe(annotation.id)} | ${safe(annotation.instruction)} | ${safe(decision?.finalTreatment)}（${safe(decision?.disposition)}） | ${list(decision?.beatIds, "未声明")} |`);
  }
}

lines.push(
  "",
  "## A/B 轴执行规则",
  "",
  "| Axis | 信息节奏 | 人物、字幕与证据保护 |",
  "| --- | --- | --- |",
  `| A | ${safe(confirmation.axisPolicy?.A?.accumulation)} | 表面：${safe(confirmation.axisPolicy?.A?.surface?.kind)}；人脸策略：${safe(confirmation.axisPolicy?.A?.faceProtection)} |`,
  `| B | ${safe(confirmation.axisPolicy?.B?.accumulation)} | PiP：${safe(confirmation.axisPolicy?.B?.pip?.protected)}；成组退出：${safe(confirmation.axisPolicy?.B?.groupedExit)} |`,
  ""
);

if (visualOrchestrationV2) {
  lines.push("## 视觉论证决策总览", "");
  for (const mode of ["none", "annotation", "argument", "evidence"]) {
    const modeBeats = beats.filter((beat) => mode === "none" ? beat.mgScope === "none" : decision(beat)?.mode === mode);
    lines.push(`### ${mode}`, "", "| Beat | 模式 | 论证增量 / 记忆锚点 / 不加原因 | 依据与支持词 | 回退 / 节奏例外 |", "| --- | --- | --- | --- | --- |");
    if (modeBeats.length === 0) {
      lines.push("| 无 | 无 | 无 | 无 | 无 |");
    } else {
      for (const beat of modeBeats) {
        const selected = decision(beat);
        const cadence = cadenceExceptionsForBeat(beat)
          .map((exception) => `时间：${safe(exception.start)}–${safe(exception.end)}；coveredNoneBeatIds：${list(exception.coveredNoneBeatIds)}；${safe(exception.reason)}`)
          .join("<br>") || "无";
        const basis = selected?.informationDelta?.basis;
        lines.push(`<!-- visual-decision:${beat.id} -->`);
        lines.push(`| ${safe(beat.id)} | ${mode === "none" ? "none" : safe(selected?.mode)} | ${decisionSummary(beat)} | ${basis ? `依据：${safe(basis)}；` : ""}支持词：${list(supportingWords(beat))} | ${selected ? `回退：${safe(selected.fallback)}` : ""}${selected && cadence !== "无" ? "<br>" : ""}${cadence} |`);
      }
    }
    lines.push("");
  }
}

lines.push(
  "## 完整视觉编排表",
  "",
  "| Beat / 锁定窗口 | 口播与字幕锚点 | 处理方式 | 观众任务 | 视觉方案 | 素材 | 四段节奏 | 审核点 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |"
);

for (const beat of beats) {
  const beatFrames = quantizeFrameWindow(beat.start, beat.end, fps, totalFrames);
  const cues = Array.isArray(beat.objectCues) ? beat.objectCues : [];
  const references = Array.isArray(beat.materialRefs) ? beat.materialRefs : [];
  const treatment = beat.mgScope === "none"
    ? `纯字幕；不加原因：${noMgReason(beat)}`
    : `${safe(beat.axis)}-axis local MG；表面：${safe(beat.surfaceTreatment)}`;
  const visual = beat.mgScope === "none"
    ? "字幕承载口播；无额外 MG。"
    : `主焦点：${safe(beat.visualEncoding)}<br>上屏：${list(beat.onScreenCopy, "未声明")}<br>轴向：${safe(beat.primaryFlowAxis)}；样式：${safe(beat.visualStyle)}；参考：${safe(beat.visualReference)}`;
  const safety = beat.mgScope === "none"
    ? "字幕安全区由字幕层承载。"
    : `字幕安全区：${safe(beat.captionSafeZonePass)}；人脸：${safe(beat.layout?.faceCover)}；人脸理由：${safe(beat.layout?.faceCoverRationale)}；焦点：${safe(beat.layout?.focalPlacement)}；焦点理由：${safe(beat.layout?.focalPlacementRationale)}。`;
  lines.push(`<!-- visual-arrangement-beat:${beat.id} -->`);
  lines.push(`| ${safe(beat.id)} / ${frameRange(beatFrames.startFrame, beatFrames.endFrame)} | ${safe(beat.text)}<br>${captionLabel(beat)}<br>入口：${wordLabel(beat.entryAnchorWordId)}<br>退出：${wordLabel(beat.exitAnchorWordId)} | ${treatment} | ${safe(beat.viewerQuestion)}<br>角色：${safe(beat.supportRole)}<br>删除损失：${safe(beat.removalLoss)} | ${visual} | ${references.length > 0 ? references.map(materialReferenceLabel).join("<hr>") : "无"} | ${cues.length > 0 ? cues.map(cueRhythm).join("<br>") : (beat.mgScope === "none" ? "无 MG" : "未声明")} | ${safety} |`);
}

lines.push(
  "",
  "## 局部 MG 对象展开",
  ""
);
for (const beat of localBeats) {
  const cues = Array.isArray(beat.objectCues) ? beat.objectCues : [];
  const references = Array.isArray(beat.materialRefs) ? beat.materialRefs : [];
  lines.push(`### ${safe(beat.id)}：局部 MG（表面：${safe(beat.surfaceTreatment)}）`);
  lines.push(`<!-- visual-arrangement-local:${beat.id} -->`);
  if (visualOrchestrationV2) {
    const selected = decision(beat);
    lines.push("", "| 决策模式 | 信息增量 / 记忆锚点 | 对象与演进 | 回退 | 素材 |", "| --- | --- | --- | --- | --- |");
    lines.push(`<!-- visual-decision:${beat.id} -->`);
    lines.push(`| ${safe(selected?.mode)} | ${decisionSummary(beat)}<br>依据：${safe(selected?.informationDelta?.basis)}；支持词：${list(supportingWords(beat))} | objectFamily：${safe(selected?.objectFamily)}；visualVerb：${safe(selected?.visualVerb)}；evolutionMode：${safe(selected?.evolutionMode)} | ${safe(selected?.fallback)} | ${references.length > 0 ? references.map((reference) => safe(reference.materialId)).join("<br>") : "无"} |`);
    if (Array.isArray(selected?.argumentStates)) {
      const cueById = new Map(cues.map((cue) => [cue.id, cue]));
      lines.push("", "| 状态 | 锚点 / 相位 | 操作 | 活跃 cue | 状态变化 / 可读性 | cue 时序 |", "| --- | --- | --- | --- | --- | --- |");
      for (const state of selected.argumentStates) {
        lines.push(`<!-- visual-argument-state:${beat.id}:${state.id} -->`);
        lines.push(`| ${safe(state.id)} | ${wordLabel(state.anchorWordId)}<br>相位：${formatFrame(phaseFrame(state, beat))} | ${safe(state.operation)} | ${list(state.activeObjectCueIds)} | ${safe(state.stateChange)}<br>可读性：${safe(state.readability)} | ${(state.activeObjectCueIds ?? []).map((cueId) => cueRhythm(cueById.get(cueId) ?? { id: cueId })).join("<br>")} |`);
      }
    }
  }
  lines.push("", "| 对象 / 角色 | 语义绑定 | 四段时序 | 内容与位置 | 动作与信息价值 |", "| --- | --- | --- | --- | --- |");
  if (cues.length === 0) {
    lines.push("| 未声明 | 未声明 | 未声明 | 未声明 | 未声明 |");
  } else {
    for (const cue of cues) {
      lines.push(`<!-- visual-arrangement-cue:${beat.id}:${safe(cue.id)} -->`);
      lines.push(`| ${safe(cue.id)} / ${safe(cue.semanticRole)} | 触发：${wordLabel(cue.spokenTriggerWordId)}<br>退出：${wordLabel(cue.exitTriggerWordId)} | 入场：${formatFrame(cue.preMotionFrame)}<br>首次可读：${formatFrame(cue.firstLegibleFrame)}<br>落定：${formatFrame(cue.settledFrame)}<br>完全隐藏：${formatFrame(cue.invisibleFrame)}<br>停留类型：${safe(cue.holdKind)} | 上屏：${list(beat.onScreenCopy, "未声明")}<br>焦点：${safe(beat.layout?.focalPlacement)}；字幕安全区：${safe(beat.captionSafeZonePass)} | 样式：${safe(beat.visualStyle)}<br>角色：${safe(beat.supportRole)}；删除损失：${safe(beat.removalLoss)} |`);
    }
  }
  lines.push("", "| 素材引用 | 展示窗口 | 裁切 / 遮罩 | 事实边界 |", "| --- | --- | --- | --- |");
  if (references.length === 0) {
    lines.push("| 无 | 无 | 无 | 无 |");
  } else {
    for (const reference of references) {
      const material = materialById.get(reference.materialId);
      lines.push(`<!-- visual-arrangement-material-ref:${beat.id}:${safe(reference.materialId)} -->`);
      lines.push(`| ${safe(reference.materialId)} / ${safe(material?.path)} | ${frameRange(reference.displayStartFrame, reference.displayEndFrame)} | ${safe(reference.crop)} / ${safe(reference.masking)} | 可见事实：${list(material?.visibleFacts, "未声明")}<br>禁止推断：${list(material?.forbiddenInferences, "未声明")} |`);
    }
  }
  lines.push("");
}

lines.push("## 素材事实边界", "");
if (!Array.isArray(beatMap.materials) || beatMap.materials.length === 0) {
  lines.push("无已登记素材。", "");
} else {
  for (const material of [...beatMap.materials].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`### ${safe(material.id)}`);
    lines.push(`<!-- visual-arrangement-material:${safe(material.id)} -->`);
    lines.push("", "| 路径 / 类型 | 来源与隐私 | 可见事实 | 禁止推断 |", "| --- | --- | --- | --- |");
    lines.push(`| ${safe(material.path)} / ${safe(material.kind)} | ${safe(material.sourceOrRights)} / ${safe(material.privacyStatus)} | ${list(material.visibleFacts, "登记为空")} | ${list(material.forbiddenInferences, "登记为空")} |`, "");
  }
}

lines.push(
  "## 分镜动画方案",
  "",
  "上述完整表逐 Beat 覆盖字幕与局部 MG；局部 MG 的对象、素材、事实边界与四段节奏以对象展开表为准。",
  "",
  "## 审核决定",
  "",
  "- 请确认：每段的素材位置、是否保持纯字幕、上屏文案、对象出现时机及阅读停留是否符合口播表达。",
  "- 如需改动，返回 `motion-plan` 更新 Beat Map 后重新生成本包；本文件不自行修改机器真源。",
  ""
);

const outputPath = path.join(jobRoot, "docs", "creative-confirmation.md");
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Visual arrangement package written: ${outputPath}`);
