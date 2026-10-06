import fs from "node:fs";
import path from "node:path";
import { durationToFrames, quantizeFrameWindow } from "./frame-window-utils.mjs";
import { THOUGHTFUL_EDITORIAL_PROFILE, resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";
import { isVisualOrchestrationActive, isVisualOrchestrationV2 } from "./visual-orchestration-version.mjs";
import { assertRegularContainedFile, isPathInside, sha256File } from "./workflow-utils.mjs";

const [beatMapPath, transcriptPath, designSystemPath, workflowPathArgument] = process.argv.slice(2);

if (!beatMapPath || !transcriptPath || !designSystemPath) {
  console.error("Usage: node check-visual-plan.mjs <beat-map.json> <transcript.json> <design-system.json> [workflow.json]");
  process.exit(64);
}

const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const inferredWorkflowPath = path.join(path.dirname(beatMapPath), "workflow.json");
const workflowPath = workflowPathArgument ?? (fs.existsSync(inferredWorkflowPath) ? inferredWorkflowPath : null);
const workflow = workflowPath ? JSON.parse(fs.readFileSync(workflowPath, "utf8")) : null;
const errors = [];
const warnings = [];
const beats = [...beatMap.beats].sort((left, right) => left.start - right.start);
const transcriptById = new Map(transcript.segments.map((segment) => [segment.id, segment]));
const wordsById = transcriptWordsById(transcript);
const sourceUsage = new Map();
const signatureUsage = new Map();
const renderWindows = new Map();
const normalize = (value) => value.replace(/[\s，。！？、,.!?]/g, "").toLowerCase();
const captionMode = beatMap.captionMode ?? "motion-copy";
const rhythm = designSystem.rhythmProfiles[captionMode];
const typography = designSystem.typography;
const spacing = designSystem.spacing;
const density = designSystem.density;
const pipExclusionZone = designSystem.axisPolicies?.B?.pipExclusionZone;
const subtitleSupportRoles = new Set(["evidence", "explanation", "calibration", "organization", "action", "consequence"]);
const subtitleMgCadence = designSystem.subtitleMgCadence;
const subtitleMgCadenceActive = captionMode === "subtitles"
  && Number(beatMap.duration) >= 20
  && Object.hasOwn(designSystem, "subtitleMgCadence");
const cadenceRules = {
  minimumDurationSeconds: 20,
  targetIntervalSeconds: 10,
  minimumPassageSeparationSeconds: 7,
  maximumUnexplainedGapSeconds: 12
};
const isNonemptyString = (value) => typeof value === "string" && value.trim().length > 0;
const visualOrchestrationActive = isVisualOrchestrationActive(beatMap);
const visualOrchestrationV2 = isVisualOrchestrationV2(beatMap);
const visualArrangementReviewRequired = visualOrchestrationActive && workflow?.visualArrangementReviewRequired === true;
const jobRoot = path.resolve(path.dirname(beatMapPath), "..");
const inputRoot = path.join(jobRoot, "input");
const materialById = new Map();
const thoughtfulEditorialTiming = designSystem.motionProfiles?.[THOUGHTFUL_EDITORIAL_PROFILE]?.cueTiming;
const thoughtfulEditorialSurface = designSystem.motionProfiles?.[THOUGHTFUL_EDITORIAL_PROFILE]?.aAxis;
const thoughtfulHoldKinds = new Set(["standard", "evidence-reading", "causal-sequence", "rhetorical-pause"]);
const frameAtOrAfter = (seconds, fps) => Math.ceil(Number(seconds) * fps - 1e-6);
const thoughtfulFrameLimit = (field) => {
  if (thoughtfulEditorialTiming?.referenceFps !== 60) return null;
  const value = thoughtfulEditorialTiming[field];
  return Number.isInteger(value) && value >= 0 ? Math.round(value * beatMap.fps / 60) : null;
};
const thoughtfulHoldLimit = (holdKind) => {
  if (thoughtfulEditorialTiming?.referenceFps !== 60) return null;
  const value = thoughtfulEditorialTiming?.maxVisibleFramesByHoldKind?.[holdKind];
  return Number.isInteger(value) && value > 0 ? Math.round(value * beatMap.fps / 60) : null;
};

if (beatMap.visualOrchestrationVersion !== undefined && !visualOrchestrationActive) {
  errors.push("visualOrchestrationVersion must be 1 or 2 when present");
}
if (visualOrchestrationActive) {
  if (!Array.isArray(beatMap.materials)) {
    errors.push("visualOrchestrationVersion requires a materials registry");
  } else {
    for (const [index, material] of beatMap.materials.entries()) {
      const label = `materials[${index}]`;
      if (!isNonemptyString(material?.id) || !/^[a-z0-9][a-z0-9-]*$/.test(material.id)) {
        errors.push(`${label}.id must be a stable lowercase material ID`);
        continue;
      }
      if (materialById.has(material.id)) {
        errors.push(`${label}.id duplicates ${material.id}`);
        continue;
      }
      materialById.set(material.id, material);
      if (!isNonemptyString(material?.path) || !material.path.startsWith("input/")) {
        errors.push(`${label}.path must stay under input/`);
      } else if (!fs.existsSync(inputRoot)) {
        errors.push(`${label}.path requires the job input/ directory`);
      } else {
        try {
          const materialPath = path.resolve(jobRoot, material.path);
          if (!isPathInside(inputRoot, materialPath)) throw new Error("escapes input/");
          const resolvedMaterialPath = assertRegularContainedFile(inputRoot, materialPath, `${label}.path`);
          if (typeof material.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(material.sha256)) {
            errors.push(`${label}.sha256 must be a lowercase SHA-256`);
          } else if (sha256File(resolvedMaterialPath) !== material.sha256) {
            errors.push(`${label}.sha256 does not match its input file`);
          }
        } catch (error) {
          errors.push(`${label}.path ${error.message}`);
        }
      }
      if (!['image', 'screenshot', 'recording', 'clip', 'document'].includes(material?.kind)) errors.push(`${label}.kind is invalid`);
      if (!isNonemptyString(material?.sourceOrRights)) errors.push(`${label}.sourceOrRights is required`);
      if (!['approved', 'approved-with-mask'].includes(material?.privacyStatus)) errors.push(`${label}.privacyStatus must be approved`);
      for (const field of ["visibleFacts", "forbiddenInferences"]) {
        if (!Array.isArray(material?.[field]) || material[field].length === 0 || material[field].some((value) => !isNonemptyString(value))) {
          errors.push(`${label}.${field} must be a non-empty array of fact-boundary statements`);
        }
      }
    }
  }
}

if (subtitleMgCadenceActive) {
  for (const [field, expected] of Object.entries(cadenceRules)) {
    if (subtitleMgCadence?.[field] !== expected) errors.push(`subtitleMgCadence.${field} must be ${expected}`);
  }
}

for (let index = 0; index < beats.length; index += 1) {
  const beat = beats[index];
  const duration = beat.end - beat.start;
  const thoughtfulEditorialBeat = beat.motionProfile === THOUGHTFUL_EDITORIAL_PROFILE;

  if (!(duration > 0)) errors.push(`${beat.id}: end must be greater than start`);

  const sourceSegments = beat.sourceSegmentIds.map((id) => transcriptById.get(id));
  if (sourceSegments.some((segment) => !segment)) errors.push(`${beat.id}: references an unknown transcript segment`);

  for (const sourceId of beat.sourceSegmentIds) {
    const uses = sourceUsage.get(sourceId) ?? [];
    uses.push(beat);
    sourceUsage.set(sourceId, uses);
  }

  if (captionMode === "motion-copy" && sourceSegments.every(Boolean) && !beat.copyException) {
    const sourceText = sourceSegments.map((segment) => segment.text).join("");
    if (normalize(sourceText) !== normalize(beat.text)) errors.push(`${beat.id}: displayed copy does not exactly cover its transcript segments`);
  }

  if (captionMode === "subtitles" && sourceSegments.every(Boolean) && !beat.copyException) {
    const sourceText = sourceSegments.map((segment) => segment.text).join("");
    if (normalize(sourceText) === normalize(beat.text)) errors.push(`${beat.id}: subtitles mode motion must add information instead of duplicating caption copy`);
  }

  if (sourceSegments.every(Boolean) && !beat.syncException) {
    const sourceStart = Math.min(...sourceSegments.map((segment) => segment.start));
    const sourceEnd = Math.max(...sourceSegments.map((segment) => segment.end));
    if (beat.audioAnchorTime < sourceStart || beat.audioAnchorTime > sourceEnd) errors.push(`${beat.id}: audio anchor falls outside its transcript segments`);
    if (captionMode === "motion-copy" && Math.abs(beat.audioAnchorTime - sourceStart) * beatMap.fps > rhythm.syncToleranceFrames) errors.push(`${beat.id}: motion-copy anchor must match phrase onset`);
    const syncErrorFrames = Math.abs(beat.start - beat.audioAnchorTime) * beatMap.fps;
    if (syncErrorFrames > rhythm.syncToleranceFrames) errors.push(`${beat.id}: starts ${syncErrorFrames.toFixed(1)} frames away from speech`);
  }

  if (visualOrchestrationActive) {
    if (beat.mgScope === "local") {
      if (visualArrangementReviewRequired && !thoughtfulEditorialBeat) {
        errors.push(`${beat.id}: V1 local MG under visualArrangementReviewRequired requires motionProfile ${THOUGHTFUL_EDITORIAL_PROFILE}`);
      }
      if (!Array.isArray(beat.materialRefs)) {
        errors.push(`${beat.id}: local MG requires materialRefs (use [] when no asset is shown)`);
      } else {
        const beatFrames = quantizeFrameWindow(beat.start, beat.end, beatMap.fps, durationToFrames(beatMap.duration, beatMap.fps));
        for (const [referenceIndex, reference] of beat.materialRefs.entries()) {
          const label = `${beat.id}.materialRefs[${referenceIndex}]`;
          if (!isNonemptyString(reference?.materialId) || !materialById.has(reference.materialId)) {
            errors.push(`${label}.materialId must reference a registered material`);
          }
          if (!isNonemptyString(reference?.role)) errors.push(`${label}.role is required`);
          if (!Number.isInteger(reference?.displayStartFrame)) errors.push(`${label}.displayStartFrame must be an integer frame`);
          if (!Number.isInteger(reference?.displayEndFrame)) errors.push(`${label}.displayEndFrame must be an integer frame`);
          if (Number.isInteger(reference?.displayStartFrame) && Number.isInteger(reference?.displayEndFrame)) {
            if (reference.displayEndFrame <= reference.displayStartFrame) errors.push(`${label}.displayEndFrame must follow displayStartFrame`);
            if (reference.displayStartFrame < beatFrames.startFrame || reference.displayEndFrame > beatFrames.endFrame) {
              errors.push(`${label} display window must stay within ${beat.id}'s Beat frame window`);
            }
          }
          if (!isNonemptyString(reference?.crop)) errors.push(`${label}.crop is required`);
          if (!isNonemptyString(reference?.masking)) errors.push(`${label}.masking is required`);
        }
      }
      if (!Array.isArray(beat.objectCues) || beat.objectCues.length === 0) {
        errors.push(`${beat.id}: local MG requires objectCues for the visual arrangement table`);
      } else {
        const cueIds = new Set();
        for (const [cueIndex, cue] of beat.objectCues.entries()) {
          const label = `${beat.id}.objectCues[${cueIndex}]`;
          if (!isNonemptyString(cue?.id) || cueIds.has(cue.id)) errors.push(`${label}.id must be a unique object cue ID`);
          cueIds.add(cue?.id);
          for (const field of ["semanticRole", "spokenTriggerWordId", "exitTriggerWordId"]) {
            if (!isNonemptyString(cue?.[field])) errors.push(`${label}.${field} is required`);
          }
          for (const field of ["preMotionFrame", "firstLegibleFrame", "settledFrame", "invisibleFrame"]) {
            if (!Number.isInteger(cue?.[field])) errors.push(`${label}.${field} must be an integer frame`);
          }
        }
      }
    } else {
      if (!isNonemptyString(beat.noMgReason)) errors.push(`${beat.id}: caption-only Beat requires a concrete noMgReason`);
      if (Array.isArray(beat.materialRefs) && beat.materialRefs.length > 0) {
        errors.push(`${beat.id}: only local MG beats may reference materials`);
      }
    }
  }

  if (visualOrchestrationV2) {
    if (beat.mgScope === "local") {
      if (!thoughtfulEditorialBeat) errors.push(`${beat.id}: V2 local MG requires motionProfile ${THOUGHTFUL_EDITORIAL_PROFILE}`);
      if (!beat.visualDecision || typeof beat.visualDecision !== "object") errors.push(`${beat.id}: V2 local MG requires visualDecision`);
    } else if (beat.mgScope === "none" && beat.visualDecision !== undefined) {
      errors.push(`${beat.id}: V2 mgScope none must not declare visualDecision`);
    }
  }

  if (beat.motionProfile !== undefined && !thoughtfulEditorialBeat) {
    errors.push(`${beat.id}: motionProfile must be ${THOUGHTFUL_EDITORIAL_PROFILE} when declared`);
  }
  if (thoughtfulEditorialBeat) {
    if (!visualOrchestrationActive) errors.push(`${beat.id}: ${THOUGHTFUL_EDITORIAL_PROFILE} requires visualOrchestrationVersion 1 or 2`);
    if (beat.mgScope !== "local") errors.push(`${beat.id}: ${THOUGHTFUL_EDITORIAL_PROFILE} only applies to local MG beats`);
    if (!['direct-overlay', 'evidence-surface'].includes(beat.surfaceTreatment)) {
      errors.push(`${beat.id}: ${THOUGHTFUL_EDITORIAL_PROFILE} requires direct-overlay or evidence-surface treatment`);
    }
    if (beat.surfaceTreatment === "evidence-surface" && (!Array.isArray(beat.materialRefs) || beat.materialRefs.length === 0)) {
      errors.push(`${beat.id}: evidence-surface requires registered materialRefs`);
    }
    if (beat.surfaceTreatment === "direct-overlay" && Array.isArray(beat.materialRefs) && beat.materialRefs.length > 0) {
      errors.push(`${beat.id}: direct-overlay cannot declare materialRefs; use evidence-surface for registered material display`);
    }
    if (thoughtfulEditorialTiming?.referenceFps !== 60
      || thoughtfulFrameLimit("maxPreMotionFrames") === null
      || thoughtfulFrameLimit("maxFirstLegibleDelayFrames") === null
      || thoughtfulFrameLimit("maxSettledDelayFrames") === null
      || thoughtfulFrameLimit("maxExitAfterTriggerFrames") === null
      || [...thoughtfulHoldKinds].some((holdKind) => thoughtfulHoldLimit(holdKind) === null)) {
      errors.push(`${beat.id}: design system must declare 60fps thoughtful-editorial-v1 cue timing limits`);
    }
    if (!Number.isFinite(thoughtfulEditorialSurface?.evidenceSurfaceMaxAreaRatio)
      || !Number.isFinite(thoughtfulEditorialSurface?.evidenceSurfaceMaxOpacity)
      || !Number.isFinite(thoughtfulEditorialSurface?.evidenceSurfaceMaxBackdropBlurPx)
      || !Number.isFinite(thoughtfulEditorialSurface?.minimumEvidenceSurfaceLightness)) {
      errors.push(`${beat.id}: design system must declare thoughtful-editorial-v1 evidence surface limits`);
    }
    const beatFrames = quantizeFrameWindow(beat.start, beat.end, beatMap.fps, durationToFrames(beatMap.duration, beatMap.fps));
    const cueIds = new Set();
    for (const [cueIndex, cue] of (beat.objectCues ?? []).entries()) {
      const label = `${beat.id}.objectCues[${cueIndex}]`;
      if (!isNonemptyString(cue?.id) || cueIds.has(cue.id)) {
        errors.push(`${label}.id must be a unique thoughtful-editorial-v1 cue ID`);
      }
      cueIds.add(cue?.id);
      if (!thoughtfulHoldKinds.has(cue?.holdKind)) {
        errors.push(`${label}.holdKind must be standard, evidence-reading, causal-sequence, or rhetorical-pause`);
      }
      const triggerWord = wordsById.get(cue?.spokenTriggerWordId);
      const exitWord = wordsById.get(cue?.exitTriggerWordId);
      if (!triggerWord) errors.push(`${label}.spokenTriggerWordId does not resolve to a transcript word`);
      if (!exitWord) errors.push(`${label}.exitTriggerWordId does not resolve to a transcript word`);
      const frames = [cue?.preMotionFrame, cue?.firstLegibleFrame, cue?.settledFrame, cue?.invisibleFrame];
      if (frames.some((frame) => !Number.isInteger(frame))) {
        errors.push(`${label} must use integer 60fps-derived frame windows`);
        continue;
      }
      const [preMotionFrame, firstLegibleFrame, settledFrame, invisibleFrame] = frames;
      const allowedPreMotionFrame = beatFrames.startFrame - (thoughtfulFrameLimit("maxPreMotionFrames") ?? 0);
      if (preMotionFrame < allowedPreMotionFrame || invisibleFrame > beatFrames.endFrame) {
        errors.push(`${label} must remain inside its Beat frame window`);
      }
      if (!(preMotionFrame <= firstLegibleFrame && firstLegibleFrame <= settledFrame && settledFrame <= invisibleFrame)) {
        errors.push(`${label} must keep pre-motion, first-legible, settled, and invisible frames in order`);
      }
      if (triggerWord) {
        const triggerFrame = frameAtOrAfter(triggerWord.start, beatMap.fps);
        const maxPreMotionFrames = thoughtfulFrameLimit("maxPreMotionFrames");
        const maxFirstLegibleDelayFrames = thoughtfulFrameLimit("maxFirstLegibleDelayFrames");
        const maxSettledDelayFrames = thoughtfulFrameLimit("maxSettledDelayFrames");
        if (maxPreMotionFrames !== null && (preMotionFrame < triggerFrame - maxPreMotionFrames || preMotionFrame > triggerFrame)) {
          errors.push(`${label}.preMotionFrame must start no more than ${maxPreMotionFrames} frame(s) before its trigger`);
        }
        if (maxFirstLegibleDelayFrames !== null && (firstLegibleFrame < triggerFrame || firstLegibleFrame > triggerFrame + maxFirstLegibleDelayFrames)) {
          errors.push(`${label}.firstLegibleFrame must fall from its trigger through ${maxFirstLegibleDelayFrames} frame(s) after it`);
        }
        if (maxSettledDelayFrames !== null && (settledFrame < firstLegibleFrame || settledFrame > triggerFrame + maxSettledDelayFrames)) {
          errors.push(`${label}.settledFrame must land within ${maxSettledDelayFrames} frame(s) of its trigger`);
        }
      }
      if (exitWord) {
        const exitFrame = frameAtOrAfter(exitWord.end, beatMap.fps);
        const maxExitAfterTriggerFrames = thoughtfulFrameLimit("maxExitAfterTriggerFrames");
        if (invisibleFrame < exitFrame || (maxExitAfterTriggerFrames !== null && invisibleFrame > exitFrame + maxExitAfterTriggerFrames)) {
          errors.push(`${label}.invisibleFrame must follow its exit trigger within ${maxExitAfterTriggerFrames ?? "the configured"} frame(s)`);
        }
      }
      const maxVisibleFrames = thoughtfulHoldLimit(cue?.holdKind);
      if (maxVisibleFrames !== null && invisibleFrame - preMotionFrame > maxVisibleFrames) {
        errors.push(`${label}.holdKind ${cue.holdKind} exceeds its ${maxVisibleFrames}-frame maximum`);
      }
    }

    if (visualOrchestrationV2 && beat.mgScope === "local" && beat.visualDecision && typeof beat.visualDecision === "object") {
      const decision = beat.visualDecision;
      const decisionLabel = `${beat.id}.visualDecision`;
      const cueById = new Map((beat.objectCues ?? []).filter((cue) => isNonemptyString(cue?.id)).map((cue) => [cue.id, cue]));
      const hasRegisteredMaterialRefs = Array.isArray(beat.materialRefs)
        && beat.materialRefs.some((reference) => materialById.has(reference?.materialId));
      if (beat.supportRole === "evidence" && decision.mode !== "evidence") errors.push(`${beat.id}: V2 supportRole evidence requires mode evidence`);
      if (decision.mode === "annotation") {
        const allowedFields = new Set(["mode", "memoryAnchor", "supportingWordIds", "fallback"]);
        if (Object.keys(decision).some((field) => !allowedFields.has(field))) errors.push(`${decisionLabel}.annotation only permits mode, memoryAnchor, supportingWordIds, and fallback`);
        for (const field of ["memoryAnchor", "fallback"]) {
          if (!isNonemptyString(decision[field])) errors.push(`${decisionLabel}.annotation requires ${field}`);
        }
        if (!Array.isArray(decision.supportingWordIds) || decision.supportingWordIds.length === 0) {
          errors.push(`${decisionLabel}.annotation requires supportingWordIds`);
        } else {
          const supportIds = new Set();
          for (const wordId of decision.supportingWordIds) {
            if (!isNonemptyString(wordId) || supportIds.has(wordId)) errors.push(`${decisionLabel}.annotation supportingWordIds must be unique non-empty IDs`);
            supportIds.add(wordId);
            if (!wordsById.has(wordId)) errors.push(`${decisionLabel}.annotation supportingWordIds must resolve to transcript words`);
          }
        }
      } else if (["argument", "evidence"].includes(decision.mode)) {
        const informationDelta = decision.informationDelta;
        for (const field of ["objectFamily", "visualVerb", "fallback"]) {
          if (!isNonemptyString(decision[field])) errors.push(`${decisionLabel} requires ${field}`);
        }
        if (!informationDelta || typeof informationDelta !== "object") {
          errors.push(`${decisionLabel} requires informationDelta`);
        } else {
          if (!['evidence', 'quote-context', 'comparison', 'causal-chain', 'selection', 'state-change', 'consequence', 'decision-aid'].includes(informationDelta.kind)) {
            errors.push(`${decisionLabel}.informationDelta.kind is invalid`);
          }
          if (!isNonemptyString(informationDelta.statement)) errors.push(`${decisionLabel}.informationDelta.statement is required`);
          if (!['spoken-structure', 'registered-material', 'both'].includes(informationDelta.basis)) errors.push(`${decisionLabel}.informationDelta.basis is invalid`);
          if (["spoken-structure", "both"].includes(informationDelta.basis)) {
            if (!Array.isArray(informationDelta.supportingWordIds) || informationDelta.supportingWordIds.length === 0) {
              errors.push(`${decisionLabel}.informationDelta spoken-structure basis requires supportingWordIds`);
            } else {
              const supportIds = new Set();
              for (const wordId of informationDelta.supportingWordIds) {
                if (!isNonemptyString(wordId) || supportIds.has(wordId)) errors.push(`${decisionLabel}.informationDelta.supportingWordIds must be unique non-empty IDs`);
                supportIds.add(wordId);
                if (!wordsById.has(wordId)) errors.push(`${decisionLabel}.informationDelta.supportingWordIds must resolve to transcript words`);
              }
            }
          }
          if (["registered-material", "both"].includes(informationDelta.basis)
            && !hasRegisteredMaterialRefs) {
            errors.push(`${decisionLabel}.informationDelta registered-material basis requires registered materialRefs`);
          }
          if (decision.mode === "evidence" && !["registered-material", "both"].includes(informationDelta.basis)) {
            errors.push(`${decisionLabel}.evidence requires registered-material or both basis`);
          }
        }
        if (decision.mode === "evidence" && beat.supportRole !== "evidence") errors.push(`${beat.id}: V2 mode evidence requires supportRole evidence`);
        const states = decision.argumentStates;
        if (!Array.isArray(states) || states.length < 3 || states.length > 4) {
          errors.push(`${decisionLabel}.argumentStates must contain exactly 3 or 4 states`);
        } else {
          const stateIds = new Set();
          const stateChanges = new Set();
          let previousAnchorFrame = null;
          for (const [stateIndex, state] of states.entries()) {
            const stateLabel = `${decisionLabel}.argumentStates[${stateIndex}]`;
            if (!isNonemptyString(state?.id) || stateIds.has(state.id)) errors.push(`${stateLabel}.id must be a unique ID`);
            stateIds.add(state?.id);
            if (!['introduce', 'compare', 'filter', 'link', 'transform', 'resolve'].includes(state?.operation)) {
              errors.push(`${stateLabel}.operation must be introduce, compare, filter, link, transform, or resolve`);
            }
            if (!['clear', 'impact'].includes(state?.readability)) errors.push(`${stateLabel}.readability must be clear or impact`);
            const anchorWord = wordsById.get(state?.anchorWordId);
            if (!anchorWord) errors.push(`${stateLabel}.anchorWordId must resolve to a transcript word`);
            const anchorFrame = anchorWord ? frameAtOrAfter(anchorWord.start, beatMap.fps) : null;
            if (anchorFrame !== null && previousAnchorFrame !== null && anchorFrame <= previousAnchorFrame) {
              errors.push(`${decisionLabel}.argumentStates anchors must strictly increase`);
            }
            if (anchorFrame !== null) previousAnchorFrame = anchorFrame;
            if (!Array.isArray(state?.activeObjectCueIds) || state.activeObjectCueIds.length === 0) {
              errors.push(`${stateLabel}.activeObjectCueIds is required`);
            } else {
              const activeCueIds = new Set();
              for (const cueId of state.activeObjectCueIds) {
                if (!isNonemptyString(cueId) || activeCueIds.has(cueId)) errors.push(`${stateLabel}.activeObjectCueIds must be unique non-empty IDs`);
                activeCueIds.add(cueId);
                const cue = cueById.get(cueId);
                if (!cue) errors.push(`${stateLabel}.activeObjectCueIds must resolve to this Beat's cue IDs`);
                if (cue && anchorFrame !== null && (anchorFrame < cue.preMotionFrame || anchorFrame >= cue.invisibleFrame)) {
                  errors.push(`${stateLabel}.anchorWordId must fall inside every referenced cue lifecycle`);
                }
              }
            }
            if (!isNonemptyString(state?.stateChange)) {
              errors.push(`${stateLabel}.stateChange is required`);
            } else {
              const normalizedStateChange = state.stateChange.replace(/\s/g, "").toLowerCase();
              if (stateChanges.has(normalizedStateChange)) errors.push(`${stateLabel}.stateChange duplicates another stateChange`);
              stateChanges.add(normalizedStateChange);
            }
          }
          if (!["replace", "evolve"].includes(decision.evolutionMode)) errors.push(`${decisionLabel}.evolutionMode must be replace or evolve`);
          if (decision.evolutionMode === "evolve") {
            if (decision.mode !== "argument") errors.push(`${decisionLabel}.evolve requires argument mode`);
            const commonCueIds = states.reduce((common, state) => {
              const activeCueIds = new Set(Array.isArray(state?.activeObjectCueIds) ? state.activeObjectCueIds : []);
              return common === null ? activeCueIds : new Set([...common].filter((cueId) => activeCueIds.has(cueId)));
            }, null);
            if (!commonCueIds || commonCueIds.size === 0) {
              errors.push(`${decisionLabel}.evolve requires a cue shared across all states`);
            } else {
              const causalCue = [...commonCueIds].map((cueId) => cueById.get(cueId)).find((cue) => cue?.holdKind === "causal-sequence");
              if (!causalCue) {
                errors.push(`${decisionLabel}.evolve requires a shared causal-sequence cue`);
              } else {
                const durationSeconds = (causalCue.invisibleFrame - causalCue.preMotionFrame) / beatMap.fps;
                if (durationSeconds < 2.4 || durationSeconds > 4.5) errors.push(`${decisionLabel}.evolve causal-sequence cue duration must be 2.4–4.5 seconds`);
              }
            }
          }
        }
      } else {
        errors.push(`${decisionLabel}.mode must be annotation, argument, or evidence`);
      }
    }
  }

  const captionOnly = captionMode === "subtitles" && beat.mgScope === "none";
  if (captionMode === "subtitles" && !["none", "local"].includes(beat.mgScope)) errors.push(`${beat.id}: subtitles mode requires mgScope to be none or local`);
  if (captionOnly) {
    if (beat.recipe !== "caption-only") errors.push(`${beat.id}: caption-only beat must use the caption-only recipe`);
    if ((beat.components ?? []).length !== 0 || (beat.microEvents ?? []).length !== 0) errors.push(`${beat.id}: caption-only beat cannot declare MG components or micro-events`);
    continue;
  }

  if (!beat.layout || !beat.typography || !beat.components || !beat.microEvents) {
    errors.push(`${beat.id}: motion beat is missing layout, typography, components, or micro-events`);
    continue;
  }
  if (!["horizontal", "vertical"].includes(beat.primaryFlowAxis)) errors.push(`${beat.id}: motion beat must declare a horizontal or vertical primaryFlowAxis`);
  if (typeof beat.visualReference !== "string" || beat.visualReference.trim().length === 0) errors.push(`${beat.id}: motion beat must declare its approved or proposed visualReference`);
  if (!["sequence", "comparison", "convergence", "branch", "mapping", "emphasis", "evidence"].includes(beat.semanticTopology)) errors.push(`${beat.id}: motion beat must declare semanticTopology`);
  const entryWord = wordsById.get(beat.entryAnchorWordId);
  const exitWord = wordsById.get(beat.exitAnchorWordId);
  if (!entryWord) errors.push(`${beat.id}: entryAnchorWordId does not resolve to a transcript word`);
  if (!exitWord) errors.push(`${beat.id}: exitAnchorWordId does not resolve to a transcript word`);
  if (!Number.isInteger(beat.exitAnchorOffsetFrames) || beat.exitAnchorOffsetFrames < 0 || beat.exitAnchorOffsetFrames > 12) {
    errors.push(`${beat.id}: exitAnchorOffsetFrames must be an integer from 0 to 12`);
  }
  let renderWindow = null;
  if (entryWord && exitWord) {
    try {
      renderWindow = resolveBeatRenderWindow(beat, beatMap, wordsById);
      renderWindows.set(beat.id, renderWindow);
      if (exitWord.end < entryWord.start) errors.push(`${beat.id}: exit anchor precedes entry anchor`);
      if (renderWindow.exitAnchorTime > beat.end + 1 / beatMap.fps) errors.push(`${beat.id}: exit anchor extends beyond the Beat window`);
      const lastMicroEvent = Math.max(beat.start, ...(beat.microEvents ?? []).map((event) => event.time));
      if (!thoughtfulEditorialBeat && renderWindow.exitAnchorTime < lastMicroEvent && !beat.staticHoldReason) errors.push(`${beat.id}: exit anchor precedes the last meaningful event`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (captionMode === "subtitles" && beat.mgScope !== "local") errors.push(`${beat.id}: subtitles mode only permits local MG`);
  if (captionMode === "subtitles" && beat.captionSafeZonePass !== true) errors.push(`${beat.id}: local MG must pass caption safe-zone review`);
  if (captionMode === "subtitles") {
    if (subtitleMgCadenceActive) {
      if (!['center', 'side'].includes(beat.layout.focalPlacement)) errors.push(`${beat.id}: local MG must declare focal placement center or side`);
      if (!isNonemptyString(beat.layout.focalPlacementRationale)) errors.push(`${beat.id}: local MG must declare focal placement rationale`);
      if (["partial", "intentional"].includes(beat.layout.faceCover) && !isNonemptyString(beat.layout.faceCoverRationale)) {
        errors.push(`${beat.id}: face-cover rationale is required for partial or intentional face coverage`);
      }
    }
    if (!Array.isArray(beat.captionCueIds) || beat.captionCueIds.length === 0) errors.push(`${beat.id}: subtitle MG must map to captionCueIds`);
    if (typeof beat.visualStyle !== "string" || beat.visualStyle.trim().length === 0) errors.push(`${beat.id}: subtitle MG must declare visualStyle`);
    if (!Array.isArray(beat.onScreenCopy) || beat.onScreenCopy.length === 0 || beat.onScreenCopy.length > 6) {
      errors.push(`${beat.id}: subtitle MG must declare 1–6 exact onScreenCopy strings`);
    } else {
      for (const [copyIndex, copy] of beat.onScreenCopy.entries()) {
        if (typeof copy !== "string" || copy.trim().length === 0) {
          errors.push(`${beat.id}: onScreenCopy[${copyIndex}] must be a non-empty string`);
          continue;
        }
        const visibleCharacters = [...copy.replace(/[\s·/｜|→↔+\-]/g, "")].length;
        if (visibleCharacters > 12) errors.push(`${beat.id}: onScreenCopy[${copyIndex}] exceeds 12 visible characters`);
      }
    }
    for (const field of ["viewerQuestion", "removalLoss", "visualEncoding", "stillFrameValue", "attentionCost"]) {
      if (typeof beat[field] !== "string" || beat[field].trim().length === 0) errors.push(`${beat.id}: subtitle MG must declare ${field}`);
    }
    if (!subtitleSupportRoles.has(beat.supportRole)) errors.push(`${beat.id}: subtitle MG has an invalid supportRole`);
    if (!["low", "medium", "high"].includes(beat.attentionCost)) errors.push(`${beat.id}: subtitle MG attentionCost must be low, medium, or high`);
    if (!Array.isArray(beat.factualClaims)) errors.push(`${beat.id}: subtitle MG must declare factualClaims, including an empty array when none are added`);
    if (Array.isArray(beat.factualClaims)) {
      for (const [claimIndex, claim] of beat.factualClaims.entries()) {
        if (typeof claim?.claim !== "string" || claim.claim.trim().length === 0 || typeof claim?.source !== "string" || claim.source.trim().length === 0) {
          errors.push(`${beat.id}: factualClaims[${claimIndex}] must include claim and source`);
        }
      }
    }
    if (!Array.isArray(beat.terms)) errors.push(`${beat.id}: subtitle MG must declare terms, including an empty array when none are introduced`);
    if (Array.isArray(beat.terms)) {
      for (const [termIndex, term] of beat.terms.entries()) {
        if (typeof term?.term !== "string" || term.term.trim().length === 0 || typeof term?.plainExplanation !== "string" || term.plainExplanation.trim().length === 0) {
          errors.push(`${beat.id}: terms[${termIndex}] must include term and plainExplanation`);
        }
      }
    }
    if (beat.supportRole === "evidence" && (typeof beat.evidenceSource !== "string" || beat.evidenceSource.trim().length === 0)) errors.push(`${beat.id}: evidence MG must declare evidenceSource`);
    if (beat.supportRole === "evidence" && (!Array.isArray(beat.factualClaims) || beat.factualClaims.length === 0)) errors.push(`${beat.id}: evidence MG must declare at least one factual claim`);
    if (beat.attentionCost === "high") {
      if (beat.axis !== "B") errors.push(`${beat.id}: high-attention-cost subtitle MG must use the B-axis`);
      if (typeof beat.attentionCostReason !== "string" || beat.attentionCostReason.trim().length === 0) errors.push(`${beat.id}: high-attention-cost subtitle MG must declare attentionCostReason`);
    }
  }

  if (beat.typography.fontFamily !== typography.displayFamily) errors.push(`${beat.id}: must use ${typography.displayFamily}`);
  const sizeRange = beat.typography.role === "primary" ? typography.primarySizePx : typography.secondarySizePx;
  if (beat.typography.fontSizePx < sizeRange[0] || beat.typography.fontSizePx > sizeRange[1]) errors.push(`${beat.id}: font size is outside ${sizeRange[0]}–${sizeRange[1]} px`);
  if (beat.typography.lineHeight < typography.displayLineHeight[0] || beat.typography.lineHeight > typography.displayLineHeight[1]) errors.push(`${beat.id}: display line height is outside the approved range`);
  if (beat.typography.outlineReservePx < typography.outlineReservePx) errors.push(`${beat.id}: insufficient outline and transform reserve`);

  if (beat.layout.primaryOccupancyRatio < density.primaryOccupancyRatio[0] || beat.layout.primaryOccupancyRatio > density.primaryOccupancyRatio[1]) errors.push(`${beat.id}: primary occupancy is too empty or too crowded`);
  if (beat.layout.supportingElementCount < density.supportingElementCount[0] || beat.layout.supportingElementCount > density.supportingElementCount[1]) errors.push(`${beat.id}: supporting element count is outside the approved range`);
  if (beat.layout.supportingElementCount !== beat.components.length) errors.push(`${beat.id}: component list does not match supporting element count`);
  if (beat.layout.emptyComponentCount !== density.emptyComponentCount) errors.push(`${beat.id}: empty components are forbidden`);
  if (!beat.layout.safeAreaPass) errors.push(`${beat.id}: declared layout does not pass the safe area`);
  if (beat.layout.panelPaddingPx < spacing.panelPaddingPx[0] || beat.layout.panelPaddingPx > spacing.panelPaddingPx[1]) errors.push(`${beat.id}: panel padding is outside the approved range`);

  const bounds = beat.layout.primaryBoundsNormalized;
  if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) errors.push(`${beat.id}: primary bounds leave the canvas`);
  const primaryCenterY = bounds.y + bounds.height / 2;
  if (primaryCenterY < designSystem.canvas.primaryStageYRatio[0] || primaryCenterY > designSystem.canvas.primaryStageYRatio[1]) errors.push(`${beat.id}: primary content is placed in an edge strip`);
  if (beat.axis === "B" && pipExclusionZone) {
    const pipBounds = {
      x: 1 - (pipExclusionZone.rightPx + pipExclusionZone.widthPx) / designSystem.canvas.width,
      y: 1 - (pipExclusionZone.bottomPx + pipExclusionZone.heightPx) / designSystem.canvas.height,
      width: pipExclusionZone.widthPx / designSystem.canvas.width,
      height: pipExclusionZone.heightPx / designSystem.canvas.height
    };
    const overlapsPip = bounds.x < pipBounds.x + pipBounds.width
      && bounds.x + bounds.width > pipBounds.x
      && bounds.y < pipBounds.y + pipBounds.height
      && bounds.y + bounds.height > pipBounds.y;
    if (overlapsPip) errors.push(`${beat.id}: B-axis primary bounds overlap the protected PIP zone`);
  }

  if (captionMode === "subtitles") {
    const captionHeight = designSystem.captions.fontSizePx * designSystem.captions.lineHeight * designSystem.captions.maximumLines + 8;
    const captionBounds = {
      x: 54 / designSystem.canvas.width,
      y: 1 - (designSystem.captions.bottomOffsetPx + captionHeight) / designSystem.canvas.height,
      width: 1 - 108 / designSystem.canvas.width,
      height: captionHeight / designSystem.canvas.height
    };
    const overlapsCaption = bounds.x < captionBounds.x + captionBounds.width
      && bounds.x + bounds.width > captionBounds.x
      && bounds.y < captionBounds.y + captionBounds.height
      && bounds.y + bounds.height > captionBounds.y;
    if (overlapsCaption) errors.push(`${beat.id}: local MG overlaps the protected caption zone`);
  }

  const microTimes = beat.microEvents.map((event) => event.time).sort((left, right) => left - right);
  if (microTimes.some((time) => time < beat.start || time > beat.end)) errors.push(`${beat.id}: micro-event falls outside its phrase`);
  const rhythmPoints = [beat.start, ...microTimes, beat.end];
  const largestGap = Math.max(...rhythmPoints.slice(1).map((time, pointIndex) => time - rhythmPoints[pointIndex]));
  if (!thoughtfulEditorialBeat && largestGap > rhythm.microEventGapSeconds[1] && !beat.staticHoldReason) errors.push(`${beat.id}: visual dead zone is ${largestGap.toFixed(2)}s`);
  if (entryWord && microTimes.length > 0) {
    const firstMeaningfulDelayMs = (microTimes[0] - entryWord.start) * 1000;
    if (firstMeaningfulDelayMs < -rhythm.syncToleranceFrames / beatMap.fps * 1000) errors.push(`${beat.id}: first meaningful event starts before its anchor word`);
    if (firstMeaningfulDelayMs > (rhythm.firstMeaningfulEventMaxMs ?? 400)) errors.push(`${beat.id}: first meaningful event is delayed ${firstMeaningfulDelayMs.toFixed(1)}ms`);
  }

  const topologyRoles = beat.microEvents.map((event) => event.topologyRole).filter(Boolean);
  if (beat.semanticTopology === "sequence" && topologyRoles.filter((role) => role === "node").length < 2) errors.push(`${beat.id}: sequence topology requires at least two nodes`);
  if (beat.semanticTopology === "comparison" && (!topologyRoles.includes("comparison-a") || !topologyRoles.includes("comparison-b"))) errors.push(`${beat.id}: comparison topology requires both sides`);
  if (beat.semanticTopology === "convergence" && (topologyRoles.filter((role) => role === "input").length < 2 || !topologyRoles.includes("result"))) errors.push(`${beat.id}: convergence topology requires two inputs and a result`);
  if (beat.semanticTopology === "branch" && (!topologyRoles.includes("source") || topologyRoles.filter((role) => role === "branch").length < 2)) errors.push(`${beat.id}: branch topology requires one source and two branches`);
  if (beat.semanticTopology === "mapping" && (!topologyRoles.includes("source") || !topologyRoles.includes("result"))) errors.push(`${beat.id}: mapping topology requires source and result roles`);
  if (["convergence", "branch", "mapping"].includes(beat.semanticTopology)
    && !beat.microEvents.some((event) => event.visualRole === "connector")) {
    errors.push(`${beat.id}: ${beat.semanticTopology} topology requires a connector`);
  }

  const revealGroups = new Map();
  for (const event of beat.microEvents.filter((candidate) => candidate.revealGroup)) {
    const events = revealGroups.get(event.revealGroup) ?? [];
    events.push(event);
    revealGroups.set(event.revealGroup, events);
  }
  for (const [group, events] of revealGroups) {
    if (!events.some((event) => event.visualRole === "connector")) continue;
    if (!events.some((event) => event.visualRole === "container")) errors.push(`${beat.id}: reveal group ${group} has a connector without a container`);
    const times = events.map((event) => event.time);
    if ((Math.max(...times) - Math.min(...times)) * beatMap.fps > (rhythm.revealGroupMaxSkewFrames ?? 2)) errors.push(`${beat.id}: reveal group ${group} exceeds two-frame coordination`);
  }
  if (beat.microEvents.some((event) => event.visualRole === "connector" && !event.revealGroup)) errors.push(`${beat.id}: connector events must declare revealGroup`);

  const visualSignature = JSON.stringify({
    axis: beat.axis,
    visualReference: beat.visualReference,
    semanticTopology: beat.semanticTopology,
    primaryFlowAxis: beat.primaryFlowAxis,
    motionFamily: beat.motionFamily,
    visualStyle: beat.visualStyle ?? null
  });
  const signatureBeats = signatureUsage.get(visualSignature) ?? [];
  signatureBeats.push(beat);
  signatureUsage.set(visualSignature, signatureBeats);

  if (index >= rhythm.maximumRepeatedTransitionFamily) {
    const recent = beats.slice(index - rhythm.maximumRepeatedTransitionFamily, index + 1);
    if (recent.every((candidate) => candidate.transitionFamily === beat.transitionFamily)) errors.push(`${beat.id}: transition family repeats too many times`);
  }
}

if (visualOrchestrationV2 && beatMap.mgCadenceExceptions !== undefined && !Array.isArray(beatMap.mgCadenceExceptions)) {
  errors.push("V2 mgCadenceExceptions must be an array");
}

if (visualOrchestrationV2 && Array.isArray(beatMap.mgCadenceExceptions)) {
  const v2NoneBeats = new Map(beats.filter((beat) => beat.mgScope === "none").map((beat) => [beat.id, beat]));
  for (const [index, exception] of beatMap.mgCadenceExceptions.entries()) {
    const label = `mgCadenceExceptions[${index}]`;
    const start = Number(exception?.start);
    const end = Number(exception?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > Number(beatMap.duration) || end <= start) {
      errors.push(`${label} must stay within the video and have a positive duration`);
      continue;
    }
    if (!isNonemptyString(exception?.reason)) errors.push(`${label}: V2 mgCadenceExceptions requires a reason`);
    if (!Array.isArray(exception.coveredNoneBeatIds) || exception.coveredNoneBeatIds.length === 0) {
      errors.push(`${label}.coveredNoneBeatIds is required`);
      continue;
    }
    const coveredIds = new Set();
    for (const beatId of exception.coveredNoneBeatIds) {
      if (!isNonemptyString(beatId) || coveredIds.has(beatId)) errors.push(`${label}.coveredNoneBeatIds must be unique non-empty IDs`);
      coveredIds.add(beatId);
      const noneBeat = v2NoneBeats.get(beatId);
      if (!noneBeat) {
        errors.push(`${label}.coveredNoneBeatIds must reference a V2 none beat`);
      } else if (start > noneBeat.start || end < noneBeat.end) {
        errors.push(`${label} must fully cover named none beats`);
      }
    }
    for (const localBeat of beats.filter((beat) => beat.mgScope === "local")) {
      const window = renderWindows.get(localBeat.id) ?? { start: localBeat.start, end: localBeat.end };
      if (start < window.end && end > window.start) {
        errors.push(`${label} overlaps a local MG passage`);
        break;
      }
    }
  }
}

if (subtitleMgCadenceActive) {
  const totalDuration = Number(beatMap.duration);
  const rawExceptions = beatMap.mgCadenceExceptions ?? [];
  const validExceptions = [];
  if (!Array.isArray(rawExceptions)) {
    errors.push("mgCadenceExceptions must be an array");
  } else {
    for (const [index, exception] of rawExceptions.entries()) {
      const start = Number(exception?.start);
      const end = Number(exception?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > totalDuration || end <= start) {
        errors.push(`mgCadenceExceptions[${index}] must stay within the video and have a positive duration`);
        continue;
      }
      if (!isNonemptyString(exception?.reason)) {
        errors.push(`mgCadenceExceptions[${index}] requires a reason`);
        continue;
      }
      validExceptions.push({ start, end, reason: exception.reason });
    }
  }
  validExceptions.sort((left, right) => left.start - right.start || left.end - right.end);
  const exceptionUnion = [];
  for (const exception of validExceptions) {
    const previous = exceptionUnion.at(-1);
    if (previous && exception.start < previous.end) {
      errors.push("mgCadenceExceptions must not overlap");
      previous.end = Math.max(previous.end, exception.end);
    } else {
      exceptionUnion.push({ ...exception });
    }
  }

  const localWindows = beats
    .filter((beat) => beat.mgScope === "local")
    .map((beat) => ({ beat, window: renderWindows.get(beat.id) }))
    .filter(({ window }) => Boolean(window))
    .sort((left, right) => left.window.start - right.window.start || left.window.end - right.window.end);
  const frameSeconds = Number(beatMap.fps) > 0 ? 1 / Number(beatMap.fps) : 0;
  const passages = [];
  for (const { beat, window } of localWindows) {
    const previous = passages.at(-1);
    if (previous && window.start <= previous.end + frameSeconds) {
      previous.end = Math.max(previous.end, window.end);
      previous.beatIds.push(beat.id);
    } else {
      passages.push({ start: window.start, end: window.end, beatIds: [beat.id] });
    }
  }
  for (const exception of exceptionUnion) {
    if (passages.some((passage) => exception.start < passage.end && exception.end > passage.start)) {
      errors.push(`mgCadenceExceptions ${exception.start}–${exception.end} overlaps a local MG passage`);
    }
  }

  const exceptionCoverage = exceptionUnion.reduce((total, exception) => total + exception.end - exception.start, 0);
  const requiredPassages = Math.ceil(Math.max(0, totalDuration - exceptionCoverage) / cadenceRules.targetIntervalSeconds);
  if (passages.length < requiredPassages) {
    errors.push(`subtitle MG cadence requires at least ${requiredPassages} meaningful local-MG passages; found ${passages.length}`);
  }
  for (let index = 1; index < passages.length; index += 1) {
    const separation = passages[index].start - passages[index - 1].start;
    if (separation < cadenceRules.minimumPassageSeparationSeconds) {
      errors.push(`subtitle MG cadence passage starts must be at least ${cadenceRules.minimumPassageSeparationSeconds} seconds apart`);
    }
  }
  const coversEntireGap = (start, end) => {
    let cursor = start;
    for (const exception of exceptionUnion) {
      if (exception.end <= cursor) continue;
      if (exception.start > cursor + 1e-6) return false;
      cursor = Math.max(cursor, exception.end);
      if (cursor >= end - 1e-6) return true;
    }
    return cursor >= end - 1e-6;
  };
  const gaps = [];
  let previousEnd = 0;
  for (const passage of passages) {
    gaps.push({ start: previousEnd, end: passage.start, label: previousEnd === 0 ? "opening" : "inter-passage" });
    previousEnd = passage.end;
  }
  gaps.push({ start: previousEnd, end: totalDuration, label: "closing" });
  for (const gap of gaps) {
    if (gap.end - gap.start > cadenceRules.maximumUnexplainedGapSeconds && !coversEntireGap(gap.start, gap.end)) {
      errors.push(`subtitle MG cadence has an unexplained ${gap.label} gap of ${(gap.end - gap.start).toFixed(2)} seconds`);
    }
  }
}

const aAxisMotionBeats = beats.filter((beat) => beat.axis === "A" && !(captionMode === "subtitles" && beat.mgScope === "none"));
for (const [index, beat] of aAxisMotionBeats.entries()) {
  const renderWindow = renderWindows.get(beat.id) ?? { start: beat.start, end: beat.end };
  const previousWindow = index > 0
    ? renderWindows.get(aAxisMotionBeats[index - 1].id) ?? {
      start: aAxisMotionBeats[index - 1].start,
      end: aAxisMotionBeats[index - 1].end
    }
    : null;
  if (previousWindow && renderWindow.start < previousWindow.end) errors.push(`${beat.id}: A-axis information groups overlap instead of replacing`);
}

for (const repeatedBeats of signatureUsage.values()) {
  if (repeatedBeats.length < 2) continue;
  const reuseGroups = new Set(repeatedBeats.map((beat) => beat.reuseGroup).filter(Boolean));
  if (reuseGroups.size !== 1 || repeatedBeats.some((beat) => typeof beat.reuseReason !== "string" || beat.reuseReason.trim().length === 0)) {
    errors.push(`${repeatedBeats.map((beat) => beat.id).join(", ")}: repeated visual signature requires one reuseGroup and a reason`);
  }
}

for (const segment of transcript.segments) {
  if (!sourceUsage.has(segment.id)) errors.push(`${segment.id}: transcript segment is missing from the beat map`);
}

for (const [sourceId, uses] of sourceUsage) {
  if (uses.length > 1 && !uses.every((beat) => beat.reuseSource)) errors.push(`${sourceId}: transcript segment is reused without an explicit reason`);
}

let sceneStart = beats[0]?.start ?? 0;
let currentScene = beats[0]?.sceneId;
for (const beat of beats.slice(1)) {
  if (beat.sceneId !== currentScene) {
    const sceneDuration = beat.start - sceneStart;
    if (sceneDuration < rhythm.majorSceneGapSeconds[0] && !beat.majorSceneException) errors.push(`${beat.id}: major scene changes after only ${sceneDuration.toFixed(2)}s`);
    if (sceneDuration > rhythm.majorSceneGapSeconds[1]) warnings.push(`${currentScene}: major scene lasts ${sceneDuration.toFixed(2)}s; confirm micro-events keep it alive`);
    sceneStart = beat.start;
    currentScene = beat.sceneId;
  }
}

let axisRunStart = 0;
while (axisRunStart < beats.length) {
  const axis = beats[axisRunStart].axis;
  let axisRunEnd = axisRunStart;
  while (axisRunEnd + 1 < beats.length && beats[axisRunEnd + 1].axis === axis) axisRunEnd += 1;
  if (axis === "B") {
    const runDuration = beats[axisRunEnd].end - beats[axisRunStart].start;
    if (runDuration < rhythm.minimumBAxisRunSeconds && !beats[axisRunStart].axisException) errors.push(`${beats[axisRunStart].id}: B-axis run is only ${runDuration.toFixed(2)}s`);
  }
  axisRunStart = axisRunEnd + 1;
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
for (const error of errors) console.error(`Error: ${error}`);

if (errors.length > 0) process.exit(1);
console.log(`Visual plan passed: ${beats.length} beats, ${warnings.length} warning(s)`);
