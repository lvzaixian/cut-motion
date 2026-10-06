import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { componentNames, resolveComponent } from "../scripts/motion-template-library.mjs";
import { templateSamples } from "../scripts/mg-template-samples.mjs";
import { buildBeatMap } from "../scripts/plan-artifacts.mjs";
import { buildComposition } from "../scripts/build-composition.mjs";
import { sha256File } from "../scripts/workflow-utils.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-local-planning-"));
const json = (job, relative, value) => {
  const file = path.join(job, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const read = (job, relative) => JSON.parse(fs.readFileSync(path.join(job, relative), "utf8"));
const run = (script, args, pattern) => {
  const result = spawnSync(process.execPath, [path.join(repository, "scripts", script), ...args], { encoding: "utf8" });
  const output = result.stdout + result.stderr;
  if (pattern) { assert.notEqual(result.status, 0, output); assert.match(output, pattern); }
  else assert.equal(result.status, 0, output);
  return output;
};
const designSystem = JSON.parse(fs.readFileSync(path.join(repository, "assets/design-system.default.json"), "utf8"));
const initialize = job => {
  for (const dir of ["state", "input", "roughcut", "hyperframes/assets", "captions", "docs"]) fs.mkdirSync(path.join(job, dir), { recursive: true });
  fs.copyFileSync(path.join(repository, "templates/hyperframes/index.template.html"), path.join(job, "hyperframes/index.template.html"));
  json(job, "state/design-system.json", designSystem);
  fs.writeFileSync(path.join(job, "roughcut/a-roll.mp4"), "fixture only; no real media validation claimed");
};
try {
  // Every semantic component must pass the actual controlled builder, not just
  // produce plausible strings. No existing production job is touched.
  for (const name of componentNames().filter(name => !name.startsWith("stage/"))) {
    const job = path.join(root, name); initialize(job);
    const data = { ...templateSamples[name] };
    const materialPath = "input/evidence.svg";
    fs.copyFileSync(path.join(repository, "templates/motion-graphics/evidence-focus/sample-evidence.svg"), path.join(job, materialPath));
    const material = { id: "proof", path: materialPath, kind: "screenshot", sha256: sha256File(path.join(job, materialPath)), sourceOrRights: "fictional fixture", privacyStatus: "approved", visibleFacts: ["sample only"], forbiddenInferences: ["not a real product claim"] };
    if (name === "evidence-focus") Object.assign(data, { image: "../input/evidence.svg", imageWidthPx: 960, imageHeightPx: 660 });
    const slots = [...resolveComponent(name).content({ templateData: data }).body.matchAll(/data-at=/g)].length;
    const words = Array.from({ length: slots }, (_, index) => ({ text: `词${index}`, start: index / 5, end: index === slots - 1 ? 4 : (index + 1) / 5 }));
    const transcript = { duration: 4, revision: 2, segments: [{ id: "speech", text: words.map(word => word.text).join(""), start: 0, end: 4, words }] };
    json(job, "state/transcript.json", transcript);
    json(job, "state/workflow.json", { visualArrangementReviewRequired: true });
    const objectCues = words.map((word, index) => ({ id: `cue-${index}`, semanticRole: "fixture semantic slot", spokenTriggerWordId: `speech:word-${String(index + 1).padStart(3, "0")}`, preMotionFrame: index * 6, firstLegibleFrame: index * 6, settledFrame: index * 6 + 4, exitTriggerWordId: `speech:word-${String(slots).padStart(3, "0")}`, invisibleFrame: 120, holdKind: "standard" }));
    const map = buildBeatMap({ transcript, designSystem, fps: 30, captionMode: "subtitles", visualOrchestrationVersion: 1, materials: name === "evidence-focus" ? [material] : [], beats: [{ id: "semantic", sceneId: "fixture", sourceSegmentIds: ["speech"], text: transcript.segments[0].text, start: 0, end: 4, axis: "A", templateId: name, templateData: data, motionProfile: "thoughtful-editorial-v1", surfaceTreatment: name === "evidence-focus" ? "evidence-surface" : "direct-overlay", objectCues, materialRefs: name === "evidence-focus" ? [{ materialId: "proof", role: "sample", displayStartFrame: 0, displayEndFrame: 120, crop: "full contain", masking: "none" }] : [], entryAnchorWordId: "speech:word-001", exitAnchorWordId: `speech:word-${String(slots).padStart(3, "0")}`, exitFrames: 6, exitAnchorOffsetFrames: 0, supportRole: "organization", layout: { primaryBoundsNormalized: { x: .1, y: .3, width: .8, height: .28 } } }] });
    json(job, "state/beat-map.json", map);
    run("assemble-mg.mjs", [job, "--write"]);
    const built = buildComposition(path.join(job, "hyperframes"));
    assert.deepEqual(built.beatIds, ["semantic"], name);
    const module = fs.readFileSync(path.join(job, "hyperframes/mg/semantic/timeline.mjs"), "utf8");
    assert.equal([...module.matchAll(/motion\.reveal\(/g)].length, slots, name);
    const fragment = fs.readFileSync(path.join(job, "hyperframes/mg/semantic/fragment.html"), "utf8");
    assert.equal([...fragment.matchAll(/data-cue-id=/g)].length, slots, name);
    assert.doesNotMatch(fragment, /\sstyle=|<svg/);
    const before = fs.readFileSync(path.join(job, "hyperframes/mg/semantic/fragment.html"), "utf8");
    delete map.beats[0].templateId; map.beats[0].recipe = "unknown-historic-recipe";
    json(job, "state/beat-map.json", map); run("assemble-mg.mjs", [job, "--write"]);
    assert.equal(fs.readFileSync(path.join(job, "hyperframes/mg/semantic/fragment.html"), "utf8"), before, "historic authored module retained");
  }

  const job = path.join(root, "fresh-plan"); initialize(job);
  const transcriptText = "文案和画面汇集成为成片";
  const synthetic = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x568:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", path.join(job, "roughcut/a-roll.mp4")], { encoding: "utf8" });
  assert.equal(synthetic.status, 0, synthetic.stderr);
  fs.copyFileSync(path.join(job, "roughcut/a-roll.mp4"), path.join(job, "input/source.mp4"));
  json(job, "state/project.json", { id: "fresh-plan", fps: 30, language: "zh-CN", sourceVideo: "input/source.mp4", designSystem: "state/design-system.json", mediaArtifacts: { roughcut: { path: "roughcut/a-roll.mp4" } } });
  // Simulated preferences and rough-cut approval apply only to this synthetic
  // software fixture. They record no real user's editorial decision.
  const fixtureWorkflow = JSON.parse(fs.readFileSync(path.join(repository, "templates/job/workflow.json"), "utf8"));
  json(job, "state/workflow.json", { ...fixtureWorkflow, jobId: "fresh-plan", currentState: "motion-plan", captionModeAcknowledged: true, captionModeSource: "user", visualAxisModeAcknowledged: true, visualAxisModeSource: "user", referenceScriptAcknowledged: true, roughCutReviewDecision: "manual-approved", authoritativeMediaPath: "roughcut/a-roll.mp4", authoritativeMediaSha256: sha256File(path.join(job, "roughcut/a-roll.mp4")), gates: { ...fixtureWorkflow.gates, "rough-cut-review": { status: "approved", actor: "user", note: "Synthetic software fixture; no real user approval" } } });
  json(job, "state/reference-script-annotations.json", { annotations: [] });
  json(job, "state/chatcut-roughcut.json", { schemaVersion: "1.0.0", source: "chatcut", projectId: "project", timelineIds: ["timeline"], activeTimelineId: "timeline", sourceAssetId: "source", recordedAt: "synthetic software fixture" });
  json(job, "state/chatcut-main-timeline.json", { projectId: "project", state: { id: "timeline", fps: 30, durationFrames: 120 }, transcript: { coverage: "complete", entries: [{ itemId: "abcdef12", text: transcriptText, sourceRange: { start: 0, end: 4000000 }, timelineRange: { fromFrame: 0, toFrame: 120 } }] } });
  json(job, "state/timeline-source-windows.json", { projectId: "project", timelineId: "timeline", sourceAssetId: "source", sourceSha256: sha256File(path.join(job, "input/source.mp4")), timelineFps: { numerator: 30, denominator: 1 }, clips: [{ itemId: "abcdef12", timelineStartFrame: 0, durationFrames: 120, srcStartUs: 0, srcEndUs: 4000000, playbackRateNumerator: 1, playbackRateDenominator: 1 }] });
  const lookupPath = path.join(job, "lookup.json");
  fs.writeFileSync(lookupPath, JSON.stringify({ provider: "chatcut.find_transcript", projectId: "project", timelineId: "timeline", assetId: "source", lookups: [{ text: "\n1. result\n [item abcdef12]\n (source 00:00.000 → 00:00.700) 文案\n (source 00:00.900 → 00:01.600) 画面\n (source 00:02.800 → 00:03.800) 成片\n" }] }));
  const inputs = { schemaVersion: "1.0.0", visualOrchestrationVersion: 2, materials: [], cleanExport: { captionRenderDisabled: true }, captionEdits: { "main-001": ["文案和画面", "汇集成为成片"] }, beats: [{ id: "combined", sceneId: "one", sourceSegmentIds: ["main-001"], text: transcriptText, start: 0, end: 4, templateId: "converge-sources", intent: "inputs form a result", templateData: { items: ["文案", "画面"], result: "成片", revealCues: [{ keyword: "文案", segmentId: "main-001" }, { keyword: "画面", segmentId: "main-001" }, { keyword: "成片", segmentId: "main-001" }] }, entryAnchorWordId: "main-001:word-001", exitAnchorWordId: "main-001:word-001", exitAnchorOffsetFrames: 0, exitFrames: 6, supportRole: "organization", captionSafeZonePass: true, viewerQuestion: "哪些输入组合成结果", removalLoss: "失去输入与结果的关系", visualEncoding: "inputs above a shared result", stillFrameValue: "readable relationship", attentionCost: "low", factualClaims: [], terms: [], components: ["输入关系", "结果"], visualDecision: { mode: "argument", informationDelta: { kind: "causal-chain", statement: "输入组合为输出", basis: "spoken-structure", supportingWordIds: ["main-001:measured-word-001", "main-001:measured-word-002", "main-001:measured-word-003"] }, objectFamily: "inputs and output", visualVerb: "converge", evolutionMode: "evolve", argumentStates: [0, 1, 2].map((index) => ({ id: `state-${index}`, anchorWordId: `main-001:measured-word-${String(index + 1).padStart(3, "0")}`, operation: index === 2 ? "resolve" : "introduce", activeObjectCueIds: Array.from({ length: index + 1 }, (_, cue) => `object-${String(cue + 1).padStart(3, "0")}`), stateChange: `next semantic object ${index}`, readability: "clear" })), fallback: "caption only" }, layout: { primaryBoundsNormalized: { x: .1, y: .35, width: .8, height: .25 }, safeAreaPass: true, focalPlacement: "center", focalPlacementRationale: "focus above captions" } }] };
  json(job, "state/planning-inputs.json", inputs);
  run("prepare-mg-speech-timing.mjs", [job, lookupPath, "--write"]);
  run("generate-plan.mjs", [job, "--write"]);
  run("check-caption-review-plan.mjs", [path.join(job, "captions/caption-review-plan.json")]);
  run("check-transcript-reconciliation.mjs", [path.join(job, "state/transcript-reconciliation.json")]);
  run("check-visual-plan.mjs", [path.join(job, "state/beat-map.json"), path.join(job, "state/transcript.json"), path.join(job, "state/design-system.json")]);
  run("check-creative-confirmation.mjs", [path.join(job, "state/creative-confirmation.json"), path.join(job, "docs/creative-confirmation.md"), path.join(job, "state/beat-map.json"), path.join(job, "state/workflow.json")]);
  const transcript = read(job, "state/transcript.json");
  assert.equal(transcript.segments[0].words.length, 1, "measured MG anchors cannot duplicate released caption words");
  assert.equal(transcript.timingAnchors.length, 3);
  const map = read(job, "state/beat-map.json");
  assert.equal(map.visualOrchestrationVersion, 2); assert.deepEqual(map.materials, []);
  assert.deepEqual(map.beats[0].objectCues.map(cue => cue.firstLegibleFrame), [0, 27, 84]);
  assert.equal(read(job, "state/creative-confirmation.json").changeControl.implementationMayStartAfter, "visual-arrangement-approved");
  assert.equal(read(job, "state/creative-confirmation.json").changeControl.planChangesRequireReapproval, true);
  assert.match(fs.readFileSync(path.join(job, "docs/creative-confirmation.md"), "utf8"), /visual-arrangement-cue:combined:object-003/);
  run("assemble-mg.mjs", [job, "--write"]);
  buildComposition(path.join(job, "hyperframes"));
  const initial = sha256File(path.join(job, "state/transcript.json"));
  inputs.beats[0].templateId = "stage/axis-stage-transition";
  json(job, "state/planning-inputs.json", inputs);
  run("generate-plan.mjs", [job, "--write"], /Stage helpers require/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  inputs.beats[0].templateId = "converge-sources";
  json(job, "state/planning-inputs.json", inputs);
  const snapshot = read(job, "state/chatcut-main-timeline.json");
  json(job, "state/chatcut-main-timeline.json", { ...snapshot, projectId: "different-project" });
  run("generate-plan.mjs", [job, "--write"], /project\/timeline differs/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  json(job, "state/chatcut-main-timeline.json", { ...snapshot, state: { ...snapshot.state, durationFrames: 123 } });
  run("generate-plan.mjs", [job, "--write"], /snapshot duration differs/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  json(job, "state/chatcut-main-timeline.json", snapshot);
  const staleWindows = read(job, "state/timeline-source-windows.json");
  json(job, "state/timeline-source-windows.json", { ...staleWindows, clips: staleWindows.clips.map(clip => ({ ...clip, srcStartUs: 100000, srcEndUs: 4100000 })) });
  run("generate-plan.mjs", [job, "--write"], /source-window mapping/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  json(job, "state/timeline-source-windows.json", { ...staleWindows, sourceSha256: "a".repeat(64) });
  run("generate-plan.mjs", [job, "--write"], /immutable source media/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  json(job, "state/timeline-source-windows.json", staleWindows);
  run("generate-plan.mjs", [job, "--write"]);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial, "generation is idempotent");
  const workflow = read(job, "state/workflow.json"); workflow.currentState = "visual-arrangement-review"; json(job, "state/workflow.json", workflow);
  inputs.beats[0].intent = "changed after review"; json(job, "state/planning-inputs.json", inputs);
  run("generate-plan.mjs", [job, "--write", "--replace-existing"], /under review or approved/);
  assert.equal(sha256File(path.join(job, "state/transcript.json")), initial);
  workflow.currentState = "motion-plan"; json(job, "state/workflow.json", workflow);
  const edited = read(job, "state/transcript.json"); edited.segments[0].text = "人工听校文案"; json(job, "state/transcript.json", edited);
  run("generate-plan.mjs", [job, "--write"], /existing manual content/);
  json(job, "state/transcript.json", transcript);
  inputs.beats[0].intent = "inputs form a result"; json(job, "state/planning-inputs.json", inputs);
  const storyboard = fs.readFileSync(path.join(job, "docs/motion-plan.md"), "utf8");
  assert.match(storyboard, /\| Beat \| 时间 \| 场景 \| 对应口播/);
  assert.match(storyboard, /\| combined \|.*文案和画面汇集成为成片.*局部 MG：converge-sources/);
  const moduleHash = sha256File(path.join(job, "hyperframes/mg/combined/timeline.mjs"));
  const indexHash = sha256File(path.join(job, "hyperframes/index.html"));
  run("workflow-state.mjs", [path.join(job, "state/workflow.json"), "approve-creative", "--actor", "agent", "--note", "Synthetic software integration validation; no real user approval"]);
  const composeOutput = run("compose-job.mjs", [job]);
  assert.match(composeOutput, /Visual arrangement ready for user review/);
  const reviewWorkflow = read(job, "state/workflow.json");
  assert.equal(reviewWorkflow.currentState, "visual-arrangement-review");
  assert.equal(reviewWorkflow.visualArrangementReviewDecision, "pending");
  assert.equal(reviewWorkflow.gates["visual-arrangement-review"].status, "pending");
  assert.equal(sha256File(path.join(job, "hyperframes/mg/combined/timeline.mjs")), moduleHash);
  assert.equal(sha256File(path.join(job, "hyperframes/index.html")), indexHash);
  assert.equal(fs.existsSync(path.join(job, "captions/captions.json")), false, "compose cannot promote captions before visual approval");
  console.log(`All 13 controlled semantic templates plus fresh generator→assembly→builder, actual creative-validation→compose visual gate, measured timing, legacy retention, idempotency and protected-write failure paths passed. Fixture: ${job}`);
} finally {
  if (!process.argv.includes("--keep")) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`Retained diagnostic fixtures: ${root}`);
}
