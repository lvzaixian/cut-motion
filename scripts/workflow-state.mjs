import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import {
  assertCreativeAuthorities,
  assertCompositionReady,
  assertRegularContainedFile,
  beginWorkflowRevision,
  collectCreativeAuthorityDrift,
  collectWorkflowDrift,
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  enableVisualArrangementReviewForMotionPlan,
  ensureWorkflowDefaults,
  hasActiveSubtitleMgCadence,
  invalidateCreativeArtifacts,
  jobRootForWorkflow,
  readJson,
  recoverTranscriptTransaction,
  resetVisualArrangementReview,
  saveWorkflow,
  sha256File,
  validateActiveReference,
  visualPlanChanges,
  writeJsonAtomic
} from "./workflow-utils.mjs";
import { isVisualOrchestrationActive } from "./visual-orchestration-version.mjs";

const [workflowPath, command, ...rawArguments] = process.argv.slice(2);

if (!workflowPath || !command) {
  console.error("Usage: node workflow-state.mjs <workflow.json> <status|verify|lock-transcript|advance|approve-cover|approve|approve-creative|approve-visual-arrangement|revise|revise-visual-arrangement|fallback-auto|waive-v1-roughcut-selection-for-ffmpeg-fallback|replan|reopen|set-mode|set-caption-mode|set-axis-mode> [value] [--actor name] [--artifact path] [--note text]");
  process.exit(64);
}

const stages = {
  intake: { next: "transcription" },
  transcription: { next: "rough-cut", artifact: true },
  "rough-cut": { next: "rough-cut-review", artifact: true },
  "rough-cut-review": { gate: true, next: "rough-cut-export", revise: "rough-cut" },
  "rough-cut-export": { next: "motion-plan", artifact: true },
  "motion-plan": { next: "composition", artifact: true },
  "visual-arrangement-review": { gate: true, next: "composition", revise: "motion-plan" },
  composition: { next: "render", artifact: true },
  render: { next: "complete", artifact: true },
  complete: { terminal: true }
};

const options = {};
const positionals = [];
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  if (argument.startsWith("--")) {
    options[argument.slice(2)] = rawArguments[index + 1] ?? true;
    index += 1;
  } else {
    positionals.push(argument);
  }
}

const jobRoot = jobRootForWorkflow(workflowPath);
recoverTranscriptTransaction(jobRoot);
const workflow = ensureWorkflowDefaults(JSON.parse(fs.readFileSync(workflowPath, "utf8")));
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const roughCutSelectionPolicy = "reference-aligned-last-complete-take-v1";
const v1FallbackWaiverCommand = "waive-v1-roughcut-selection-for-ffmpeg-fallback";
const actor = String(options.actor ?? (["advance", "lock-transcript"].includes(command) ? "agent" : "user"));
const artifact = options.artifact ? String(options.artifact) : null;
const note = options.note ? String(options.note) : null;
const now = new Date().toISOString();
const visualBaselinePath = path.join(jobRoot, "state", "visual-plan-baseline.json");
let pendingVisualBaseline = null;
let deliveryPromotion = null;
const fullAuditRequested = workflow.mode === "auto" || workflow.roughCutReviewDecision === "automatic-fallback";
const requiresVisualArrangementReview = () => workflow.visualArrangementReviewRequired === true;
const isNonemptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isIsoTimestamp = (value) => isNonemptyString(value)
  && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value));
const hasValidV1FallbackWaiver = () => {
  const waiver = workflow.roughCutSelectionFallbackWaiver;
  return waiver?.actor === "user" && isIsoTimestamp(waiver.waivedAt) && isNonemptyString(waiver.reason);
};
const validateFfmpegFallbackEligibility = () => {
  const project = readJson(path.join(jobRoot, "state", "project.json"));
  if (project.roughCutEngine !== "ffmpeg-fallback") {
    throw new Error("FFmpeg rough-cut fallback requires project.roughCutEngine=ffmpeg-fallback");
  }
  const selectionPath = path.join(jobRoot, "state", "roughcut-selection.json");
  if (!fs.existsSync(selectionPath)) {
    if (workflow.roughCutSelectionPolicy === null) return;
    if (workflow.roughCutSelectionPolicy === roughCutSelectionPolicy) {
      throw new Error(`reference-aligned-last-complete-take-v1 requires a ChatCut rough-cut selection; ffmpeg-fallback cannot enforce it. Use ${v1FallbackWaiverCommand} only when the user explicitly accepts the downgrade.`);
    }
    throw new Error(`Unknown rough-cut selection policy: ${workflow.roughCutSelectionPolicy}`);
  }
  assertRegularContainedFile(path.join(jobRoot, "state"), selectionPath, "Rough-cut selection");
  if (workflow.roughCutSelectionPolicy !== null) {
    if (workflow.roughCutSelectionPolicy === roughCutSelectionPolicy) {
      throw new Error(`reference-aligned-last-complete-take-v1 requires a ChatCut rough-cut selection; ffmpeg-fallback cannot enforce it. Use ${v1FallbackWaiverCommand} only when the user explicitly accepts the downgrade.`);
    }
    throw new Error(`Unknown rough-cut selection policy: ${workflow.roughCutSelectionPolicy}`);
  }
  if (workflow.roughCutSelectionPolicyOrigin !== roughCutSelectionPolicy) {
    throw new Error("FFmpeg fallback with state/roughcut-selection.json requires a V1 origin and explicit user waiver");
  }
  if (!hasValidV1FallbackWaiver()) {
    throw new Error(`V1-origin ffmpeg fallback requires an explicit user waiver via ${v1FallbackWaiverCommand}`);
  }
};

const appendHistory = (action, from, to, entryActor = actor, entryArtifact = artifact) => {
  workflow.history.push({ at: now, action, actor: entryActor, from, to, artifact: entryArtifact, note, revisionId: workflow.revisionId });
};

const move = (to, action, entryActor = actor, entryArtifact = artifact) => {
  const from = workflow.currentState;
  workflow.currentState = to;
  workflow.pendingGate = stages[to]?.gate ? to : null;
  if (stages[to]?.gate) {
    workflow.gates[to] = { status: "pending", at: now, actor: entryActor, artifact: entryArtifact, note, revisionId: workflow.revisionId };
  }
  appendHistory(action, from, to, entryActor, entryArtifact);
};

