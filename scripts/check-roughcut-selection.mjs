import fs from "node:fs";
import path from "node:path";
import {
  assertRegularContainedFile,
  ensureWorkflowDefaults,
  jobRootForWorkflow,
  readJson,
  sha256File,
  validateActiveReference
} from "./workflow-utils.mjs";

const policy = "reference-aligned-last-complete-take-v1";
const [workflowArgument] = process.argv.slice(2);
if (!workflowArgument) {
  console.error("Usage: node check-roughcut-selection.mjs <workflow.json>");
  process.exit(64);
}

const workflowPath = path.resolve(workflowArgument);
const jobRoot = jobRootForWorkflow(workflowPath);
const stateRoot = path.join(jobRoot, "state");
const errors = [];
const addError = (message) => errors.push(message);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isoTimestamp = (value) => {
  if (!nonempty(value) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};
const onlyKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return addError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(`${label} has undeclared field: ${key}`);
  }
};
const readState = (name, label) => {
  const filePath = path.join(stateRoot, name);
  if (!fs.existsSync(filePath)) {
    addError(`${label} is missing`);
    return { filePath, value: null };
  }
  try {
    assertRegularContainedFile(stateRoot, filePath, label);
    return { filePath, value: readJson(filePath) };
  } catch (error) {
    addError(error.message);
    return { filePath, value: null };
  }
};

let workflow;
try {
  workflow = ensureWorkflowDefaults(readJson(workflowPath));
} catch (error) {
  console.error(`Error: Cannot read workflow: ${error.message}`);
  process.exit(1);
}
if (workflow.roughCutSelectionPolicy === null) {
  console.log("Rough-cut selection check skipped for legacy workflow.");
  process.exit(0);
}
if (workflow.roughCutSelectionPolicy !== policy) {
  console.error(`Error: Unknown rough-cut selection policy: ${workflow.roughCutSelectionPolicy}`);
  process.exit(1);
}

try {
  validateActiveReference(workflowPath, workflow);
} catch (error) {
  addError(error.message);
}

const source = readState("source-transcript.json", "Source transcript");
const reconciliation = readState("transcript-reconciliation.json", "Transcript reconciliation");
const chatcut = readState("chatcut-roughcut.json", "ChatCut rough-cut record");
const record = readState("roughcut-selection.json", "Rough-cut selection");

if (!workflow.sourceTranscriptSha256 || !sha256(workflow.sourceTranscriptSha256)) {
  addError("Workflow source transcript SHA-256 is missing");
} else if (source.value && sha256File(source.filePath) !== workflow.sourceTranscriptSha256) {
  addError("Workflow source transcript SHA-256 is stale");
}

let selectionVerifiedAt = null;
if (record.value) {
  onlyKeys(record.value, new Set([
    "$schema", "schemaVersion", "policy", "sourceTranscriptSha256", "transcriptReconciliationSha256",
    "referenceScriptSha256", "chatcutRoughCutSha256", "verifiedAt", "chatcut", "selections", "discards"
  ]), "Rough-cut selection");
  if (record.value.schemaVersion !== "1.0.0") addError("Rough-cut selection schemaVersion must be 1.0.0");
  if (record.value.policy !== policy) addError(`Rough-cut selection policy must be ${policy}`);
  if (!sha256(record.value.sourceTranscriptSha256)) addError("Rough-cut selection source transcript SHA-256 is required");
  if (record.value.sourceTranscriptSha256 !== workflow.sourceTranscriptSha256) addError("Rough-cut selection source transcript SHA-256 does not match workflow");
  if (!sha256(record.value.transcriptReconciliationSha256)) addError("Rough-cut selection transcript reconciliation SHA-256 is required");
  if (reconciliation.value && record.value.transcriptReconciliationSha256 !== sha256File(reconciliation.filePath)) {
    addError("Rough-cut selection transcript reconciliation SHA-256 is stale");
  }
  if (workflow.referenceScriptStatus === "none") {
    if (record.value.referenceScriptSha256 !== null) addError("Rough-cut selection reference-script SHA-256 must be null without a reference script");
  } else if (workflow.referenceScriptStatus === "provided") {
    if (!sha256(record.value.referenceScriptSha256) || record.value.referenceScriptSha256 !== workflow.referenceScriptSha256) {
      addError("Rough-cut selection reference-script SHA-256 does not match workflow");
    }
  } else {
    addError("Rough-cut selection requires a resolved reference-script status");
  }
  if (!sha256(record.value.chatcutRoughCutSha256)) addError("Rough-cut selection ChatCut rough-cut SHA-256 is required");
  else if (chatcut.value && record.value.chatcutRoughCutSha256 !== sha256File(chatcut.filePath)) {
    addError("Rough-cut selection ChatCut rough-cut SHA-256 is stale");
  }
  selectionVerifiedAt = isoTimestamp(record.value.verifiedAt);
  if (selectionVerifiedAt === null) addError("Rough-cut selection verifiedAt must be a valid ISO timestamp");
}

