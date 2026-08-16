import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJsonAtomic } from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-creative-approval-"));
const run = (name, argumentsList) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result;
};
const writeJson = (filePath, value) => writeJsonAtomic(filePath, value);

try {
  const source = path.join(temporaryRoot, "source.mov");
  const jobRoot = path.join(temporaryRoot, "job");
  fs.writeFileSync(source, "fixture media");
  const scaffold = spawnSync(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [jobRoot, source, "review", "subtitles"], { encoding: "utf8" });
  if (scaffold.status !== 0) throw new Error(`${scaffold.stdout}\n${scaffold.stderr}`);
  const designSystem = readJson(path.join(jobRoot, "state", "design-system.json"));
  assert.deepEqual(designSystem.axisPolicies.A.overlayZones, ["center", "side"]);
  assert.equal(designSystem.axisPolicies.A.faceCoverPolicy, "viewer-cognition-first");

  const transcriptPath = path.join(jobRoot, "state", "transcript.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), transcriptPath);
  const transcript = readJson(transcriptPath);
  const itemsPath = path.join(temporaryRoot, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(transcript.segments.map((segment, index) => ({
    id: `speech-${index + 1}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: 1,
    evidence: { audioChecked: true, supportsReference: false, note: "Creative approval fixture" }
  }))));
  run("create-transcript-reconciliation.mjs", [jobRoot, "input/source.mov", itemsPath]);

  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "caption-review-plan.example.json"),
    path.join(jobRoot, "captions", "caption-review-plan.json")
  );
  const beats = transcript.segments.map((segment, index) => ({
    id: `caption-${String(index + 1).padStart(3, "0")}`,
    sceneId: "talking-head",
    sourceSegmentIds: [segment.id],
    text: segment.text,
    start: segment.start,
    end: segment.end,
    audioAnchorTime: segment.start,
    axis: "A",
    recipe: "caption-only",
    mgScope: "none",
    intent: "Timed subtitle carries this spoken segment.",
    copyException: "Caption-only beat; spoken copy is carried by timed captions.",
    motionFamily: "editorial",
    transitionFamily: `caption-${index + 1}`,
    components: [],
    microEvents: []
  }));
  writeJson(path.join(jobRoot, "state", "beat-map.json"), {
    duration: 3.2,
    fps: 30,
    captionMode: "subtitles",
    designSystem: "state/design-system.json",
    beats
  });
  fs.writeFileSync(path.join(jobRoot, "docs", "motion-plan.md"), [
    "# Motion Plan",
    "",
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...beats.map((beat) => `| ${beat.start}–${beat.end} | ${beat.text} | A | caption-only | talking-head | captions | ${beat.transitionFamily} |`),
    "",
    "Caption mode: subtitles"
  ].join("\n"));
  fs.writeFileSync(path.join(jobRoot, "docs", "caption-plan.md"), [
    "# 字幕与 MG 审核方案",
    "## 完整字幕切分",
    "| Cue | 时间 | 单行字幕 | 字符数 | 对应 MG |",
    "| --- | --- | --- | --- | --- |",
    "| caption-0001 | 0.00–1.50 | 看看这些特效 | 6 | 无 |",
    "| caption-0002 | 1.50–3.20 | 看看这些动画 | 6 | 无 |",
    "## MG 节点",
    "| 节点 | 时间 / 对应字幕 | 最终上屏原文 | 信息增量 | 动画样式 |",
    "| --- | --- | --- | --- | --- |",
    "## 明确不加 MG 的段落",
    "| 时间 | 原句 | 不加原因 |",
    "| --- | --- | --- |",
    "| 0.00–3.20 | 全部 | 字幕承载完整口播 |"
  ].join("\n"));
  fs.writeFileSync(path.join(jobRoot, "docs", "creative-confirmation.md"), [
    "# 创意确认包",
    "## 用户选择",
    "字幕模式：subtitles",
    "| 项目 | 选择 |",
    "| --- | --- |",
    "| 字幕 | subtitles |",
    "## 逐字稿对齐",
    "录音转写为发布文字依据。",
    "## 逐字稿画面批注",
    "| 批注 | 处理 |",
    "| --- | --- |",
    "| 无 | 无需额外处理 |",
    "## A/B 轴执行规则",
    "| 轴 | 规则 |",
    "| --- | --- |",
    "| A | 仅保留真人与字幕 |",
    "## 分镜动画方案",
    "| 时间 | 处理 |",
    "| --- | --- |",
    "| 0.00–3.20 | caption-only |",
    "### 字幕模式 MG 审核清单",
    "本版本没有 local MG。",
    "### 明确不加 MG 的段落",
    "| 时间 | 原句 | 原因 |",
    "| --- | --- | --- |",
    "| 0.00–3.20 | 全部 | 无新增信息需求 |"
  ].join("\n"));

  const workflowPath = path.join(jobRoot, "state", "workflow.json");
  const workflow = readJson(workflowPath);
  workflow.currentState = "motion-plan";
  workflow.pendingGate = null;
  workflow.roughCutReviewDecision = "manual-approved";
  workflow.captionMode = "subtitles";
  workflow.captionModeSource = "user";
  workflow.captionModeAcknowledged = true;
  workflow.visualAxisMode = "a-axis-overlay";
  workflow.visualAxisModeSource = "user";
  workflow.visualAxisModeAcknowledged = true;
  workflow.referenceScriptAcknowledged = true;
  workflow.gates["rough-cut-review"] = { status: "approved", artifact: "state/chatcut-roughcut.json" };
  writeJson(workflowPath, workflow);
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  assert.deepEqual(confirmation.axisPolicy.A.overlayZones, ["center", "side"]);
  assert.equal(confirmation.axisPolicy.A.faceProtection, "viewer-cognition-first");
  confirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  confirmation.visualAxisModeDecision = { status: "acknowledged", source: "user" };
  confirmation.storyboard.beatCount = beats.length;
  confirmation.review = { required: false, status: "ready" };
  writeJson(confirmationPath, confirmation);

  run("workflow-state.mjs", [
    workflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Validated package after manual rough-cut approval"
  ]);

  const approvedWorkflow = readJson(workflowPath);
  assert.equal(approvedWorkflow.currentState, "motion-plan");
  assert.equal(typeof approvedWorkflow.creativeConfirmationSha256, "string");
  assert.equal(readJson(path.join(jobRoot, "captions", "caption-review-plan.json")).status, "approved");
  assert.equal(readJson(confirmationPath).review.status, "approved");
  assert.equal(approvedWorkflow.history.at(-1).action, "approve-creative");

  for (const faceProtection of ["brief-semantic-only", "required"]) {
    const legacyConfirmationPath = path.join(jobRoot, "state", `creative-confirmation.legacy-${faceProtection}.json`);
    const legacyConfirmation = readJson(confirmationPath);
    legacyConfirmation.axisPolicy.A.overlayZones = ["top", "bottom", "side"];
    legacyConfirmation.axisPolicy.A.faceProtection = faceProtection;
    legacyConfirmation.review.status = "ready";
    writeJson(legacyConfirmationPath, legacyConfirmation);
    const legacyCheck = spawnSync(process.execPath, [
      path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
      legacyConfirmationPath,
      path.join(jobRoot, "docs", "creative-confirmation.md"),
      path.join(jobRoot, "state", "beat-map.json"),
      workflowPath
    ], { encoding: "utf8" });
    assert.equal(legacyCheck.status, 0, `${faceProtection}: ${legacyCheck.stdout}\n${legacyCheck.stderr}`);
  }
  console.log("Creative approval workflow test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
