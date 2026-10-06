import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginWorkflowRevision,
  ensureWorkflowDefaults,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-workflow-"));
const run = (command, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${command} unexpectedly passed`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`Unexpected failure:\n${output}`);
  return result;
};
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  expectSuccess,
  failurePattern
);
const scaffold = (name, ...options) => {
  const source = path.join(temporaryRoot, `${name}.mov`);
  const job = path.join(temporaryRoot, name);
  fs.writeFileSync(source, "media");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [job, source, ...options]);
  return job;
};
const legacyMotionPlanReturn = (name) => {
  const job = scaffold(name, "review");
  const workflowPath = path.join(job, "state", "workflow.json");
  const workflow = readJson(workflowPath);
  delete workflow.visualArrangementReviewRequired;
  delete workflow.visualArrangementReviewDecision;
  delete workflow.gates["visual-arrangement-review"];
  workflow.currentState = "composition";
  workflow.pendingGate = null;
  writeJsonAtomic(workflowPath, workflow);
  return { job, workflowPath };
};
const legacyWorkflowAt = (name, currentState) => {
  const job = scaffold(name, "review");
  const workflowPath = path.join(job, "state", "workflow.json");
  const workflow = readJson(workflowPath);
  delete workflow.visualArrangementReviewRequired;
  delete workflow.visualArrangementReviewDecision;
  delete workflow.gates["visual-arrangement-review"];
  workflow.currentState = currentState;
  workflow.pendingGate = null;
  writeJsonAtomic(workflowPath, workflow);
  return { job, workflowPath };
};
const assertLegacyMotionPlanReturnEnablesVisualReview = (workflowPath) => {
  const workflow = readJson(workflowPath);
  assert.equal(workflow.currentState, "motion-plan");
  assert.equal(workflow.visualArrangementReviewRequired, true);
  assert.equal(workflow.visualArrangementReviewDecision, "pending");
  assert.equal(workflow.gates["visual-arrangement-review"].status, "not-reached");
};
const prepareCover = (job, { schemaVersion = "2.1.0", outputHeight = 1440, recordedSha256 = null } = {}) => {
  const previewRoot = path.join(job, "previews", "cover");
  const framePath = path.join(previewRoot, "frame-01.png");
  const basePath = path.join(previewRoot, "base.png");
  const outputPath = path.join(job, "output", "cover.png");
  const frameIds = Array.from({ length: schemaVersion === "2.1.0" ? 24 : 8 }, (_, index) => String(index + 1).padStart(2, "0"));
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1440",
    "-frames:v", "1", framePath
  ]);
  for (const id of frameIds.slice(1)) fs.copyFileSync(framePath, path.join(previewRoot, `frame-${id}.png`));
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=black:s=1080x${outputHeight}`,
    "-frames:v", "1", outputPath
  ]);
  for (let index = 1; index <= 6; index += 1) {
    fs.copyFileSync(outputPath, path.join(previewRoot, `cover-${index}.png`));
  }
  fs.copyFileSync(outputPath, basePath);
  const coverPath = path.join(job, "state", "cover.json");
  const cover = readJson(coverPath);
  cover.schemaVersion = schemaVersion;
  cover.status = "ready";
  cover.styleId = "talking-head-opinion-poster-v2";
  cover.frameCandidates = frameIds.map((id, index) => ({
    id: `frame-${id}`,
    path: `previews/cover/frame-${id}.png`,
    timestampSeconds: index + 1,
    reasons: ["Clear expression"]
  }));
  cover.renderedCandidates = Array.from({ length: 6 }, (_, index) => ({
    id: `cover-${index + 1}`,
    frameId: "frame-01",
    basePath: "previews/cover/base.png",
    headlineLines: ["公开观点", `结论 ${index + 1}`],
    source: "user-brief",
    previewPath: `previews/cover/cover-${index + 1}.png`
  }));
  cover.selection = {
    frameId: "frame-01",
    renderedCandidateId: "cover-1"
  };
  cover.coverBase = {
    sourceFrameId: "frame-01",
    crop: { x: 0, y: 0, width: 1080, height: 1440 },
    method: "direct-source-crop",
    path: "previews/cover/base.png",
    sha256: sha256File(basePath),
    width: 1080,
    height: 1440
  };
  cover.visualReview = {
    subjectIntegrity: true,
    headlineAboveEyes: true,
    thumbnailReadable: true,
    noOpaqueTextBackdrop: true,
    noDarkGradient: true,
    safeAreaChecked: true
  };
  cover.publicLanguageReviewed = true;
  cover.output.sha256 = recordedSha256;
  writeJsonAtomic(coverPath, cover);
};
const prepareReconciledTranscript = (job) => {
  const transcriptPath = path.join(job, "state", "transcript.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), transcriptPath);
  const transcript = readJson(transcriptPath);
  const itemsPath = path.join(job, "checkpoints", "reconciliation-items.json");
  writeJsonAtomic(itemsPath, transcript.segments.map((segment, index) => ({
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
    evidence: { audioChecked: true, supportsReference: false, note: "Workflow gate fixture" }
  })));
  script("create-transcript-reconciliation.mjs", [job, "input/source.mov", itemsPath]);
};
const prepareLegacyCover = (job) => {
  prepareCover(job, { schemaVersion: "2.0.0" });
  const coverPath = path.join(job, "state", "cover.json");
  const cover = readJson(coverPath);
  cover.schemaVersion = "1.0.0";
  cover.styleId = "centered-talking-head-yellow-v1";
  delete cover.coverBase;
  delete cover.visualReview;
  cover.renderedCandidates = cover.renderedCandidates.map((candidate) => ({
    id: candidate.id,
    frameId: candidate.frameId,
    crop: { x: 0, y: 0, width: 1080, height: 1440 },
    topLines: [candidate.headlineLines[0]],
    bottomLines: [candidate.headlineLines[1]],
    source: candidate.source,
    previewPath: candidate.previewPath
  }));
  cover.selection = {
    frameId: "frame-01",
    renderedCandidateId: "cover-1",
    crop: { x: 0, y: 0, width: 1080, height: 1440 }
  };
  writeJsonAtomic(coverPath, cover);
};
const approveCover = (workflowPath) => script("workflow-state.mjs", [
  workflowPath,
  "approve-cover",
  "--actor",
  "user",
  "--note",
  "Selected public cover copy"
]);
const prepareTitles = (job, videoRelativePath = "output/final.mp4") => {
  const videoPath = path.join(job, videoRelativePath);
  const workbookPath = path.join(job, "output", "titles.xlsx");
  fs.writeFileSync(workbookPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x73]));
  const platforms = [
    ["douyin", "抖音", "DY"],
    ["video-account", "视频号", "SPH"],
    ["xiaohongshu", "小红书", "XHS"],
    ["bilibili", "B站", "BIL"],
    ["kuaishou", "快手", "KS"]
  ];
  writeJsonAtomic(path.join(job, "state", "titles.json"), {
    schemaVersion: "1.0.0",
    status: "ready",
    sourceDelivery: { path: videoRelativePath, sha256: sha256File(videoPath) },
    workbook: { path: "output/titles.xlsx", sha256: sha256File(workbookPath) },
    publicLanguageReviewed: true,
    platforms: platforms.map(([id, displayName, prefix]) => ({
      id,
      displayName,
      candidates: Array.from({ length: 5 }, (_, index) => ({
        id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
        title: `公开 AI 观点 ${index + 1}`,
        keywords: ["AI"],
        hookType: "观点直给",
        contentSupport: "Runtime fixture"
      }))
    })),
    generatedAt: new Date().toISOString()
  });
};
const roughCutSelectionPolicy = "reference-aligned-last-complete-take-v1";
const prepareRoughCutSelection = (job) => {
  const workflowPath = path.join(job, "state", "workflow.json");
  const sourceTranscriptPath = path.join(job, "state", "source-transcript.json");
  const referencePath = path.join(job, "input", "reference-scripts", "reference.txt");
  const sourceTranscript = {
    schemaVersion: "1.0.0",
    revision: 1,
    language: "zh",
    duration: 6,
    source: "chatcut",
    segments: [
      { id: "source-first", text: "第一遍完整表达", start: 0, end: 1, words: [] },
      { id: "source-later", text: "第二遍完整表达", start: 2, end: 3, words: [] },
      { id: "source-incomplete", text: "第三遍没有说完", start: 4, end: 4.5, words: [] },
      { id: "source-filler", text: "嗯", start: 5, end: 5.2, words: [] }
    ]
  };
  writeJsonAtomic(sourceTranscriptPath, sourceTranscript);
  fs.writeFileSync(referencePath, "完整观点\n");

  const workflow = readJson(workflowPath);
  workflow.roughCutSelectionPolicy = roughCutSelectionPolicy;
  workflow.sourceTranscriptSha256 = sha256File(sourceTranscriptPath);
  workflow.referenceScriptStatus = "provided";
  workflow.referenceScriptPath = "input/reference-scripts/reference.txt";
  workflow.referenceScriptSha256 = sha256File(referencePath);
  writeJsonAtomic(workflowPath, workflow);

  const reconciliationPath = path.join(job, "state", "transcript-reconciliation.json");
  writeJsonAtomic(reconciliationPath, {
    schemaVersion: "1.0.0",
    mediaFingerprint: "a".repeat(64),
    transcriptRevision: 1,
    referenceScript: {
      status: "provided",
      path: workflow.referenceScriptPath,
      sha256: workflow.referenceScriptSha256
    },
    items: [
      { id: "first-take", type: "speech-only", segmentId: "source-first", start: 0, end: 1, referenceText: null, heardText: "第一遍完整表达", resolution: "accepted-speech", releaseImpact: true, confidence: 1, evidence: { audioChecked: true, note: "First complete take" } },
      { id: "reference-point", type: "matched", segmentId: "source-later", start: 2, end: 3, referenceText: "完整观点", heardText: "第二遍完整表达", resolution: "accepted-speech", releaseImpact: true, confidence: 1, evidence: { audioChecked: true, note: "Later complete take" } },
      { id: "incomplete-take", type: "speech-only", segmentId: "source-incomplete", start: 4, end: 4.5, referenceText: null, heardText: "第三遍没有说完", resolution: "accepted-speech", releaseImpact: true, confidence: 1, evidence: { audioChecked: true, note: "Later incomplete retry" } },
      { id: "filler", type: "speech-only", segmentId: "source-filler", start: 5, end: 5.2, referenceText: null, heardText: "嗯", resolution: "accepted-speech", releaseImpact: false, confidence: 1, evidence: { audioChecked: true, note: "Filler" } }
    ],
    verification: { audioChecked: true, mediaPath: "input/source.mov", mediaFingerprintMatches: true, transcriptRevisionMatches: true, unresolvedReleaseImpactCount: 0 }
  });
  const chatcutRoughCutPath = path.join(job, "state", "chatcut-roughcut.json");
  writeJsonAtomic(chatcutRoughCutPath, {
    schemaVersion: "1.0.0",
    source: "chatcut",
    projectId: "project-test",
    timelineIds: ["timeline-front", "timeline-back"],
    activeTimelineId: "timeline-back",
    recordedAt: "2026-08-06T00:00:00.000Z"
  });

  const selectionPath = path.join(job, "state", "roughcut-selection.json");
  writeJsonAtomic(selectionPath, {
    schemaVersion: "1.0.0",
    policy: roughCutSelectionPolicy,
    sourceTranscriptSha256: workflow.sourceTranscriptSha256,
    transcriptReconciliationSha256: sha256File(reconciliationPath),
    referenceScriptSha256: workflow.referenceScriptSha256,
    chatcutRoughCutSha256: sha256File(chatcutRoughCutPath),
    verifiedAt: "2026-08-06T00:00:01.000Z",
    chatcut: { projectId: "project-test", activeTimelineId: "timeline-back" },
    selections: [{
      referenceItemIds: ["reference-point"],
      takes: [
        { id: "take-first", sourceSegmentIds: ["source-first"], disposition: "complete", audioReviewedEvidence: "Audio reviewed: first complete take." },
        { id: "take-later", sourceSegmentIds: ["source-later"], disposition: "complete", audioReviewedEvidence: "Audio reviewed: later complete take." },
        { id: "take-incomplete", sourceSegmentIds: ["source-incomplete"], disposition: "later-incomplete", audioReviewedEvidence: "Audio reviewed: the later take stops before the point." }
      ],
      selectedTakeId: "take-later"
    }],
    discards: [{
      sourceSegmentIds: ["source-filler"],
      disposition: "filler",
      audioReviewedEvidence: "Audio reviewed: isolated filler before the next point."
    }]
  });
  return selectionPath;
};
const removeRoughCutReference = (job, selectionPath) => {
  const workflowPath = path.join(job, "state", "workflow.json");
  const workflow = readJson(workflowPath);
  workflow.referenceScriptStatus = "none";
  workflow.referenceScriptPath = null;
  workflow.referenceScriptSha256 = null;
  writeJsonAtomic(workflowPath, workflow);
  const reconciliationPath = path.join(job, "state", "transcript-reconciliation.json");
  const reconciliation = readJson(reconciliationPath);
  reconciliation.referenceScript = { status: "none", path: null, sha256: null };
  for (const item of reconciliation.items) item.referenceText = null;
  writeJsonAtomic(reconciliationPath, reconciliation);
  const selection = readJson(selectionPath);
  selection.referenceScriptSha256 = null;
  selection.transcriptReconciliationSha256 = sha256File(reconciliationPath);
  for (const group of selection.selections) group.referenceItemIds = [];
  writeJsonAtomic(selectionPath, selection);
};
const prepareFallbackMedia = (job) => run("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=2:d=1",
  "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
  "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
  path.join(job, "roughcut", "a-roll.mp4")
]);