const sourceSegments = new Map();
for (const segment of source.value?.segments ?? []) {
  if (!nonempty(segment?.id) || sourceSegments.has(segment.id)) {
    addError("Source transcript segment IDs must be unique and nonempty");
    continue;
  }
  if (!Number.isFinite(segment.end)) {
    addError(`Source transcript segment ${segment.id} has no valid end time`);
    continue;
  }
  sourceSegments.set(segment.id, segment);
}

const reconciliationItems = new Map();
const recordingSegmentIds = new Set();
const releaseImpactSegmentIds = new Set();
const referenceItems = new Map();
for (const item of reconciliation.value?.items ?? []) {
  if (!nonempty(item?.id) || reconciliationItems.has(item.id)) {
    addError("Transcript reconciliation item IDs must be unique and nonempty");
    continue;
  }
  reconciliationItems.set(item.id, item);
  const recordingBacked = nonempty(item.segmentId);
  if (recordingBacked) {
    if (!sourceSegments.has(item.segmentId)) addError(`Reconciliation item ${item.id} source segment does not resolve in source transcript`);
    else {
      recordingSegmentIds.add(item.segmentId);
      if (item.releaseImpact === true) releaseImpactSegmentIds.add(item.segmentId);
    }
  }
  if (workflow.referenceScriptStatus === "provided" && nonempty(item.referenceText) && item.resolution !== "omitted-unspoken") {
    referenceItems.set(item.id, item);
    if (!recordingBacked || !sourceSegments.has(item.segmentId)) {
      addError(`Reference-backed reconciliation item ${item.id} has no source transcript segment`);
    }
  }
}

const chatcutRecord = chatcut.value;
if (chatcutRecord) {
  if (chatcutRecord.source !== "chatcut" || !nonempty(chatcutRecord.projectId)) addError("ChatCut rough-cut record requires a projectId");
  if (!Array.isArray(chatcutRecord.timelineIds) || chatcutRecord.timelineIds.some((id) => !nonempty(id))) {
    addError("ChatCut rough-cut record requires timeline IDs");
  }
  if (!nonempty(chatcutRecord.activeTimelineId) || !chatcutRecord.timelineIds?.includes(chatcutRecord.activeTimelineId)) {
    addError("ChatCut rough-cut record requires a valid active timeline");
  }
  const chatcutRecordedAt = isoTimestamp(chatcutRecord.recordedAt);
  if (chatcutRecordedAt === null) addError("ChatCut rough-cut record requires a valid ISO recordedAt timestamp");
  else if (selectionVerifiedAt !== null && selectionVerifiedAt < chatcutRecordedAt) {
    addError("Rough-cut selection verifiedAt must be at or after ChatCut rough-cut recordedAt");
  }
}

const ownership = new Map();
const selectedSourceSegmentsBySelection = new Map();
const claimSourceSegments = (segmentIds, kind, detail, label) => {
  if (!Array.isArray(segmentIds) || segmentIds.length === 0 || segmentIds.some((id) => !nonempty(id))) {
    addError(`${label} requires nonempty source segment IDs`);
    return;
  }
  if (new Set(segmentIds).size !== segmentIds.length) addError(`${label} repeats a source segment ID`);
  for (const segmentId of segmentIds) {
    if (!sourceSegments.has(segmentId)) {
      addError(`${label} source segment ${segmentId} does not resolve in source transcript`);
      continue;
    }
    if (ownership.has(segmentId)) addError(`Source segment ${segmentId} is classified more than once`);
    else ownership.set(segmentId, { kind, ...detail });
  }
};