const runCheck = (scriptName, argumentsList, failurePrefix) => {
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, scriptName), ...argumentsList], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${failurePrefix}: ${result.stderr.trim() || result.stdout.trim()}`);
};

const checkCover = (readyOnly = false) => runCheck(
  "check-cover.mjs",
  [workflowPath, ...(readyOnly ? ["--ready"] : [])],
  "Cover validation failed"
);
const checkTitles = (renderedVideoPath) => runCheck(
  "check-titles.mjs",
  [workflowPath, renderedVideoPath],
  "Title package invalid"
);
const checkRoughCutSelection = () => {
  if (workflow.roughCutSelectionPolicy === null) {
    if (workflow.roughCutSelectionPolicyOrigin === roughCutSelectionPolicy
      || fs.existsSync(path.join(jobRoot, "state", "roughcut-selection.json"))) {
      throw new Error("ChatCut rough-cut selection cannot be disabled by a null policy; only historic workflows without a selection file may use null");
    }
    return;
  }
  if (workflow.roughCutSelectionPolicy !== roughCutSelectionPolicy) {
    throw new Error(`Unknown rough-cut selection policy: ${workflow.roughCutSelectionPolicy}`);
  }
  runCheck("check-roughcut-selection.mjs", [workflowPath], "Rough-cut selection invalid");
};
const promoteTitleSourceDelivery = (fromRelativePath, toRelativePath) => {
  const titlesPath = path.join(jobRoot, "state", "titles.json");
  const titles = readJson(titlesPath);
  if (titles.sourceDelivery?.path === fromRelativePath) {
    titles.sourceDelivery.path = toRelativePath;
    writeJsonAtomic(titlesPath, titles);
  }
};

// ponytail: thrown failures roll back; abrupt termination retains backups, add journal recovery if crash-safe promotion is required.
const beginDeliveryPromotion = (candidatePath, candidateReceiptPath, canonicalPath) => {
  const backupDirectory = fs.mkdtempSync(path.join(jobRoot, "output", ".delivery-promotion-"));
  const originalPaths = [canonicalPath, `${canonicalPath}.render.json`, path.join(jobRoot, "state", "titles.json"), path.resolve(workflowPath), candidatePath, candidateReceiptPath];
  const originals = [];
  try {
    for (const [index, originalPath] of originalPaths.entries()) {
      const backupPath = fs.existsSync(originalPath) ? path.join(backupDirectory, String(index)) : null;
      if (backupPath) {
        assertRegularContainedFile(jobRoot, originalPath, "Delivery promotion original");
        try { fs.linkSync(originalPath, backupPath); }
        catch { fs.copyFileSync(originalPath, backupPath, fs.constants.COPYFILE_EXCL); }
      }
      originals.push({ originalPath, backupPath });
    }
  } catch (error) {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
    throw error;
  }
  deliveryPromotion = { backupDirectory, originals };
};
const rollbackDeliveryPromotion = () => {
  if (!deliveryPromotion) return;
  const transaction = deliveryPromotion;
  const failures = [];
  const restore = (operation) => { try { operation(); } catch (error) { failures.push(error); } };
  for (const { originalPath, backupPath } of transaction.originals) {
    restore(() => backupPath ? fs.renameSync(backupPath, originalPath) : fs.rmSync(originalPath, { force: true }));
  }
  for (const target of [path.join(jobRoot, "state", "titles.json"), path.resolve(workflowPath)]) {
    restore(() => fs.rmSync(`${target}.${process.pid}.tmp`, { force: true }));
  }
  if (failures.length) throw new AggregateError(failures, `Delivery rollback incomplete; retained backups: ${transaction.backupDirectory}`);
  fs.rmSync(transaction.backupDirectory, { recursive: true, force: true });
  deliveryPromotion = null;
};
const commitDeliveryPromotion = () => {
  if (!deliveryPromotion) return;
  const { backupDirectory } = deliveryPromotion;
  deliveryPromotion = null;
  try { fs.rmSync(backupDirectory, { recursive: true, force: true }); }
  catch (error) { console.warn(`Delivery committed; backup cleanup failed at ${backupDirectory}: ${error.message}`); }
};

const reconciliationPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
const sourceTranscriptPath = path.join(jobRoot, "state", "source-transcript.json");
const checkReconciliation = (allowPending, expectedMedia = null) => {
  if (!fs.existsSync(reconciliationPath)) throw new Error("Transcript reconciliation is missing");
  runCheck(
    "check-transcript-reconciliation.mjs",
    [reconciliationPath, ...(allowPending ? ["--allow-review-pending"] : []), ...(expectedMedia ? ["--expected-media", expectedMedia] : [])],
    "Transcript reconciliation failed"
  );
};

const lockRoughCutMedia = (artifactPath, { audit = false, requirePromotion = false } = {}) => {
  const mediaPath = path.relative(jobRoot, artifactPath);
  const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");

  probeReviewVideo(artifactPath, "Rough-cut export");
  assertSourceTranscriptLock();

  if (requirePromotion) {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    const recorded = project.mediaArtifacts?.roughcut;
    if (recorded?.path !== mediaPath || recorded.sha256 !== sha256File(artifactPath)) {
      throw new Error("Rough-cut export must be promoted after the ChatCut review");
    }
  }

  if (audit) {
    checkReconciliation(true, mediaPath);
    runCheck("finalize-trim-plan.mjs", [
      trimPlanPath,
      artifactPath,
      "--expected-source-transcript-sha",
      workflow.sourceTranscriptSha256
    ], "Automatic rough-cut fallback failed canonical trim finalization");
    assertSourceTranscriptLock();
    runCheck("check-trim-plan.mjs", [trimPlanPath, "--require-audit", "--media", artifactPath], "Automatic rough-cut fallback requires a complete seam audit");
  }

  workflow.authoritativeMediaPath = mediaPath;
  workflow.authoritativeMediaSha256 = sha256File(artifactPath);
  workflow.trimPlanSha256 = sha256File(trimPlanPath);
};

const assertSourceTranscriptLock = () => {
  if (!workflow.sourceTranscriptSha256) throw new Error("Source transcript has not been locked");
  assertRegularContainedFile(path.join(jobRoot, "state"), sourceTranscriptPath, "Source transcript");
  if (sha256File(sourceTranscriptPath) !== workflow.sourceTranscriptSha256) {
    throw new Error("Source transcript changed after its timeline lock");
  }
};
const lockSourceTranscript = (transcriptPath) => {
  if (workflow.sourceTranscriptSha256) {
    assertSourceTranscriptLock();
    return;
  }
  if (fs.existsSync(sourceTranscriptPath)) {
    throw new Error("Unbound source transcript already exists");
  }
  writeJsonAtomic(sourceTranscriptPath, readJson(transcriptPath));
  workflow.sourceTranscriptSha256 = sha256File(sourceTranscriptPath);
};

const recordCreativeAuthorities = () => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.authorities = computeCreativeAuthorities(jobRoot, workflow.captionMode);
  writeJsonAtomic(confirmationPath, confirmation);
};
const requiresCadenceCreativeLock = () => {
  if (hasActiveSubtitleMgCadence(jobRoot, workflow.captionMode)) return true;
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  return fs.existsSync(confirmationPath) && Boolean(readJson(confirmationPath).authorities?.designSystem);
};

const assertJobArtifact = (relativePath, expectedDirectory) => {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Artifacts must use a job-relative path");
  const absolutePath = path.resolve(jobRoot, relativePath);
  assertRegularContainedFile(path.join(jobRoot, expectedDirectory), absolutePath, "Workflow artifact");
  return absolutePath;
};

const validateChatcutRoughCutRecord = (recordedArtifactPath) => {
  const record = readJson(recordedArtifactPath);
  if (record.schemaVersion !== "1.0.0") throw new Error("ChatCut rough-cut record must use schemaVersion 1.0.0");
  if (record.source !== "chatcut") throw new Error("ChatCut rough-cut record must identify ChatCut as its source");
  if (typeof record.projectId !== "string" || !record.projectId.trim()) {
    throw new Error("ChatCut rough-cut record requires a projectId");
  }
  if (!Array.isArray(record.timelineIds) || record.timelineIds.length === 0
    || record.timelineIds.some((timelineId) => typeof timelineId !== "string" || !timelineId.trim())) {
    throw new Error("ChatCut rough-cut record requires at least one timelineId");
  }
  if (record.activeTimelineId != null && !record.timelineIds.includes(record.activeTimelineId)) {
    throw new Error("ChatCut rough-cut activeTimelineId must be listed in timelineIds");
  }
  if (typeof record.recordedAt !== "string" || !record.recordedAt.trim()) {
    throw new Error("ChatCut rough-cut record requires recordedAt");
  }
  return record;
};

const chatcutRoughCutArtifact = (relativePath) => relativePath === "state/chatcut-roughcut.json";

const probeReviewVideo = (videoPath, label) => {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", videoPath], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`${label} is not a readable media file`);
  const result = JSON.parse(probe.stdout || "{}");
  const duration = Number(result.format?.duration);
  if (!(duration > 0)) throw new Error(`${label} has no positive duration`);
  const streamTypes = new Set((result.streams ?? []).map((stream) => stream.codec_type));
  if (!streamTypes.has("video") || !streamTypes.has("audio")) throw new Error(`${label} requires video and audio streams`);
  const video = result.streams.find((stream) => stream.codec_type === "video");
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  const [numerator, denominator] = String(video?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = denominator ? numerator / denominator : 0;
  const videoDuration = Number(video?.duration);
  const audioDuration = Number(audio?.duration);
  if (Number.isFinite(videoDuration) && Number.isFinite(audioDuration)
    && Math.abs(videoDuration - audioDuration) > Math.max(0.1, 2 / Math.max(fps, 1))) {
    throw new Error(`${label} audio and video durations differ`);
  }
  return { duration, width: video?.width, height: video?.height, fps };
};

const validateRoughCutReview = () => {
  const recordedArtifact = workflow.gates?.["rough-cut-review"]?.artifact;
  if (!recordedArtifact) throw new Error("Rough-cut review has no recorded artifact");
  const expectedDirectory = chatcutRoughCutArtifact(recordedArtifact) ? "state" : "roughcut";
  const recordedArtifactPath = assertJobArtifact(recordedArtifact, expectedDirectory);
  if (chatcutRoughCutArtifact(recordedArtifact)) {
    validateChatcutRoughCutRecord(recordedArtifactPath);
    assertSourceTranscriptLock();
    checkRoughCutSelection();
    return;
  }
  validateFfmpegFallbackEligibility();
  probeReviewVideo(recordedArtifactPath, "Rough cut");
  assertSourceTranscriptLock();
  const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
  if (!workflow.trimPlanSha256 || sha256File(trimPlanPath) !== workflow.trimPlanSha256) {
    throw new Error("Rough-cut trim audit changed after the locked edit was produced");
  }
  if (!workflow.authoritativeMediaSha256 || sha256File(recordedArtifactPath) !== workflow.authoritativeMediaSha256) {
    throw new Error("Rough-cut media changed after the locked edit was produced");
  }
};

const validateCreativePackage = (approvalNote, approvalActor) => {
  if (!workflow.captionModeAcknowledged) throw new Error("Caption mode requires explicit user acknowledgement");
  if (["b-axis-stage", "hybrid"].includes(workflow.visualAxisMode)
    && (!workflow.visualAxisModeAcknowledged || workflow.visualAxisModeSource !== "user")) {
    throw new Error("B-axis or hybrid plans require explicit user acknowledgement");
  }
  const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
  runCheck(
    "check-visual-plan.mjs",
    [beatMapPath, path.join(jobRoot, "state", "transcript.json"), path.join(jobRoot, "state", "design-system.json"), workflowPath],
    "Motion plan requires a valid beat map"
  );
  checkReconciliation(false);
  approveCaptionReviewPlan(approvalNote);
  if (requiresVisualArrangementReview() && isVisualOrchestrationActive(readJson(beatMapPath))) {
    runCheck(
      "render-visual-arrangement-doc.mjs",
      [jobRoot],
      "Visual arrangement package generation failed"
    );
  }
  recordCreativeAuthorities();
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const proposedConfirmation = readJson(confirmationPath);
  if (proposedConfirmation.review?.status === "revision-requested") {
    proposedConfirmation.review = { ...proposedConfirmation.review, status: "ready" };
    writeJsonAtomic(confirmationPath, proposedConfirmation);
  }
  runCheck(
    "check-creative-confirmation.mjs",
    [
      confirmationPath,
      path.join(jobRoot, "docs", "creative-confirmation.md"),
      path.join(jobRoot, "state", "beat-map.json"),
      workflowPath
    ],
    "Creative confirmation validation failed"
  );
  const confirmation = readJson(confirmationPath);
  confirmation.review = { status: "approved", actor: approvalActor, decidedAt: now, note: approvalNote };
  writeJsonAtomic(confirmationPath, confirmation);
  workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
  workflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(jobRoot, workflow.captionMode);
};

const recordRoughCutDecision = (status, decision, entryActor, decisionNote) => {
  workflow.roughCutReviewDecision = decision;
  workflow.gates["rough-cut-review"] = {
    ...workflow.gates["rough-cut-review"],
    status,
    decidedAt: now,
    actor: entryActor,
    note: decisionNote
  };
};

const recordVisualArrangementDecision = (status, decision, entryActor, decisionNote) => {
  workflow.visualArrangementReviewDecision = decision;
  workflow.gates["visual-arrangement-review"] = {
    ...workflow.gates["visual-arrangement-review"],
    status,
    decidedAt: now,
    actor: entryActor,
    artifact: "docs/creative-confirmation.md",
    note: decisionNote,
    revisionId: workflow.revisionId
  };
};

const selectAutomaticFallback = (entryActor, decisionNote) => {
  validateRoughCutReview();
  acceptDeferredPreferences("auto");
  const warning = "Automatic export and three-threshold checking may take a long time";
  recordRoughCutDecision("automatic-fallback", "automatic-fallback", entryActor, `${decisionNote} ${warning}.`);
  move("rough-cut-export", "automatic-fallback", entryActor);
  console.warn(`${warning}.`);
};
const save = () => {
  if (pendingVisualBaseline) writeJsonAtomic(visualBaselinePath, pendingVisualBaseline);
  saveWorkflow(workflowPath, workflow, now);
};

const invalidateCreativeConfirmation = () => {
  invalidateCreativeArtifacts(jobRoot);
};

const syncPreferenceArtifacts = (resetDocuments = false) => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (!fs.existsSync(confirmationPath)) return;
  const confirmation = readJson(confirmationPath);
  confirmation.captionMode = workflow.captionMode;
  confirmation.captionModeDecision = {
    status: workflow.captionModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.captionModeSource
  };
  confirmation.visualAxisMode = workflow.visualAxisMode;
  confirmation.visualAxisModeDecision = {
    status: workflow.visualAxisModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.visualAxisModeSource
  };
  confirmation.storyboard ??= {};
  if (workflow.captionMode === "subtitles") {
    confirmation.storyboard.captionPlan = "docs/caption-plan.md";
  } else {
    delete confirmation.storyboard.captionPlan;
  }
  writeJsonAtomic(confirmationPath, confirmation);
  if (!resetDocuments) return;
  const templates = path.join(scriptDirectory, "..", "templates", "job");
  fs.copyFileSync(
    path.join(templates, workflow.captionMode === "subtitles" ? "creative-confirmation.md" : "creative-confirmation.motion-copy.md"),
    path.join(jobRoot, "docs", "creative-confirmation.md")
  );
  const captionPlanPath = path.join(jobRoot, "docs", "caption-plan.md");
  if (workflow.captionMode === "subtitles") fs.copyFileSync(path.join(templates, "caption-plan.md"), captionPlanPath);
  else if (fs.existsSync(captionPlanPath)) fs.unlinkSync(captionPlanPath);
};

const acceptDeferredPreferences = (decisionSource) => {
  validateActiveReference(workflowPath, workflow);
  if (!workflow.captionModeAcknowledged && workflow.captionModeSource !== "auto") {
    throw new Error("Rough-cut approval requires an agent caption-mode recommendation with --note");
  }
  if (!workflow.visualAxisModeAcknowledged && workflow.visualAxisModeSource !== "auto") {
    throw new Error("Rough-cut approval requires an agent visual-axis recommendation with --note");
  }
  let changed = false;
  if (!workflow.captionModeAcknowledged) {
    workflow.captionModeAcknowledged = true;
    workflow.captionModeSource = decisionSource;
    changed = true;
  }
  if (!workflow.visualAxisModeAcknowledged) {
    workflow.visualAxisModeAcknowledged = true;
    workflow.visualAxisModeSource = decisionSource;
    changed = true;
  }
  if (!workflow.referenceScriptAcknowledged) {
    workflow.referenceScriptAcknowledged = true;
    changed = true;
  }
  if (!changed) return;
  syncPreferenceArtifacts();
  appendHistory(
    "accept-deferred-preferences",
    workflow.currentState,
    workflow.currentState,
    decisionSource === "user" ? "user" : "agent"
  );
};

const approveCaptionReviewPlan = (approvalNote) => {
  if (workflow.captionMode !== "subtitles") return;
  const captionReviewPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
  if (!fs.existsSync(captionReviewPlanPath)) throw new Error("Subtitle plan approval requires captions/caption-review-plan.json");
  const captionReviewCheck = spawnSync(process.execPath, [path.join(scriptDirectory, "check-caption-review-plan.mjs"), captionReviewPlanPath], { encoding: "utf8" });
  if (captionReviewCheck.status !== 0) throw new Error(`Subtitle plan approval requires valid semantic cues: ${captionReviewCheck.stderr.trim() || captionReviewCheck.stdout.trim()}`);
  const captionReviewPlan = readJson(captionReviewPlanPath);
  captionReviewPlan.status = "approved";
  captionReviewPlan.approvedAt = now;
  captionReviewPlan.approvalNote = approvalNote;
  writeJsonAtomic(captionReviewPlanPath, captionReviewPlan);
};

if (command === "status") {
  console.log(JSON.stringify(workflow, null, 2));
  process.exit(0);
}

if (command === "verify") {
  const drift = [...collectWorkflowDrift(jobRoot, workflow), ...collectCreativeAuthorityDrift(jobRoot, workflow)];
  if (drift.length) {
    for (const entry of drift) console.error(`Drift: ${entry}`);
    process.exit(1);
  }
  console.log("Workflow fingerprints match their recorded artifacts.");
  process.exit(0);
}
if (command === "lock-transcript") {
  if (!["transcription", "rough-cut", "rough-cut-export", "motion-plan"].includes(workflow.currentState)) {
    throw new Error("Lock the source transcript during transcription or editing");
  }
  const transcriptPath = assertJobArtifact("state/transcript.json", "state");
  const transcript = readJson(transcriptPath);
  if (!Array.isArray(transcript.segments) || !transcript.segments.length) throw new Error("Source transcript has no segments");
  // Locking timing never advances the workflow or accepts cover/selection decisions.
  const alreadyLocked = Boolean(workflow.sourceTranscriptSha256);
  lockSourceTranscript(transcriptPath);
  if (!alreadyLocked) {
    appendHistory("lock-transcript", workflow.currentState, workflow.currentState);
    save();
  }
  console.log("Source transcript locked.");
  process.exit(0);
}
if (command === "set-mode") {
  const mode = positionals[0];
  if (!["review", "auto"].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  if (mode === "auto" && options.actor !== "user") throw new Error("Automatic mode requires an explicit --actor user selection");
  const previousMode = workflow.mode;
  workflow.mode = mode;
  appendHistory("set-mode", workflow.currentState, workflow.currentState, actor);
  if (mode === "auto" && workflow.currentState === "rough-cut-review") {
    selectAutomaticFallback("agent", "Automatic mode selected");
  }
  if (mode === "auto" && workflow.currentState === "visual-arrangement-review") {
    validateCreativePackage("Automatic mode selected by user", "agent");
    recordVisualArrangementDecision("automatic-accepted", "automatic-accepted", "agent", "Automatic mode selected by user");
    move("composition", "automatic-visual-arrangement-accept", "agent", "docs/creative-confirmation.md");
  }
  save();
  console.log(`Mode changed: ${previousMode} → ${workflow.mode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "set-caption-mode") {
  const captionMode = positionals[0];
  if (!["motion-copy", "subtitles"].includes(captionMode)) throw new Error(`Invalid caption mode: ${captionMode}`);
  const previousCaptionMode = workflow.captionMode;
  const previousState = workflow.currentState;
  const isRecommendation = actor === "agent";
  if (isRecommendation && !note) throw new Error("Agent caption-mode recommendations require --note");
  workflow.captionMode = captionMode;
  workflow.captionModeSource = isRecommendation ? "auto" : "user";
  workflow.captionModeAcknowledged = !isRecommendation;
  const planningOrLater = ["motion-plan", "visual-arrangement-review", "composition", "render", "complete"].includes(previousState);
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  syncPreferenceArtifacts(!planningOrLater);
  const captionModeChanged = previousCaptionMode !== captionMode;
  if (captionModeChanged) enableVisualArrangementReviewForMotionPlan(workflow);
  if (captionModeChanged && planningOrLater) {
    beginWorkflowRevision(workflow);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-caption-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-caption-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    }
  }
  save();
  console.log(`Caption mode changed: ${previousCaptionMode} → ${workflow.captionMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "set-axis-mode") {
  const axisMode = positionals[0];
  if (!["a-axis-overlay", "b-axis-stage", "hybrid"].includes(axisMode)) throw new Error(`Invalid visual axis mode: ${axisMode}`);
  const previousAxisMode = workflow.visualAxisMode;
  const previousState = workflow.currentState;
  const isRecommendation = actor === "agent";
  if (isRecommendation && !note) throw new Error("Agent visual-axis recommendations require --note");
  workflow.visualAxisMode = axisMode;
  workflow.visualAxisModeSource = isRecommendation ? "auto" : "user";
  workflow.visualAxisModeAcknowledged = !isRecommendation;
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  syncPreferenceArtifacts();
  const planningOrLater = ["motion-plan", "visual-arrangement-review", "composition", "render", "complete"].includes(previousState);
  const axisModeChanged = previousAxisMode !== axisMode;
  if (axisModeChanged) enableVisualArrangementReviewForMotionPlan(workflow);
  if (axisModeChanged && planningOrLater) {
    beginWorkflowRevision(workflow);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-axis-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-axis-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    }
  }
  save();
  console.log(`Visual axis mode changed: ${previousAxisMode} → ${workflow.visualAxisMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "replan") {
  if (!["motion-plan", "visual-arrangement-review", "composition", "render"].includes(workflow.currentState)) {
    throw new Error(`State ${workflow.currentState} cannot return to motion-plan`);
  }
  if (!note) throw new Error("Replan requires --note");
  const previousState = workflow.currentState;
  beginWorkflowRevision(workflow);
  invalidateCreativeConfirmation();
  workflow.creativeConfirmationSha256 = null;
  workflow.creativeDocumentFingerprints = null;
  enableVisualArrangementReviewForMotionPlan(workflow);
  workflow.currentState = "motion-plan";
  workflow.pendingGate = null;
  appendHistory("replan", previousState, "motion-plan", actor);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "approve-creative") {
  if (workflow.mode !== "review" || workflow.currentState !== "motion-plan" || workflow.roughCutReviewDecision !== "manual-approved") {
    throw new Error("Creative approval requires review-mode motion-plan after a manual rough-cut approval");
  }
  if (workflow.gates?.["rough-cut-review"]?.status !== "approved") {
    throw new Error("Creative approval requires an approved rough-cut review gate");
  }
  if (actor !== "agent") throw new Error("Creative approval is an internal Agent action and requires --actor agent");
  if (!note) throw new Error("Creative approval requires --note");
  validateCreativePackage(note, actor);
  appendHistory("approve-creative", workflow.currentState, workflow.currentState, actor);
  save();
  console.log("Creative package approved.");
  process.exit(0);
}
if (command === "approve-visual-arrangement") {
  if (workflow.currentState !== "visual-arrangement-review") throw new Error("Only visual arrangement review can be approved");
  if (!requiresVisualArrangementReview()) throw new Error("Visual arrangement review is not required for this legacy workflow");
  if (options.actor !== "user") throw new Error("Visual arrangement approval requires actor user");
  if (!isNonemptyString(note)) throw new Error("Visual arrangement approval requires --note");
  // Validate the frozen package first; approval must never rebind a changed plan.
  assertCreativeAuthorities(jobRoot, workflow);
  checkReconciliation(false);
  recordVisualArrangementDecision("approved", "manual-approved", actor, note);
  move("composition", "approve-visual-arrangement", actor);
  save();
  console.log("Visual arrangement approved.");
  process.exit(0);
}
if (command === "revise-visual-arrangement") {
  if (workflow.currentState !== "visual-arrangement-review") throw new Error("Only visual arrangement review can be revised");
  if (!requiresVisualArrangementReview()) throw new Error("Visual arrangement review is not required for this legacy workflow");
  if (options.actor !== "user") throw new Error("Visual arrangement revision requires actor user");
  if (!isNonemptyString(note)) throw new Error("Visual arrangement revision requires --note");
  const previousState = workflow.currentState;
  beginWorkflowRevision(workflow);
  invalidateCreativeConfirmation();
  workflow.creativeConfirmationSha256 = null;
  workflow.creativeDocumentFingerprints = null;
  workflow.visualPlanSha256 = null;
  resetVisualArrangementReview(workflow);
  workflow.currentState = "motion-plan";
  workflow.pendingGate = null;
  appendHistory("revise-visual-arrangement", previousState, "motion-plan", actor);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "approve-cover") {
  if (actor !== "user") throw new Error("Cover approval requires --actor user");
  if (!note) throw new Error("Cover approval requires --note");
  checkCover(true);
  const coverPath = path.join(jobRoot, "state", "cover.json");
  const cover = readJson(coverPath);
  cover.status = "approved";
  cover.output.sha256 = sha256File(path.join(jobRoot, "output", "cover.png"));
  cover.review = { status: "approved", actor, decidedAt: now, note };
  writeJsonAtomic(coverPath, cover);
  checkCover();
  workflow.coverReviewDecision = "approved";
  appendHistory("approve-cover", workflow.currentState, workflow.currentState, actor);
  save();
  console.log("Cover approved.");
  process.exit(0);
}
if (command === v1FallbackWaiverCommand) {
  if (workflow.currentState !== "rough-cut") throw new Error("V1 fallback waiver is only available at rough-cut before fallback");
  if (options.actor !== "user") throw new Error("V1 fallback waiver requires --actor user");
  if (!note) throw new Error("V1 fallback waiver requires --note");
  if (workflow.roughCutSelectionPolicyOrigin !== roughCutSelectionPolicy) {
    throw new Error("V1 fallback waiver requires a V1-origin rough-cut workflow");
  }
  const project = readJson(path.join(jobRoot, "state", "project.json"));
  if (project.roughCutEngine !== "ffmpeg-fallback") {
    throw new Error("V1 fallback waiver requires project.roughCutEngine=ffmpeg-fallback");
  }
  workflow.roughCutSelectionPolicy = null;
  workflow.roughCutSelectionFallbackWaiver = { actor, waivedAt: now, reason: note };
  appendHistory(v1FallbackWaiverCommand, workflow.currentState, workflow.currentState, actor);
  save();
  console.log("V1 rough-cut selection waived for ffmpeg fallback.");
  process.exit(0);
}
if (command === "fallback-auto") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Automatic rough-cut fallback is only available at rough-cut-review");
  if (workflow.mode !== "auto" && actor !== "user") throw new Error("Automatic rough-cut fallback requires an explicit user decision");
  if (!note) throw new Error("Automatic rough-cut fallback requires --note");
  selectAutomaticFallback(actor, note);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "reopen") {
  const scope = positionals[0];
  const targets = {
    "rough-cut": "rough-cut",
    "motion-plan": "motion-plan",
    composition: "composition",
    delivery: "render"
  };
  const target = targets[scope];
  if (workflow.currentState !== "complete") throw new Error("Only a completed job can be reopened");
  if (!target) throw new Error("Reopen scope must be rough-cut, motion-plan, composition, or delivery");
  if (actor !== "user") throw new Error("Reopen requires --actor user");
  if (!note) throw new Error("Reopen requires --note");
  const previousState = workflow.currentState;
  if (["rough-cut", "motion-plan"].includes(scope)) enableVisualArrangementReviewForMotionPlan(workflow);
  beginWorkflowRevision(workflow, { invalidateVisualPlan: ["rough-cut", "motion-plan"].includes(scope) });
  if (scope === "rough-cut") {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    workflow.authoritativeMediaPath = project.sourceVideo;
    workflow.authoritativeMediaSha256 = null;
    workflow.trimPlanSha256 = null;
    workflow.gates["rough-cut-review"] = { status: "not-reached" };
    workflow.roughCutReviewDecision = "pending";
  }
  if (["rough-cut", "motion-plan"].includes(scope)) {
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
  }
  if (scope !== "delivery") {
    workflow.compositionArtifactPath = null;
    workflow.compositionArtifactSha256 = null;
  }
  workflow.currentState = target;
  workflow.pendingGate = null;
  workflow.completed = false;
  appendHistory("reopen", previousState, target, actor);
  workflow.history.at(-1).scope = scope;
  save();
  console.log(`Workflow reopened at ${target}: ${scope}`);
  process.exit(0);
}
const currentStage = stages[workflow.currentState];
if (!currentStage) throw new Error(`Unknown current state: ${workflow.currentState}`);