try {
  for (const invalidVisualArrangementReviewRequired of [false, "true"]) {
    assert.throws(
      () => ensureWorkflowDefaults({ visualArrangementReviewRequired: invalidVisualArrangementReviewRequired, gates: {} }),
      /visualArrangementReviewRequired may only be true when present/
    );
  }
  const legacyDefaults = ensureWorkflowDefaults({ gates: {} });
  assert.equal(Object.hasOwn(legacyDefaults, "visualArrangementReviewRequired"), false);

  const simple = ensureWorkflowDefaults({
    captionMode: "subtitles",
    visualAxisMode: "a-axis-overlay",
    currentState: "motion-plan",
    revisionId: 1,
    gates: { "rough-cut-review": { status: "approved", revisionId: 1 } },
    history: []
  });
  beginWorkflowRevision(simple);
  assert.equal(simple.revisionId, 2);
  assert.equal(simple.gates["rough-cut-review"].status, "approved");
  assert.deepEqual(Object.keys(simple.gates), ["rough-cut-review"]);

  const scaffolded = scaffold("scaffold", "review", "subtitles");
  const scaffoldedWorkflow = readJson(path.join(scaffolded, "state", "workflow.json"));
  const workflowSchema = readJson(path.join(repositoryRoot, "schemas", "workflow.schema.json"));
  assert.equal(fs.existsSync(path.join(scaffolded, "hyperframes", "index.html")), true);
  assert.equal(scaffoldedWorkflow.captionMode, "subtitles");
  assert.equal(scaffoldedWorkflow.visualArrangementReviewRequired, true);
  assert.equal(scaffoldedWorkflow.visualArrangementReviewDecision, "pending");
  assert.equal(scaffoldedWorkflow.gates["visual-arrangement-review"].status, "not-reached");
  assert.equal(workflowSchema.properties.visualArrangementReviewRequired.const, true);
  assert.ok(workflowSchema.properties.visualArrangementReviewDecision.enum.includes("automatic-accepted"));
  assert.ok(workflowSchema.properties.currentState.enum.includes("visual-arrangement-review"));
  assert.equal(scaffoldedWorkflow.roughCutSelectionPolicy, roughCutSelectionPolicy);
  assert.equal(scaffoldedWorkflow.roughCutSelectionPolicyOrigin, roughCutSelectionPolicy);
  assert.equal(scaffoldedWorkflow.roughCutSelectionFallbackWaiver, null);
  assert.equal(fs.existsSync(path.join(scaffolded, "state", "roughcut-selection.json")), true);
  assert.equal(fs.existsSync(path.join(scaffolded, "docs", "caption-plan.md")), true);
  const status = script("workflow-state.mjs", [
    path.join(scaffolded, "state", "workflow.json"),
    "status"
  ]);
  assert.equal(JSON.parse(status.stdout).currentState, "intake");
  script("workflow-state.mjs", [path.join(scaffolded, "state", "workflow.json"), "advance"]);
  assert.equal(readJson(path.join(scaffolded, "state", "workflow.json")).currentState, "transcription");

  const v2VisualRouteJob = scaffold("v2-visual-route", "review", "subtitles");
  const v2VisualRouteWorkflowPath = path.join(v2VisualRouteJob, "state", "workflow.json");
  const v2VisualRouteTranscriptPath = path.join(v2VisualRouteJob, "state", "transcript.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), v2VisualRouteTranscriptPath);
  const v2RouteTranscript = readJson(v2VisualRouteTranscriptPath);
  const v2RouteItemsPath = path.join(temporaryRoot, "v2-visual-route-items.json");
  writeJsonAtomic(v2RouteItemsPath, v2RouteTranscript.segments.map((segment, index) => ({
    id: `v2-route-speech-${index + 1}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: 1,
    evidence: { audioChecked: true, supportsReference: false, note: "V2 route fixture" }
  })));
  script("create-transcript-reconciliation.mjs", [v2VisualRouteJob, "input/source.mov", v2RouteItemsPath]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"), path.join(v2VisualRouteJob, "captions", "caption-review-plan.json"));
  fs.writeFileSync(path.join(v2VisualRouteJob, "docs", "caption-plan.md"), [
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
  const v2RouteBeatMap = readJson(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"));
  v2RouteBeatMap.visualOrchestrationVersion = 2;
  v2RouteBeatMap.materials = [];
  for (const beat of v2RouteBeatMap.beats) {
    Object.assign(beat, {
      mgScope: "none",
      recipe: "caption-only",
      components: [],
      microEvents: [],
      noMgReason: "The complete recorded sentence remains clear through subtitles alone."
    });
    delete beat.motionProfile;
    delete beat.surfaceTreatment;
    delete beat.visualDecision;
    delete beat.objectCues;
    delete beat.materialRefs;
  }
  writeJsonAtomic(path.join(v2VisualRouteJob, "state", "beat-map.json"), v2RouteBeatMap);
  fs.writeFileSync(path.join(v2VisualRouteJob, "docs", "motion-plan.md"), [
    "# Motion Plan",
    "",
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...v2RouteBeatMap.beats.map((beat) => `| ${beat.start}–${beat.end} | ${beat.text} | ${beat.axis} | ${beat.primaryFlowAxis} | ${beat.visualReference} | captions | ${beat.transitionFamily} |`),
    "",
    "Caption mode: subtitles"
  ].join("\n"));
  const v2VisualRouteWorkflow = readJson(v2VisualRouteWorkflowPath);
  Object.assign(v2VisualRouteWorkflow, {
    currentState: "motion-plan",
    pendingGate: null,
    roughCutReviewDecision: "manual-approved",
    captionMode: "subtitles",
    captionModeSource: "user",
    captionModeAcknowledged: true,
    visualAxisMode: "b-axis-stage",
    visualAxisModeSource: "user",
    visualAxisModeAcknowledged: true,
    referenceScriptAcknowledged: true,
    visualArrangementReviewRequired: true,
    visualArrangementReviewDecision: "pending"
  });
  v2VisualRouteWorkflow.gates["rough-cut-review"] = { status: "approved", artifact: "state/chatcut-roughcut.json" };
  v2VisualRouteWorkflow.gates["visual-arrangement-review"] = { status: "not-reached" };
  writeJsonAtomic(v2VisualRouteWorkflowPath, v2VisualRouteWorkflow);
  const v2VisualRouteConfirmationPath = path.join(v2VisualRouteJob, "state", "creative-confirmation.json");
  const v2VisualRouteConfirmation = readJson(v2VisualRouteConfirmationPath);
  v2VisualRouteConfirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  v2VisualRouteConfirmation.visualAxisMode = "b-axis-stage";
  v2VisualRouteConfirmation.visualAxisModeDecision = { status: "acknowledged", source: "user" };
  v2VisualRouteConfirmation.storyboard.beatCount = v2RouteBeatMap.beats.length;
  v2VisualRouteConfirmation.review = { required: false, status: "ready" };
  writeJsonAtomic(v2VisualRouteConfirmationPath, v2VisualRouteConfirmation);
  script("workflow-state.mjs", [v2VisualRouteWorkflowPath, "approve-creative", "--actor", "agent", "--note", "Validated V2 plan before the user review"]);
  script("workflow-state.mjs", [v2VisualRouteWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  const v2VisualRouteState = readJson(v2VisualRouteWorkflowPath);
  assert.equal(v2VisualRouteState.currentState, "visual-arrangement-review");
  assert.equal(v2VisualRouteState.pendingGate, "visual-arrangement-review");
  assert.equal(v2VisualRouteState.visualArrangementReviewDecision, "pending");
  run(
    path.join(repositoryRoot, "scripts", "scaffold-project.sh"),
    [scaffolded, path.join(temporaryRoot, "scaffold.mov"), "review", "subtitles"],
    false,
    /not empty/
  );

  const extensionless = path.join(temporaryRoot, "source-without-extension");
  fs.writeFileSync(extensionless, "media");
  const extensionlessJob = path.join(temporaryRoot, "extensionless");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [extensionlessJob, extensionless, "review"]);
  assert.equal(fs.existsSync(path.join(extensionlessJob, "input", "source.media")), true);

  const validV21Cover = scaffold("valid-v21-cover", "review");
  prepareCover(validV21Cover);
  const validV21Record = readJson(path.join(validV21Cover, "state", "cover.json"));
  assert.equal(validV21Record.frameCandidates.length, 24);
  assert.equal(validV21Record.renderedCandidates.length, 6);
  script("check-cover.mjs", [path.join(validV21Cover, "state", "workflow.json"), "--ready"]);

  const readableV20Cover = scaffold("readable-v20-cover", "review");
  prepareCover(readableV20Cover, { schemaVersion: "2.0.0" });
  assert.equal(readJson(path.join(readableV20Cover, "state", "cover.json")).frameCandidates.length, 8);
  script("check-cover.mjs", [path.join(readableV20Cover, "state", "workflow.json"), "--ready"]);

  const readableLegacyV1Cover = scaffold("readable-legacy-v1-cover", "review");
  prepareLegacyCover(readableLegacyV1Cover);
  assert.equal(readJson(path.join(readableLegacyV1Cover, "state", "cover.json")).frameCandidates.length, 8);
  script("check-cover.mjs", [path.join(readableLegacyV1Cover, "state", "workflow.json"), "--ready"]);

  const wrongSizeCover = scaffold("wrong-size-cover", "review");
  prepareCover(wrongSizeCover, { outputHeight: 1439 });
  script(
    "workflow-state.mjs",
    [path.join(wrongSizeCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject wrong size"],
    false,
    /1080x1440/i
  );

  const mismatchedCover = scaffold("mismatched-cover", "review");
  prepareCover(mismatchedCover, { recordedSha256: "a".repeat(64) });
  script(
    "workflow-state.mjs",
    [path.join(mismatchedCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject changed file"],
    false,
    /SHA-256/i
  );

  const internalCopyCover = scaffold("internal-copy-cover", "review");
  prepareCover(internalCopyCover);
  const internalCopyRecordPath = path.join(internalCopyCover, "state", "cover.json");
  const internalCopyRecord = readJson(internalCopyRecordPath);
  internalCopyRecord.renderedCandidates[0].headlineLines = ["粗剪完成", "公开结论"];
  writeJsonAtomic(internalCopyRecordPath, internalCopyRecord);
  script(
    "workflow-state.mjs",
    [path.join(internalCopyCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject internal wording"],
    false,
    /internal production language/i
  );

  const missingPreviewCover = scaffold("missing-rendered-preview", "review");
  prepareCover(missingPreviewCover);
  fs.unlinkSync(path.join(missingPreviewCover, "previews", "cover", "cover-6.png"));
  script(
    "workflow-state.mjs",
    [path.join(missingPreviewCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject missing rendered preview"],
    false,
    /rendered preview/i
  );

  const wrongFrameCountCover = scaffold("wrong-frame-count", "review");
  prepareCover(wrongFrameCountCover);
  const wrongFrameCountRecordPath = path.join(wrongFrameCountCover, "state", "cover.json");
  const wrongFrameCountRecord = readJson(wrongFrameCountRecordPath);
  wrongFrameCountRecord.frameCandidates.pop();
  writeJsonAtomic(wrongFrameCountRecordPath, wrongFrameCountRecord);
  script(
    "workflow-state.mjs",
    [path.join(wrongFrameCountCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject incomplete frame round"],
    false,
    /exactly twenty-four/i
  );

  const wrongRenderedCandidateCountCover = scaffold("wrong-rendered-candidate-count", "review");
  prepareCover(wrongRenderedCandidateCountCover);
  const wrongRenderedCandidateCountRecordPath = path.join(wrongRenderedCandidateCountCover, "state", "cover.json");
  const wrongRenderedCandidateCountRecord = readJson(wrongRenderedCandidateCountRecordPath);
  wrongRenderedCandidateCountRecord.renderedCandidates.pop();
  writeJsonAtomic(wrongRenderedCandidateCountRecordPath, wrongRenderedCandidateCountRecord);
  script(
    "workflow-state.mjs",
    [path.join(wrongRenderedCandidateCountCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject incomplete public cover choices"],
    false,
    /exactly six/i
  );

  const mismatchedCoverBaseSourceCover = scaffold("mismatched-cover-base-source", "review");
  prepareCover(mismatchedCoverBaseSourceCover);
  const mismatchedCoverBaseSourceRecordPath = path.join(mismatchedCoverBaseSourceCover, "state", "cover.json");
  const mismatchedCoverBaseSourceRecord = readJson(mismatchedCoverBaseSourceRecordPath);
  mismatchedCoverBaseSourceRecord.coverBase.sourceFrameId = "frame-02";
  writeJsonAtomic(mismatchedCoverBaseSourceRecordPath, mismatchedCoverBaseSourceRecord);
  script(
    "workflow-state.mjs",
    [path.join(mismatchedCoverBaseSourceCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject unrelated cover base source"],
    false,
    /cover base.*selected frame|selected frame.*cover base/i
  );

  const tamperedCoverBaseCover = scaffold("tampered-cover-base", "review");
  prepareCover(tamperedCoverBaseCover);
  const tamperedCoverBaseRecordPath = path.join(tamperedCoverBaseCover, "state", "cover.json");
  const tamperedCoverBaseRecord = readJson(tamperedCoverBaseRecordPath);
  tamperedCoverBaseRecord.coverBase.sha256 = "b".repeat(64);
  writeJsonAtomic(tamperedCoverBaseRecordPath, tamperedCoverBaseRecord);
  script(
    "workflow-state.mjs",
    [path.join(tamperedCoverBaseCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject changed cover base"],
    false,
    /cover base.*SHA-256|SHA-256.*cover base/i
  );

  const wrongCoverBaseDimensionsCover = scaffold("wrong-cover-base-dimensions", "review");
  prepareCover(wrongCoverBaseDimensionsCover);
  const wrongCoverBaseDimensionsRecordPath = path.join(wrongCoverBaseDimensionsCover, "state", "cover.json");
  const wrongCoverBaseDimensionsRecord = readJson(wrongCoverBaseDimensionsRecordPath);
  const wrongCoverBasePath = path.join(wrongCoverBaseDimensionsCover, "previews", "cover", "base.png");
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1439",
    "-frames:v", "1", wrongCoverBasePath
  ]);
  wrongCoverBaseDimensionsRecord.coverBase.sha256 = sha256File(wrongCoverBasePath);
  writeJsonAtomic(wrongCoverBaseDimensionsRecordPath, wrongCoverBaseDimensionsRecord);
  script(
    "workflow-state.mjs",
    [path.join(wrongCoverBaseDimensionsCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject wrong cover base dimensions"],
    false,
    /cover base.*1080x1440|1080x1440.*cover base/i
  );

  for (const visualReviewField of ["subjectIntegrity", "headlineAboveEyes", "thumbnailReadable", "noOpaqueTextBackdrop", "noDarkGradient", "safeAreaChecked"]) {
    const failedVisualReviewCover = scaffold(`failed-cover-visual-review-${visualReviewField}`, "review");
    prepareCover(failedVisualReviewCover);
    const failedVisualReviewRecordPath = path.join(failedVisualReviewCover, "state", "cover.json");
    const failedVisualReviewRecord = readJson(failedVisualReviewRecordPath);
    failedVisualReviewRecord.visualReview[visualReviewField] = false;
    writeJsonAtomic(failedVisualReviewRecordPath, failedVisualReviewRecord);
    script(
      "workflow-state.mjs",
      [path.join(failedVisualReviewCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", `Reject failed ${visualReviewField} review`],
      false,
      /visual review|subject integrity|thumbnail|opaque text backdrop|safe area/i
    );
  }

  const legacyCoverCopyFieldsCover = scaffold("legacy-cover-copy-fields", "review");
  prepareCover(legacyCoverCopyFieldsCover);
  const legacyCoverCopyFieldsRecordPath = path.join(legacyCoverCopyFieldsCover, "state", "cover.json");
  const legacyCoverCopyFieldsRecord = readJson(legacyCoverCopyFieldsRecordPath);
  legacyCoverCopyFieldsRecord.renderedCandidates[0].topLines = ["旧字段"];
  legacyCoverCopyFieldsRecord.renderedCandidates[0].bottomLines = ["仍然存在"];
  writeJsonAtomic(legacyCoverCopyFieldsRecordPath, legacyCoverCopyFieldsRecord);
  script(
    "workflow-state.mjs",
    [path.join(legacyCoverCopyFieldsCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject legacy text layout fields"],
    false,
    /legacy|topLines|bottomLines/i
  );

  const extendedEnvironmentCover = scaffold("extended-environment-cover", "review");
  prepareCover(extendedEnvironmentCover);
  const extendedEnvironmentRecordPath = path.join(extendedEnvironmentCover, "state", "cover.json");
  const extendedEnvironmentRecord = readJson(extendedEnvironmentRecordPath);
  extendedEnvironmentRecord.coverBase.method = "subject-cutout-environment-extend";
  writeJsonAtomic(extendedEnvironmentRecordPath, extendedEnvironmentRecord);
  script(
    "workflow-state.mjs",
    [path.join(extendedEnvironmentCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject cutout and extension"],
    false,
    /direct-source-crop|cutout|extend/i
  );

  const mismatchedRenderedFrameCover = scaffold("mismatched-rendered-frame", "review");
  prepareCover(mismatchedRenderedFrameCover);
  const mismatchedRenderedFrameRecordPath = path.join(mismatchedRenderedFrameCover, "state", "cover.json");
  const mismatchedRenderedFrameRecord = readJson(mismatchedRenderedFrameRecordPath);
  mismatchedRenderedFrameRecord.renderedCandidates[5].frameId = "frame-02";
  writeJsonAtomic(mismatchedRenderedFrameRecordPath, mismatchedRenderedFrameRecord);
  script(
    "workflow-state.mjs",
    [path.join(mismatchedRenderedFrameCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject different preview frame"],
    false,
    /selected frame/i
  );

  const mismatchedRenderedBaseCover = scaffold("mismatched-rendered-base", "review");
  prepareCover(mismatchedRenderedBaseCover);
  const mismatchedRenderedBaseRecordPath = path.join(mismatchedRenderedBaseCover, "state", "cover.json");
  const mismatchedRenderedBaseRecord = readJson(mismatchedRenderedBaseRecordPath);
  fs.copyFileSync(
    path.join(mismatchedRenderedBaseCover, "previews", "cover", "base.png"),
    path.join(mismatchedRenderedBaseCover, "previews", "cover", "alternate-base.png")
  );
  mismatchedRenderedBaseRecord.renderedCandidates[5].basePath = "previews/cover/alternate-base.png";
  writeJsonAtomic(mismatchedRenderedBaseRecordPath, mismatchedRenderedBaseRecord);
  script(
    "workflow-state.mjs",
    [path.join(mismatchedRenderedBaseCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject different cover base"],
    false,
    /cover base|base path/i
  );

  const candidatesDetachedFromCoverBase = scaffold("candidates-detached-from-cover-base", "review");
  prepareCover(candidatesDetachedFromCoverBase);
  const candidatesDetachedFromCoverBaseRecordPath = path.join(candidatesDetachedFromCoverBase, "state", "cover.json");
  const candidatesDetachedFromCoverBaseRecord = readJson(candidatesDetachedFromCoverBaseRecordPath);
  fs.copyFileSync(
    path.join(candidatesDetachedFromCoverBase, "previews", "cover", "base.png"),
    path.join(candidatesDetachedFromCoverBase, "previews", "cover", "alternate-base.png")
  );
  for (const candidate of candidatesDetachedFromCoverBaseRecord.renderedCandidates) {
    candidate.basePath = "previews/cover/alternate-base.png";
  }
  writeJsonAtomic(candidatesDetachedFromCoverBaseRecordPath, candidatesDetachedFromCoverBaseRecord);
  script(
    "workflow-state.mjs",
    [path.join(candidatesDetachedFromCoverBase, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject candidates detached from cover base"],
    false,
    /cover base|base path/i
  );

  const duplicateHeadlineCover = scaffold("duplicate-cover-headline", "review");
  prepareCover(duplicateHeadlineCover);
  const duplicateHeadlineRecordPath = path.join(duplicateHeadlineCover, "state", "cover.json");
  const duplicateHeadlineRecord = readJson(duplicateHeadlineRecordPath);
  duplicateHeadlineRecord.renderedCandidates[5].headlineLines = [...duplicateHeadlineRecord.renderedCandidates[0].headlineLines];
  writeJsonAtomic(duplicateHeadlineRecordPath, duplicateHeadlineRecord);
  script(
    "workflow-state.mjs",
    [path.join(duplicateHeadlineCover, "state", "workflow.json"), "approve-cover", "--actor", "user", "--note", "Reject duplicate cover copy"],
    false,
    /distinct|duplicate|headline|copy/i
  );

  const approvedCover = scaffold("approved-cover", "review");
  const approvedCoverWorkflow = path.join(approvedCover, "state", "workflow.json");
  script("workflow-state.mjs", [approvedCoverWorkflow, "advance"]);
  assert.equal(readJson(approvedCoverWorkflow).currentState, "transcription");
  prepareReconciledTranscript(approvedCover);
  const transcriptAdvance = [approvedCoverWorkflow, "advance", "--artifact", "state/transcript.json"];
  script("workflow-state.mjs", transcriptAdvance, false, /approved cover/i);
  assert.equal(fs.existsSync(path.join(approvedCover, "state", "source-transcript.json")), false);
  prepareCover(approvedCover);
  script("workflow-state.mjs", transcriptAdvance, false, /approved cover/i);
  approveCover(approvedCoverWorkflow);
  assert.equal(readJson(approvedCoverWorkflow).coverReviewDecision, "approved");
  const approvedCoverBytes = fs.readFileSync(path.join(approvedCover, "output", "cover.png"));
  fs.appendFileSync(path.join(approvedCover, "output", "cover.png"), "changed");
  script("workflow-state.mjs", transcriptAdvance, false, /Cover validation failed/i);
  assert.equal(readJson(approvedCoverWorkflow).currentState, "transcription");
  assert.equal(fs.existsSync(path.join(approvedCover, "state", "source-transcript.json")), false);
  fs.writeFileSync(path.join(approvedCover, "output", "cover.png"), approvedCoverBytes);
  script("workflow-state.mjs", transcriptAdvance);
  assert.equal(readJson(approvedCoverWorkflow).currentState, "rough-cut");
  const revisedCover = readJson(path.join(approvedCover, "state", "cover.json"));
  revisedCover.status = "ready";
  revisedCover.output.sha256 = null;
  revisedCover.review = { status: "pending", actor: null, decidedAt: null, note: null };
  writeJsonAtomic(path.join(approvedCover, "state", "cover.json"), revisedCover);
  approveCover(approvedCoverWorkflow);
  assert.equal(readJson(approvedCoverWorkflow).currentState, "rough-cut");

  for (const returnState of ["rough-cut", "motion-plan"]) {
    const returnJob = scaffold(`transcript-return-${returnState}`, "review");
    const returnWorkflowPath = path.join(returnJob, "state", "workflow.json");
    prepareReconciledTranscript(returnJob);
    const returnWorkflow = readJson(returnWorkflowPath);
    returnWorkflow.currentState = "transcription";
    returnWorkflow.reconciliationReturnState = returnState;
    writeJsonAtomic(returnWorkflowPath, returnWorkflow);
    const returnAdvance = [returnWorkflowPath, "advance", "--artifact", "state/transcript.json"];
    if (returnState === "rough-cut") {
      script("workflow-state.mjs", returnAdvance, false, /approved cover/i);
      prepareCover(returnJob);
      approveCover(returnWorkflowPath);
    }
    script("workflow-state.mjs", returnAdvance);
    assert.equal(readJson(returnWorkflowPath).currentState, returnState);
    assert.equal(readJson(returnWorkflowPath).reconciliationReturnState, null);
  }

  const modeJob = scaffold("mode", "review");
  const modeWorkflow = path.join(modeJob, "state", "workflow.json");
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "motion-copy", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), false);
  assert.equal(readJson(path.join(modeJob, "state", "creative-confirmation.json")).storyboard.captionPlan, undefined);
  script("workflow-state.mjs", [modeWorkflow, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  assert.equal(readJson(path.join(modeJob, "state", "creative-confirmation.json")).visualAxisMode, "b-axis-stage");
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "subtitles", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), true);

  const legacyIntakeCaptionChange = legacyWorkflowAt("legacy-intake-caption-change", "intake");
  script("workflow-state.mjs", [legacyIntakeCaptionChange.workflowPath, "set-caption-mode", "motion-copy", "--actor", "user"]);
  const upgradedLegacyIntakeCaption = readJson(legacyIntakeCaptionChange.workflowPath);
  assert.equal(upgradedLegacyIntakeCaption.currentState, "intake");
  assert.equal(upgradedLegacyIntakeCaption.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyIntakeCaption.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyIntakeCaption.gates["visual-arrangement-review"].status, "not-reached");

  const legacyRoughCutExportAxisChange = legacyWorkflowAt("legacy-rough-cut-export-axis-change", "rough-cut-export");
  script("workflow-state.mjs", [legacyRoughCutExportAxisChange.workflowPath, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  const upgradedLegacyRoughCutExportAxis = readJson(legacyRoughCutExportAxisChange.workflowPath);
  assert.equal(upgradedLegacyRoughCutExportAxis.currentState, "rough-cut-export");
  assert.equal(upgradedLegacyRoughCutExportAxis.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyRoughCutExportAxis.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyRoughCutExportAxis.gates["visual-arrangement-review"].status, "not-reached");

  const legacyIntakeReferenceChange = legacyWorkflowAt("legacy-intake-reference-change", "intake");
  const legacyIntakeReferencePath = path.join(temporaryRoot, "legacy-intake-reference.md");
  fs.writeFileSync(legacyIntakeReferencePath, "入场前更新的参考稿\n");
  script("register-reference-script.mjs", [legacyIntakeReferenceChange.workflowPath, "provided", legacyIntakeReferencePath, "--actor", "user"]);
  const upgradedLegacyIntakeReference = readJson(legacyIntakeReferenceChange.workflowPath);
  assert.equal(upgradedLegacyIntakeReference.currentState, "intake");
  assert.equal(upgradedLegacyIntakeReference.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyIntakeReference.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyIntakeReference.gates["visual-arrangement-review"].status, "not-reached");

  const legacyNoopInputs = legacyWorkflowAt("legacy-noop-inputs", "intake");
  script("workflow-state.mjs", [legacyNoopInputs.workflowPath, "set-caption-mode", "subtitles", "--actor", "user"]);
  script("workflow-state.mjs", [legacyNoopInputs.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "user"]);
  script("register-reference-script.mjs", [legacyNoopInputs.workflowPath, "none", "--actor", "user"]);
  const preservedLegacyNoopInputs = readJson(legacyNoopInputs.workflowPath);
  assert.equal(preservedLegacyNoopInputs.currentState, "intake");
  assert.equal(Object.hasOwn(preservedLegacyNoopInputs, "visualArrangementReviewRequired"), false);
  assert.equal(Object.hasOwn(preservedLegacyNoopInputs.gates, "visual-arrangement-review"), false);

  const legacyRoughCutReopen = scaffold("legacy-rough-cut-reopen", "review");
  const legacyRoughCutWorkflowPath = path.join(legacyRoughCutReopen, "state", "workflow.json");
  const legacyRoughCutWorkflow = readJson(legacyRoughCutWorkflowPath);
  delete legacyRoughCutWorkflow.visualArrangementReviewRequired;
  delete legacyRoughCutWorkflow.visualArrangementReviewDecision;
  delete legacyRoughCutWorkflow.gates["visual-arrangement-review"];
  legacyRoughCutWorkflow.currentState = "complete";
  legacyRoughCutWorkflow.completed = true;
  writeJsonAtomic(legacyRoughCutWorkflowPath, legacyRoughCutWorkflow);
  script("workflow-state.mjs", [legacyRoughCutWorkflowPath, "reopen", "rough-cut", "--actor", "user", "--note", "Revise legacy rough cut"]);
  const upgradedLegacyRoughCut = readJson(legacyRoughCutWorkflowPath);
  assert.equal(upgradedLegacyRoughCut.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyRoughCut.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyRoughCut.gates["visual-arrangement-review"].status, "not-reached");

  const legacyReplan = legacyMotionPlanReturn("legacy-replan-visual-review");
  script("workflow-state.mjs", [legacyReplan.workflowPath, "replan", "--note", "Create a revised visual plan"]);
  assertLegacyMotionPlanReturnEnablesVisualReview(legacyReplan.workflowPath);

  const legacyCaptionChange = legacyMotionPlanReturn("legacy-caption-change-visual-review");
  script("workflow-state.mjs", [legacyCaptionChange.workflowPath, "set-caption-mode", "motion-copy", "--actor", "user"]);
  assertLegacyMotionPlanReturnEnablesVisualReview(legacyCaptionChange.workflowPath);

  const legacyAxisChange = legacyMotionPlanReturn("legacy-axis-change-visual-review");
  script("workflow-state.mjs", [legacyAxisChange.workflowPath, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  assertLegacyMotionPlanReturnEnablesVisualReview(legacyAxisChange.workflowPath);

  const legacyReferenceChange = legacyMotionPlanReturn("legacy-reference-change-visual-review");
  const legacyReferencePath = path.join(temporaryRoot, "legacy-reference-change.md");
  fs.writeFileSync(legacyReferencePath, "更新后的参考稿\n");
  script("register-reference-script.mjs", [legacyReferenceChange.workflowPath, "provided", legacyReferencePath, "--actor", "user"]);
  const upgradedLegacyReference = readJson(legacyReferenceChange.workflowPath);
  assert.equal(upgradedLegacyReference.currentState, "transcription");
  assert.equal(upgradedLegacyReference.reconciliationReturnState, "motion-plan");
  assert.equal(upgradedLegacyReference.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyReference.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyReference.gates["visual-arrangement-review"].status, "not-reached");

  const legacyPreRoughCutReferenceJob = scaffold("legacy-pre-rough-cut-reference-visual-review", "review");
  const legacyPreRoughCutReferenceWorkflowPath = path.join(legacyPreRoughCutReferenceJob, "state", "workflow.json");
  const legacyPreRoughCutReferenceWorkflow = readJson(legacyPreRoughCutReferenceWorkflowPath);
  delete legacyPreRoughCutReferenceWorkflow.visualArrangementReviewRequired;
  delete legacyPreRoughCutReferenceWorkflow.visualArrangementReviewDecision;
  delete legacyPreRoughCutReferenceWorkflow.gates["visual-arrangement-review"];
  legacyPreRoughCutReferenceWorkflow.currentState = "rough-cut";
  legacyPreRoughCutReferenceWorkflow.pendingGate = null;
  writeJsonAtomic(legacyPreRoughCutReferenceWorkflowPath, legacyPreRoughCutReferenceWorkflow);
  const legacyPreRoughCutReferencePath = path.join(temporaryRoot, "legacy-pre-rough-cut-reference.md");
  fs.writeFileSync(legacyPreRoughCutReferencePath, "粗剪前更新的参考稿\n");
  script("register-reference-script.mjs", [legacyPreRoughCutReferenceWorkflowPath, "provided", legacyPreRoughCutReferencePath, "--actor", "user"]);
  const upgradedLegacyPreRoughCutReference = readJson(legacyPreRoughCutReferenceWorkflowPath);
  assert.equal(upgradedLegacyPreRoughCutReference.currentState, "transcription");
  assert.equal(upgradedLegacyPreRoughCutReference.reconciliationReturnState, "rough-cut");
  assert.equal(upgradedLegacyPreRoughCutReference.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyPreRoughCutReference.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyPreRoughCutReference.gates["visual-arrangement-review"].status, "not-reached");

  const unchangedLegacyReferenceJob = scaffold("unchanged-legacy-reference", "review");
  const unchangedLegacyReferenceWorkflowPath = path.join(unchangedLegacyReferenceJob, "state", "workflow.json");
  const unchangedLegacyReferenceWorkflow = readJson(unchangedLegacyReferenceWorkflowPath);
  delete unchangedLegacyReferenceWorkflow.visualArrangementReviewRequired;
  delete unchangedLegacyReferenceWorkflow.visualArrangementReviewDecision;
  delete unchangedLegacyReferenceWorkflow.gates["visual-arrangement-review"];
  unchangedLegacyReferenceWorkflow.currentState = "rough-cut";
  unchangedLegacyReferenceWorkflow.pendingGate = null;
  writeJsonAtomic(unchangedLegacyReferenceWorkflowPath, unchangedLegacyReferenceWorkflow);
  script("register-reference-script.mjs", [unchangedLegacyReferenceWorkflowPath, "none", "--actor", "user"]);
  const unchangedLegacyReference = readJson(unchangedLegacyReferenceWorkflowPath);
  assert.equal(unchangedLegacyReference.currentState, "rough-cut");
  assert.equal(Object.hasOwn(unchangedLegacyReference, "visualArrangementReviewRequired"), false);
  assert.equal(Object.hasOwn(unchangedLegacyReference.gates, "visual-arrangement-review"), false);

  const rejectedAutoJob = path.join(temporaryRoot, "auto-mode-rejected");
  const rejectedAutoSource = path.join(temporaryRoot, "auto-mode-rejected.mov");
  fs.writeFileSync(rejectedAutoSource, "media");
  run(
    path.join(repositoryRoot, "scripts", "scaffold-project.sh"),
    [rejectedAutoJob, rejectedAutoSource, "auto"],
    false,
    /initialize.*review.*workflow-state\.mjs.*set-mode auto --actor user/i
  );
  assert.equal(fs.existsSync(rejectedAutoJob), false);

  const autoModeJob = scaffold("auto-mode", "review");
  const autoModeWorkflowPath = path.join(autoModeJob, "state", "workflow.json");
  script("workflow-state.mjs", [autoModeWorkflowPath, "set-mode", "auto", "--actor", "user"]);
  const autoModeWorkflow = readJson(path.join(autoModeJob, "state", "workflow.json"));
  assert.equal(autoModeWorkflow.mode, "auto");

  const selectionJob = scaffold("roughcut-selection", "review");
  const selectionWorkflow = path.join(selectionJob, "state", "workflow.json");
  const selectionPath = prepareRoughCutSelection(selectionJob);
  script("check-roughcut-selection.mjs", [selectionWorkflow]);

  prepareRoughCutSelection(selectionJob);
  let selection = readJson(selectionPath);
  const staleChatcutRecordPath = path.join(selectionJob, "state", "chatcut-roughcut.json");
  const staleChatcutRecord = readJson(staleChatcutRecordPath);
  staleChatcutRecord.recordedAt = "2026-08-06T00:00:02.000Z";
  writeJsonAtomic(staleChatcutRecordPath, staleChatcutRecord);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /ChatCut rough-cut SHA-256 is stale/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.verifiedAt = "2026-08-05T23:59:59.000Z";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /verifiedAt.*recordedAt/i);

  prepareRoughCutSelection(selectionJob);
  const omittedReconciliationPath = path.join(selectionJob, "state", "transcript-reconciliation.json");
  const omittedReconciliation = readJson(omittedReconciliationPath);
  omittedReconciliation.items.find((item) => item.id === "reference-point").resolution = "omitted-unspoken";
  writeJsonAtomic(omittedReconciliationPath, omittedReconciliation);
  selection = readJson(selectionPath);
  selection.transcriptReconciliationSha256 = sha256File(omittedReconciliationPath);
  selection.selections[0].referenceItemIds = [];
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow]);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.selections[0].takes = selection.selections[0].takes.filter((take) => take.id !== "take-first");
  selection.discards.push({
    sourceSegmentIds: ["source-first"],
    disposition: "false-start",
    audioReviewedEvidence: "Audio reviewed: release-impact content was not selected."
  });
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /release-impact.*cannot be discarded/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.discards[0].disposition = "other";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /invalid discard disposition/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.selections[0].takes.find((take) => take.id === "take-later").audioReviewedEvidence = "";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /candidate take.*audio-reviewed evidence/i);

  prepareRoughCutSelection(selectionJob);
  removeRoughCutReference(selectionJob, selectionPath);
  script("check-roughcut-selection.mjs", [selectionWorkflow]);

  prepareRoughCutSelection(selectionJob);

  selection = readJson(selectionPath);
  selection.selections[0].selectedTakeId = "take-first";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /latest.*complete|later complete/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.selections[0].selectedTakeId = "take-first";
  const rejectedReferenceTake = selection.selections[0].takes.find((take) => take.id === "take-later");
  rejectedReferenceTake.disposition = "later-mistake";
  rejectedReferenceTake.audioReviewedEvidence = "Audio reviewed: the later take is a mistake.";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /reference-backed.*selected|selected complete take.*reference/i);

  for (const disposition of ["later-incomplete", "later-mistake", "later-content-loss"]) {
    prepareRoughCutSelection(selectionJob);
    removeRoughCutReference(selectionJob, selectionPath);
    selection = readJson(selectionPath);
    selection.selections[0].selectedTakeId = "take-first";
    const laterTake = selection.selections[0].takes.find((take) => take.id === "take-later");
    laterTake.disposition = disposition;
    laterTake.audioReviewedEvidence = `Audio reviewed: ${disposition}.`;
    writeJsonAtomic(selectionPath, selection);
    script("check-roughcut-selection.mjs", [selectionWorkflow]);
    laterTake.audioReviewedEvidence = "";
    writeJsonAtomic(selectionPath, selection);
    script("check-roughcut-selection.mjs", [selectionWorkflow], false, /audio-reviewed evidence/i);
  }

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.selections[0].referenceItemIds = [];
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /reference.*exactly once|reference.*coverage/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.chatcut.activeTimelineId = "timeline-stale";
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /active.*timeline/i);

  prepareRoughCutSelection(selectionJob);
  selection = readJson(selectionPath);
  selection.discards = [];
  writeJsonAtomic(selectionPath, selection);
  script("check-roughcut-selection.mjs", [selectionWorkflow], false, /classif|source-filler/i);

  const prepareChatcutReviewJob = (name, mode = "review") => {
    const job = scaffold(name, mode);
    const workflowPath = path.join(job, "state", "workflow.json");
    prepareRoughCutSelection(job);
    const workflow = readJson(workflowPath);
    workflow.currentState = "rough-cut";
    workflow.pendingGate = null;
    workflow.authoritativeMediaPath = null;
    workflow.authoritativeMediaSha256 = null;
    workflow.gates["rough-cut-review"] = { status: "not-reached" };
    writeJsonAtomic(workflowPath, workflow);
    return { job, workflowPath };
  };
  const prepareWaivedFallbackReview = (name) => {
    const fallback = prepareChatcutReviewJob(name);
    const projectPath = path.join(fallback.job, "state", "project.json");
    const project = readJson(projectPath);
    project.roughCutEngine = "ffmpeg-fallback";
    writeJsonAtomic(projectPath, project);
    script("workflow-state.mjs", [
      fallback.workflowPath,
      "waive-v1-roughcut-selection-for-ffmpeg-fallback",
      "--actor",
      "user",
      "--note",
      "User accepts the conservative fallback."
    ]);
    prepareFallbackMedia(fallback.job);
    script("workflow-state.mjs", [
      fallback.workflowPath,
      "advance",
      "--artifact",
      "roughcut/a-roll.mp4"
    ]);
    assert.equal(readJson(fallback.workflowPath).currentState, "rough-cut-review");
    return fallback;
  };

  const missingRoughCutSelection = prepareChatcutReviewJob("chatcut-missing-selection");
  fs.unlinkSync(path.join(missingRoughCutSelection.job, "state", "roughcut-selection.json"));
  script("workflow-state.mjs", [
    missingRoughCutSelection.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ], false, /rough-cut selection.*missing|selection.*missing/i);

  const invalidRoughCutSelection = prepareChatcutReviewJob("chatcut-invalid-selection");
  const invalidSelectionPath = path.join(invalidRoughCutSelection.job, "state", "roughcut-selection.json");
  const invalidSelection = readJson(invalidSelectionPath);
  invalidSelection.sourceTranscriptSha256 = "b".repeat(64);
  writeJsonAtomic(invalidSelectionPath, invalidSelection);
  script("workflow-state.mjs", [
    invalidRoughCutSelection.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ], false, /rough-cut selection.*source transcript.*SHA-256|source transcript.*SHA-256/i);

  const legacyRoughCutSelection = prepareChatcutReviewJob("chatcut-legacy-selection");
  const legacyWorkflow = readJson(legacyRoughCutSelection.workflowPath);
  delete legacyWorkflow.roughCutSelectionPolicy;
  delete legacyWorkflow.roughCutSelectionPolicyOrigin;
  delete legacyWorkflow.roughCutSelectionFallbackWaiver;
  writeJsonAtomic(legacyRoughCutSelection.workflowPath, legacyWorkflow);
  fs.unlinkSync(path.join(legacyRoughCutSelection.job, "state", "roughcut-selection.json"));
  script("workflow-state.mjs", [
    legacyRoughCutSelection.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  assert.equal(readJson(legacyRoughCutSelection.workflowPath).currentState, "rough-cut-review");
  script("workflow-state.mjs", [legacyRoughCutSelection.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Legacy caption recommendation"]);
  script("workflow-state.mjs", [legacyRoughCutSelection.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Legacy A-axis recommendation"]);
  script("workflow-state.mjs", [legacyRoughCutSelection.workflowPath, "approve", "--actor", "user", "--note", "Approve legacy ChatCut review"]);
  assert.equal(readJson(legacyRoughCutSelection.workflowPath).currentState, "rough-cut-export");

  const noEngineFallback = prepareChatcutReviewJob("ffmpeg-fallback-no-engine");
  const noEngineWorkflow = readJson(noEngineFallback.workflowPath);
  noEngineWorkflow.roughCutSelectionPolicy = null;
  noEngineWorkflow.roughCutSelectionPolicyOrigin = null;
  writeJsonAtomic(noEngineFallback.workflowPath, noEngineWorkflow);
  prepareFallbackMedia(noEngineFallback.job);
  script("workflow-state.mjs", [
    noEngineFallback.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ], false, /project\.roughCutEngine=ffmpeg-fallback/i);

  const noWaiverFallback = prepareChatcutReviewJob("ffmpeg-fallback-no-waiver");
  const noWaiverWorkflow = readJson(noWaiverFallback.workflowPath);
  noWaiverWorkflow.roughCutSelectionPolicy = null;
  noWaiverWorkflow.roughCutSelectionPolicyOrigin = roughCutSelectionPolicy;
  writeJsonAtomic(noWaiverFallback.workflowPath, noWaiverWorkflow);
  const noWaiverProjectPath = path.join(noWaiverFallback.job, "state", "project.json");
  const noWaiverProject = readJson(noWaiverProjectPath);
  noWaiverProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(noWaiverProjectPath, noWaiverProject);
  prepareFallbackMedia(noWaiverFallback.job);
  script("workflow-state.mjs", [
    noWaiverFallback.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ], false, /requires an explicit user waiver|waive-v1-roughcut-selection-for-ffmpeg-fallback/i);

  const selectionFileWithoutOrigin = prepareChatcutReviewJob("ffmpeg-fallback-selection-file-no-origin");
  const selectionFileWithoutOriginWorkflow = readJson(selectionFileWithoutOrigin.workflowPath);
  selectionFileWithoutOriginWorkflow.roughCutSelectionPolicy = null;
  delete selectionFileWithoutOriginWorkflow.roughCutSelectionPolicyOrigin;
  writeJsonAtomic(selectionFileWithoutOrigin.workflowPath, selectionFileWithoutOriginWorkflow);
  const selectionFileWithoutOriginProjectPath = path.join(selectionFileWithoutOrigin.job, "state", "project.json");
  const selectionFileWithoutOriginProject = readJson(selectionFileWithoutOriginProjectPath);
  selectionFileWithoutOriginProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(selectionFileWithoutOriginProjectPath, selectionFileWithoutOriginProject);
  prepareFallbackMedia(selectionFileWithoutOrigin.job);
  script("workflow-state.mjs", [
    selectionFileWithoutOrigin.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ], false, /roughcut-selection\.json.*V1 origin|V1 origin.*roughcut-selection\.json/i);

  const missingActorWaiver = prepareChatcutReviewJob("ffmpeg-fallback-missing-actor-waiver");
  const missingActorProjectPath = path.join(missingActorWaiver.job, "state", "project.json");
  const missingActorProject = readJson(missingActorProjectPath);
  missingActorProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(missingActorProjectPath, missingActorProject);
  script("workflow-state.mjs", [
    missingActorWaiver.workflowPath,
    "waive-v1-roughcut-selection-for-ffmpeg-fallback",
    "--note",
    "Must not infer a user actor"
  ], false, /requires --actor user/i);

  const waivedFallback = prepareChatcutReviewJob("ffmpeg-fallback-waived");
  const waivedProjectPath = path.join(waivedFallback.job, "state", "project.json");
  const waivedProject = readJson(waivedProjectPath);
  waivedProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(waivedProjectPath, waivedProject);
  script("workflow-state.mjs", [
    waivedFallback.workflowPath,
    "waive-v1-roughcut-selection-for-ffmpeg-fallback",
    "--actor",
    "agent",
    "--note",
    "Attempted agent-only downgrade"
  ], false, /requires --actor user/i);
  script("workflow-state.mjs", [
    waivedFallback.workflowPath,
    "waive-v1-roughcut-selection-for-ffmpeg-fallback",
    "--actor",
    "user"
  ], false, /requires --note/i);
  const waiverReason = "ChatCut is unavailable; user accepts the conservative legacy fallback.";
  script("workflow-state.mjs", [
    waivedFallback.workflowPath,
    "waive-v1-roughcut-selection-for-ffmpeg-fallback",
    "--actor",
    "user",
    "--note",
    waiverReason
  ]);
  const waivedWorkflow = readJson(waivedFallback.workflowPath);
  assert.equal(waivedWorkflow.roughCutSelectionPolicy, null);
  assert.equal(waivedWorkflow.roughCutSelectionPolicyOrigin, roughCutSelectionPolicy);
  assert.equal(waivedWorkflow.roughCutSelectionFallbackWaiver.actor, "user");
  assert.equal(waivedWorkflow.roughCutSelectionFallbackWaiver.reason, waiverReason);
  assert.ok(Number.isFinite(Date.parse(waivedWorkflow.roughCutSelectionFallbackWaiver.waivedAt)));
  prepareFallbackMedia(waivedFallback.job);
  script("workflow-state.mjs", [
    waivedFallback.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ]);
  assert.equal(readJson(waivedFallback.workflowPath).currentState, "rough-cut-review");

  const waiverRemovedAfterReview = prepareWaivedFallbackReview("ffmpeg-fallback-waiver-removed-after-review");
  script("workflow-state.mjs", [waiverRemovedAfterReview.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Fallback caption recommendation"]);
  script("workflow-state.mjs", [waiverRemovedAfterReview.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Fallback axis recommendation"]);
  const waiverRemovedWorkflow = readJson(waiverRemovedAfterReview.workflowPath);
  waiverRemovedWorkflow.roughCutSelectionFallbackWaiver = null;
  writeJsonAtomic(waiverRemovedAfterReview.workflowPath, waiverRemovedWorkflow);
  script("workflow-state.mjs", [
    waiverRemovedAfterReview.workflowPath,
    "approve",
    "--actor",
    "user",
    "--note",
    "Approval must recheck fallback eligibility"
  ], false, /explicit user waiver|waive-v1-roughcut-selection-for-ffmpeg-fallback/i);

  const engineChangedAfterReview = prepareWaivedFallbackReview("ffmpeg-fallback-engine-changed-after-review");
  const engineChangedProjectPath = path.join(engineChangedAfterReview.job, "state", "project.json");
  const engineChangedProject = readJson(engineChangedProjectPath);
  engineChangedProject.roughCutEngine = "chatcut";
  writeJsonAtomic(engineChangedProjectPath, engineChangedProject);
  script("workflow-state.mjs", [
    engineChangedAfterReview.workflowPath,
    "fallback-auto",
    "--actor",
    "user",
    "--note",
    "Fallback must recheck the configured engine"
  ], false, /project\.roughCutEngine=ffmpeg-fallback/i);

  const v1Fallback = prepareChatcutReviewJob("v1-ffmpeg-fallback");
  const v1FallbackProjectPath = path.join(v1Fallback.job, "state", "project.json");
  const v1FallbackProject = readJson(v1FallbackProjectPath);
  v1FallbackProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(v1FallbackProjectPath, v1FallbackProject);
  fs.writeFileSync(path.join(v1Fallback.job, "roughcut", "a-roll.mp4"), "not a media file");
  script("workflow-state.mjs", [
    v1Fallback.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ], false, /requires a ChatCut rough-cut selection|ffmpeg-fallback/i);

  const legacyFallback = prepareChatcutReviewJob("legacy-ffmpeg-fallback");
  const legacyFallbackWorkflow = readJson(legacyFallback.workflowPath);
  delete legacyFallbackWorkflow.roughCutSelectionPolicy;
  delete legacyFallbackWorkflow.roughCutSelectionPolicyOrigin;
  delete legacyFallbackWorkflow.roughCutSelectionFallbackWaiver;
  writeJsonAtomic(legacyFallback.workflowPath, legacyFallbackWorkflow);
  fs.unlinkSync(path.join(legacyFallback.job, "state", "roughcut-selection.json"));
  const legacyFallbackProjectPath = path.join(legacyFallback.job, "state", "project.json");
  const legacyFallbackProject = readJson(legacyFallbackProjectPath);
  legacyFallbackProject.roughCutEngine = "ffmpeg-fallback";
  writeJsonAtomic(legacyFallbackProjectPath, legacyFallbackProject);
  prepareFallbackMedia(legacyFallback.job);
  script("workflow-state.mjs", [
    legacyFallback.workflowPath,
    "advance",
    "--artifact",
    "roughcut/a-roll.mp4"
  ]);
  assert.equal(readJson(legacyFallback.workflowPath).currentState, "rough-cut-review");

  const manualReview = prepareChatcutReviewJob("chatcut-manual-review");
  const manualProjectPath = path.join(manualReview.job, "state", "project.json");
  const manualProject = readJson(manualProjectPath);
  manualProject.mediaArtifacts = {
    roughcut: {
      path: "roughcut/a-roll.mp4",
      sha256: "a".repeat(64),
      duration: 1,
      updatedAt: "2026-08-05T00:00:00.000Z"
    }
  };
  writeJsonAtomic(manualProjectPath, manualProject);
  script("workflow-state.mjs", [
    manualReview.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  let manualWorkflow = readJson(manualReview.workflowPath);
  assert.equal(manualWorkflow.currentState, "rough-cut-review");
  assert.equal(readJson(manualProjectPath).mediaArtifacts.roughcut, undefined);
  assert.equal(fs.existsSync(path.join(manualReview.job, "roughcut", "a-roll.mp4")), false);
  const policyBoundState = fs.readFileSync(manualReview.workflowPath);
  for (const origin of [roughCutSelectionPolicy, null]) {
    const disabledSelection = readJson(manualReview.workflowPath);
    disabledSelection.roughCutSelectionPolicy = null;
    disabledSelection.roughCutSelectionPolicyOrigin = origin;
    writeJsonAtomic(manualReview.workflowPath, disabledSelection);
    script("workflow-state.mjs", [manualReview.workflowPath, "approve", "--actor", "user", "--note", "Do not bypass the last-complete-take policy"], false, /selection cannot be disabled by a null policy/);
    assert.equal(readJson(manualReview.workflowPath).currentState, "rough-cut-review");
  }
  fs.writeFileSync(manualReview.workflowPath, policyBoundState);
  const staleManualSelectionPath = path.join(manualReview.job, "state", "roughcut-selection.json");
  const staleManualSelection = readJson(staleManualSelectionPath);
  staleManualSelection.chatcut.activeTimelineId = "timeline-stale";
  writeJsonAtomic(staleManualSelectionPath, staleManualSelection);
  script("workflow-state.mjs", [manualReview.workflowPath, "approve", "--actor", "user", "--note", "Reject stale selection binding"], false, /rough-cut selection.*active.*timeline|active.*timeline/i);
  prepareRoughCutSelection(manualReview.job);
  script("workflow-state.mjs", [manualReview.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [manualReview.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  script("workflow-state.mjs", [manualReview.workflowPath, "approve", "--actor", "user", "--note", "ChatCut timeline reviewed and approved"]);
  manualWorkflow = readJson(manualReview.workflowPath);
  assert.equal(manualWorkflow.currentState, "rough-cut-export");
  assert.equal(manualWorkflow.roughCutReviewDecision, "manual-approved");
  assert.equal(fs.existsSync(path.join(manualReview.job, "roughcut", "a-roll.mp4")), false);

  const unresolvedReference = prepareChatcutReviewJob("chatcut-unresolved-reference");
  script("workflow-state.mjs", [
    unresolvedReference.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  const unresolvedWorkflow = readJson(unresolvedReference.workflowPath);
  unresolvedWorkflow.referenceScriptStatus = "unknown";
  unresolvedWorkflow.referenceScriptAcknowledged = false;
  writeJsonAtomic(unresolvedReference.workflowPath, unresolvedWorkflow);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "approve", "--actor", "user", "--note", "Do not infer an absent reference script"], false, /reference-script|unresolved/i);

  const automaticFallback = prepareChatcutReviewJob("chatcut-automatic-fallback");
  script("workflow-state.mjs", [
    automaticFallback.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  script("workflow-state.mjs", [automaticFallback.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [automaticFallback.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  const fallback = script("workflow-state.mjs", [
    automaticFallback.workflowPath,
    "fallback-auto",
    "--actor",
    "user",
    "--note",
    "Skip manual ChatCut review"
  ]);
  assert.match(`${fallback.stdout}\n${fallback.stderr}`, /may take a long time/i);
  const fallbackWorkflow = readJson(automaticFallback.workflowPath);
  assert.equal(fallbackWorkflow.currentState, "rough-cut-export");
  assert.equal(fallbackWorkflow.roughCutReviewDecision, "automatic-fallback");
  assert.equal(fallbackWorkflow.gates["rough-cut-review"].status, "automatic-fallback");
  assert.equal(fs.existsSync(path.join(automaticFallback.job, "roughcut", "a-roll.mp4")), false);

  const automaticMode = prepareChatcutReviewJob("chatcut-auto-mode");
  script("workflow-state.mjs", [automaticMode.workflowPath, "set-mode", "auto", "--actor", "user"]);
  script("workflow-state.mjs", [automaticMode.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [automaticMode.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  const automaticAdvance = script("workflow-state.mjs", [
    automaticMode.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  assert.match(`${automaticAdvance.stdout}\n${automaticAdvance.stderr}`, /may take a long time/i);
  const automaticWorkflow = readJson(automaticMode.workflowPath);
  assert.equal(automaticWorkflow.currentState, "rough-cut-export");
  assert.equal(automaticWorkflow.roughCutReviewDecision, "automatic-fallback");
  assert.equal(automaticWorkflow.gates["rough-cut-review"].status, "automatic-fallback");
  assert.equal(fs.existsSync(path.join(automaticMode.job, "roughcut", "a-roll.mp4")), false);

  const intakeJob = scaffold("intake", "review");
  const intakeWorkflow = path.join(intakeJob, "state", "workflow.json");
  prepareCover(intakeJob);
  approveCover(intakeWorkflow);
  script("workflow-state.mjs", [intakeWorkflow, "advance"]);
  assert.equal(readJson(intakeWorkflow).currentState, "transcription");
  script(
    "workflow-state.mjs",
    [intakeWorkflow, "set-caption-mode", "subtitles", "--actor", "agent"],
    false,
    /require --note/
  );
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-caption-mode",
    "subtitles",
    "--actor",
    "agent",
    "--note",
    "Readable captions fit this talking-head release"
  ]);
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-axis-mode",
    "a-axis-overlay",
    "--actor",
    "agent",
    "--note",
    "No B-axis evidence was supplied"
  ]);
  assert.equal(readJson(intakeWorkflow).captionModeSource, "auto");

  const referenceJob = scaffold("reference", "review", "subtitles");
  const referenceWorkflow = path.join(referenceJob, "state", "workflow.json");
  const reference = path.join(temporaryRoot, "reference.md");
  fs.writeFileSync(reference, "参考稿【MG：关键词】\n");
  script("register-reference-script.mjs", [referenceWorkflow, "provided", reference, "--actor", "user"]);
  const registered = readJson(referenceWorkflow);
  assert.match(registered.referenceScriptPath, /^input\/reference-scripts\/[a-f0-9]{64}\.txt$/);
  const registeredAnnotations = readJson(path.join(referenceJob, "state", "reference-script-annotations.json"));
  assert.equal(registeredAnnotations.source.status, "provided");
  assert.equal(registeredAnnotations.source.path, registered.referenceScriptPath);
  assert.equal(registeredAnnotations.source.sha256, registered.referenceScriptSha256);
  fs.appendFileSync(path.join(referenceJob, registered.referenceScriptPath), "tampered");
  script("workflow-state.mjs", [referenceWorkflow, "advance"], false, /changed|hash|reference/i);

  const defaultRouteJob = scaffold("default-route", "review");
  const defaultRouteWorkflowPath = path.join(defaultRouteJob, "state", "workflow.json");
  prepareCover(defaultRouteJob);
  approveCover(defaultRouteWorkflowPath);
  const defaultRouteWorkflow = readJson(defaultRouteWorkflowPath);
  delete defaultRouteWorkflow.visualArrangementReviewRequired;
  delete defaultRouteWorkflow.visualArrangementReviewDecision;
  delete defaultRouteWorkflow.gates["visual-arrangement-review"];
  defaultRouteWorkflow.currentState = "motion-plan";
  defaultRouteWorkflow.captionModeAcknowledged = true;
  defaultRouteWorkflow.visualAxisModeAcknowledged = true;
  defaultRouteWorkflow.referenceScriptAcknowledged = true;
  writeJsonAtomic(defaultRouteWorkflowPath, defaultRouteWorkflow);
  fs.writeFileSync(
    path.join(defaultRouteJob, "docs", "motion-plan.md"),
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 0.0–1.0 | 示例 | A | horizontal | none | caption-only | cut |\n\n"
      + "Caption mode: subtitles\n"
  );
  writeJsonAtomic(path.join(defaultRouteJob, "state", "beat-map.json"), { fps: 30, captionMode: "subtitles", beats: [] });
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  let defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "composition");
  assert.deepEqual(Object.keys(defaultRouteState.gates), ["rough-cut-review"]);
  assert.equal(Object.hasOwn(defaultRouteState, "visualArrangementReviewRequired"), false);
  assert.equal(defaultRouteState.pendingGate, null);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "render");
  const defaultRenderPath = path.join(defaultRouteJob, "output", "final.mp4");
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=2:d=1",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", defaultRenderPath
  ]);
  fs.appendFileSync(path.join(defaultRouteJob, "output", "cover.png"), "stale");
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "output/final.mp4"], false, /Cover validation failed/i);
  prepareCover(defaultRouteJob);
  approveCover(defaultRouteWorkflowPath);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "output/final.mp4"], false, /Title package invalid/i);
  prepareTitles(defaultRouteJob);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "output/final.mp4"]);
  defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "complete");
  assert.equal(defaultRouteState.lastKnownGoodDelivery.path, "output/final.mp4");
  const finalDeliveryHash = sha256File(defaultRenderPath);
  prepareCover(defaultRouteJob);
  approveCover(defaultRouteWorkflowPath);
  defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "complete");
  assert.equal(defaultRouteState.lastKnownGoodDelivery.sha256, finalDeliveryHash);

  script("workflow-state.mjs", [defaultRouteWorkflowPath, "reopen", "delivery", "--actor", "user", "--note", "Candidate delivery transaction regression"]);
  const candidatePath = path.join(defaultRouteJob, "output", "final.candidate.mp4");
  fs.copyFileSync(defaultRenderPath, candidatePath);
  fs.appendFileSync(candidatePath, "candidate revision");
  const candidateReceiptPath = `${candidatePath}.render.json`;
  const finalReceiptPath = `${defaultRenderPath}.render.json`;
  writeJsonAtomic(candidateReceiptPath, { fixture: "candidate render receipt" });
  writeJsonAtomic(finalReceiptPath, { fixture: "previous render receipt" });
  prepareTitles(defaultRouteJob, "output/final.candidate.mp4");
  const titlesPath = path.join(defaultRouteJob, "state", "titles.json");
  const retainedPaths = [defaultRenderPath, finalReceiptPath, titlesPath, defaultRouteWorkflowPath, candidatePath, candidateReceiptPath];
  const retainedBytes = new Map(retainedPaths.map(file => [file, fs.readFileSync(file)]));
  const failureInjection = path.join(temporaryRoot, "inject-promotion-failure.mjs");
  for (const failureTarget of [finalReceiptPath, titlesPath, defaultRouteWorkflowPath]) {
    fs.writeFileSync(failureInjection, `import fs from "node:fs";
const rename = fs.renameSync;
let injected = false;
fs.renameSync = (source, destination) => {
  if (!injected && destination === ${JSON.stringify(failureTarget)}) {
    injected = true;
    throw new Error("Injected delivery promotion failure");
  }
  return rename(source, destination);
};
`);
    run(process.execPath, ["--import", failureInjection, path.join(repositoryRoot, "scripts", "workflow-state.mjs"), defaultRouteWorkflowPath, "advance", "--artifact", "output/final.candidate.mp4"], false, /Injected delivery promotion failure/);
    for (const retainedPath of retainedPaths) {
      assert.deepEqual(fs.readFileSync(retainedPath), retainedBytes.get(retainedPath), `${path.basename(failureTarget)} failure must restore ${path.basename(retainedPath)}`);
    }
    assert.equal(fs.readdirSync(path.join(defaultRouteJob, "output")).some(name => name.startsWith(".delivery-promotion-")), false);
  }
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "output/final.candidate.mp4"]);
  assert.equal(fs.existsSync(candidatePath), false);
  assert.equal(fs.existsSync(candidateReceiptPath), false);
  assert.deepEqual(fs.readFileSync(defaultRenderPath), retainedBytes.get(candidatePath));
  assert.deepEqual(fs.readFileSync(finalReceiptPath), retainedBytes.get(candidateReceiptPath));
  assert.equal(readJson(titlesPath).sourceDelivery.path, "output/final.mp4");
  const promotedWorkflow = readJson(defaultRouteWorkflowPath);
  assert.equal(promotedWorkflow.currentState, "complete");
  assert.equal(promotedWorkflow.lastKnownGoodDelivery.sha256, sha256File(defaultRenderPath));

  const cadenceReviewJob = scaffold("cadence-review-gate", "review", "subtitles");
  const cadenceReviewWorkflowPath = path.join(cadenceReviewJob, "state", "workflow.json");
  const cadenceReviewWorkflow = readJson(cadenceReviewWorkflowPath);
  cadenceReviewWorkflow.currentState = "motion-plan";
  cadenceReviewWorkflow.captionModeAcknowledged = true;
  cadenceReviewWorkflow.visualAxisModeAcknowledged = true;
  cadenceReviewWorkflow.referenceScriptAcknowledged = true;
  writeJsonAtomic(cadenceReviewWorkflowPath, cadenceReviewWorkflow);
  const cadenceTranscript = {
    revision: 1,
    language: "zh-CN",
    duration: 40,
    source: "fixture",
    segments: Array.from({ length: 4 }, (_, index) => ({
      id: `cadence-seg-${index + 1}`,
      text: `长视频片段${index + 1}`,
      start: index * 10,
      end: (index + 1) * 10,
      confidence: 1,
      words: []
    }))
  };
  writeJsonAtomic(path.join(cadenceReviewJob, "state", "transcript.json"), cadenceTranscript);
  writeJsonAtomic(path.join(cadenceReviewJob, "state", "beat-map.json"), {
    duration: 40,
    fps: 30,
    captionMode: "subtitles",
    designSystem: "state/design-system.json",
    beats: cadenceTranscript.segments.map((segment, index) => ({
      id: `cadence-caption-${index + 1}`,
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
      transitionFamily: `cadence-caption-${index + 1}`,
      components: [],
      microEvents: []
    }))
  });
  fs.writeFileSync(
    path.join(cadenceReviewJob, "docs", "motion-plan.md"),
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 0.0–40.0 | Cadence fixture | A | horizontal | none | caption-only | cut |\n\n"
      + "Caption mode: subtitles\n"
  );
  script(
    "workflow-state.mjs",
    [cadenceReviewWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"],
    false,
    /cadence.*requires|requires.*cadence/i
  );

  for (const [scope, expectedState] of [
    ["rough-cut", "rough-cut"],
    ["motion-plan", "motion-plan"],
    ["composition", "composition"],
    ["delivery", "render"]
  ]) {
    const job = scaffold(`reopen-${scope}`, "review", "subtitles");
    const workflowPath = path.join(job, "state", "workflow.json");
    const workflow = readJson(workflowPath);
    workflow.currentState = "complete";
    workflow.completed = true;
    workflow.gates = {
      "rough-cut-review": { status: "approved", revisionId: 1 }
    };
    workflow.roughCutReviewDecision = "manual-approved";
    workflow.visualPlanSha256 = "a".repeat(64);
    workflow.compositionArtifactPath = "hyperframes/index.html";
    workflow.compositionArtifactSha256 = "b".repeat(64);
    writeJsonAtomic(workflowPath, workflow);
    script("workflow-state.mjs", [workflowPath, "reopen", scope, "--actor", "user", "--note", `revise ${scope}`]);
    const reopened = readJson(workflowPath);
    assert.equal(reopened.currentState, expectedState);
    assert.equal(reopened.completed, false);
    assert.equal(reopened.revisionId, 2);
    assert.equal(
      reopened.visualPlanSha256,
      ["rough-cut", "motion-plan"].includes(scope) ? null : "a".repeat(64)
    );
    assert.deepEqual(Object.keys(reopened.gates), ["rough-cut-review", "visual-arrangement-review"]);
    assert.equal(
      reopened.gates["rough-cut-review"].status,
      scope === "rough-cut" ? "not-reached" : "approved"
    );
    assert.equal(
      reopened.roughCutReviewDecision,
      scope === "rough-cut" ? "pending" : "manual-approved"
    );
  }

  const legacyMotionPlanReopen = scaffold("legacy-motion-plan-reopen", "review", "subtitles");
  const legacyMotionPlanWorkflowPath = path.join(legacyMotionPlanReopen, "state", "workflow.json");
  const legacyMotionPlanWorkflow = readJson(legacyMotionPlanWorkflowPath);
  delete legacyMotionPlanWorkflow.visualArrangementReviewRequired;
  delete legacyMotionPlanWorkflow.visualArrangementReviewDecision;
  delete legacyMotionPlanWorkflow.gates["visual-arrangement-review"];
  legacyMotionPlanWorkflow.currentState = "complete";
  legacyMotionPlanWorkflow.completed = true;
  writeJsonAtomic(legacyMotionPlanWorkflowPath, legacyMotionPlanWorkflow);
  script("workflow-state.mjs", [legacyMotionPlanWorkflowPath, "reopen", "motion-plan", "--actor", "user", "--note", "Revise legacy visual plan"]);
  const upgradedLegacyMotionPlan = readJson(legacyMotionPlanWorkflowPath);
  assert.equal(upgradedLegacyMotionPlan.visualArrangementReviewRequired, true);
  assert.equal(upgradedLegacyMotionPlan.visualArrangementReviewDecision, "pending");
  assert.equal(upgradedLegacyMotionPlan.gates["visual-arrangement-review"].status, "not-reached");

  for (const scope of ["composition", "delivery"]) {
    const legacyJob = scaffold(`legacy-${scope}-reopen`, "review", "subtitles");
    const legacyWorkflowPath = path.join(legacyJob, "state", "workflow.json");
    const legacyWorkflow = readJson(legacyWorkflowPath);
    delete legacyWorkflow.visualArrangementReviewRequired;
    delete legacyWorkflow.visualArrangementReviewDecision;
    delete legacyWorkflow.gates["visual-arrangement-review"];
    legacyWorkflow.currentState = "complete";
    legacyWorkflow.completed = true;
    writeJsonAtomic(legacyWorkflowPath, legacyWorkflow);
    script("workflow-state.mjs", [legacyWorkflowPath, "reopen", scope, "--actor", "user", "--note", `Revise legacy ${scope}`]);
    const reopenedLegacy = readJson(legacyWorkflowPath);
    assert.equal(Object.hasOwn(reopenedLegacy, "visualArrangementReviewRequired"), false);
    assert.equal(Object.hasOwn(reopenedLegacy, "visualArrangementReviewDecision"), false);
    assert.equal(Object.hasOwn(reopenedLegacy.gates, "visual-arrangement-review"), false);
  }

  const transactionJob = scaffold("transaction", "review", "subtitles");
  const prepared = path.join(transactionJob, "state", "workflow.json.bad.prepared");
  fs.writeFileSync(prepared, "{}\n");
  writeJsonAtomic(path.join(transactionJob, "state", "transcript-resolution.transaction.json"), {
    id: "bad",
    files: [{
      target: "../escaped.json",
      prepared: "state/workflow.json.bad.prepared",
      sha256: sha256File(prepared)
    }]
  });
  script("workflow-state.mjs", [path.join(transactionJob, "state", "workflow.json"), "status"], false);
  assert.equal(fs.existsSync(path.join(temporaryRoot, "escaped.json")), false);

  console.log("Workflow contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
