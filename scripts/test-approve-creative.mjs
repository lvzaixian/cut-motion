import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCreativeAuthorities,
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-creative-approval-"));
const run = (name, argumentsList) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result;
};
const fail = (name, argumentsList, pattern) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], { encoding: "utf8" });
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
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
  const creativeConfirmationSchema = readJson(path.join(repositoryRoot, "schemas", "creative-confirmation.schema.json"));
  const reapprovalFields = creativeConfirmationSchema.properties.changeControl.properties.reapprovalFields.items.enum;
  for (const field of ["mg-cadence", "focal-placement", "face-cover-rationale"]) {
    assert.ok(reapprovalFields.includes(field), `creative confirmation schema must permit ${field}`);
  }

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
  assert.equal(workflow.visualArrangementReviewRequired, true);
  assert.equal(workflow.visualArrangementReviewDecision, "pending");
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
  assert.equal(confirmation.axisPolicy.A.surface.kind, "direct-overlay");
  assert.deepEqual(confirmation.axisPolicy.A.surface.opacityRange, [0, 0]);
  assert.equal(confirmation.axisPolicy.A.surface.backdropBlurPx, 0);
  confirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  confirmation.visualAxisModeDecision = { status: "acknowledged", source: "user" };
  confirmation.storyboard.beatCount = beats.length;
  confirmation.review = { required: false, status: "ready" };
  writeJson(confirmationPath, confirmation);

  const flaggedNoV1Job = path.join(temporaryRoot, "flagged-no-v1");
  fs.cpSync(jobRoot, flaggedNoV1Job, { recursive: true });
  fail("check-creative-confirmation.mjs", [
    path.join(flaggedNoV1Job, "state", "creative-confirmation.json"),
    path.join(flaggedNoV1Job, "docs", "creative-confirmation.md"),
    path.join(flaggedNoV1Job, "state", "beat-map.json"),
    path.join(flaggedNoV1Job, "state", "workflow.json")
  ], /visualOrchestrationVersion.*1/i);
  fail("workflow-state.mjs", [
    path.join(flaggedNoV1Job, "state", "workflow.json"),
    "approve-creative",
    "--actor", "agent",
    "--note", "Flagged jobs require the visual orchestration contract"
  ], /visualOrchestrationVersion.*1/i);
  delete workflow.visualArrangementReviewRequired;
  delete workflow.visualArrangementReviewDecision;
  delete workflow.gates["visual-arrangement-review"];
  writeJson(workflowPath, workflow);

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
  assert.equal(computeCreativeAuthorities(jobRoot, "subtitles").designSystem.path, "state/design-system.json");
  assert.doesNotThrow(() => assertCreativeAuthorities(jobRoot, approvedWorkflow));
  const shortDesignSystemPath = path.join(jobRoot, "state", "design-system.json");
  const shortDesignSystem = readJson(shortDesignSystemPath);
  shortDesignSystem.authorityDriftFixture = true;
  writeJson(shortDesignSystemPath, shortDesignSystem);
  assert.throws(() => assertCreativeAuthorities(jobRoot, approvedWorkflow), /Creative authority drift: designSystem/);
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), shortDesignSystemPath);

  const visualPackageJob = path.join(temporaryRoot, "visual-package-authority");
  fs.cpSync(jobRoot, visualPackageJob, { recursive: true });
  const visualPackageWorkflowPath = path.join(visualPackageJob, "state", "workflow.json");
  const visualPackageConfirmationPath = path.join(visualPackageJob, "state", "creative-confirmation.json");
  const visualPackageBeatMapPath = path.join(visualPackageJob, "state", "beat-map.json");
  const visualPackageDocumentPath = path.join(visualPackageJob, "docs", "creative-confirmation.md");
  const visualPackageMaterialPath = path.join(visualPackageJob, "input", "evidence", "fixture-evidence.png");
  fs.mkdirSync(path.dirname(visualPackageMaterialPath), { recursive: true });
  fs.writeFileSync(visualPackageMaterialPath, "fixture evidence");
  const visualPackageBeatMap = readJson(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"));
  visualPackageBeatMap.visualOrchestrationVersion = 1;
  visualPackageBeatMap.materials = [{
    id: "fixture-evidence",
    path: "input/evidence/fixture-evidence.png",
    kind: "screenshot",
    sha256: sha256File(visualPackageMaterialPath),
    sourceOrRights: "user-provided",
    privacyStatus: "approved-with-mask",
    visibleFacts: ["Fixture evidence image supplied for the visual-package contract."],
    forbiddenInferences: ["Do not infer a platform, date, amount, or causal relationship."]
  }];
  for (const [index, beat] of visualPackageBeatMap.beats.entries()) {
    beat.motionProfile = "thoughtful-editorial-v1";
    beat.surfaceTreatment = index === 0 ? "evidence-surface" : "direct-overlay";
    beat.materialRefs = index === 0 ? [{
      materialId: "fixture-evidence",
      role: "primary-evidence",
      displayStartFrame: 12,
      displayEndFrame: 30,
      crop: "contain",
      masking: "mask any account identifier"
    }] : [];
    beat.objectCues = [{
      id: "primary-copy",
      semanticRole: "primary-copy",
      spokenTriggerWordId: index === 0 ? "seg-001:word-002" : "seg-002:word-002",
      preMotionFrame: index === 0 ? 11 : 56,
      firstLegibleFrame: index === 0 ? 12 : 57,
      settledFrame: index === 0 ? 18 : 63,
      exitTriggerWordId: index === 0 ? "seg-001:word-003" : "seg-002:word-003",
      invisibleFrame: index === 0 ? 45 : 96,
      holdKind: "standard"
    }];
  }
  writeJson(visualPackageBeatMapPath, visualPackageBeatMap);
  fs.writeFileSync(path.join(visualPackageJob, "docs", "motion-plan.md"), [
    "# Motion Plan",
    "",
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...visualPackageBeatMap.beats.map((beat) => `| ${beat.start}–${beat.end} | ${beat.text} | ${beat.axis} | ${beat.primaryFlowAxis} | ${beat.visualReference} | ${beat.visualStyle} | ${beat.transitionFamily} |`),
    "",
    "Caption mode: subtitles"
  ].join("\n"));
  const visualPackageWorkflow = readJson(visualPackageWorkflowPath);
  visualPackageWorkflow.currentState = "motion-plan";
  visualPackageWorkflow.pendingGate = null;
  visualPackageWorkflow.roughCutReviewDecision = "manual-approved";
  visualPackageWorkflow.captionMode = "subtitles";
  visualPackageWorkflow.captionModeSource = "user";
  visualPackageWorkflow.captionModeAcknowledged = true;
  visualPackageWorkflow.visualAxisMode = "b-axis-stage";
  visualPackageWorkflow.visualAxisModeSource = "user";
  visualPackageWorkflow.visualAxisModeAcknowledged = true;
  visualPackageWorkflow.referenceScriptAcknowledged = true;
  visualPackageWorkflow.visualArrangementReviewRequired = true;
  visualPackageWorkflow.visualArrangementReviewDecision = "pending";
  visualPackageWorkflow.gates["rough-cut-review"] = { status: "approved", artifact: "state/chatcut-roughcut.json" };
  visualPackageWorkflow.gates["visual-arrangement-review"] = { status: "not-reached" };
  writeJson(visualPackageWorkflowPath, visualPackageWorkflow);
  const visualPackageConfirmation = readJson(visualPackageConfirmationPath);
  visualPackageConfirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  visualPackageConfirmation.visualAxisMode = "b-axis-stage";
  visualPackageConfirmation.visualAxisModeDecision = { status: "acknowledged", source: "user" };
  visualPackageConfirmation.storyboard.beatCount = visualPackageBeatMap.beats.length;
  visualPackageConfirmation.review = { required: false, status: "ready" };
  visualPackageConfirmation.authorities = {};
  writeJson(visualPackageConfirmationPath, visualPackageConfirmation);

  run("render-visual-arrangement-doc.mjs", [visualPackageJob]);
  const generatedVisualPackage = fs.readFileSync(visualPackageDocumentPath, "utf8");
  const firstVisualBeatMarker = "<!-- visual-arrangement-beat:support-001 -->";
  assert.ok(generatedVisualPackage.includes(firstVisualBeatMarker));
  const secondVisualBeatMarker = "<!-- visual-arrangement-beat:support-002 -->";
  const firstVisualBeatStart = generatedVisualPackage.indexOf(firstVisualBeatMarker);
  const secondVisualBeatStart = generatedVisualPackage.indexOf(secondVisualBeatMarker);
  assert.ok(firstVisualBeatStart >= 0 && secondVisualBeatStart > firstVisualBeatStart);
  fs.writeFileSync(
    visualPackageDocumentPath,
    `${generatedVisualPackage.slice(0, firstVisualBeatStart)}${generatedVisualPackage.slice(secondVisualBeatStart)}`
  );
  const expectedVisualAuthorities = computeCreativeAuthorities(visualPackageJob, "subtitles");
  const visualPackageConfirmationWithAuthorities = readJson(visualPackageConfirmationPath);
  visualPackageConfirmationWithAuthorities.authorities = expectedVisualAuthorities;
  writeJson(visualPackageConfirmationPath, visualPackageConfirmationWithAuthorities);
  fail("check-creative-confirmation.mjs", [
    visualPackageConfirmationPath,
    visualPackageDocumentPath,
    visualPackageBeatMapPath,
    visualPackageWorkflowPath
  ], /complete visual arrangement.*missing/i);
  run("render-visual-arrangement-doc.mjs", [visualPackageJob]);
  run("check-creative-confirmation.mjs", [
    visualPackageConfirmationPath,
    visualPackageDocumentPath,
    visualPackageBeatMapPath,
    visualPackageWorkflowPath
  ]);
  const v2VisualPackageJob = path.join(temporaryRoot, "v2-visual-package");
  fs.cpSync(visualPackageJob, v2VisualPackageJob, { recursive: true });
  const v2VisualPackageWorkflowPath = path.join(v2VisualPackageJob, "state", "workflow.json");
  const v2VisualPackageConfirmationPath = path.join(v2VisualPackageJob, "state", "creative-confirmation.json");
  const v2VisualPackageBeatMapPath = path.join(v2VisualPackageJob, "state", "beat-map.json");
  const v2VisualPackageDocumentPath = path.join(v2VisualPackageJob, "docs", "creative-confirmation.md");
  const v2VisualPackageBeatMap = readJson(v2VisualPackageBeatMapPath);
  v2VisualPackageBeatMap.visualOrchestrationVersion = 2;
  const [argumentBeat, noneBeat] = v2VisualPackageBeatMap.beats;
  argumentBeat.motionProfile = "thoughtful-editorial-v1";
  argumentBeat.surfaceTreatment = "direct-overlay";
  argumentBeat.materialRefs = [];
  argumentBeat.supportRole = "explanation";
  Object.assign(argumentBeat.objectCues[0], {
    spokenTriggerWordId: "seg-001:word-001",
    preMotionFrame: 0,
    firstLegibleFrame: 0,
    settledFrame: 1,
    exitTriggerWordId: "seg-001:word-003",
    invisibleFrame: 45,
    holdKind: "standard"
  });
  argumentBeat.visualDecision = {
    mode: "argument",
    informationDelta: {
      kind: "selection",
      statement: "The supporting idea resolves through three recorded steps.",
      basis: "spoken-structure",
      supportingWordIds: ["seg-001:word-001", "seg-001:word-002"]
    },
    objectFamily: "supporting steps",
    visualVerb: "resolve",
    evolutionMode: "replace",
    argumentStates: [
      { id: "step-entry", anchorWordId: "seg-001:word-001", operation: "introduce", activeObjectCueIds: ["primary-copy"], stateChange: "The first supporting step becomes readable.", readability: "clear" },
      { id: "step-middle", anchorWordId: "seg-001:word-002", operation: "transform", activeObjectCueIds: ["primary-copy"], stateChange: "The supporting step gains its recorded relation.", readability: "clear" },
      { id: "step-result", anchorWordId: "seg-001:word-003", operation: "resolve", activeObjectCueIds: ["primary-copy"], stateChange: "The supporting result becomes the conclusion.", readability: "clear" }
    ],
    fallback: "caption-only because no recorded supporting relation remains"
  };
  Object.assign(noneBeat, {
    mgScope: "none",
    recipe: "caption-only",
    components: [],
    microEvents: [],
    noMgReason: "The final sentence is complete in subtitles without another visual object."
  });
  delete noneBeat.motionProfile;
  delete noneBeat.surfaceTreatment;
  delete noneBeat.visualDecision;
  delete noneBeat.objectCues;
  delete noneBeat.materialRefs;
  v2VisualPackageBeatMap.mgCadenceExceptions = [{
    start: noneBeat.start,
    end: noneBeat.end,
    reason: "The final sentence remains caption-only by design.",
    coveredNoneBeatIds: [noneBeat.id]
  }];
  v2VisualPackageBeatMap.fps = 60;
  Object.assign(argumentBeat.objectCues[0], {
    preMotionFrame: 1,
    firstLegibleFrame: 2,
    settledFrame: 3,
    invisibleFrame: 90
  });
  argumentBeat.microEvents[1].time = 0.433333;
  writeJson(v2VisualPackageBeatMapPath, v2VisualPackageBeatMap);
  const fractionalV2TranscriptPath = path.join(v2VisualPackageJob, "state", "transcript.json");
  const fractionalV2Transcript = readJson(fractionalV2TranscriptPath);
  fractionalV2Transcript.segments[0].words[0].start = 0.023;
  writeJson(fractionalV2TranscriptPath, fractionalV2Transcript);
  const fractionalV2CaptionPlanPath = path.join(v2VisualPackageJob, "captions", "caption-review-plan.json");
  const fractionalV2CaptionPlan = readJson(fractionalV2CaptionPlanPath);
  fractionalV2CaptionPlan.transcriptSha256 = sha256File(fractionalV2TranscriptPath);
  writeJson(fractionalV2CaptionPlanPath, fractionalV2CaptionPlan);
  const v2VisualPackageConfirmation = readJson(v2VisualPackageConfirmationPath);
  v2VisualPackageConfirmation.authorities = computeCreativeAuthorities(v2VisualPackageJob, "subtitles");
  writeJson(v2VisualPackageConfirmationPath, v2VisualPackageConfirmation);
  fs.writeFileSync(v2VisualPackageDocumentPath, "# stale V2 visual package\n");
  run("workflow-state.mjs", [
    v2VisualPackageWorkflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Validated V2 visual argument package"
  ]);
  const generatedV2VisualPackage = fs.readFileSync(v2VisualPackageDocumentPath, "utf8");
  assert.match(generatedV2VisualPackage, /## 视觉论证决策总览/);
  assert.match(generatedV2VisualPackage, /<!-- visual-decision:support-001 -->/);
  assert.match(generatedV2VisualPackage, /<!-- visual-argument-state:support-001:step-entry -->/);
  assert.match(generatedV2VisualPackage, /看看（seg-001:word-001；00:00\.02 \/ 2 帧）/);
  assert.match(generatedV2VisualPackage, /The final sentence is complete in subtitles without another visual object\./);
  assert.match(generatedV2VisualPackage, /support-002/);
  const cadenceOverviewRow = generatedV2VisualPackage.split("\n").find((line) => line.includes("coveredNoneBeatIds：support-002"));
  assert.ok(cadenceOverviewRow?.includes(`时间：${noneBeat.start}–${noneBeat.end}；`), "V2 cadence overview must include the exception timing");
  assert.ok(cadenceOverviewRow.includes("The final sentence remains caption-only by design."));
  const overviewStart = generatedV2VisualPackage.indexOf("## 视觉论证决策总览");
  const overviewDecisionStart = generatedV2VisualPackage.indexOf("<!-- visual-decision:support-001 -->", overviewStart);
  const overviewDecisionEnd = generatedV2VisualPackage.indexOf("\n", generatedV2VisualPackage.indexOf("\n", overviewDecisionStart) + 1);
  assert.ok(overviewDecisionStart > overviewStart && overviewDecisionEnd > overviewDecisionStart);
  fs.writeFileSync(v2VisualPackageDocumentPath, `${generatedV2VisualPackage.slice(0, overviewDecisionStart)}${generatedV2VisualPackage.slice(overviewDecisionEnd + 1)}`);
  fail("check-creative-confirmation.mjs", [
    v2VisualPackageConfirmationPath,
    v2VisualPackageDocumentPath,
    v2VisualPackageBeatMapPath,
    v2VisualPackageWorkflowPath
  ], /support-001: V2 overview decision is missing/i);
  fs.writeFileSync(v2VisualPackageDocumentPath, generatedV2VisualPackage);
  const localDecisionStart = generatedV2VisualPackage.indexOf("<!-- visual-decision:support-001 -->", generatedV2VisualPackage.indexOf("<!-- visual-arrangement-local:support-001 -->"));
  const localDecisionRowStart = generatedV2VisualPackage.indexOf("\n", localDecisionStart) + 1;
  const localDecisionRowEnd = generatedV2VisualPackage.indexOf("\n", localDecisionRowStart);
  assert.ok(localDecisionStart > 0 && localDecisionRowEnd > localDecisionRowStart);
  const localDecisionRow = generatedV2VisualPackage.slice(localDecisionRowStart, localDecisionRowEnd);
  assert.match(localDecisionRow, /caption-only because no recorded supporting relation remains/);
  fs.writeFileSync(v2VisualPackageDocumentPath, `${generatedV2VisualPackage.slice(0, localDecisionRowStart)}${localDecisionRow.replace("caption-only because no recorded supporting relation remains", "missing local fallback")}${generatedV2VisualPackage.slice(localDecisionRowEnd)}`);
  fail("check-creative-confirmation.mjs", [
    v2VisualPackageConfirmationPath,
    v2VisualPackageDocumentPath,
    v2VisualPackageBeatMapPath,
    v2VisualPackageWorkflowPath
  ], /support-001: V2 local visual decision is missing controlled values/i);
  fs.writeFileSync(v2VisualPackageDocumentPath, generatedV2VisualPackage);
  fs.writeFileSync(v2VisualPackageDocumentPath, generatedV2VisualPackage.replace(
    "<!-- visual-argument-state:support-001:step-entry -->",
    "<!-- missing visual argument state -->"
  ));
  fail("check-creative-confirmation.mjs", [
    v2VisualPackageConfirmationPath,
    v2VisualPackageDocumentPath,
    v2VisualPackageBeatMapPath,
    v2VisualPackageWorkflowPath
  ], /argument state|visual argument|step-entry/i);
  run("render-visual-arrangement-doc.mjs", [v2VisualPackageJob]);
  run("workflow-state.mjs", [v2VisualPackageWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  const v2VisualPackageWorkflow = readJson(v2VisualPackageWorkflowPath);
  assert.equal(v2VisualPackageWorkflow.currentState, "visual-arrangement-review");
  assert.equal(v2VisualPackageWorkflow.pendingGate, "visual-arrangement-review");
  const visualPackageSurfaceConfirmation = readJson(visualPackageConfirmationPath);
  visualPackageSurfaceConfirmation.axisPolicy.A.surface = {
    kind: "localized-glass",
    fullFrame: false,
    opacityRange: [0.58, 0.76],
    backdropBlurPx: 14
  };
  writeJson(visualPackageConfirmationPath, visualPackageSurfaceConfirmation);
  fail("check-creative-confirmation.mjs", [
    visualPackageConfirmationPath,
    visualPackageDocumentPath,
    visualPackageBeatMapPath,
    visualPackageWorkflowPath
  ], /visual arrangement packages must use direct-overlay or evidence-surface; localized-glass is legacy-only/i);
  visualPackageSurfaceConfirmation.axisPolicy.A.surface = {
    kind: "evidence-surface",
    fullFrame: false,
    opacityRange: [0.12, 0.28],
    backdropBlurPx: 8
  };
  writeJson(visualPackageConfirmationPath, visualPackageSurfaceConfirmation);
  run("check-creative-confirmation.mjs", [
    visualPackageConfirmationPath,
    visualPackageDocumentPath,
    visualPackageBeatMapPath,
    visualPackageWorkflowPath
  ]);
  const creativeSurfaceKinds = creativeConfirmationSchema.properties.axisPolicy.properties.A.properties.surface.oneOf
    .map((surface) => surface.properties.kind.const);
  assert.ok(creativeSurfaceKinds.includes("evidence-surface"), "creative confirmation schema must allow evidence-surface");
  visualPackageSurfaceConfirmation.axisPolicy.A.surface = {
    kind: "direct-overlay",
    fullFrame: false,
    opacityRange: [0, 0],
    backdropBlurPx: 0
  };
  writeJson(visualPackageConfirmationPath, visualPackageSurfaceConfirmation);
  fs.writeFileSync(visualPackageDocumentPath, "# stale visual package\n");
  run("workflow-state.mjs", [
    visualPackageWorkflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Validated the complete visual arrangement package"
  ]);
  assert.match(fs.readFileSync(visualPackageDocumentPath, "utf8"), /<!-- visual-arrangement-beat:support-001 -->/);
  run("workflow-state.mjs", [visualPackageWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  fs.writeFileSync(visualPackageMaterialPath, "changed fixture evidence");
  assert.throws(
    () => assertCreativeAuthorities(visualPackageJob, readJson(visualPackageWorkflowPath)),
    /Creative authority drift: material:fixture-evidence/
  );
  fail("workflow-state.mjs", [
    visualPackageWorkflowPath,
    "approve-visual-arrangement",
    "--actor", "user",
    "--note", "Material drift must block composition"
  ], /materials\[0\]\.sha256/);

  const legacyTranscriptResolutionJob = path.join(temporaryRoot, "legacy-transcript-resolution");
  fs.cpSync(jobRoot, legacyTranscriptResolutionJob, { recursive: true });
  const legacyTranscriptResolutionWorkflowPath = path.join(legacyTranscriptResolutionJob, "state", "workflow.json");
  const legacyTranscriptResolutionWorkflow = readJson(legacyTranscriptResolutionWorkflowPath);
  delete legacyTranscriptResolutionWorkflow.visualArrangementReviewRequired;
  delete legacyTranscriptResolutionWorkflow.visualArrangementReviewDecision;
  delete legacyTranscriptResolutionWorkflow.gates["visual-arrangement-review"];
  writeJson(legacyTranscriptResolutionWorkflowPath, legacyTranscriptResolutionWorkflow);
  const legacyTranscriptReconciliationPath = path.join(legacyTranscriptResolutionJob, "state", "transcript-reconciliation.json");
  const legacyTranscriptReconciliation = readJson(legacyTranscriptReconciliationPath);
  const unresolvedSpeech = legacyTranscriptReconciliation.items.find((item) => item.id === "speech-1");
  unresolvedSpeech.type = "ambiguous";
  unresolvedSpeech.resolution = "unresolved";
  legacyTranscriptReconciliation.verification.unresolvedReleaseImpactCount = 1;
  writeJson(legacyTranscriptReconciliationPath, legacyTranscriptReconciliation);
  run("resolve-transcript-item.mjs", [
    legacyTranscriptResolutionWorkflowPath,
    "speech-1",
    "accepted-speech",
    "--actor", "user",
    "--note", "Resolve the legacy transcript ambiguity"
  ]);
  const upgradedLegacyTranscriptResolution = readJson(legacyTranscriptResolutionWorkflowPath);
  assert.equal(upgradedLegacyTranscriptResolution.currentState, "motion-plan");
  assert.equal(upgradedLegacyTranscriptResolution.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyTranscriptResolution.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyTranscriptResolution.gates["visual-arrangement-review"].status, "not-reached");

  const motionCopyJob = path.join(temporaryRoot, "motion-copy-authority");
  const motionCopySource = path.join(temporaryRoot, "motion-copy-authority.mov");
  fs.writeFileSync(motionCopySource, "fixture media");
  const motionCopyScaffold = spawnSync(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [motionCopyJob, motionCopySource, "review", "motion-copy"], { encoding: "utf8" });
  assert.equal(motionCopyScaffold.status, 0, `${motionCopyScaffold.stdout}\n${motionCopyScaffold.stderr}`);
  const motionCopyWorkflowPath = path.join(motionCopyJob, "state", "workflow.json");
  const motionCopyConfirmationPath = path.join(motionCopyJob, "state", "creative-confirmation.json");
  fs.copyFileSync(transcriptPath, path.join(motionCopyJob, "state", "transcript.json"));
  writeJson(path.join(motionCopyJob, "state", "beat-map.json"), {
    duration: 3.2,
    fps: 30,
    captionMode: "motion-copy",
    designSystem: "state/design-system.json",
    beats: []
  });
  const motionCopyConfirmation = readJson(motionCopyConfirmationPath);
  motionCopyConfirmation.review = { status: "approved" };
  motionCopyConfirmation.authorities = computeCreativeAuthorities(motionCopyJob, "motion-copy");
  writeJson(motionCopyConfirmationPath, motionCopyConfirmation);
  const motionCopyWorkflow = readJson(motionCopyWorkflowPath);
  motionCopyWorkflow.creativeConfirmationSha256 = sha256File(motionCopyConfirmationPath);
  motionCopyWorkflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(motionCopyJob, "motion-copy");
  writeJson(motionCopyWorkflowPath, motionCopyWorkflow);
  assert.equal(computeCreativeAuthorities(motionCopyJob, "motion-copy").designSystem.path, "state/design-system.json");
  assert.doesNotThrow(() => assertCreativeAuthorities(motionCopyJob, motionCopyWorkflow));
  const motionCopyDesignSystemPath = path.join(motionCopyJob, "state", "design-system.json");
  const motionCopyDesignSystem = readJson(motionCopyDesignSystemPath);
  motionCopyDesignSystem.authorityDriftFixture = true;
  writeJson(motionCopyDesignSystemPath, motionCopyDesignSystem);
  assert.throws(() => assertCreativeAuthorities(motionCopyJob, motionCopyWorkflow), /Creative authority drift: designSystem/);
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), motionCopyDesignSystemPath);

  const legacyAutoConfirmation = readJson(motionCopyConfirmationPath);
  delete legacyAutoConfirmation.authorities.designSystem;
  writeJson(motionCopyConfirmationPath, legacyAutoConfirmation);
  const legacyAutoWorkflow = readJson(motionCopyWorkflowPath);
  delete legacyAutoWorkflow.visualArrangementReviewRequired;
  delete legacyAutoWorkflow.visualArrangementReviewDecision;
  delete legacyAutoWorkflow.gates["visual-arrangement-review"];
  legacyAutoWorkflow.mode = "auto";
  legacyAutoWorkflow.currentState = "complete";
  legacyAutoWorkflow.completed = true;
  legacyAutoWorkflow.creativeConfirmationSha256 = sha256File(motionCopyConfirmationPath);
  legacyAutoWorkflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(motionCopyJob, "motion-copy");
  writeJson(motionCopyWorkflowPath, legacyAutoWorkflow);
  run("workflow-state.mjs", [motionCopyWorkflowPath, "reopen", "composition", "--actor", "user", "--note", "Rebuild historical auto composition"]);
  const reopenedLegacyAutoWorkflow = readJson(motionCopyWorkflowPath);
  assert.equal(reopenedLegacyAutoWorkflow.currentState, "composition");
  assert.equal(Object.hasOwn(reopenedLegacyAutoWorkflow, "visualArrangementReviewRequired"), false);
  assert.doesNotThrow(() => assertCreativeAuthorities(motionCopyJob, reopenedLegacyAutoWorkflow));

  for (const faceProtection of ["brief-semantic-only", "required"]) {
    const legacyConfirmationPath = path.join(jobRoot, "state", `creative-confirmation.legacy-${faceProtection}.json`);
    const legacyWorkflowPath = path.join(jobRoot, "state", `workflow.legacy-${faceProtection}.json`);
    const legacyConfirmation = readJson(confirmationPath);
    const legacyWorkflow = readJson(workflowPath);
    delete legacyWorkflow.visualArrangementReviewRequired;
    delete legacyWorkflow.visualArrangementReviewDecision;
    delete legacyWorkflow.gates["visual-arrangement-review"];
    legacyConfirmation.axisPolicy.A.overlayZones = ["top", "bottom", "side"];
    legacyConfirmation.axisPolicy.A.faceProtection = faceProtection;
    legacyConfirmation.axisPolicy.A.surface = {
      kind: "localized-glass",
      fullFrame: false,
      opacityRange: [0.58, 0.76],
      backdropBlurPx: 14
    };
    legacyConfirmation.review.status = "ready";
    legacyConfirmation.changeControl.implementationMayStartAfter = "creative-package-approved";
    writeJson(legacyConfirmationPath, legacyConfirmation);
    writeJson(legacyWorkflowPath, legacyWorkflow);
    const legacyCheck = spawnSync(process.execPath, [
      path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
      legacyConfirmationPath,
      path.join(jobRoot, "docs", "creative-confirmation.md"),
      path.join(jobRoot, "state", "beat-map.json"),
      legacyWorkflowPath
    ], { encoding: "utf8" });
    assert.equal(legacyCheck.status, 0, `${faceProtection}: ${legacyCheck.stdout}\n${legacyCheck.stderr}`);
  }

  const legacyV1SurfaceJob = path.join(temporaryRoot, "legacy-v1-surface");
  fs.cpSync(jobRoot, legacyV1SurfaceJob, { recursive: true });
  const legacyV1SurfaceWorkflowPath = path.join(legacyV1SurfaceJob, "state", "workflow.json");
  const legacyV1SurfaceWorkflow = readJson(legacyV1SurfaceWorkflowPath);
  delete legacyV1SurfaceWorkflow.visualArrangementReviewRequired;
  delete legacyV1SurfaceWorkflow.visualArrangementReviewDecision;
  delete legacyV1SurfaceWorkflow.gates["visual-arrangement-review"];
  writeJson(legacyV1SurfaceWorkflowPath, legacyV1SurfaceWorkflow);
  const legacyV1SurfaceBeatMapPath = path.join(legacyV1SurfaceJob, "state", "beat-map.json");
  const legacyV1SurfaceBeatMap = readJson(legacyV1SurfaceBeatMapPath);
  legacyV1SurfaceBeatMap.visualOrchestrationVersion = 1;
  legacyV1SurfaceBeatMap.materials = [];
  writeJson(legacyV1SurfaceBeatMapPath, legacyV1SurfaceBeatMap);
  const legacyV1SurfaceConfirmationPath = path.join(legacyV1SurfaceJob, "state", "creative-confirmation.json");
  const legacyV1SurfaceConfirmation = readJson(legacyV1SurfaceConfirmationPath);
  legacyV1SurfaceConfirmation.axisPolicy.A.surface = {
    kind: "localized-glass",
    fullFrame: false,
    opacityRange: [0.58, 0.76],
    backdropBlurPx: 14
  };
  legacyV1SurfaceConfirmation.authorities = computeCreativeAuthorities(legacyV1SurfaceJob, "subtitles");
  writeJson(legacyV1SurfaceConfirmationPath, legacyV1SurfaceConfirmation);
  run("check-creative-confirmation.mjs", [
    legacyV1SurfaceConfirmationPath,
    path.join(legacyV1SurfaceJob, "docs", "creative-confirmation.md"),
    legacyV1SurfaceBeatMapPath,
    legacyV1SurfaceWorkflowPath
  ]);

  const activeBeatMap = readJson(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"));
  activeBeatMap.duration = 20;
  for (const [index, beat] of activeBeatMap.beats.entries()) {
    beat.axis = "A";
    beat.layout.focalPlacement = index === 0 ? "center" : "side";
    beat.layout.focalPlacementRationale = `Placement rationale ${index + 1}`;
    beat.layout.faceCoverRationale = `Face-cover rationale ${index + 1}`;
  }
  writeJson(path.join(jobRoot, "state", "beat-map.json"), activeBeatMap);
  const activeConfirmation = readJson(confirmationPath);
  activeConfirmation.storyboard.beatCount = activeBeatMap.beats.length;
  activeConfirmation.changeControl.reapprovalFields.push("mg-cadence", "focal-placement", "face-cover-rationale");
  activeConfirmation.authorities = computeCreativeAuthorities(jobRoot, "subtitles");
  writeJson(confirmationPath, activeConfirmation);
  fs.writeFileSync(path.join(jobRoot, "docs", "motion-plan.md"), [
    "# Motion Plan",
    "",
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...activeBeatMap.beats.map((beat) => `| ${beat.start}–${beat.end} | ${beat.text} | ${beat.axis} | ${beat.primaryFlowAxis} | ${beat.visualReference} | ${beat.visualStyle} | ${beat.transitionFamily} |`),
    "",
    "Caption mode: subtitles"
  ].join("\n"));
  const creativeDocument = (omitFirstFocalRationale = false) => [
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
    "| A | 当前语义优先 |",
    "| B | 真人窗受保护 |",
    "## 分镜动画方案",
    "| 时间 | 处理 |",
    "| --- | --- |",
    ...activeBeatMap.beats.map((beat, index) => `| ${beat.start}–${beat.end} | ${beat.id} ${beat.supportRole} ${beat.viewerQuestion} ${beat.removalLoss} ${beat.visualStyle} ${beat.primaryFlowAxis} ${beat.visualReference} ${beat.onScreenCopy.join(" ")} ${beat.layout.focalPlacement} ${omitFirstFocalRationale && index === 0 ? "" : beat.layout.focalPlacementRationale} ${beat.layout.faceCoverRationale} |`),
    "### 字幕模式 MG 审核清单",
    "| 最终上屏原文 | 信息增量 | 最佳观看位 | 动画样式 | 主要任务 | 删除后的具体损失 | 注意力成本 |",
    "| --- | --- | --- | --- | --- | --- |",
    "| 已列于上表 | 已列于上表 | center / side | 已列于上表 | organization | 已列于上表 | medium |",
    "### 明确不加 MG 的段落",
    "| 时间 | 原句 | 原因 |",
    "| --- | --- | --- |",
    "| 无 | 无 | 无 |"
  ].join("\n");
  fs.writeFileSync(path.join(jobRoot, "docs", "creative-confirmation.md"), creativeDocument(true));
  const missingReviewedFocal = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
    confirmationPath,
    path.join(jobRoot, "docs", "creative-confirmation.md"),
    path.join(jobRoot, "state", "beat-map.json"),
    workflowPath
  ], { encoding: "utf8" });
  assert.notEqual(missingReviewedFocal.status, 0);
  assert.match(`${missingReviewedFocal.stdout}\n${missingReviewedFocal.stderr}`, /focal placement|face-cover rationale/i);
  fs.writeFileSync(path.join(jobRoot, "docs", "creative-confirmation.md"), creativeDocument());
  const reviewedFocal = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
    confirmationPath,
    path.join(jobRoot, "docs", "creative-confirmation.md"),
    path.join(jobRoot, "state", "beat-map.json"),
    workflowPath
  ], { encoding: "utf8" });
  assert.equal(reviewedFocal.status, 0, `${reviewedFocal.stdout}\n${reviewedFocal.stderr}`);
  activeBeatMap.mgCadenceExceptions = [{
    start: 3.2,
    end: 20,
    reason: "The closing recap deliberately remains caption-only because it adds no visual information."
  }];
  writeJson(path.join(jobRoot, "state", "beat-map.json"), activeBeatMap);
  const cadenceExceptionConfirmation = readJson(confirmationPath);
  cadenceExceptionConfirmation.authorities = computeCreativeAuthorities(jobRoot, "subtitles");
  writeJson(confirmationPath, cadenceExceptionConfirmation);
  const unreviewedCadenceException = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
    confirmationPath,
    path.join(jobRoot, "docs", "creative-confirmation.md"),
    path.join(jobRoot, "state", "beat-map.json"),
    workflowPath
  ], { encoding: "utf8" });
  assert.notEqual(unreviewedCadenceException.status, 0, `${unreviewedCadenceException.stdout}\n${unreviewedCadenceException.stderr}`);
  assert.match(`${unreviewedCadenceException.stdout}\n${unreviewedCadenceException.stderr}`, /cadence exception.*reviewed/i);
  fs.appendFileSync(path.join(jobRoot, "docs", "caption-plan.md"), [
    "",
    "## 节奏例外",
    "| 时间 | 原因 |",
    "| --- | --- |",
    "| 3.20–20.00 | The closing recap deliberately remains caption-only because it adds no visual information. |"
  ].join("\n"));
  const reviewedCadenceException = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
    confirmationPath,
    path.join(jobRoot, "docs", "creative-confirmation.md"),
    path.join(jobRoot, "state", "beat-map.json"),
    workflowPath
  ], { encoding: "utf8" });
  assert.equal(reviewedCadenceException.status, 0, `${reviewedCadenceException.stdout}\n${reviewedCadenceException.stderr}`);
  const cadenceLockedWorkflow = readJson(workflowPath);
  cadenceLockedWorkflow.creativeConfirmationSha256 = sha256File(confirmationPath);
  cadenceLockedWorkflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(jobRoot, "subtitles");
  writeJson(workflowPath, cadenceLockedWorkflow);
  assert.doesNotThrow(() => assertCreativeAuthorities(jobRoot, cadenceLockedWorkflow));
  const cadenceDesignSystem = readJson(path.join(jobRoot, "state", "design-system.json"));
  delete cadenceDesignSystem.subtitleMgCadence;
  writeJson(path.join(jobRoot, "state", "design-system.json"), cadenceDesignSystem);
  assert.throws(() => assertCreativeAuthorities(jobRoot, cadenceLockedWorkflow), /Creative authority drift: designSystem/);
  const staleCadencePackage = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-creative-confirmation.mjs"),
    confirmationPath,
    path.join(jobRoot, "docs", "creative-confirmation.md"),
    path.join(jobRoot, "state", "beat-map.json"),
    workflowPath
  ], { encoding: "utf8" });
  assert.notEqual(staleCadencePackage.status, 0, `${staleCadencePackage.stdout}\n${staleCadencePackage.stderr}`);
  assert.match(`${staleCadencePackage.stdout}\n${staleCadencePackage.stderr}`, /designSystem.*authorit|authorit.*designSystem/i);
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), path.join(jobRoot, "state", "design-system.json"));

  const longTranscript = {
    revision: 1,
    language: "zh-CN",
    duration: 40,
    source: "fixture",
    segments: Array.from({ length: 4 }, (_, index) => ({
      id: `long-seg-${index + 1}`,
      text: `长视频片段${index + 1}`,
      start: index * 10,
      end: (index + 1) * 10,
      confidence: 1,
      words: []
    }))
  };
  writeJson(transcriptPath, longTranscript);
  writeJson(path.join(jobRoot, "state", "beat-map.json"), {
    duration: 40,
    fps: 30,
    captionMode: "subtitles",
    designSystem: "state/design-system.json",
    beats: longTranscript.segments.map((segment, index) => ({
      id: `long-caption-${index + 1}`,
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
      transitionFamily: `long-caption-${index + 1}`,
      components: [],
      microEvents: []
    }))
  });
  assert.equal(computeCreativeAuthorities(jobRoot, "subtitles").designSystem.path, "state/design-system.json");
  const invalidCadenceApproval = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Invalid cadence must not be approved"
  ], { encoding: "utf8" });
  assert.notEqual(invalidCadenceApproval.status, 0);
  assert.match(`${invalidCadenceApproval.stdout}\n${invalidCadenceApproval.stderr}`, /cadence.*requires|requires.*cadence/i);
  const invalidCadenceAdvance = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath,
    "advance",
    "--artifact", "docs/motion-plan.md"
  ], { encoding: "utf8" });
  assert.notEqual(invalidCadenceAdvance.status, 0);
  assert.match(`${invalidCadenceAdvance.stdout}\n${invalidCadenceAdvance.stderr}`, /cadence.*requires|requires.*cadence/i);
  const automaticWorkflow = readJson(workflowPath);
  automaticWorkflow.mode = "auto";
  writeJson(workflowPath, automaticWorkflow);
  const invalidAutomaticAdvance = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath,
    "advance",
    "--artifact", "docs/motion-plan.md"
  ], { encoding: "utf8" });
  assert.notEqual(invalidAutomaticAdvance.status, 0);
  assert.match(`${invalidAutomaticAdvance.stdout}\n${invalidAutomaticAdvance.stderr}`, /cadence.*requires|requires.*cadence/i);

  const cadenceValidBeatMap = structuredClone(activeBeatMap);
  cadenceValidBeatMap.visualOrchestrationVersion = 1;
  cadenceValidBeatMap.materials = [];
  cadenceValidBeatMap.beats[0].motionProfile = "thoughtful-editorial-v1";
  cadenceValidBeatMap.beats[0].surfaceTreatment = "direct-overlay";
  cadenceValidBeatMap.beats[0].materialRefs = [];
  cadenceValidBeatMap.beats[0].objectCues = [{
    id: "primary-copy",
    semanticRole: "primary-copy",
    spokenTriggerWordId: "seg-001:word-002",
    preMotionFrame: 11,
    firstLegibleFrame: 12,
    settledFrame: 18,
    exitTriggerWordId: "seg-001:word-003",
    invisibleFrame: 45,
    holdKind: "standard"
  }];
  cadenceValidBeatMap.beats[1] = {
    ...cadenceValidBeatMap.beats[1],
    axis: "A",
    recipe: "caption-only",
    mgScope: "none",
    components: [],
    microEvents: [],
    noMgReason: "The first structural marker already resolves the point; subtitles carry this remaining sentence."
  };
  cadenceValidBeatMap.mgCadenceExceptions = [{
    start: 1.5,
    end: 20,
    reason: "The remainder stays caption-only because the first structural marker already resolves the point."
  }];
  fs.appendFileSync(path.join(jobRoot, "docs", "caption-plan.md"), [
    "",
    "| 1.50–20.00 | The remainder stays caption-only because the first structural marker already resolves the point. |"
  ].join("\n"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), transcriptPath);
  writeJson(path.join(jobRoot, "state", "beat-map.json"), cadenceValidBeatMap);
  const cadenceValidConfirmation = readJson(confirmationPath);
  cadenceValidConfirmation.authorities = computeCreativeAuthorities(jobRoot, "subtitles");
  cadenceValidConfirmation.review = { required: false, status: "ready" };
  writeJson(confirmationPath, cadenceValidConfirmation);
  const cadenceValidWorkflow = readJson(workflowPath);
  cadenceValidWorkflow.mode = "review";
  cadenceValidWorkflow.currentState = "motion-plan";
  cadenceValidWorkflow.pendingGate = null;
  cadenceValidWorkflow.roughCutReviewDecision = "manual-approved";
  cadenceValidWorkflow.gates["rough-cut-review"] = { status: "approved", artifact: "state/chatcut-roughcut.json" };
  cadenceValidWorkflow.visualArrangementReviewRequired = true;
  cadenceValidWorkflow.visualArrangementReviewDecision = "pending";
  cadenceValidWorkflow.gates["visual-arrangement-review"] = { status: "not-reached" };
  writeJson(workflowPath, cadenceValidWorkflow);
  run("workflow-state.mjs", [
    workflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Approved cadence-valid review package"
  ]);
  run("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  let visualReviewWorkflow = readJson(workflowPath);
  assert.equal(visualReviewWorkflow.currentState, "visual-arrangement-review");
  assert.equal(visualReviewWorkflow.pendingGate, "visual-arrangement-review");
  assert.equal(visualReviewWorkflow.visualArrangementReviewDecision, "pending");
  assert.equal(visualReviewWorkflow.gates["visual-arrangement-review"].artifact, "docs/creative-confirmation.md");
  assert.equal(visualReviewWorkflow.history.at(-1).artifact, "docs/creative-confirmation.md");
  fail("workflow-state.mjs", [workflowPath, "advance", "--artifact", "hyperframes/index.html"], /visual arrangement review requires/i);
  fail("workflow-state.mjs", [workflowPath, "approve-visual-arrangement", "--actor", "agent", "--note", "Agent cannot approve this review"], /requires actor user/i);
  fail("workflow-state.mjs", [workflowPath, "approve-visual-arrangement", "--note", "Do not infer a user actor"], /requires actor user/i);
  fail("workflow-state.mjs", [workflowPath, "revise-visual-arrangement", "--note", "Do not infer a user actor"], /requires actor user/i);
  fail("workflow-state.mjs", [workflowPath, "approve-visual-arrangement", "--actor", "user"], /requires --note/i);
  run("workflow-state.mjs", [workflowPath, "revise-visual-arrangement", "--actor", "user", "--note", "Revise the visual arrangement"]);
  visualReviewWorkflow = readJson(workflowPath);
  assert.equal(visualReviewWorkflow.currentState, "motion-plan");
  assert.equal(visualReviewWorkflow.visualArrangementReviewDecision, "pending");
  assert.equal(visualReviewWorkflow.creativeConfirmationSha256, null);
  assert.equal(visualReviewWorkflow.creativeDocumentFingerprints, null);

  run("workflow-state.mjs", [
    workflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Validated the revised visual package"
  ]);
  run("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  run("workflow-state.mjs", [
    workflowPath,
    "approve-visual-arrangement",
    "--actor", "user",
    "--note", "Approved the visual arrangement"
  ]);
  visualReviewWorkflow = readJson(workflowPath);
  assert.equal(visualReviewWorkflow.currentState, "composition");
  assert.equal(visualReviewWorkflow.visualArrangementReviewDecision, "manual-approved");

  run("workflow-state.mjs", [workflowPath, "replan", "--actor", "agent", "--note", "Retest the automatic visual acceptance path"]);
  run("workflow-state.mjs", [
    workflowPath,
    "approve-creative",
    "--actor", "agent",
    "--note", "Validated the automatic visual package"
  ]);
  run("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  run("workflow-state.mjs", [workflowPath, "set-mode", "auto", "--actor", "user"]);
  const autoVisualWorkflow = readJson(workflowPath);
  assert.equal(autoVisualWorkflow.currentState, "composition");
  assert.equal(autoVisualWorkflow.visualArrangementReviewDecision, "automatic-accepted");
  console.log("Creative approval workflow test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