const selectionCoverage = new Map();
const selectionReferences = new Map();
const takeIds = new Set();
const allowedTakeDispositions = new Set(["complete", "later-incomplete", "later-mistake", "later-content-loss"]);
const allowedLaterDispositions = new Set(["later-incomplete", "later-mistake", "later-content-loss"]);
if (!Array.isArray(record.value?.selections)) {
  addError("Rough-cut selection selections must be an array");
} else {
  record.value.selections.forEach((selection, selectionIndex) => {
    const label = `Selection ${selectionIndex + 1}`;
    onlyKeys(selection, new Set(["referenceItemIds", "takes", "selectedTakeId"]), label);
    const referenceItemIds = Array.isArray(selection?.referenceItemIds) ? selection.referenceItemIds : null;
    if (!referenceItemIds || referenceItemIds.some((id) => !nonempty(id))) addError(`${label} requires reference item IDs`);
    else {
      if (new Set(referenceItemIds).size !== referenceItemIds.length) addError(`${label} repeats a reference item ID`);
      for (const referenceItemId of referenceItemIds) {
        if (!referenceItems.has(referenceItemId)) addError(`${label} has undeclared reference item ${referenceItemId}`);
        selectionCoverage.set(referenceItemId, (selectionCoverage.get(referenceItemId) ?? 0) + 1);
        selectionReferences.set(referenceItemId, selectionIndex);
      }
    }
    if (!Array.isArray(selection?.takes) || selection.takes.length === 0) {
      addError(`${label} requires at least one candidate take`);
      return;
    }

    const takes = new Map();
    for (const take of selection.takes) {
      const takeLabel = `${label} candidate take ${take?.id ?? "<missing>"}`;
      onlyKeys(take, new Set(["id", "sourceSegmentIds", "disposition", "audioReviewedEvidence"]), takeLabel);
      if (!nonempty(take?.id) || takeIds.has(take.id)) addError(`${takeLabel} has an invalid or duplicate ID`);
      else takeIds.add(take.id);
      if (!allowedTakeDispositions.has(take?.disposition)) addError(`${takeLabel} has an invalid disposition`);
      if (!nonempty(take?.audioReviewedEvidence)) addError(`${takeLabel} requires nonempty audio-reviewed evidence`);
      claimSourceSegments(take?.sourceSegmentIds, "candidate", { selectionIndex, takeId: take?.id }, takeLabel);
      if (nonempty(take?.id)) takes.set(take.id, take);
    }

    const selectedTake = takes.get(selection?.selectedTakeId);
    if (!selectedTake) {
      addError(`${label} selectedTakeId must identify a declared candidate take`);
      return;
    }
    if (selectedTake.disposition !== "complete") addError(`${label} selected take must have disposition complete`);
    selectedSourceSegmentsBySelection.set(selectionIndex, new Set(selectedTake.sourceSegmentIds ?? []));
    const endForTake = (take) => Math.max(...(take.sourceSegmentIds ?? [])
      .map((segmentId) => sourceSegments.get(segmentId)?.end)
      .filter(Number.isFinite));
    const selectedEnd = endForTake(selectedTake);
    const completeEnds = [...takes.values()]
      .filter((take) => take.disposition === "complete")
      .map(endForTake)
      .filter(Number.isFinite);
    if (Number.isFinite(selectedEnd) && completeEnds.some((end) => end > selectedEnd)) {
      addError(`${label} selected take must be the latest chronological complete take`);
    }
    for (const take of takes.values()) {
      if (take.id === selectedTake.id || !Number.isFinite(selectedEnd) || endForTake(take) <= selectedEnd) continue;
      if (!allowedLaterDispositions.has(take.disposition)) {
        addError(`${label} later non-selected candidate ${take.id} must be later-incomplete, later-mistake, or later-content-loss`);
      }
    }
  });
}

const allowedDiscardDispositions = new Set(["false-start", "filler", "production-reset", "technical-failure", "off-topic", "non-speech", "body-reset", "restart"]);
if (!Array.isArray(record.value?.discards)) {
  addError("Rough-cut selection discards must be an array");
} else {
  record.value.discards.forEach((discard, discardIndex) => {
    const label = `Discard ${discardIndex + 1}`;
    onlyKeys(discard, new Set(["sourceSegmentIds", "disposition", "audioReviewedEvidence"]), label);
    if (!allowedDiscardDispositions.has(discard?.disposition)) addError(`${label} has an invalid discard disposition`);
    if (!nonempty(discard?.audioReviewedEvidence)) addError(`${label} requires nonempty audio-reviewed evidence`);
    claimSourceSegments(discard?.sourceSegmentIds, "discard", { discardIndex }, label);
    for (const segmentId of discard?.sourceSegmentIds ?? []) {
      if (releaseImpactSegmentIds.has(segmentId)) addError(`Release-impact source segment ${segmentId} cannot be discarded`);
    }
  });
}

for (const [referenceItemId, item] of referenceItems) {
  const count = selectionCoverage.get(referenceItemId) ?? 0;
  if (count !== 1) addError(`Reference-backed item ${referenceItemId} requires exactly one selection coverage`);
  const owner = ownership.get(item.segmentId);
  if (owner?.kind !== "candidate") {
    addError(`Reference-backed item ${referenceItemId} source segment must be a candidate take, not a discard`);
  } else if (selectionReferences.get(referenceItemId) !== owner.selectionIndex) {
    addError(`Reference-backed item ${referenceItemId} must stay with a candidate in its selected semantic group`);
  } else if (!selectedSourceSegmentsBySelection.get(owner.selectionIndex)?.has(item.segmentId)) {
    addError(`Reference-backed item ${referenceItemId} source segment must be present in its selected complete take`);
  }
}
for (const segmentId of recordingSegmentIds) {
  if (!ownership.has(segmentId)) addError(`Recording-backed source segment ${segmentId} is not classified as a candidate take or documented discard`);
}

if (record.value?.chatcut) {
  onlyKeys(record.value.chatcut, new Set(["projectId", "activeTimelineId"]), "Rough-cut selection ChatCut binding");
  if (!nonempty(record.value.chatcut.projectId) || record.value.chatcut.projectId !== chatcutRecord?.projectId) {
    addError("Rough-cut selection ChatCut project does not match the active rough-cut record");
  }
  if (!nonempty(record.value.chatcut.activeTimelineId) || record.value.chatcut.activeTimelineId !== chatcutRecord?.activeTimelineId) {
    addError("Rough-cut selection active ChatCut timeline does not match the active rough-cut record");
  }
} else {
  addError("Rough-cut selection requires a ChatCut binding");
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length) process.exit(1);
console.log(`Rough-cut selection passed: ${record.value.selections.length} selection group(s).`);
