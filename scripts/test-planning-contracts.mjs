import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReferenceScript } from "./reference-script-annotations.mjs";
import { sha256File } from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-planning-"));
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${name} unexpectedly passed`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`${name} failed for the wrong reason:\n${output}`);
  return result;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

try {
  const parsed = parseReferenceScript("第一句[保留]【MG：关键词】；第二句【从前面的分号到此使用B轴】");
  assert.equal(parsed.speechText, "第一句[保留]；第二句");
  assert.equal(parsed.annotations[0].scopeMode, "preceding-clause");
  assert.equal(parsed.annotations[1].scopeMode, "explicit-range");
  assert.equal(parseReferenceScript("这是第一句。\n【MG：关键词】").annotations[0].defaultScope.text, "这是第一句");
  for (const malformed of ["【MG】正文", "正文【】", "正文【外层【内层】】", "正文【未闭合", "正文】"]) {
    assert.throws(() => parseReferenceScript(malformed));
  }

  const transcript = path.join(repositoryRoot, "examples", "transcript.example.json");
  const design = path.join(repositoryRoot, "assets", "design-system.default.json");
  const validMotion = path.join(repositoryRoot, "examples", "beat-map.example.json");
  const validSubtitles = path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json");
  const beatMapSchema = readJson(path.join(repositoryRoot, "schemas", "beat-map.schema.json"));
  assert.deepEqual(beatMapSchema.properties.visualOrchestrationVersion.enum, [1, 2]);
  const visualDecisionSchemas = beatMapSchema.properties.beats.items.properties.visualDecision.oneOf;
  assert.equal(visualDecisionSchemas.length, 2);
  const annotationDecisionSchema = visualDecisionSchemas.find((schema) => schema.properties.mode.const === "annotation");
  const argumentDecisionSchema = visualDecisionSchemas.find((schema) => Array.isArray(schema.properties.mode.enum));
  assert.deepEqual(annotationDecisionSchema.required, ["mode", "memoryAnchor", "supportingWordIds", "fallback"]);
  assert.deepEqual(annotationDecisionSchema.properties.supportingWordIds, {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "string", pattern: "^.+:(?:measured-)?word-[0-9]{3,}$" }
  });
  assert.deepEqual(annotationDecisionSchema.properties.fallback, { type: "string", minLength: 1 });
  assert.deepEqual(argumentDecisionSchema.required, ["mode", "informationDelta", "objectFamily", "visualVerb", "evolutionMode", "argumentStates", "fallback"]);
  assert.deepEqual(argumentDecisionSchema.properties.mode.enum, ["argument", "evidence"]);
  assert.deepEqual(argumentDecisionSchema.properties.informationDelta.properties.kind.enum, ["evidence", "quote-context", "comparison", "causal-chain", "selection", "state-change", "consequence", "decision-aid"]);
  assert.deepEqual(argumentDecisionSchema.properties.informationDelta.properties.basis.enum, ["spoken-structure", "registered-material", "both"]);
  assert.deepEqual(argumentDecisionSchema.properties.evolutionMode.enum, ["replace", "evolve"]);
  assert.equal(argumentDecisionSchema.properties.argumentStates.minItems, 3);
  assert.equal(argumentDecisionSchema.properties.argumentStates.maxItems, 4);
  assert.deepEqual(argumentDecisionSchema.properties.argumentStates.items.properties.operation.enum, ["introduce", "compare", "filter", "link", "transform", "resolve"]);
  assert.deepEqual(argumentDecisionSchema.properties.argumentStates.items.properties.activeObjectCueIds, {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" }
  });
  assert.deepEqual(argumentDecisionSchema.properties.argumentStates.items.properties.readability.enum, ["clear", "impact"]);
  const coveredNoneBeatIds = beatMapSchema.properties.mgCadenceExceptions.items.properties.coveredNoneBeatIds;
  assert.deepEqual(coveredNoneBeatIds, {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" }
  });
  assert.equal(beatMapSchema.properties.materials.items.properties.visibleFacts.minItems, 1);
  assert.equal(beatMapSchema.properties.materials.items.properties.forbiddenInferences.minItems, 1);
  script("check-visual-plan.mjs", [validMotion, transcript, design]);
  script("check-visual-plan.mjs", [validSubtitles, transcript, design]);

  const visualPackageJob = path.join(temporaryRoot, "visual-package-job");
  const visualPackageState = path.join(visualPackageJob, "state");
  const visualPackageInput = path.join(visualPackageJob, "input", "evidence");
  fs.mkdirSync(visualPackageState, { recursive: true });
  fs.mkdirSync(visualPackageInput, { recursive: true });
  const visualPackageTranscript = path.join(visualPackageState, "transcript.json");
  const visualPackageBeatMap = path.join(visualPackageState, "beat-map.json");
  const visualPackageMaterialPath = path.join(visualPackageInput, "fixture-evidence.png");
  fs.writeFileSync(visualPackageMaterialPath, "fixture evidence");
  fs.copyFileSync(transcript, visualPackageTranscript);
  const visualPackageFixture = readJson(validSubtitles);
  visualPackageFixture.visualOrchestrationVersion = 1;
  visualPackageFixture.materials = [{
    id: "fixture-evidence",
    path: "input/evidence/fixture-evidence.png",
    kind: "screenshot",
    sha256: sha256File(visualPackageMaterialPath),
    sourceOrRights: "user-provided",
    privacyStatus: "approved-with-mask",
    visibleFacts: ["Fixture evidence image supplied for the visual-package contract."],
    forbiddenInferences: ["Do not infer a platform, date, amount, or causal relationship."]
  }];
  for (const [index, beat] of visualPackageFixture.beats.entries()) {
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
      invisibleFrame: index === 0 ? 42 : 88
    }];
  }
  const visualPackageWithoutMaterials = structuredClone(visualPackageFixture);
  delete visualPackageWithoutMaterials.materials;
  writeJson(visualPackageBeatMap, visualPackageWithoutMaterials);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], false, /materials/i);
  writeJson(visualPackageBeatMap, visualPackageFixture);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design]);
  const visualPackageWithoutVisibleFacts = structuredClone(visualPackageFixture);
  visualPackageWithoutVisibleFacts.materials[0].visibleFacts = [];
  writeJson(visualPackageBeatMap, visualPackageWithoutVisibleFacts);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], false, /visibleFacts/i);
  const visualPackageWithoutForbiddenInferences = structuredClone(visualPackageFixture);
  visualPackageWithoutForbiddenInferences.materials[0].forbiddenInferences = [];
  writeJson(visualPackageBeatMap, visualPackageWithoutForbiddenInferences);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], false, /forbiddenInferences/i);
  const visualPackageMissingDisplayWindow = structuredClone(visualPackageFixture);
  delete visualPackageMissingDisplayWindow.beats[0].materialRefs[0].displayStartFrame;
  writeJson(visualPackageBeatMap, visualPackageMissingDisplayWindow);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], false, /displayStartFrame/i);
  writeJson(visualPackageBeatMap, visualPackageFixture);

  const b01LegacyLocalMg = structuredClone(visualPackageFixture);
  b01LegacyLocalMg.beats[0].id = "b01";
  writeJson(visualPackageBeatMap, b01LegacyLocalMg);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], true, null);
  const b01ReviewWorkflow = path.join(visualPackageState, "workflow.json");
  writeJson(b01ReviewWorkflow, { visualArrangementReviewRequired: true });
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design], false, /b01.*motionProfile.*thoughtful-editorial-v1/i);
  script("check-visual-plan.mjs", [visualPackageBeatMap, visualPackageTranscript, design, b01ReviewWorkflow], false, /b01.*motionProfile.*thoughtful-editorial-v1/i);
  writeJson(visualPackageBeatMap, visualPackageFixture);

  const thoughtfulTranscriptPath = path.join(temporaryRoot, "thoughtful-transcript.json");
  const thoughtfulBeatMapPath = path.join(temporaryRoot, "thoughtful-beat-map.json");
  writeJson(thoughtfulTranscriptPath, {
    revision: 1,
    language: "zh-CN",
    duration: 6,
    source: "fixture",
    segments: [{
      id: "thoughtful-001",
      text: "入口中间出口",
      start: 1,
      end: 5.1,
      confidence: 1,
      words: [
        { text: "入口", start: 1, end: 1.2, confidence: 1 },
        { text: "中间", start: 4, end: 4.1, confidence: 1 },
        { text: "出口", start: 5, end: 5.1, confidence: 1 }
      ]
    }]
  });
  const thoughtfulBeat = structuredClone(visualPackageFixture.beats[0]);
  Object.assign(thoughtfulBeat, {
    id: "thoughtful-001",
    sourceSegmentIds: ["thoughtful-001"],
    start: 1,
    end: 5.5,
    audioAnchorTime: 1,
    entryAnchorWordId: "thoughtful-001:word-001",
    exitAnchorWordId: "thoughtful-001:word-003",
    motionProfile: "thoughtful-editorial-v1",
    surfaceTreatment: "direct-overlay",
    materialRefs: [],
    microEvents: [
      { time: 1.1, type: "marker", semanticChange: "The primary idea enters with its spoken trigger.", visualRole: "indicator", topologyRole: "node" },
      { time: 1.15, type: "marker", semanticChange: "The supporting reading order settles.", visualRole: "indicator", topologyRole: "node" }
    ],
    staticHoldReason: "Legacy fixture compatibility; thoughtful profile validation must use object cues instead.",
    objectCues: [{
      id: "primary-copy",
      semanticRole: "primary-copy",
      spokenTriggerWordId: "thoughtful-001:word-001",
      preMotionFrame: 57,
      firstLegibleFrame: 60,
      settledFrame: 70,
      exitTriggerWordId: "thoughtful-001:word-002",
      invisibleFrame: 252,
      holdKind: "standard"
    }]
  });
  const thoughtfulFixture = {
    duration: 6,
    fps: 60,
    captionMode: "subtitles",
    designSystem: "state/design-system.json",
    visualOrchestrationVersion: 1,
    materials: [],
    beats: [thoughtfulBeat]
  };
  writeJson(thoughtfulBeatMapPath, thoughtfulFixture);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design]);
  const visualOrchestrationV2Fixture = structuredClone(thoughtfulFixture);
  visualOrchestrationV2Fixture.visualOrchestrationVersion = 2;
  visualOrchestrationV2Fixture.beats[0].supportRole = "explanation";
  visualOrchestrationV2Fixture.beats[0].objectCues[0].holdKind = "causal-sequence";
  visualOrchestrationV2Fixture.beats[0].objectCues[0].exitTriggerWordId = "thoughtful-001:word-003";
  visualOrchestrationV2Fixture.beats[0].objectCues[0].invisibleFrame = 312;
  visualOrchestrationV2Fixture.beats[0].visualDecision = {
    mode: "argument",
    informationDelta: {
      kind: "selection",
      statement: "The candidate set narrows into one retained result.",
      basis: "spoken-structure",
      supportingWordIds: ["thoughtful-001:word-001", "thoughtful-001:word-002"]
    },
    objectFamily: "candidate expressions",
    visualVerb: "filter",
    evolutionMode: "evolve",
    argumentStates: [
      { id: "candidates-established", anchorWordId: "thoughtful-001:word-001", operation: "introduce", activeObjectCueIds: ["primary-copy"], stateChange: "The candidate field becomes readable.", readability: "clear" },
      { id: "candidates-narrow", anchorWordId: "thoughtful-001:word-002", operation: "filter", activeObjectCueIds: ["primary-copy"], stateChange: "The field narrows to retained candidates.", readability: "clear" },
      { id: "result-remains", anchorWordId: "thoughtful-001:word-003", operation: "resolve", activeObjectCueIds: ["primary-copy"], stateChange: "One retained result becomes the conclusion.", readability: "clear" }
    ],
    fallback: "caption-only because no supported selection criterion exists"
  };
  assert.equal(visualOrchestrationV2Fixture.beats[0].visualDecision.mode, "argument");
  writeJson(thoughtfulBeatMapPath, visualOrchestrationV2Fixture);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design]);
  const v2ReviewTimesWithoutTranscript = script("review-times.mjs", [thoughtfulBeatMapPath]).stdout.trim().split(",");
  assert.equal(v2ReviewTimesWithoutTranscript.includes("1.167"), false, "one-argument V2 sampling must not invent argument-state phase times");
  const v2ReviewTimes = script("review-times.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath]).stdout.trim().split(",");
  for (const phaseTime of ["1.167", "4", "5"]) {
    assert.ok(v2ReviewTimes.includes(phaseTime), `V2 argument state phase ${phaseTime} must be sampled`);
  }

  const writeV2Mutation = (name, mutate, error = null) => {
    const fixture = structuredClone(visualOrchestrationV2Fixture);
    mutate(fixture);
    writeJson(thoughtfulBeatMapPath, fixture);
    script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], error === null, error);
  };
  writeV2Mutation("version-three", (fixture) => { fixture.visualOrchestrationVersion = 3; }, /must be 1 or 2/);
  writeV2Mutation("missing-decision", (fixture) => { delete fixture.beats[0].visualDecision; }, /requires visualDecision/);
  const annotationDecision = {
    mode: "annotation",
    memoryAnchor: "入口到出口的因果链",
    supportingWordIds: ["thoughtful-001:word-002"],
    fallback: "caption-only because the spoken structure is insufficient"
  };
  writeV2Mutation("annotation-missing-memory-anchor", (fixture) => {
    fixture.beats[0].visualDecision = structuredClone(annotationDecision);
    delete fixture.beats[0].visualDecision.memoryAnchor;
  }, /annotation.*memoryAnchor|requires.*memoryAnchor/i);
  writeV2Mutation("annotation-missing-support-words", (fixture) => {
    fixture.beats[0].visualDecision = structuredClone(annotationDecision);
    delete fixture.beats[0].visualDecision.supportingWordIds;
  }, /annotation.*supportingWordIds|requires.*supportingWordIds/i);
  writeV2Mutation("annotation-missing-fallback", (fixture) => {
    fixture.beats[0].visualDecision = structuredClone(annotationDecision);
    delete fixture.beats[0].visualDecision.fallback;
  }, /annotation.*fallback|requires.*fallback/i);
  writeV2Mutation("annotation-valid", (fixture) => {
    fixture.beats[0].visualDecision = structuredClone(annotationDecision);
  });
  writeV2Mutation("unknown-support-word", (fixture) => {
    fixture.beats[0].visualDecision.informationDelta.supportingWordIds = ["thoughtful-001:word-999"];
  }, /supportingWordIds.*resolve/i);
  const v2EvidenceJob = path.join(temporaryRoot, "v2-evidence-job");
  const v2EvidenceState = path.join(v2EvidenceJob, "state");
  const v2EvidenceInput = path.join(v2EvidenceJob, "input", "evidence");
  fs.mkdirSync(v2EvidenceState, { recursive: true });
  fs.mkdirSync(v2EvidenceInput, { recursive: true });
  const v2EvidenceTranscriptPath = path.join(v2EvidenceState, "transcript.json");
  const v2EvidenceBeatMapPath = path.join(v2EvidenceState, "beat-map.json");
  const v2EvidenceMaterialPath = path.join(v2EvidenceInput, "fixture-evidence.png");
  fs.copyFileSync(thoughtfulTranscriptPath, v2EvidenceTranscriptPath);
  fs.writeFileSync(v2EvidenceMaterialPath, "v2 evidence fixture");
  const v2EvidenceFixture = structuredClone(visualOrchestrationV2Fixture);
  Object.assign(v2EvidenceFixture.beats[0], {
    supportRole: "evidence",
    surfaceTreatment: "evidence-surface",
    materialRefs: [{
      materialId: "fixture-evidence",
      role: "primary-evidence",
      displayStartFrame: 60,
      displayEndFrame: 120,
      crop: "contain",
      masking: "none"
    }],
    evidenceSource: "fixture evidence",
    factualClaims: [{ claim: "The fixture provides registered material support.", source: "fixture evidence" }]
  });
  v2EvidenceFixture.materials = [{
    id: "fixture-evidence",
    path: "input/evidence/fixture-evidence.png",
    kind: "screenshot",
    sha256: sha256File(v2EvidenceMaterialPath),
    sourceOrRights: "test fixture",
    privacyStatus: "approved",
    visibleFacts: ["Fixture evidence is registered for this test."],
    forbiddenInferences: ["Do not infer beyond the fixture."]
  }];
  v2EvidenceFixture.beats[0].visualDecision.mode = "evidence";
  v2EvidenceFixture.beats[0].visualDecision.informationDelta.basis = "both";
  v2EvidenceFixture.beats[0].visualDecision.evolutionMode = "replace";
  writeJson(v2EvidenceBeatMapPath, v2EvidenceFixture);
  script("check-visual-plan.mjs", [v2EvidenceBeatMapPath, v2EvidenceTranscriptPath, design]);
  const evidenceReviewTimes = script("review-times.mjs", [v2EvidenceBeatMapPath, v2EvidenceTranscriptPath]).stdout.trim().split(",");
  for (const phaseTime of ["1.167", "4", "5"]) {
    assert.ok(evidenceReviewTimes.includes(phaseTime), `V2 evidence state phase ${phaseTime} must be sampled`);
  }
  const writeEvidenceMutation = (mutate, error) => {
    const fixture = structuredClone(v2EvidenceFixture);
    mutate(fixture);
    writeJson(v2EvidenceBeatMapPath, fixture);
    script("check-visual-plan.mjs", [v2EvidenceBeatMapPath, v2EvidenceTranscriptPath, design], false, error);
  };
  writeEvidenceMutation((fixture) => {
    fixture.beats[0].visualDecision.mode = "argument";
  }, /supportRole evidence.*mode evidence/i);
  writeEvidenceMutation((fixture) => {
    fixture.beats[0].supportRole = "explanation";
  }, /mode evidence.*supportRole evidence/i);
  writeEvidenceMutation((fixture) => {
    fixture.beats[0].visualDecision.informationDelta.basis = "spoken-structure";
  }, /evidence.*registered-material/i);
  writeEvidenceMutation((fixture) => {
    fixture.beats[0].surfaceTreatment = "direct-overlay";
    fixture.beats[0].materialRefs = [];
  }, /registered-material.*materialRefs/i);
  writeV2Mutation("too-few-states", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates.pop();
  }, /argumentStates.*3 or 4/i);
  writeV2Mutation("too-many-states", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates.push({
      ...fixture.beats[0].visualDecision.argumentStates[2],
      id: "result-confirmed",
      stateChange: "The retained result is confirmed."
    });
    fixture.beats[0].visualDecision.argumentStates.push({
      ...fixture.beats[0].visualDecision.argumentStates[2],
      id: "result-repeated",
      stateChange: "The retained result remains visible."
    });
  }, /argumentStates.*3 or 4/i);
  writeV2Mutation("duplicate-state-id", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].id = fixture.beats[0].visualDecision.argumentStates[0].id;
  }, /argumentStates.*unique ID/i);
  writeV2Mutation("invalid-state-operation", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].operation = "refine";
  }, /operation.*introduce.*resolve/i);
  writeV2Mutation("missing-state-operation", (fixture) => {
    delete fixture.beats[0].visualDecision.argumentStates[1].operation;
  }, /operation.*introduce.*resolve/i);
  writeV2Mutation("invalid-state-readability", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].readability = "blurred";
  }, /readability.*clear.*impact/i);
  writeV2Mutation("missing-state-readability", (fixture) => {
    delete fixture.beats[0].visualDecision.argumentStates[1].readability;
  }, /readability.*clear.*impact/i);
  writeV2Mutation("unresolved-state-anchor", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].anchorWordId = "thoughtful-001:word-999";
  }, /anchorWordId.*resolve/i);
  writeV2Mutation("empty-active-cues", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].activeObjectCueIds = [];
  }, /activeObjectCueIds.*required/i);
  writeV2Mutation("duplicate-active-cues", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].activeObjectCueIds = ["primary-copy", "primary-copy"];
  }, /activeObjectCueIds.*unique/i);
  writeV2Mutation("duplicate-state-change", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].stateChange = fixture.beats[0].visualDecision.argumentStates[0].stateChange;
  }, /stateChange.*duplicates/i);
  writeV2Mutation("normalized-duplicate-state-change", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[0].stateChange = "Candidate Set Changes";
    fixture.beats[0].visualDecision.argumentStates[1].stateChange = "candidate   set changes";
  }, /stateChange.*duplicates/i);
  writeV2Mutation("out-of-order-anchor", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[1].anchorWordId = "thoughtful-001:word-001";
  }, /anchors.*strictly increase/i);
  writeV2Mutation("unknown-cue", (fixture) => {
    fixture.beats[0].visualDecision.argumentStates[0].activeObjectCueIds = ["unknown-cue"];
  }, /activeObjectCueIds.*resolve/i);
  writeV2Mutation("anchor-outside-cue", (fixture) => {
    fixture.beats[0].objectCues.push({
      ...fixture.beats[0].objectCues[0],
      id: "secondary-copy",
      spokenTriggerWordId: "thoughtful-001:word-002",
      preMotionFrame: 240,
      firstLegibleFrame: 240,
      settledFrame: 250
    });
    fixture.beats[0].visualDecision.argumentStates[0].activeObjectCueIds = ["secondary-copy"];
  }, /anchor.*cue lifecycle/i);
  writeEvidenceMutation((fixture) => {
    fixture.beats[0].visualDecision.evolutionMode = "evolve";
  }, /evolve.*argument/i);
  writeV2Mutation("evolve-no-shared-cue", (fixture) => {
    fixture.beats[0].objectCues.push({
      ...fixture.beats[0].objectCues[0],
      id: "secondary-copy",
      spokenTriggerWordId: "thoughtful-001:word-002",
      preMotionFrame: 240,
      firstLegibleFrame: 240,
      settledFrame: 250
    });
    fixture.beats[0].visualDecision.argumentStates[1].activeObjectCueIds = ["secondary-copy"];
  }, /evolve.*(cue shared|shared across)/i);
  const originalThoughtfulTranscript = readJson(thoughtfulTranscriptPath);
  const shortEvolutionTranscript = structuredClone(originalThoughtfulTranscript);
  shortEvolutionTranscript.segments[0].words[1] = { ...shortEvolutionTranscript.segments[0].words[1], start: 1.5, end: 1.6 };
  shortEvolutionTranscript.segments[0].words[2] = { ...shortEvolutionTranscript.segments[0].words[2], start: 2, end: 2.1 };
  const shortEvolutionFixture = structuredClone(visualOrchestrationV2Fixture);
  shortEvolutionFixture.beats[0].objectCues[0].invisibleFrame = 138;
  const nonCausalEvolutionFixture = structuredClone(shortEvolutionFixture);
  nonCausalEvolutionFixture.beats[0].objectCues[0].holdKind = "standard";
  writeJson(thoughtfulTranscriptPath, shortEvolutionTranscript);
  writeJson(thoughtfulBeatMapPath, nonCausalEvolutionFixture);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /evolve.*causal-sequence/i);
  writeJson(thoughtfulBeatMapPath, shortEvolutionFixture);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /evolve.*2\.4.*4\.5/i);
  writeJson(thoughtfulTranscriptPath, originalThoughtfulTranscript);
  const longEvolutionDesign = readJson(design);
  longEvolutionDesign.motionProfiles["thoughtful-editorial-v1"].cueTiming.maxExitAfterTriggerFrames = 60;
  longEvolutionDesign.motionProfiles["thoughtful-editorial-v1"].cueTiming.maxVisibleFramesByHoldKind["causal-sequence"] = 360;
  const longEvolutionDesignPath = path.join(temporaryRoot, "long-evolution-design-system.json");
  writeJson(longEvolutionDesignPath, longEvolutionDesign);
  const longEvolutionFixture = structuredClone(visualOrchestrationV2Fixture);
  longEvolutionFixture.beats[0].objectCues[0].invisibleFrame = 330;
  writeJson(thoughtfulBeatMapPath, longEvolutionFixture);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, longEvolutionDesignPath], false, /evolve.*2\.4.*4\.5/i);

  const v2NoneFixture = structuredClone(visualOrchestrationV2Fixture);
  Object.assign(v2NoneFixture.beats[0], {
    mgScope: "none",
    recipe: "caption-only",
    components: [],
    microEvents: [],
    noMgReason: "The subtitles already preserve the complete point without another visual object."
  });
  delete v2NoneFixture.beats[0].motionProfile;
  delete v2NoneFixture.beats[0].surfaceTreatment;
  delete v2NoneFixture.beats[0].visualDecision;
  const writeV2NoneMutation = (mutate, error = null) => {
    const fixture = structuredClone(v2NoneFixture);
    mutate(fixture);
    writeJson(thoughtfulBeatMapPath, fixture);
    script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], error === null, error);
  };
  writeV2NoneMutation((fixture) => { fixture.beats[0].visualDecision = visualOrchestrationV2Fixture.beats[0].visualDecision; }, /mgScope none.*visualDecision/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: "The entire beat is caption-only." }];
  }, /coveredNoneBeatIds/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: "The entire beat is caption-only.", coveredNoneBeatIds: ["unknown-beat"] }];
  }, /coveredNoneBeatIds.*V2 none beat/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: "The entire beat is caption-only.", coveredNoneBeatIds: ["thoughtful-001", "thoughtful-001"] }];
  }, /coveredNoneBeatIds.*unique/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1.1, end: 5.5, reason: "The entire beat is caption-only.", coveredNoneBeatIds: ["thoughtful-001"] }];
  }, /must fully cover/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: "The entire beat is caption-only.", coveredNoneBeatIds: ["thoughtful-001"] }];
  });
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: " ", coveredNoneBeatIds: ["thoughtful-001"] }];
  }, /V2 mgCadenceExceptions.*reason/i);
  writeV2NoneMutation((fixture) => {
    fixture.mgCadenceExceptions = { start: 1 };
  }, /V2 mgCadenceExceptions must be an array/i);
  writeV2Mutation("exception-overlaps-local", (fixture) => {
    fixture.beats.push({ ...v2NoneFixture.beats[0], id: "v2-none-beat", reuseSource: true });
    fixture.beats[0].reuseSource = true;
    fixture.mgCadenceExceptions = [{ start: 1, end: 5.5, reason: "The full second beat is caption-only.", coveredNoneBeatIds: ["v2-none-beat"] }];
  }, /overlaps a local MG passage/i);
  writeJson(thoughtfulBeatMapPath, thoughtfulFixture);
  const earlyThoughtfulCue = structuredClone(thoughtfulFixture);
  earlyThoughtfulCue.beats[0].objectCues[0].firstLegibleFrame = 59;
  writeJson(thoughtfulBeatMapPath, earlyThoughtfulCue);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /firstLegibleFrame.*trigger/i);
  const longThoughtfulCue = structuredClone(thoughtfulFixture);
  longThoughtfulCue.beats[0].objectCues[0].exitTriggerWordId = "thoughtful-001:word-003";
  longThoughtfulCue.beats[0].objectCues[0].invisibleFrame = 312;
  writeJson(thoughtfulBeatMapPath, longThoughtfulCue);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /holdKind.*maximum/i);
  const evidenceWithoutMaterial = structuredClone(thoughtfulFixture);
  evidenceWithoutMaterial.beats[0].surfaceTreatment = "evidence-surface";
  writeJson(thoughtfulBeatMapPath, evidenceWithoutMaterial);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /evidence-surface.*material/i);
  const directWithMaterial = structuredClone(thoughtfulFixture);
  const thoughtfulEvidencePath = path.join(temporaryRoot, "input", "evidence", "fixture-evidence.png");
  fs.mkdirSync(path.dirname(thoughtfulEvidencePath), { recursive: true });
  fs.writeFileSync(thoughtfulEvidencePath, "thoughtful fixture evidence");
  directWithMaterial.beats[0].materialRefs = [{
    materialId: "fixture-evidence",
    role: "decorative",
    displayStartFrame: 60,
    displayEndFrame: 120,
    crop: "contain",
    masking: "none"
  }];
  directWithMaterial.materials = [{
    id: "fixture-evidence",
    path: "input/evidence/fixture-evidence.png",
    kind: "screenshot",
    sha256: sha256File(thoughtfulEvidencePath),
    sourceOrRights: "test fixture",
    privacyStatus: "approved",
    visibleFacts: ["Fixture evidence."],
    forbiddenInferences: ["No inference."]
  }];
  writeJson(thoughtfulBeatMapPath, directWithMaterial);
  script("check-visual-plan.mjs", [thoughtfulBeatMapPath, thoughtfulTranscriptPath, design], false, /direct-overlay.*materialRefs|materialRefs.*evidence-surface/i);
  writeJson(thoughtfulBeatMapPath, thoughtfulFixture);

  const cadenceDesign = readJson(design);
  cadenceDesign.subtitleMgCadence = {
    minimumDurationSeconds: 20,
    targetIntervalSeconds: 10,
    minimumPassageSeparationSeconds: 7,
    maximumUnexplainedGapSeconds: 12
  };
  const cadenceDesignPath = path.join(temporaryRoot, "cadence-design-system.json");
  writeJson(cadenceDesignPath, cadenceDesign);
  const buildCadenceFixture = (starts = [0, 10, 20, 30, 40, 50], captionOnlyIndices = [], mgCadenceExceptions = []) => {
    const segments = starts.map((start, index) => ({
      id: `cadence-${String(index + 1).padStart(3, "0")}`,
      text: `口播片段${index + 1}`,
      start,
      end: Math.min(start + 10, 60),
      confidence: 1,
      words: [
        { text: "语义", start, end: start + 0.2, confidence: 1 },
        { text: "节点", start: start + 0.2, end: start + 0.5, confidence: 1 },
        { text: "说明", start: start + 1.2, end: start + 1.6, confidence: 1 }
      ]
    }));
    const beats = segments.map((segment, index) => {
      const captionOnlyBeat = captionOnlyIndices.includes(index);
      const id = `cadence-beat-${String(index + 1).padStart(3, "0")}`;
      return {
        id,
        sceneId: "cadence-test",
        sourceSegmentIds: [segment.id],
        text: `结构节点${index + 1}`,
        start: segment.start,
        end: segment.end,
        audioAnchorTime: segment.start,
        axis: captionOnlyBeat ? "A" : "B",
        recipe: captionOnlyBeat ? "caption-only" : "b-axis-showcase",
        mgScope: captionOnlyBeat ? "none" : "local",
        captionSafeZonePass: true,
        intent: "Cadence fixture keeps the spoken segment covered.",
        copyException: "Caption wording is carried by timed subtitles.",
        onScreenCopy: [`节点${index + 1}`],
        captionCueIds: [`caption-${String(index + 1).padStart(4, "0")}`],
        visualStyle: `节点 ${index + 1} 的结构提示。`,
        primaryFlowAxis: "horizontal",
        visualReference: `proposal:cadence-${index + 1}`,
        semanticTopology: "emphasis",
        entryAnchorWordId: `${segment.id}:word-001`,
        exitAnchorWordId: `${segment.id}:word-003`,
        exitAnchorOffsetFrames: 0,
        viewerQuestion: "What structure should the viewer retain here?",
        supportRole: "organization",
        removalLoss: "The viewer loses the current structural anchor.",
        visualEncoding: "A compact structural marker isolates the current step.",
        stillFrameValue: "The current step remains identifiable at a pause.",
        attentionCost: "low",
        factualClaims: [],
        terms: [],
        motionFamily: "technical",
        transitionFamily: `cadence-${index + 1}`,
        microEvents: captionOnlyBeat ? [] : [
          { time: segment.start + 0.3, type: "marker", semanticChange: "Current structural marker appears", visualRole: "indicator" }
        ],
        layout: {
          primaryOccupancyRatio: 0.38,
          primaryBoundsNormalized: { x: 0.08, y: 0.22, width: 0.84, height: 0.38 },
          supportingElementCount: captionOnlyBeat ? 0 : 1,
          emptyComponentCount: 0,
          panelPaddingPx: 56,
          safeAreaPass: true,
          faceCover: index === 0 ? "partial" : "none",
          focalPlacement: "center",
          focalPlacementRationale: "Center placement gives the current structural relation one feed-scale focal point.",
          ...(index === 0 ? { faceCoverRationale: "The current relation is clearest at the central focal point." } : {})
        },
        typography: {
          fontFamily: "Smiley Sans",
          role: "primary",
          fontSizePx: 104,
          lineHeight: 0.98,
          maxLines: 1,
          outlineReservePx: 20
        },
        components: captionOnlyBeat ? [] : ["structural marker"],
        entranceFrames: 8,
        exitFrames: 6,
        staticHoldReason: "This fixture holds its resolved structural marker until the next semantic passage."
      };
    });
    return {
      transcript: { revision: 1, language: "zh-CN", duration: 60, source: "fixture", segments },
      beatMap: { duration: 60, fps: 30, captionMode: "subtitles", designSystem: "state/design-system.json", mgCadenceExceptions, beats }
    };
  };
  const writeCadenceFixture = (name, ...argumentsList) => {
    const fixture = buildCadenceFixture(...argumentsList);
    const transcriptPath = path.join(temporaryRoot, `${name}-transcript.json`);
    const beatMapPath = path.join(temporaryRoot, `${name}-beat-map.json`);
    writeJson(transcriptPath, fixture.transcript);
    writeJson(beatMapPath, fixture.beatMap);
    return { fixture, transcriptPath, beatMapPath };
  };
  const cadenceValid = writeCadenceFixture("cadence-valid");
  script("check-visual-plan.mjs", [cadenceValid.beatMapPath, cadenceValid.transcriptPath, cadenceDesignPath]);

  const cadenceTooFew = writeCadenceFixture("cadence-too-few", undefined, [5]);
  script("check-visual-plan.mjs", [cadenceTooFew.beatMapPath, cadenceTooFew.transcriptPath, cadenceDesignPath], false, /cadence.*requires|requires.*cadence/i);
  const cadenceClustered = writeCadenceFixture("cadence-clustered", [0, 6, 16, 26, 36, 48]);
  script("check-visual-plan.mjs", [cadenceClustered.beatMapPath, cadenceClustered.transcriptPath, cadenceDesignPath], false, /7.*seconds|passage.*separation/i);
  const cadenceLongGap = writeCadenceFixture("cadence-long-gap", [0, 10, 20, 30, 45, 55]);
  script("check-visual-plan.mjs", [cadenceLongGap.beatMapPath, cadenceLongGap.transcriptPath, cadenceDesignPath], false, /unexplained.*gap|gap.*unexplained/i);
  const cadenceException = writeCadenceFixture(
    "cadence-exception",
    undefined,
    [5],
    [{ start: 41.8, end: 60, reason: "The closing recap has no additional visual information gain." }]
  );
  script("check-visual-plan.mjs", [cadenceException.beatMapPath, cadenceException.transcriptPath, cadenceDesignPath]);
  const cadenceOverlappingException = writeCadenceFixture(
    "cadence-overlapping-exception",
    undefined,
    [],
    [{ start: 0, end: 1, reason: "This must not overlap the first local passage." }]
  );
  script("check-visual-plan.mjs", [cadenceOverlappingException.beatMapPath, cadenceOverlappingException.transcriptPath, cadenceDesignPath], false, /overlaps a local MG passage/i);
  const cadenceOverlappingExceptions = writeCadenceFixture(
    "cadence-overlapping-exceptions",
    undefined,
    [5],
    [
      { start: 41.8, end: 52, reason: "First documented closing exception." },
      { start: 50, end: 60, reason: "Second exception must not overlap the first." }
    ]
  );
  script("check-visual-plan.mjs", [cadenceOverlappingExceptions.beatMapPath, cadenceOverlappingExceptions.transcriptPath, cadenceDesignPath], false, /mgCadenceExceptions must not overlap/i);
  const missingFocalPlacementValue = writeCadenceFixture("cadence-missing-focal-value");
  delete missingFocalPlacementValue.fixture.beatMap.beats[0].layout.focalPlacement;
  writeJson(missingFocalPlacementValue.beatMapPath, missingFocalPlacementValue.fixture.beatMap);
  script("check-visual-plan.mjs", [missingFocalPlacementValue.beatMapPath, missingFocalPlacementValue.transcriptPath, cadenceDesignPath], false, /focal placement center or side/i);
  const missingFocalPlacement = writeCadenceFixture("cadence-missing-focal");
  delete missingFocalPlacement.fixture.beatMap.beats[0].layout.focalPlacementRationale;
  writeJson(missingFocalPlacement.beatMapPath, missingFocalPlacement.fixture.beatMap);
  script("check-visual-plan.mjs", [missingFocalPlacement.beatMapPath, missingFocalPlacement.transcriptPath, cadenceDesignPath], false, /focal.*rationale/i);
  const missingFaceRationale = writeCadenceFixture("cadence-missing-face-rationale");
  delete missingFaceRationale.fixture.beatMap.beats[0].layout.faceCoverRationale;
  writeJson(missingFaceRationale.beatMapPath, missingFaceRationale.fixture.beatMap);
  script("check-visual-plan.mjs", [missingFaceRationale.beatMapPath, missingFaceRationale.transcriptPath, cadenceDesignPath], false, /face.*rationale/i);

  const longIntentionalFaceCover = readJson(validMotion);
  longIntentionalFaceCover.beats = [{
    ...longIntentionalFaceCover.beats[0],
    sourceSegmentIds: ["seg-001", "seg-002"],
    text: "看看这些特效看看这些动画",
    start: 0,
    end: 3.2,
    audioAnchorTime: 0,
    axis: "A",
    entryAnchorWordId: "seg-001:word-001",
    exitAnchorWordId: "seg-002:word-003",
    exitAnchorOffsetFrames: 0,
    layout: { ...longIntentionalFaceCover.beats[0].layout, faceCover: "intentional" },
    staticHoldReason: "The evidence needs a continuous reading hold."
  }];
  const longIntentionalFaceCoverPath = path.join(temporaryRoot, "long-intentional-face-cover.json");
  writeJson(longIntentionalFaceCoverPath, longIntentionalFaceCover);
  script("check-visual-plan.mjs", [longIntentionalFaceCoverPath, transcript, design]);

  const mutationCases = [
    {
      name: "duplicate-caption-copy",
      source: validSubtitles,
      mutate: (map) => { map.beats[0].text = "看看这些特效"; },
      error: /duplicating caption copy/
    },
    {
      name: "global-subtitle-mg",
      source: validSubtitles,
      mutate: (map) => { map.beats[0].mgScope = "global"; },
      error: /mgScope/
    },
    {
      name: "missing-cognition-gap",
      source: validSubtitles,
      mutate: (map) => { delete map.beats[0].viewerQuestion; },
      error: /viewerQuestion/
    },
    {
      name: "missing-copy",
      source: validSubtitles,
      mutate: (map) => { delete map.beats[0].onScreenCopy; },
      error: /onScreenCopy/
    },
    {
      name: "late-entry",
      source: validMotion,
      mutate: (map) => { map.beats[0].microEvents[0].time = 0.8; },
      error: /first meaningful event/
    },
    {
      name: "bad-topology",
      source: validMotion,
      mutate: (map) => { map.beats[0].semanticTopology = "convergence"; },
      error: /convergence/
    }
  ];
  for (const testCase of mutationCases) {
    const fixture = readJson(testCase.source);
    testCase.mutate(fixture);
    const target = path.join(temporaryRoot, `${testCase.name}.json`);
    writeJson(target, fixture);
    script("check-visual-plan.mjs", [target, transcript, design], false, testCase.error);
  }

  const captionOnly = readJson(validSubtitles);
  for (const beat of captionOnly.beats) {
    Object.assign(beat, { mgScope: "none", recipe: "caption-only", axis: "A", components: [], microEvents: [] });
  }
  const captionOnlyPath = path.join(temporaryRoot, "caption-only.json");
  writeJson(captionOnlyPath, captionOnly);
  script("check-visual-plan.mjs", [captionOnlyPath, transcript, design]);
  const reviewTimes = script("review-times.mjs", [captionOnlyPath]).stdout.trim().split(",");
  assert.equal(reviewTimes.length, 3);

  const job = path.join(temporaryRoot, "caption-job");
  fs.mkdirSync(path.join(job, "captions"), { recursive: true });
  fs.mkdirSync(path.join(job, "state"), { recursive: true });
  const captions = path.join(job, "captions", "captions.json");
  const pages = path.join(job, "captions", "chatcut-pages.json");
  const reviewPlan = path.join(job, "captions", "caption-review-plan.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "captions.approved-semantic.example.json"), captions);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "chatcut-caption-pages.example.json"), pages);
  fs.copyFileSync(transcript, path.join(job, "state", "transcript.json"));
  const approvedPlan = readJson(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"));
  approvedPlan.status = "approved";
  writeJson(reviewPlan, approvedPlan);
  script("check-captions.mjs", [captions, pages, design]);

  const composition = path.join(job, "caption-fixture.html");
  fs.writeFileSync(
    composition,
    "<!doctype html><html><body><!-- CUT_MOTION_CAPTIONS_START --><!-- CUT_MOTION_CAPTIONS_END --></body></html>\n"
  );
  script("install-captions.mjs", [captions, composition, design]);
  script("install-captions.mjs", [captions, composition, design]);
  script("check-captions.mjs", [captions, pages, design, composition]);

  const boldCaptions = readJson(captions);
  boldCaptions.style.fontWeight = 700;
  const boldPath = path.join(job, "captions", "bold.json");
  writeJson(boldPath, boldCaptions);
  script("check-captions.mjs", [boldPath, pages, design], false, /normal weight 400/);

  const legacyCaptions = readJson(captions);
  legacyCaptions.source.kind = "chatcut-viewer-pages";
  const legacyPath = path.join(job, "captions", "legacy.json");
  writeJson(legacyPath, legacyCaptions);
  script("check-captions.mjs", [legacyPath, pages, design], false, /approved semantic plan/);

  console.log("Planning contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
