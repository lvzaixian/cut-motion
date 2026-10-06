import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [fontPath] = process.argv.slice(2);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-delivery-"));
const jobRoot = path.join(temporaryRoot, "job");
const workflowPath = path.join(jobRoot, "state", "workflow.json");
const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};
const script = (name, argumentsList, options = {}) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  options
);
const writeJson = (relativePath, value) => writeJsonAtomic(path.join(jobRoot, relativePath), value);
const prepareTitles = (videoRelativePath) => {
  const videoPath = path.join(jobRoot, videoRelativePath);
  const workbookPath = path.join(jobRoot, "output", "titles.xlsx");
  fs.writeFileSync(workbookPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x73]));
  const platforms = [
    ["douyin", "抖音", "DY"],
    ["video-account", "视频号", "SPH"],
    ["xiaohongshu", "小红书", "XHS"],
    ["bilibili", "B站", "BIL"],
    ["kuaishou", "快手", "KS"]
  ];
  writeJson("state/titles.json", {
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
const prepareCover = () => {
  const previewRoot = path.join(jobRoot, "previews", "cover");
  const framePath = path.join(previewRoot, "frame-01.png");
  const basePath = path.join(previewRoot, "base.png");
  const outputPath = path.join(jobRoot, "output", "cover.png");
  const frameIds = Array.from({ length: 24 }, (_, index) => String(index + 1).padStart(2, "0"));
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1440",
    "-frames:v", "1", framePath
  ]);
  for (const id of frameIds.slice(1)) fs.copyFileSync(framePath, path.join(previewRoot, `frame-${id}.png`));
  fs.copyFileSync(framePath, basePath);
  fs.copyFileSync(framePath, outputPath);
  for (let index = 1; index <= 6; index += 1) {
    fs.copyFileSync(outputPath, path.join(previewRoot, `cover-${index}.png`));
  }
  const cover = readJson(path.join(jobRoot, "state", "cover.json"));
  cover.schemaVersion = "2.1.0";
  cover.status = "ready";
  cover.styleId = "talking-head-opinion-poster-v2";
  cover.frameCandidates = frameIds.map((id, index) => ({
    id: `frame-${id}`,
    path: `previews/cover/frame-${id}.png`,
    timestampSeconds: index + 1,
    reasons: ["Runtime fixture"]
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
  writeJson("state/cover.json", cover);
};

try {
  const source = path.join(temporaryRoot, "source.mp4");
  run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "3.2", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    source
  ]);
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [jobRoot, source, "review", "subtitles"]);
  const legacyWorkflow = readJson(workflowPath);
  delete legacyWorkflow.visualArrangementReviewRequired;
  delete legacyWorkflow.visualArrangementReviewDecision;
  delete legacyWorkflow.gates["visual-arrangement-review"];
  writeJsonAtomic(workflowPath, legacyWorkflow);
  if (fontPath && path.isAbsolute(fontPath) && fs.existsSync(fontPath)) {
    fs.mkdirSync(path.join(jobRoot, "hyperframes", "assets", "fonts"), { recursive: true });
    fs.copyFileSync(fontPath, path.join(jobRoot, "hyperframes", "assets", "fonts", "smiley-sans-oblique.woff2"));
  }

  const projectPath = path.join(jobRoot, "state", "project.json");
 fs.copyFileSync(source, path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"));
 fs.copyFileSync(source, path.join(jobRoot, "roughcut", "a-roll.mp4"));

  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "transcript.example.json"),
    path.join(jobRoot, "state", "transcript.json")
  );
  const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
  const reconciliationItems = path.join(temporaryRoot, "reconciliation-items.json");
  fs.writeFileSync(reconciliationItems, JSON.stringify(transcript.segments.map((segment, index) => ({
    id: `speech-${index + 1}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: segment.confidence ?? 1,
    evidence: { audioChecked: true, supportsReference: false, note: "Runtime fixture" }
  }))));
  script("create-transcript-reconciliation.mjs", [jobRoot, "input/source.mp4", reconciliationItems]);
  script("workflow-state.mjs", [workflowPath, "advance"]);
  assert.equal(readJson(workflowPath).currentState, "transcription");
  prepareCover();
  script("workflow-state.mjs", [workflowPath, "approve-cover", "--actor", "user", "--note", "Approve runtime cover"]);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "state/transcript.json"]);

  const workflow = readJson(workflowPath);
  workflow.currentState = "rough-cut";
  workflow.sourceTranscriptSha256 = sha256File(path.join(jobRoot, "state", "source-transcript.json"));
  workflow.gates["rough-cut-review"] = { status: "not-reached" };
  writeJsonAtomic(workflowPath, workflow);
  const chatcutRoughCutPath = path.join(jobRoot, "state", "chatcut-roughcut.json");
  const chatcutRecordedAt = new Date().toISOString();
  writeJson("state/chatcut-roughcut.json", {
    schemaVersion: "1.0.0",
    source: "chatcut",
    projectId: "runtime-project",
    timelineIds: ["runtime-timeline"],
    activeTimelineId: "runtime-timeline",
    recordedAt: chatcutRecordedAt
  });
  writeJson("state/roughcut-selection.json", {
    schemaVersion: "1.0.0",
    policy: "reference-aligned-last-complete-take-v1",
    sourceTranscriptSha256: workflow.sourceTranscriptSha256,
    transcriptReconciliationSha256: sha256File(path.join(jobRoot, "state", "transcript-reconciliation.json")),
    referenceScriptSha256: null,
    chatcutRoughCutSha256: sha256File(chatcutRoughCutPath),
    verifiedAt: new Date(Date.parse(chatcutRecordedAt) + 1).toISOString(),
    chatcut: { projectId: "runtime-project", activeTimelineId: "runtime-timeline" },
    selections: [{
      referenceItemIds: [],
      takes: [{
        id: "runtime-complete-take",
        sourceSegmentIds: transcript.segments.map((segment) => segment.id),
        disposition: "complete",
        audioReviewedEvidence: "Audio reviewed: complete runtime take."
      }],
      selectedTakeId: "runtime-complete-take"
    }],
    discards: []
  });
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "state/chatcut-roughcut.json"]);
  script("workflow-state.mjs", [workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Runtime caption recommendation"]);
 script("workflow-state.mjs", [workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Runtime A-axis recommendation"]);
 script("workflow-state.mjs", [workflowPath, "approve", "--actor", "user", "--note", "Approve the rough cut"]);
  const project = readJson(projectPath);
  project.mediaArtifacts = { roughcut: {
    path: "roughcut/a-roll.mp4",
    sha256: sha256File(path.join(jobRoot, "roughcut", "a-roll.mp4"))
  } };
  writeJsonAtomic(projectPath, project);
 script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "roughcut/a-roll.mp4"]);

  writeJson("state/beat-map.json", { fps: 30, duration: 3.2, captionMode: "subtitles", beats: [] });
  fs.writeFileSync(
    path.join(jobRoot, "docs", "motion-plan.md"),
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 0.0–3.2 | Runtime fixture | A | horizontal | none | caption-only | cut |\n\n"
      + "Caption mode: subtitles\n"
  );
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  assert.equal(readJson(workflowPath).currentState, "render");

  const finalPath = path.join(jobRoot, "output", "final.mp4");
  fs.copyFileSync(source, finalPath);
  const missingTitlePackage = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath, "advance", "--artifact", "output/final.mp4"
  ], { encoding: "utf8" });
  assert.notEqual(missingTitlePackage.status, 0);
  assert.match(`${missingTitlePackage.stdout}\n${missingTitlePackage.stderr}`, /Title package invalid/i);
  prepareTitles("output/final.mp4");
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.mp4"]);
  let completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(completed.lastKnownGoodDelivery.path, "output/final.mp4");

  script("workflow-state.mjs", [workflowPath, "reopen", "delivery", "--actor", "user", "--note", "Retest delivery promotion"]);
  run("ffmpeg", [
    "-y", "-v", "error", "-i", finalPath,
    "-vf", "hue=s=0", "-c:v", "libx264", "-c:a", "aac",
    path.join(jobRoot, "output", "final.candidate.mp4")
  ]);
  const staleTitlePackage = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath, "advance", "--artifact", "output/final.candidate.mp4"
  ], { encoding: "utf8" });
  assert.notEqual(staleTitlePackage.status, 0);
  assert.match(`${staleTitlePackage.stdout}\n${staleTitlePackage.stderr}`, /Title package invalid/i);
  prepareTitles("output/final.candidate.mp4");
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.candidate.mp4"]);
  completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(fs.existsSync(path.join(jobRoot, "output", "final.candidate.mp4")), false);
  assert.equal(sha256File(finalPath), completed.lastKnownGoodDelivery.sha256);

  script("workflow-state.mjs", [workflowPath, "reopen", "rough-cut", "--actor", "user", "--note", "Retest transcript lock"]);
  fs.appendFileSync(path.join(jobRoot, "state", "source-transcript.json"), "\n");
  const tampered = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath, "advance", "--artifact", "state/chatcut-roughcut.json"
  ], { encoding: "utf8" });
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /Source transcript changed after its timeline lock/);

  const state = readJson(workflowPath);
  assert.equal(state.visualArrangementReviewRequired, true);
  assert.deepEqual(Object.keys(state.gates), ["rough-cut-review", "visual-arrangement-review"]);
  console.log("Delivery workflow runtime test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