try {
if (command === "advance") {
  if (currentStage.terminal) throw new Error("Workflow is already complete");
  if (currentStage.gate) {
    if (workflow.currentState === "visual-arrangement-review") {
      throw new Error("Visual arrangement review requires user approval or revision");
    }
    throw new Error(`Gate ${workflow.currentState} requires approve or revise`);
  }
  if (workflow.currentState === "intake") {
    const projectPath = path.join(jobRoot, "state", "project.json");
    if (!fs.existsSync(projectPath)) throw new Error("Project state is missing");
    const project = readJson(projectPath);
    const sourcePath = path.resolve(jobRoot, project.sourceVideo ?? "");
    if (!fs.existsSync(sourcePath)) throw new Error("Resolved source media is missing");
    assertRegularContainedFile(path.join(jobRoot, "input"), sourcePath, "Source media");
    validateActiveReference(workflowPath, workflow);
  }
  if (currentStage.artifact && !artifact) throw new Error(`State ${workflow.currentState} requires --artifact`);
  if (currentStage.artifact) {
    const expectedDirectory = {
      transcription: "state",
      "rough-cut": chatcutRoughCutArtifact(artifact) ? "state" : "roughcut",
      "rough-cut-export": "roughcut",
      "motion-plan": "docs",
      composition: "hyperframes",
      render: "output"
    }[workflow.currentState];
    const artifactPath = assertJobArtifact(artifact, expectedDirectory);
    if (workflow.currentState === "transcription") {
      const transcriptPath = path.join(jobRoot, "state", "transcript.json");
      if (artifactPath !== transcriptPath) throw new Error("Transcription must use state/transcript.json");
      if ((workflow.reconciliationReturnState ?? currentStage.next) === "rough-cut") {
        if (workflow.coverReviewDecision !== "approved") throw new Error("Rough-cut entry requires an approved cover");
        checkCover();
      }
      checkReconciliation(true);
      lockSourceTranscript(transcriptPath);
    }
    if (workflow.currentState === "rough-cut") {
      if (chatcutRoughCutArtifact(artifact)) {
        const record = validateChatcutRoughCutRecord(artifactPath);
        const projectPath = path.join(jobRoot, "state", "project.json");
        const project = readJson(projectPath);
        if (project.roughCutEngine !== "chatcut") throw new Error("ChatCut rough-cut review requires project.roughCutEngine=chatcut");
        if (record.timelineIds.length === 0) throw new Error("ChatCut rough-cut review requires at least one timeline");
        assertSourceTranscriptLock();
        checkRoughCutSelection();
        if (project.mediaArtifacts?.roughcut) {
          delete project.mediaArtifacts.roughcut;
          writeJsonAtomic(projectPath, project);
        }
        workflow.authoritativeMediaPath = null;
        workflow.authoritativeMediaSha256 = null;
        workflow.trimPlanSha256 = null;
      } else {
        if (path.resolve(jobRoot, artifact) !== path.join(jobRoot, "roughcut", "a-roll.mp4")) throw new Error("Rough cut must use roughcut/a-roll.mp4 or state/chatcut-roughcut.json");
        validateFfmpegFallbackEligibility();
        lockRoughCutMedia(artifactPath);
      }
      workflow.roughCutReviewDecision = "pending";
    }
    if (workflow.currentState === "rough-cut-export") {
      if (path.resolve(jobRoot, artifact) !== path.join(jobRoot, "roughcut", "a-roll.mp4")) {
        throw new Error("Rough-cut export must use roughcut/a-roll.mp4");
      }
      if (!["automatic-fallback", "manual-approved"].includes(workflow.roughCutReviewDecision)) {
        throw new Error("Rough-cut export requires manual approval or an explicit automatic fallback");
      }
      lockRoughCutMedia(artifactPath, {
        audit: workflow.roughCutReviewDecision === "automatic-fallback",
        requirePromotion: chatcutRoughCutArtifact(workflow.gates?.["rough-cut-review"]?.artifact)
      });
    }
    if (workflow.currentState === "motion-plan") {
      if (!workflow.captionModeAcknowledged || !workflow.visualAxisModeAcknowledged || !workflow.referenceScriptAcknowledged) {
        throw new Error("Motion planning requires preferences accepted with the locked rough cut");
      }
      const motionPlan = fs.readFileSync(artifactPath, "utf8");
      const tableRows = motionPlan.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
      const hasCaptionMode = /(?:Caption mode|当前字幕模式).*?(?:motion-copy|subtitles)/i.test(motionPlan);
      if (tableRows.length < 3) throw new Error("Motion plan must contain at least one storyboard row");
      if (!hasCaptionMode) throw new Error("Motion plan must state the active caption mode");
      const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
      const confirmationDocPath = path.join(jobRoot, "docs", "creative-confirmation.md");
      const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
      if (!fs.existsSync(confirmationPath) || !fs.existsSync(confirmationDocPath)) {
        throw new Error("Motion plan requires a creative confirmation package");
      }
      const proposedConfirmation = readJson(confirmationPath);
      if (!workflow.visualAxisModeAcknowledged) {
        workflow.visualAxisMode = proposedConfirmation.visualAxisMode;
        workflow.visualAxisModeSource = "default";
      }
      if (!fs.existsSync(beatMapPath)) throw new Error("Motion plan requires state/beat-map.json");
      const nextBeatMapSha256 = sha256File(beatMapPath);
      let baseline = null;
      if (fs.existsSync(visualBaselinePath)) {
        assertRegularContainedFile(path.join(jobRoot, "state"), visualBaselinePath, "Visual plan baseline");
        baseline = readJson(visualBaselinePath);
      }
      const beatMap = readJson(beatMapPath);
      if (baseline?.sha256 && baseline.sha256 !== nextBeatMapSha256 && baseline.beatMap) {
        appendHistory("visual-plan-change", "motion-plan", "motion-plan");
        Object.assign(workflow.history.at(-1), {
          beforeSha256: baseline.sha256, afterSha256: nextBeatMapSha256,
          baselineAvailable: true, changes: visualPlanChanges(baseline.beatMap, beatMap)
        });
      }
      workflow.visualPlanSha256 = nextBeatMapSha256;
      pendingVisualBaseline = { sha256: nextBeatMapSha256, beatMap };
      if (fullAuditRequested || requiresVisualArrangementReview()) {
        validateCreativePackage(
          fullAuditRequested ? "Automatic full-audit validation" : "Visual arrangement package validated",
          "agent"
        );
      } else if (requiresCadenceCreativeLock()) {
        runCheck("check-visual-plan.mjs", [beatMapPath, path.join(jobRoot, "state", "transcript.json"), path.join(jobRoot, "state", "design-system.json"), workflowPath], "Motion plan requires a valid beat map");
        assertCreativeAuthorities(jobRoot, workflow);
      }
    }
    if (workflow.currentState === "composition") {
      // Gate and hash checks precede all composition writes.
      if (requiresVisualArrangementReview()) assertCompositionReady(jobRoot, workflow);
      else if (fullAuditRequested || requiresCadenceCreativeLock()) assertCreativeAuthorities(jobRoot, workflow);
      const built = buildComposition(path.join(jobRoot, "hyperframes"));
      if (path.resolve(artifactPath) !== path.resolve(built.outputPath)) {
        throw new Error("Composition advance requires the deterministic hyperframes/index.html build artifact");
      }
      if (requiresVisualArrangementReview()) {
        if (!["manual-approved", "automatic-accepted"].includes(workflow.visualArrangementReviewDecision)) {
          throw new Error("Composition requires approved visual arrangement review");
        }
        assertCreativeAuthorities(jobRoot, workflow);
        checkReconciliation(false);
      } else if (fullAuditRequested || requiresCadenceCreativeLock()) {
        assertCreativeAuthorities(jobRoot, workflow);
        checkReconciliation(false);
      }
    }
    if (workflow.currentState === "render") {
      checkCover();
      const canonicalDeliveryPath = path.join(jobRoot, "output", "final.mp4");
      const delivery = probeReviewVideo(artifactPath, "Final delivery");
      checkTitles(artifactPath);
      const receiptPath = `${artifactPath}.render.json`;
      if (fullAuditRequested && !fs.existsSync(receiptPath)) {
        throw new Error("Automatic delivery requires the render receipt produced by HyperFrames");
      }
      if (artifactPath === canonicalDeliveryPath) {
        if (workflow.lastKnownGoodDelivery && sha256File(artifactPath) !== workflow.lastKnownGoodDelivery.sha256) {
          throw new Error("A delivery revision must render to output/final.candidate.mp4 before replacing the last known-good file");
        }
      } else {
        if (path.basename(artifactPath) !== "final.candidate.mp4") {
          throw new Error("A delivery revision must use output/final.candidate.mp4");
        }
        if (fs.existsSync(receiptPath)) assertRegularContainedFile(jobRoot, receiptPath, "Candidate render receipt");
        beginDeliveryPromotion(artifactPath, receiptPath, canonicalDeliveryPath);
        fs.renameSync(artifactPath, canonicalDeliveryPath);
        if (fs.existsSync(receiptPath)) {
          fs.renameSync(receiptPath, `${canonicalDeliveryPath}.render.json`);
        } else {
          // A review-mode delivery without a receipt must not retain the old video's receipt.
          fs.rmSync(`${canonicalDeliveryPath}.render.json`, { force: true });
        }
        promoteTitleSourceDelivery("output/final.candidate.mp4", "output/final.mp4");
      }
      workflow.lastKnownGoodDelivery = {
        path: "output/final.mp4",
        sha256: sha256File(canonicalDeliveryPath),
        validatedAt: now
      };
      if (!(delivery.duration > 0)) throw new Error("Final delivery has no positive duration");
    }
    if (workflow.currentState === "composition") {
      workflow.compositionArtifactPath = artifact;
      workflow.compositionArtifactSha256 = sha256File(artifactPath);
    }
  }
  let nextState = currentStage.next;
  if (workflow.currentState === "transcription" && workflow.reconciliationReturnState) {
    nextState = workflow.reconciliationReturnState;
  }
  if (workflow.currentState === "transcription") workflow.reconciliationReturnState = null;
  if (workflow.currentState === "motion-plan" && requiresVisualArrangementReview()) {
    if (workflow.mode === "auto") {
      recordVisualArrangementDecision("automatic-accepted", "automatic-accepted", "agent", "Automatic mode selected");
      move("composition", "automatic-visual-arrangement-accept", "agent", "docs/creative-confirmation.md");
    } else {
      workflow.visualArrangementReviewDecision = "pending";
      move("visual-arrangement-review", "advance", actor, "docs/creative-confirmation.md");
    }
  } else if (workflow.currentState === "rough-cut" && workflow.mode === "auto") {
    move("rough-cut-review", "advance");
    selectAutomaticFallback("agent", "Automatic mode selected");
  } else {
    move(nextState, "advance");
  }
} else if (command === "approve") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Only the ChatCut rough-cut review can be approved");
  if (!note) throw new Error("Rough-cut review approval requires --note");
  if (workflow.mode === "review" && actor !== "user") throw new Error("Review-mode approval requires actor user");
  validateRoughCutReview();
  acceptDeferredPreferences("user");
  recordRoughCutDecision("approved", "manual-approved", actor, note);
  move("rough-cut-export", "approve");
} else if (command === "revise") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Only the ChatCut rough-cut review can be revised");
  const review = workflow.gates["rough-cut-review"];
  workflow.gates["rough-cut-review"] = { ...review, status: "revision-requested", decidedAt: now, actor, note };
  beginWorkflowRevision(workflow);
  workflow.roughCutReviewDecision = "pending";
  move("rough-cut", "revise");
} else {
  throw new Error(`Unknown command: ${command}`);
}
save();
commitDeliveryPromotion();
} catch (error) {
  try { rollbackDeliveryPromotion(); }
  catch (rollbackError) { throw new AggregateError([error, rollbackError], "Delivery promotion failed and rollback was incomplete"); }
  throw error;
}
console.log(`Workflow state: ${workflow.currentState}`);
