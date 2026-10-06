import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildComposition, clippedContentRect, findContentCollision, rebuildVisualSample } from "./build-composition.mjs";
import { quantizeFrameWindow } from "./frame-window-utils.mjs";
import { sha256File } from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(repositoryRoot, "templates", "hyperframes");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-composition-"));
const chromeExecutable = [
  process.env.CUT_MOTION_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((candidate) => candidate && fs.existsSync(candidate));

const assertChromeMotionContract = (compositionPath, label, expectedResult = "pass") => {
  if (!chromeExecutable) return;
  const probePath = path.join(path.dirname(compositionPath), "thoughtful-runtime-probe.html");
  const source = fs.readFileSync(compositionPath, "utf8").replace("</body>", `
    <script>
      try {
        window.__motionContract();
        document.documentElement.dataset.thoughtfulRuntimeProbe = "pass";
      } catch (error) {
        document.documentElement.dataset.thoughtfulRuntimeProbe = String(error && error.message || error);
      }
    </script>
  </body>`);
  fs.writeFileSync(probePath, source);
  const result = spawnSync(chromeExecutable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--virtual-time-budget=1000",
    "--dump-dom",
    pathToFileURL(probePath).href
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${label}: Chrome probe failed: ${result.stderr || result.error?.message || "unknown failure"}`);
  assert.ok(result.stdout.includes(`data-thoughtful-runtime-probe="${expectedResult}"`), `${label}: Chrome motion contract failed: ${result.stdout}`);
};

const writeFixture = (name = "job") => {
  const jobRoot = path.join(temporaryRoot, name);
  const hyperframes = path.join(jobRoot, "hyperframes");
  fs.mkdirSync(path.join(jobRoot, "state"), { recursive: true });
  fs.cpSync(templateRoot, hyperframes, { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "state", "beat-map.json"), JSON.stringify({
    duration: 2.01,
    fps: 30,
    beats: [{
      id: "beat-001",
      start: 1,
      end: 1.5,
      entryAnchorWordId: "segment-001:word-001",
      exitAnchorWordId: "segment-001:word-002",
      exitAnchorOffsetFrames: 0,
      exitFrames: 3
    }]
  }));
  fs.writeFileSync(path.join(jobRoot, "state", "transcript.json"), JSON.stringify({
    segments: [{
      id: "segment-001",
      words: [
        { text: "一", start: 1, end: 1.1 },
        { text: "二", start: 1.1, end: 1.4 }
      ]
    }]
  }));
  const moduleDirectory = path.join(hyperframes, "mg", "beat-001");
  fs.mkdirSync(moduleDirectory, { recursive: true });
  fs.writeFileSync(path.join(moduleDirectory, "fragment.html"), '<div data-beat-id="beat-001"><span class="copy">内容</span></div>');
  fs.writeFileSync(path.join(moduleDirectory, "style.css"), 'body, .copy { color: white; }\n.copy { content: "}"; }');
  fs.writeFileSync(path.join(moduleDirectory, "timeline.mjs"), 'timeline.set(root, { autoAlpha: 1 }, beat.start);');

  const templatePath = path.join(hyperframes, "index.template.html");
  const captions = [
    '<section class="clip motion-caption-layer" style="--caption-bottom: 384px" data-caption-id="cue-001" data-caption-start-frame="0" data-caption-end-frame="15" data-start="0" data-duration="0.5"></section>',
    '<section class="clip motion-caption-layer" style="--caption-bottom: 384px" data-caption-id="cue-boundary" data-caption-start-frame="15" data-caption-end-frame="30" data-start="0.5" data-duration="0.5"></section>',
    '<section class="clip motion-caption-layer" style="--caption-bottom: 384px" data-caption-id="cue-002" data-caption-start-frame="30" data-caption-end-frame="45" data-start="1" data-duration="0.5"></section>'
  ].join("\n");
  fs.writeFileSync(
    templatePath,
    fs.readFileSync(templatePath, "utf8").replace("<!-- CUT_MOTION_CAPTIONS_START -->", `<!-- CUT_MOTION_CAPTIONS_START -->\n${captions}`)
  );
  return { jobRoot, hyperframes, moduleDirectory };
};

try {
  assert.deepEqual(
    quantizeFrameWindow(0.033333, 0.066667, 30, 100),
    { startFrame: 1, endFrame: 2 }
  );
  assert.deepEqual(
    quantizeFrameWindow((1 - 0.0005) / 30, (2 + 0.0005) / 30, 30, 100),
    { startFrame: 0, endFrame: 3 },
    "genuine sub-frame bounds must retain outward quantization"
  );
  const contentElement = (rect, { text = "", role, intentional = false } = {}) => ({
    textContent: text,
    dataset: { ...(role ? { motionRole: role } : {}), ...(intentional ? { overlapPolicy: "intentional" } : {}) },
    getBoundingClientRect: () => rect
  });
  const textElement = contentElement(
    { left: 10, right: 110, top: 10, bottom: 60 },
    { text: "入门够用" }
  );
  const collidingIndicator = contentElement(
    { left: 90, right: 130, top: 20, bottom: 60 },
    { text: "✓", role: "indicator" }
  );
  assert.ok(findContentCollision([textElement, collidingIndicator]), "text and indicator overlap must fail");
  assert.equal(findContentCollision([
    textElement,
    contentElement(
      { left: 90, right: 130, top: 20, bottom: 60 },
      { text: "✓", role: "indicator", intentional: true }
    )
  ]), null, "intentional overlap must be explicitly exempted");
  assert.equal(findContentCollision([
    textElement,
    contentElement({ left: 130, right: 170, top: 20, bottom: 60 }, { role: "indicator" })
  ]), null, "separate content must pass");

  assert.equal(fs.existsSync(path.join(templateRoot, "index.html")), false, "generated template output must not be tracked");
  const fixture = writeFixture();

  const b01BuildBypassFixture = writeFixture("b01-build-bypass");
  const b01BuildBypassBeatMapPath = path.join(b01BuildBypassFixture.jobRoot, "state", "beat-map.json");
  const b01BuildBypassBeatMap = JSON.parse(fs.readFileSync(b01BuildBypassBeatMapPath, "utf8"));
  b01BuildBypassBeatMap.visualOrchestrationVersion = 1;
  b01BuildBypassBeatMap.beats[0].id = "b01";
  b01BuildBypassBeatMap.beats[0].mgScope = "local";
  fs.writeFileSync(b01BuildBypassBeatMapPath, JSON.stringify(b01BuildBypassBeatMap));
  fs.renameSync(path.join(b01BuildBypassFixture.hyperframes, "mg", "beat-001"), path.join(b01BuildBypassFixture.hyperframes, "mg", "b01"));
  fs.writeFileSync(path.join(b01BuildBypassFixture.hyperframes, "mg", "b01", "fragment.html"), '<div data-beat-id="b01"><span class="copy">内容</span></div>');
  fs.writeFileSync(path.join(b01BuildBypassFixture.jobRoot, "state", "workflow.json"), JSON.stringify({ visualArrangementReviewRequired: true }));
  assert.throws(() => buildComposition(b01BuildBypassFixture.hyperframes), /b01.*motionProfile.*thoughtful-editorial-v1/i, "b01: direct composition must not bypass the flagged V1 profile requirement");

  const b01V2BuildBypassFixture = writeFixture("b01-v2-build-bypass");
  const b01V2BuildBypassBeatMapPath = path.join(b01V2BuildBypassFixture.jobRoot, "state", "beat-map.json");
  const b01V2BuildBypassBeatMap = JSON.parse(fs.readFileSync(b01V2BuildBypassBeatMapPath, "utf8"));
  b01V2BuildBypassBeatMap.visualOrchestrationVersion = 2;
  b01V2BuildBypassBeatMap.beats[0].id = "b01-v2";
  b01V2BuildBypassBeatMap.beats[0].mgScope = "local";
  fs.writeFileSync(b01V2BuildBypassBeatMapPath, JSON.stringify(b01V2BuildBypassBeatMap));
  fs.renameSync(path.join(b01V2BuildBypassFixture.hyperframes, "mg", "beat-001"), path.join(b01V2BuildBypassFixture.hyperframes, "mg", "b01-v2"));
  fs.writeFileSync(path.join(b01V2BuildBypassFixture.hyperframes, "mg", "b01-v2", "fragment.html"), '<div data-beat-id="b01-v2"><span class="copy">内容</span></div>');
  fs.writeFileSync(path.join(b01V2BuildBypassFixture.jobRoot, "state", "workflow.json"), JSON.stringify({ visualArrangementReviewRequired: true }));
  assert.throws(() => buildComposition(b01V2BuildBypassFixture.hyperframes), /b01-v2.*motionProfile.*thoughtful-editorial-v1/i, "b01: direct composition must not bypass the flagged V2 profile requirement");

  const preciseBeatMapPath = path.join(fixture.jobRoot, "state", "beat-map.json");
  const standardBeatMap = fs.readFileSync(preciseBeatMapPath, "utf8");
  fs.writeFileSync(preciseBeatMapPath, JSON.stringify({
    ...JSON.parse(standardBeatMap),
    duration: 195.116667,
    fps: 60
  }));
  assert.equal(buildComposition(fixture.hyperframes).endFrame, 11707);
  fs.writeFileSync(preciseBeatMapPath, standardBeatMap);

  const full = buildComposition(fixture.hyperframes);
  assert.deepEqual(
    { startFrame: full.startFrame, endFrame: full.endFrame, duration: full.duration },
    { startFrame: 0, endFrame: 61, duration: 61 / 30 }
  );
  const fullHtml = fs.readFileSync(full.outputPath, "utf8");
  assert.doesNotMatch(fullHtml, /motion_contract_face_cover_duration/);
  assert.match(fullHtml, /^<!doctype html>\n<!-- GENERATED BY /i);
  assert.match(fullHtml, /@scope \(#mg-beat-001\) \{\nbody, \.copy/);
  assert.match(fullHtml, /id="mg-beat-001"/);
  assert.match(fullHtml, /motion_contract_content_collision/);
  assert.match(fullHtml, /\[data-motion-role="indicator"\]/);
  assert.match(fullHtml, /dataset\.overlapPolicy === "intentional"/);

  const chunkPath = path.join(fixture.hyperframes, "chunks", "f000030-f000060", "index.html");
  const chunk = buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, videoOnly: true, outputPath: chunkPath });
  assert.equal(chunk.duration, 1);
  const chunkHtml = fs.readFileSync(chunkPath, "utf8");
  assert.doesNotMatch(chunkHtml, /cue-001/);
  assert.doesNotMatch(chunkHtml, /cue-boundary/, "a cue ending at the chunk start frame must be excluded");
  assert.match(chunkHtml, /cue-002/);
  assert.match(chunkHtml, /src="\.\/assets\//);
  assert.doesNotMatch(chunkHtml, /\.\.\/assets/);
  assert.equal(fs.realpathSync(path.join(path.dirname(chunkPath), "assets")), fs.realpathSync(path.join(fixture.hyperframes, "assets")));
  assert.equal(
    fs.readFileSync(path.join(path.dirname(chunkPath), "caption.css"), "utf8"),
    fs.readFileSync(path.join(fixture.hyperframes, "caption.css"), "utf8")
  );

  const samplePath = path.join(fixture.hyperframes, "visual-sample", "index.html");
  const sample = buildComposition(fixture.hyperframes, {
    startFrame: 30,
    endFrame: 60,
    outputPath: samplePath
  });
  assert.deepEqual(sample.beatIds, ["beat-001"]);
  const sampleHtml = fs.readFileSync(samplePath, "utf8");
  assert.match(sampleHtml, /<span class="copy">内容<\/span>/);
  assert.doesNotMatch(sampleHtml, /cue-boundary/);
  assert.match(sampleHtml, /cue-002/);
  assert.equal(fs.realpathSync(path.join(path.dirname(samplePath), "assets")), fs.realpathSync(path.join(fixture.hyperframes, "assets")));
  assert.equal(
    fs.readFileSync(path.join(path.dirname(samplePath), "caption.css"), "utf8"),
    fs.readFileSync(path.join(fixture.hyperframes, "caption.css"), "utf8")
  );
  fs.writeFileSync(samplePath, sampleHtml.replace("</style>", ".manual-sample-patch { color: red; }</style>"));
  rebuildVisualSample(fixture.hyperframes);
  assert.equal(
    fs.readFileSync(samplePath, "utf8"),
    sampleHtml,
    "visual-sample advance rebuild must remove hand-authored sample-only changes"
  );
  const fragmentPath = path.join(fixture.moduleDirectory, "fragment.html");
  const originalFragment = fs.readFileSync(fragmentPath, "utf8");
  fs.writeFileSync(fragmentPath, originalFragment.replace("内容", "同源更新"));
  buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, outputPath: samplePath });
  assert.match(fs.readFileSync(samplePath, "utf8"), /同源更新/, "visual sample must rebuild from the canonical MG module");
  fs.writeFileSync(fragmentPath, originalFragment);

  const profileFixture = writeFixture("thoughtful-editorial");
  const profileBeatMapPath = path.join(profileFixture.jobRoot, "state", "beat-map.json");
  const profileBeatMap = JSON.parse(fs.readFileSync(profileBeatMapPath, "utf8"));
  Object.assign(profileBeatMap.beats[0], {
    mgScope: "local",
    motionProfile: "thoughtful-editorial-v1",
    surfaceTreatment: "direct-overlay",
    objectCues: [{
      id: "primary-copy",
      semanticRole: "primary-copy",
      spokenTriggerWordId: "segment-001:word-001",
      preMotionFrame: 27,
      firstLegibleFrame: 30,
      settledFrame: 35,
      exitTriggerWordId: "segment-001:word-002",
      invisibleFrame: 45,
      holdKind: "standard"
    }, {
      id: "later-copy",
      semanticRole: "supporting-copy",
      spokenTriggerWordId: "segment-001:word-002",
      preMotionFrame: 33,
      firstLegibleFrame: 33,
      settledFrame: 36,
      exitTriggerWordId: "segment-001:word-002",
      invisibleFrame: 45,
      holdKind: "standard"
    }]
  });
  profileBeatMap.visualOrchestrationVersion = 2;
  fs.writeFileSync(profileBeatMapPath, JSON.stringify(profileBeatMap));
  fs.writeFileSync(path.join(profileFixture.jobRoot, "state", "workflow.json"), JSON.stringify({ visualArrangementReviewRequired: true }));
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), path.join(profileFixture.jobRoot, "state", "design-system.json"));
  const profileFragmentPath = path.join(profileFixture.moduleDirectory, "fragment.html");
  const profileStylePath = path.join(profileFixture.moduleDirectory, "style.css");
  const profileTimelinePath = path.join(profileFixture.moduleDirectory, "timeline.mjs");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  fs.writeFileSync(profileStylePath, ".surface { color: white; }");
  const profileTimeline = [
    'motion.reveal("primary-copy", { from: { y: 12 }, settled: { y: 0 } });',
    'motion.reveal("later-copy", { from: { y: 12 }, settled: { y: 0 } });'
  ].join("\n");
  fs.writeFileSync(profileTimelinePath, profileTimeline);
  let profileBuild;
  assert.doesNotThrow(() => {
    profileBuild = buildComposition(profileFixture.hyperframes);
  }, "b01: a V2 local thoughtful-editorial profile must build through the existing scheduler");
  const profileHtml = fs.readFileSync(profileBuild.outputPath, "utf8");
  assert.match(profileHtml, /data-motion-profile="thoughtful-editorial-v1"/);
  assert.match(profileHtml, /data-motion-profile="thoughtful-editorial-v1"[^>]*style="visibility: hidden; opacity: 0"/);
  assert.match(profileHtml, /document\.querySelector\("#mg-beat-001"\)/, "thoughtful profiles must animate their generated visible wrapper, not its hidden structural child");
  assert.match(profileHtml, /const motion = Object\.freeze/);
  assert.match(profileHtml, /motion\.reveal\("primary-copy"/);
  assert.match(profileHtml, /motion\.reveal\("later-copy"/);
  assert.doesNotMatch(profileHtml, /querySelector(?:All)?\s*\(\s*`[^`]*\$\{/, "generated profile selectors must stay static for HyperFrames");
  assert.doesNotMatch(profileHtml, /timeline\.to\(root, \{ autoAlpha: 0, duration:/);
  const runtimeScript = [...profileHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
  assert.doesNotThrow(() => new Function(runtimeScript), "profile composition runtime must remain syntactically executable");
  const profileBlockStart = profileHtml.indexOf("// beat-001 (thoughtful-editorial-v1)");
  const profileBlock = profileHtml.slice(profileHtml.indexOf("{", profileBlockStart), profileHtml.indexOf("\n}\n", profileBlockStart) + 2);
  const profileNodes = new Map([
    ["primary-copy", { id: "primary-copy", dataset: { cueId: "primary-copy" } }],
    ["later-copy", { id: "later-copy", dataset: { cueId: "later-copy" } }]
  ]);
  const profileWrapper = {
    id: "mg-beat-001",
    querySelectorAll: (selector) => selector === "[data-cue-id]" ? [...profileNodes.values()] : []
  };
  const profileStructuralRoot = { id: "beat-001", querySelectorAll: () => [] };
  const profileOperations = [];
  const profileTimelineRecorder = {
    set(target, properties, position) {
      profileOperations.push({ kind: "set", target, properties, position });
      return this;
    },
    to(target, properties, position) {
      profileOperations.push({ kind: "to", target, properties, position });
      return this;
    }
  };
  new Function("document", "timeline", profileBlock)({
    querySelector: (selector) => selector === "#mg-beat-001" ? profileWrapper : profileStructuralRoot
  }, profileTimelineRecorder);
  const autoAlphaAt = (target, time, initialAutoAlpha = 1) => profileOperations
    .filter((operation) => operation.target === target && Object.hasOwn(operation.properties, "autoAlpha"))
    .sort((left, right) => left.position - right.position)
    .reduce((alpha, operation) => {
      const duration = operation.kind === "to" ? Number(operation.properties.duration ?? 0) : 0;
      return operation.position + duration <= time ? operation.properties.autoAlpha : alpha;
    }, initialAutoAlpha);
  assert.equal(
    profileOperations.some((operation) => (
      operation.kind === "to"
      && operation.target === profileNodes.get("primary-copy")
      && operation.properties.autoAlpha === 1
      && operation.position < 1
    )),
    false,
    "b09: a textual cue must not fade into legibility before its declared first-legible frame"
  );
  assert.ok(
    profileOperations.some((operation) => (
      operation.kind === "set"
      && operation.target === profileNodes.get("primary-copy")
      && operation.properties.autoAlpha === 1
      && operation.position === 1
    )),
    "b09: a textual cue must become visible at its declared first-legible frame"
  );
  assert.equal(autoAlphaAt(profileWrapper, 1, 0), 1, "earlier cue visibility window must make its generated hidden wrapper visible");
  assert.equal(autoAlphaAt(profileNodes.get("primary-copy"), 1), 1, "earlier cue must be legible at its factual frame");
  assert.equal(autoAlphaAt(profileNodes.get("later-copy"), 1), 0, "later cue must remain hidden before its own trigger");
  assert.equal(autoAlphaAt(profileNodes.get("later-copy"), 0), 0, "b20: every future cue must be hidden at local frame zero");
  assert.equal(autoAlphaAt(profileNodes.get("primary-copy"), 0.99), 0, "b09: a cue cannot become readable before its factual spoken-word frame");
  assert.equal(autoAlphaAt(profileWrapper, 1.49, 0), 1, "b01: wrapper must stay visible through the final cue instead of exiting early");
  const clippedProfilePath = path.join(profileFixture.hyperframes, "visual-sample", "index.html");
  const clippedProfileBuild = buildComposition(profileFixture.hyperframes, { startFrame: 31, endFrame: 45, outputPath: clippedProfilePath });
  const clippedProfileHtml = fs.readFileSync(clippedProfileBuild.outputPath, "utf8");
  const clippedProfileBlockStart = clippedProfileHtml.indexOf("// beat-001 (thoughtful-editorial-v1)");
  const clippedProfileBlock = clippedProfileHtml.slice(clippedProfileHtml.indexOf("{", clippedProfileBlockStart), clippedProfileHtml.indexOf("\n}\n", clippedProfileBlockStart) + 2);
  const clippedNodes = new Map([
    ["primary-copy", { id: "primary-copy", dataset: { cueId: "primary-copy" } }],
    ["later-copy", { id: "later-copy", dataset: { cueId: "later-copy" } }]
  ]);
  const clippedWrapper = {
    id: "mg-beat-001",
    querySelectorAll: (selector) => selector === "[data-cue-id]" ? [...clippedNodes.values()] : []
  };
  const clippedStructuralRoot = { id: "beat-001", querySelectorAll: () => [] };
  const clippedOperations = [];
  const clippedTimelineRecorder = {
    set(target, properties, position) {
      clippedOperations.push({ kind: "set", target, properties, position });
      return this;
    },
    to(target, properties, position) {
      clippedOperations.push({ kind: "to", target, properties, position });
      return this;
    }
  };
  new Function("document", "timeline", clippedProfileBlock)({
    querySelector: (selector) => selector === "#mg-beat-001" ? clippedWrapper : clippedStructuralRoot
  }, clippedTimelineRecorder);
  const clippedAutoAlphaAt = (target, time, initialAutoAlpha = 1) => clippedOperations
    .filter((operation) => operation.target === target && Object.hasOwn(operation.properties, "autoAlpha"))
    .sort((left, right) => left.position - right.position)
    .reduce((alpha, operation) => {
      const duration = operation.kind === "to" ? Number(operation.properties.duration ?? 0) : 0;
      return operation.position + duration <= time ? operation.properties.autoAlpha : alpha;
    }, initialAutoAlpha);
  assert.equal(clippedAutoAlphaAt(clippedWrapper, 31 / 30, 0), 1, "b20: a nonzero visual sample must preserve an already-active wrapper at its first frame");
  assert.equal(clippedAutoAlphaAt(clippedNodes.get("primary-copy"), 31 / 30), 1, "b20: a nonzero visual sample must preserve an already-legible cue at its first frame");
  assert.equal(clippedAutoAlphaAt(clippedNodes.get("later-copy"), 31 / 30), 0, "b20: a future cue remains hidden when another cue is already visible in a clipped sample");
  const tailProfileBuild = buildComposition(profileFixture.hyperframes, {
    startFrame: 43,
    endFrame: 45,
    outputPath: path.join(profileFixture.hyperframes, "chunks", "b20-tail", "index.html")
  });
  const tailProfileHtml = fs.readFileSync(tailProfileBuild.outputPath, "utf8");
  const tailProfileBlockStart = tailProfileHtml.indexOf("// beat-001 (thoughtful-editorial-v1)");
  const tailProfileBlock = tailProfileHtml.slice(tailProfileHtml.indexOf("{", tailProfileBlockStart), tailProfileHtml.indexOf("\n}\n", tailProfileBlockStart) + 2);
  const tailNodes = new Map([
    ["primary-copy", { id: "primary-copy", dataset: { cueId: "primary-copy" } }],
    ["later-copy", { id: "later-copy", dataset: { cueId: "later-copy" } }]
  ]);
  const tailWrapper = { id: "mg-beat-001", querySelectorAll: (selector) => selector === "[data-cue-id]" ? [...tailNodes.values()] : [] };
  const tailStructuralRoot = { id: "beat-001", querySelectorAll: () => [] };
  const tailOperations = [];
  const tailTimelineRecorder = {
    set(target, properties, position) { tailOperations.push({ kind: "set", target, properties, position }); return this; },
    to(target, properties, position) { tailOperations.push({ kind: "to", target, properties, position }); return this; }
  };
  new Function("document", "timeline", tailProfileBlock)({
    querySelector: (selector) => selector === "#mg-beat-001" ? tailWrapper : tailStructuralRoot
  }, tailTimelineRecorder);
  const tailAutoAlphaAt = (target, time, initialAutoAlpha = 1) => tailOperations
    .filter((operation) => operation.target === target && Object.hasOwn(operation.properties, "autoAlpha"))
    .sort((left, right) => left.position - right.position)
    .reduce((alpha, operation) => {
      const duration = operation.kind === "to" ? Number(operation.properties.duration ?? 0) : 0;
      return operation.position + duration <= time ? operation.properties.autoAlpha : alpha;
    }, initialAutoAlpha);
  assert.equal(tailAutoAlphaAt(tailWrapper, 43 / 30, 0), 1, "b20: the generated wrapper remains visible at the tail of its final cue");
  assert.equal(
    tailAutoAlphaAt(tailNodes.get("later-copy"), 44 / 30),
    1,
    "b20: a cue ending at a half-open output boundary must remain opaque on its final encoded frame"
  );
  assert.equal(
    tailAutoAlphaAt(tailNodes.get("later-copy"), 45 / 30),
    0,
    "b20: a terminal cue must hide at the exclusive output boundary"
  );
  const precisionFixture = writeFixture("thoughtful-frame-precision");
  const precisionBeatMapPath = path.join(precisionFixture.jobRoot, "state", "beat-map.json");
  const precisionBeatMap = JSON.parse(fs.readFileSync(precisionBeatMapPath, "utf8"));
  precisionBeatMap.fps = 60;
  Object.assign(precisionBeatMap.beats[0], {
    motionProfile: "thoughtful-editorial-v1",
    surfaceTreatment: "direct-overlay",
    objectCues: [{
      id: "precise-copy",
      semanticRole: "primary-copy",
      spokenTriggerWordId: "segment-001:word-001",
      preMotionFrame: 30,
      firstLegibleFrame: 31,
      settledFrame: 36,
      exitTriggerWordId: "segment-001:word-002",
      invisibleFrame: 45,
      holdKind: "standard"
    }]
  });
  fs.writeFileSync(precisionBeatMapPath, JSON.stringify(precisionBeatMap));
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), path.join(precisionFixture.jobRoot, "state", "design-system.json"));
  fs.writeFileSync(path.join(precisionFixture.moduleDirectory, "fragment.html"), '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="precise-copy">精确时点</span></div></div>');
  fs.writeFileSync(path.join(precisionFixture.moduleDirectory, "style.css"), ".surface { color: white; }");
  fs.writeFileSync(path.join(precisionFixture.moduleDirectory, "timeline.mjs"), 'motion.reveal("precise-copy", { from: { y: 12 }, settled: { y: 0 } });');
  const precisionHtml = fs.readFileSync(buildComposition(precisionFixture.hyperframes).outputPath, "utf8");
  assert.match(
    precisionHtml,
    /"firstLegible":0\.5166666666666667/,
    "thoughtful first-legible cues must retain their exact frame time"
  );
  const checkLayout = () => spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-layout-constraints.mjs"),
    profileBuild.outputPath,
    path.join(profileFixture.jobRoot, "state", "design-system.json")
  ], { encoding: "utf8" });
  const directOverlayLayout = checkLayout();
  assert.equal(directOverlayLayout.status, 0, `${directOverlayLayout.stdout}\n${directOverlayLayout.stderr}`);
  fs.writeFileSync(profileBuild.outputPath, profileHtml.replace(">内容</span>", ">甲<br>内容</span>"));
  const orphanBeforeBreak = checkLayout();
  assert.notEqual(orphanBeforeBreak.status, 0, "an explicit first line cannot leave a single Han character before its break");
  assert.match(orphanBeforeBreak.stderr, /one-character orphan/);
  fs.writeFileSync(profileBuild.outputPath, profileHtml);
  fs.writeFileSync(profileStylePath, ".surface { background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /background|filters/i, "b09: direct overlays cannot hide a dark or blurred backboard in their stylesheet");
  fs.writeFileSync(profileStylePath, ".surface { background/**/: rgba(0, 0, 0, 0.7); }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /background/i, "b09: CSS comments cannot hide a direct-overlay dark backboard declaration");
  fs.writeFileSync(profileStylePath, ".surface { box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.8); }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /box-shadow/i, "b09: a box-shadow dark board cannot bypass direct-overlay surface checks");
  fs.writeFileSync(profileStylePath, ".surface { position: fixed; }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /fixed positioning/i, "b09: a fixed surface cannot bypass the controlled profile layout");
  fs.writeFileSync(profileStylePath, ".surface { color: white; }");
  fs.writeFileSync(profileTimelinePath, "timeline.to(root, { autoAlpha: 0 });");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /controlled motion\.reveal/i);
  fs.writeFileSync(profileTimelinePath, profileTimeline);
  fs.writeFileSync(profileTimelinePath, profileTimeline.split("\n").map((line) => `// ${line}`).join("\n"));
  assert.throws(() => buildComposition(profileFixture.hyperframes), /runtime motion\.reveal|exactly once/i, "b09: comments must not satisfy the thoughtful profile runtime contract");
  fs.writeFileSync(profileTimelinePath, `if (false) {\n${profileTimeline}\n}`);
  assert.throws(() => buildComposition(profileFixture.hyperframes), /runtime motion\.reveal|only runtime/i, "b09: unreachable reveal calls must not satisfy the thoughtful profile runtime contract");
  for (const [invalidOptions, expected] of [
    ['{ from: { y: 12, repeat: 2 }, settled: { y: 0 } }', /repeat|allowed visual option/i],
    ['{ from: { y: 12, yoyo: true }, settled: { y: 0 } }', /yoyo|allowed visual option/i],
    ['{ from: { y: 12, callback: "nope" }, settled: { y: 0 } }', /callback|allowed visual option/i],
    ['{ from: { y: 12, keyframes: [] }, settled: { y: 0 } }', /keyframes|allowed visual option/i],
    ['{ from: { rotation: 5 }, settled: { y: 0 } }', /rotation|allowed visual option/i],
    ['{ from: { y: 12 }, settled: { y: 0, ease: "elastic.out(1, 0.3)" } }', /editorial ease|allowed visual option/i],
    ['{ from: { y: 12 }, settled: { y: 0, ease: "bounce.out" } }', /editorial ease|allowed visual option/i],
    ['{ from }', /explicit allowed visual properties|must be an object|static literal/i],
    ['{ from: { y: globalThis.sideEffect() } }', /explicit allowed visual properties|allowed visual option|static literal/i],
    ['{ from: { y: "x".constructor.constructor("return globalThis")().sideEffect() } }', /static literal|allowed visual option/i],
    ['{ from: { x: "random(-100,100)" } }', /static literal|allowed visual option/i],
    ['{ from: { y: 12, ease: "\\x65lastic.out(1, 0.3)" } }', /editorial ease|static literal/i]
  ]) {
    fs.writeFileSync(profileTimelinePath, [
      `motion.reveal("primary-copy", ${invalidOptions});`,
      'motion.reveal("later-copy", { from: { y: 12 }, settled: { y: 0 } });'
    ].join("\n"));
    assert.throws(() => buildComposition(profileFixture.hyperframes), expected, `b09: ${String(expected)} must not bypass the controlled reveal options`);
  }
  fs.writeFileSync(profileTimelinePath, profileTimeline);
  fs.writeFileSync(profileStylePath, ".surface { transition: opacity 10s; color: white; }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /CSS transition/i, "b09: CSS transitions cannot stretch builder-owned cue timing");
  fs.writeFileSync(profileStylePath, ".surface { color: white; }");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /exactly one.*direct-overlay/i, "thoughtful direct overlays require one declared surface");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div><div data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"></div></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /exactly one.*direct-overlay/i, "thoughtful direct overlays must reject multiple surfaces");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span></div><span data-motion-protected data-cue-id="later-copy">后续内容</span></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /cue.*inside.*direct-overlay|sole root child/i, "b09: every direct-overlay cue must stay inside its declared surface");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div><div style="position:fixed;inset:0;background:rgba(0,0,0,.9)"></div></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /inline style|sole root child/i, "b09: a hidden full-frame dark board cannot sit beside the checked direct surface");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#000"></rect></svg><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /cannot use SVG/i, "b09: a full-frame SVG dark board cannot bypass direct-overlay surface checks");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  const directMaterialBeatMap = JSON.parse(fs.readFileSync(profileBeatMapPath, "utf8"));
  directMaterialBeatMap.beats[0].materialRefs = [{ materialId: "unbound", role: "decorative", displayStartFrame: 27, displayEndFrame: 45, crop: "contain", masking: "none" }];
  fs.writeFileSync(profileBeatMapPath, JSON.stringify(directMaterialBeatMap));
  assert.throws(() => buildComposition(profileFixture.hyperframes), /direct-overlay.*materialRefs|materialRefs.*evidence-surface/i, "b09: direct-overlay materialRefs cannot bypass evidence source binding");
  directMaterialBeatMap.beats[0].materialRefs = [];
  fs.writeFileSync(profileBeatMapPath, JSON.stringify(directMaterialBeatMap));
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><img src="https://example.invalid/unbound.png" alt=""><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /direct-overlay.*source|source.*direct-overlay/i, "b09: direct-overlay cannot render an unbound source-bearing element");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><div class="surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="direct-overlay"><span data-motion-protected data-cue-id="primary-copy">内容</span><span data-motion-protected data-cue-id="later-copy">后续内容</span></div></div>');
  fs.writeFileSync(profileStylePath, "@keyframes drift { to { opacity: 1; } }");
  assert.throws(() => buildComposition(profileFixture.hyperframes), /CSS animation/i);
  fs.writeFileSync(profileStylePath, ".surface { color: white; }");
  fs.writeFileSync(profileFragmentPath, '<div data-beat-id="beat-001"><span data-cue-id="primary-copy">内容</span><span data-cue-id="primary-copy">重复</span></div>');
  assert.throws(() => buildComposition(profileFixture.hyperframes), /exactly one data-cue-id/i);

  const evidenceFixture = writeFixture("thoughtful-evidence");
  const evidenceBeatMapPath = path.join(evidenceFixture.jobRoot, "state", "beat-map.json");
  const evidenceInputPath = path.join(evidenceFixture.jobRoot, "input", "evidence", "registered.png");
  fs.mkdirSync(path.dirname(evidenceInputPath), { recursive: true });
  fs.writeFileSync(evidenceInputPath, "registered evidence fixture");
  const evidenceBeatMap = JSON.parse(fs.readFileSync(evidenceBeatMapPath, "utf8"));
  Object.assign(evidenceBeatMap, {
    visualOrchestrationVersion: 1,
    materials: [{
      id: "b20-evidence",
      path: "input/evidence/registered.png",
      kind: "screenshot",
      sha256: sha256File(evidenceInputPath),
      sourceOrRights: "test fixture",
      privacyStatus: "approved",
      visibleFacts: ["Registered evidence fixture."],
      forbiddenInferences: ["Do not infer anything beyond the fixture."]
    }]
  });
  Object.assign(evidenceBeatMap.beats[0], {
    motionProfile: "thoughtful-editorial-v1",
    surfaceTreatment: "evidence-surface",
    materialRefs: [{
      materialId: "b20-evidence",
      role: "primary-evidence",
      displayStartFrame: 30,
      displayEndFrame: 45,
      crop: "contain",
      masking: "none"
    }],
    objectCues: [{
      id: "evidence-copy",
      semanticRole: "evidence-copy",
      spokenTriggerWordId: "segment-001:word-001",
      preMotionFrame: 27,
      firstLegibleFrame: 30,
      settledFrame: 35,
      exitTriggerWordId: "segment-001:word-002",
      invisibleFrame: 45,
      holdKind: "evidence-reading"
    }]
  });
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(evidenceBeatMap));
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), path.join(evidenceFixture.jobRoot, "state", "design-system.json"));
  const evidenceFragmentPath = path.join(evidenceFixture.moduleDirectory, "fragment.html");
  const evidenceTimelinePath = path.join(evidenceFixture.moduleDirectory, "timeline.mjs");
  const evidenceSurface = '<div class="evidence-surface" data-motion-surface="container" data-border-policy="none" data-surface-kind="evidence-surface" data-evidence-surface-bounded="true" data-material-ids="b20-evidence"><img src="../input/evidence/registered.png" data-material-id="b20-evidence" alt=""><span data-motion-protected data-cue-id="evidence-copy">证据</span></div>';
  const evidenceFragment = `<div data-beat-id="beat-001">${evidenceSurface}</div>`;
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment);
  const evidenceStylePath = path.join(evidenceFixture.moduleDirectory, "style.css");
  const evidenceStyle = ".evidence-surface { overflow: hidden; background: rgba(255, 255, 255, 0.18); }";
  fs.writeFileSync(evidenceStylePath, evidenceStyle);
  fs.writeFileSync(evidenceTimelinePath, 'motion.reveal("evidence-copy", { from: { y: 12 }, settled: { y: 0 } });');
  fs.writeFileSync(path.join(evidenceFixture.hyperframes, "assets", "gsap.min.js"), `
    window.gsap = {
      timeline() {
        return {
          set() { return this; },
          to() { return this; },
          eventCallback() { return this; },
          totalTime() { return 0; }
        };
      }
    };
  `);
  const evidenceBuild = buildComposition(evidenceFixture.hyperframes);
  const evidenceBuildSource = fs.readFileSync(evidenceBuild.outputPath, "utf8");
  assert.match(evidenceBuildSource, /src="\.\/assets\/evidence\/registered\.png"/, "generated evidence must use a project-local runtime mirror");
  assert.doesNotMatch(evidenceBuildSource, /src="\.\.\/input\//, "generated evidence must not traverse above the HyperFrames project root");
  assertChromeMotionContract(evidenceBuild.outputPath, "b20: legal evidence profile must pass the real browser motion contract");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('<div data-beat-id="beat-001">', '<div class="ancestor-board" data-beat-id="beat-001">'));
  fs.writeFileSync(evidenceStylePath, `.ancestor-board { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`);
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /structural root|background|evidence-surface/i, "b20: a structural data-beat root cannot carry a visual board");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment);
  for (const [label, css, expected] of [
    ["data-beat selector", `[data-beat-id] { background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`, /structural data-beat root/i],
    ["generated wrapper selector", `#mg-beat-001 { background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`, /generated wrapper/i],
    ["pseudo carrier", `.evidence-surface::before { content: \"\"; background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`, /pseudo-elements/i],
    ["legacy pseudo carrier", `.evidence-surface:before { content: \"\"; background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`, /pseudo-elements/i]
  ]) {
    fs.writeFileSync(evidenceStylePath, css);
    assert.throws(() => buildComposition(evidenceFixture.hyperframes), expected, `b20: ${label} cannot create a structural visual carrier`);
  }
  fs.writeFileSync(evidenceStylePath, ".evidence-surface { overflow: hidden; background: rgba(255, 255, 255, 0.18); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.9); }");
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /box-shadow/i, "b20: an evidence surface cannot cast a full-frame dark board");
  fs.writeFileSync(evidenceStylePath, evidenceStyle);
  const evidenceMirrorPath = path.join(evidenceFixture.hyperframes, "assets", "evidence", "registered.png");
  const assertEvidenceSourceResolves = (compositionPath) => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const relativeSource = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(source)?.[1];
    assert.ok(relativeSource, "b20 composition must keep a real evidence image source");
    assert.equal(relativeSource, "./assets/evidence/registered.png", "b20 evidence must use the project-local mirror URL");
    assert.doesNotMatch(source, /\.\.\/input\//, "b20 generated HTML must not escape HyperFrames through an input path");
    const runtimeEvidencePath = path.resolve(path.dirname(compositionPath), relativeSource);
    assert.equal(fs.realpathSync(runtimeEvidencePath), fs.realpathSync(evidenceMirrorPath), "b20 sample and chunk assets must resolve through the canonical evidence mirror");
    assert.equal(sha256File(runtimeEvidencePath), sha256File(evidenceInputPath), "b20 runtime evidence mirror must match the registered input bytes");
    assert.equal(sha256File(runtimeEvidencePath), evidenceBeatMap.materials[0].sha256, "b20 runtime evidence mirror must retain the registered source hash");
  };
  assertEvidenceSourceResolves(evidenceBuild.outputPath);
  fs.writeFileSync(evidenceMirrorPath, "stale derived evidence mirror");
  buildComposition(evidenceFixture.hyperframes);
  assertEvidenceSourceResolves(evidenceBuild.outputPath);
  fs.unlinkSync(evidenceMirrorPath);
  fs.symlinkSync(path.join(evidenceFixture.jobRoot, "input", "evidence", "missing.png"), evidenceMirrorPath);
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /runtime evidence mirror.*regular|regular.*runtime evidence mirror/i, "b20: a symlink cannot replace a derived runtime evidence mirror");
  fs.unlinkSync(evidenceMirrorPath);
  buildComposition(evidenceFixture.hyperframes);
  const evidenceVisualSamplePath = path.join(evidenceFixture.hyperframes, "visual-sample", "index.html");
  const evidenceVisualSample = buildComposition(evidenceFixture.hyperframes, { startFrame: 30, endFrame: 45, outputPath: evidenceVisualSamplePath });
  assertEvidenceSourceResolves(evidenceVisualSample.outputPath);
  const evidenceChunkPath = path.join(evidenceFixture.hyperframes, "chunks", "b20", "index.html");
  const evidenceChunk = buildComposition(evidenceFixture.hyperframes, { startFrame: 30, endFrame: 45, outputPath: evidenceChunkPath });
  assertEvidenceSourceResolves(evidenceChunk.outputPath);
  const staleEvidenceRegistration = JSON.parse(fs.readFileSync(evidenceBeatMapPath, "utf8"));
  staleEvidenceRegistration.materials[0].sha256 = "0".repeat(64);
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(staleEvidenceRegistration));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /registered.*sha-?256|source.*hash|hash.*registered/i, "b20: the build must reject an evidence input that no longer matches its registered hash");
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(evidenceBeatMap));
  const collidingEvidenceInputPath = path.join(evidenceFixture.jobRoot, "input", "alternate", "registered.png");
  fs.mkdirSync(path.dirname(collidingEvidenceInputPath), { recursive: true });
  fs.writeFileSync(collidingEvidenceInputPath, "different evidence with the same runtime basename");
  const collidingEvidenceBeatMap = JSON.parse(fs.readFileSync(evidenceBeatMapPath, "utf8"));
  collidingEvidenceBeatMap.materials.push({
    id: "b20-colliding-evidence",
    path: "input/alternate/registered.png",
    kind: "screenshot",
    sha256: sha256File(collidingEvidenceInputPath),
    sourceOrRights: "test fixture",
    privacyStatus: "approved",
    visibleFacts: ["A separate fixture with the same basename."],
    forbiddenInferences: ["Do not infer anything beyond the fixture."]
  });
  collidingEvidenceBeatMap.beats[0].materialRefs.push({
    materialId: "b20-colliding-evidence",
    role: "secondary-evidence",
    displayStartFrame: 30,
    displayEndFrame: 45,
    crop: "contain",
    masking: "none"
  });
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(collidingEvidenceBeatMap));
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment
    .replace('data-material-ids="b20-evidence"', 'data-material-ids="b20-evidence,b20-colliding-evidence"')
    .replace('<span data-motion-protected', '<img src="../input/alternate/registered.png" data-material-id="b20-colliding-evidence" alt=""><span data-motion-protected'));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /runtime evidence mirror collision/i, "b20: different evidence files cannot collide on one runtime mirror basename");
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(evidenceBeatMap));
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment);
  const evidenceLayout = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-layout-constraints.mjs"),
    evidenceBuild.outputPath,
    path.join(evidenceFixture.jobRoot, "state", "design-system.json")
  ], { encoding: "utf8" });
  assert.equal(evidenceLayout.status, 0, `b20 evidence layout: ${evidenceLayout.stdout}\n${evidenceLayout.stderr}`);
  const ancestorBoardCompositionPath = path.join(evidenceFixture.hyperframes, "ancestor-board.html");
  fs.writeFileSync(ancestorBoardCompositionPath, fs.readFileSync(evidenceBuild.outputPath, "utf8")
    .replace('<div data-beat-id="beat-001">', '<div class="ancestor-board" data-beat-id="beat-001">')
    .replace(evidenceStyle, `.ancestor-board { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.9); }\n${evidenceStyle}`));
  const ancestorBoardLayout = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-layout-constraints.mjs"),
    ancestorBoardCompositionPath,
    path.join(evidenceFixture.jobRoot, "state", "design-system.json")
  ], { encoding: "utf8" });
  assert.notEqual(ancestorBoardLayout.status, 0, "b20: static layout validation must reject a visual structural root");
  assertChromeMotionContract(
    ancestorBoardCompositionPath,
    "b20: Chrome must reject a visual structural root",
    "motion_contract_profile_structural_root"
  );
  const evidenceShadowCompositionPath = path.join(evidenceFixture.hyperframes, "evidence-shadow.html");
  fs.writeFileSync(evidenceShadowCompositionPath, fs.readFileSync(evidenceBuild.outputPath, "utf8")
    .replace(evidenceStyle, ".evidence-surface { overflow: hidden; background: rgba(255, 255, 255, 0.18); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.9); }"));
  const evidenceShadowLayout = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-layout-constraints.mjs"),
    evidenceShadowCompositionPath,
    path.join(evidenceFixture.jobRoot, "state", "design-system.json")
  ], { encoding: "utf8" });
  assert.notEqual(evidenceShadowLayout.status, 0, "b20: static layout validation must reject a full-frame evidence shadow");
  assertChromeMotionContract(
    evidenceShadowCompositionPath,
    "b20: Chrome must reject a full-frame evidence shadow",
    "motion_contract_evidence_surface"
  );
  const evidenceFixedCompositionPath = path.join(evidenceFixture.hyperframes, "evidence-fixed.html");
  fs.writeFileSync(evidenceFixedCompositionPath, fs.readFileSync(evidenceBuild.outputPath, "utf8")
    .replace(evidenceStyle, ".evidence-surface { position: fixed; inset: 0; overflow: hidden; background: rgba(255, 255, 255, 0.18); }"));
  const evidenceFixedLayout = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-layout-constraints.mjs"),
    evidenceFixedCompositionPath,
    path.join(evidenceFixture.jobRoot, "state", "design-system.json")
  ], { encoding: "utf8" });
  assert.notEqual(evidenceFixedLayout.status, 0, "b20: static layout validation must reject a fixed evidence surface");
  assertChromeMotionContract(
    evidenceFixedCompositionPath,
    "b20: Chrome must reject a fixed evidence surface",
    "motion_contract_evidence_surface"
  );
  const motionContractTemplate = fs.readFileSync(path.join(templateRoot, "index.template.html"), "utf8");
  const motionContractStart = motionContractTemplate.indexOf("window.__motionContract =");
  const motionContractEnd = motionContractTemplate.indexOf("      window.__motionContract();", motionContractStart);
  const motionContractAssignment = motionContractTemplate.slice(motionContractStart, motionContractEnd);
  const runProfileMotionContract = ({ treatment, surfaces, materialIds = "", policy = {}, outsideElements = [], fragmentRootStyle = {} }) => {
    const root = {
      dataset: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1080, bottom: 1920, width: 1080, height: 1920 }),
      querySelectorAll: (selector) => selector === '[data-motion-profile="thoughtful-editorial-v1"]' ? [profileRoot] : []
    };
    const fragmentRoot = {
      dataset: { beatId: "beat-001" },
      ...fragmentRootStyle,
      children: [...surfaces, ...outsideElements],
      contains: (element) => element === fragmentRoot
        || surfaces.some((surface) => surface === element || surface.contains(element))
        || outsideElements.includes(element)
    };
    const profileRoot = {
      dataset: {
        surfaceTreatment: treatment,
        materialIds,
        evidenceSurfaceMaxAreaRatio: String(policy.maxAreaRatio ?? 0.28),
        evidenceSurfaceMaxOpacity: String(policy.maxOpacity ?? 0.28),
        evidenceSurfaceMaxBackdropBlurPx: String(policy.maxBackdropBlurPx ?? 8),
        evidenceSurfaceMinimumLightness: String(policy.minimumLightness ?? 0.55)
      },
      querySelectorAll: (selector) => selector === '[data-motion-surface="container"]'
        ? surfaces
        : selector === "[data-beat-id]" ? [fragmentRoot]
          : selector === "*" ? [fragmentRoot, ...surfaces.flatMap((surface) => [surface, ...(surface.children ?? [])]), ...outsideElements] : []
    };
    const document = {
      querySelector: (selector) => selector === "#root" ? root : null,
      querySelectorAll: (selector) => selector.startsWith('[data-motion-surface="container"]') ? surfaces : [],
      createElement: () => ({ style: {}, remove: () => {} }),
      body: { appendChild: () => {} }
    };
    const style = (element) => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      backgroundColor: element.backgroundColor ?? "transparent",
      backdropFilter: element.backdropFilter ?? "none",
      filter: element.filter ?? "none",
      backgroundImage: "none",
      overflow: element.overflow ?? (element.dataset?.surfaceKind === "evidence-surface" ? "hidden" : "visible"),
      overflowX: element.overflowX ?? element.overflow ?? (element.dataset?.surfaceKind === "evidence-surface" ? "hidden" : "visible"),
      overflowY: element.overflowY ?? element.overflow ?? (element.dataset?.surfaceKind === "evidence-surface" ? "hidden" : "visible"),
      position: element.position ?? "static",
      boxShadow: element.boxShadow ?? "none",
      textShadow: element.textShadow ?? "none",
      outlineWidth: element.outlineWidth ?? "0",
      outlineStyle: element.outlineStyle ?? "none",
      transform: element.transform ?? "none",
      borderTopWidth: "0",
      borderRightWidth: "0",
      borderBottomWidth: "0",
      borderLeftWidth: "0",
      fontSize: "48",
      getPropertyValue: () => ""
    });
    const window = {};
    new Function("window", "document", "getComputedStyle", "findContentCollision", "clippedContentRect", motionContractAssignment)(window, document, style, () => null, clippedContentRect);
    return window.__motionContract();
  };
  const profileSurface = (dataset, backgroundColor = "transparent", options = {}) => {
    const surface = {
      dataset,
    backgroundColor,
    overflow: options.overflow,
    boxShadow: options.boxShadow,
    textShadow: options.textShadow,
    outlineWidth: options.outlineWidth,
    outlineStyle: options.outlineStyle,
    transform: options.transform,
      children: options.children ?? [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }),
      querySelectorAll: (selector) => selector === "*" ? surface.children : [],
      contains: (element) => element === surface || surface.children.includes(element)
    };
    return surface;
  };
  const directRuntimeSurface = profileSurface({ surfaceKind: "direct-overlay" });
  assert.doesNotThrow(() => runProfileMotionContract({ treatment: "direct-overlay", surfaces: [directRuntimeSurface] }));
  assert.throws(() => runProfileMotionContract({
    treatment: "direct-overlay",
    surfaces: [directRuntimeSurface],
    fragmentRootStyle: { backgroundColor: "rgba(0,0,0,0.9)", position: "absolute" }
  }), /motion_contract_profile_structural_root/, "b20: the structural data-beat root must remain visually transparent");
  const outsideProfileVisual = {
    dataset: {},
    children: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 })
  };
  assert.throws(() => runProfileMotionContract({
    treatment: "direct-overlay",
    surfaces: [directRuntimeSurface],
    outsideElements: [outsideProfileVisual]
  }), /motion_contract_profile_surface_containment/, "b20: visual children outside the declared surface must remain rejected");
  assert.throws(() => runProfileMotionContract({ treatment: "direct-overlay", surfaces: [directRuntimeSurface, directRuntimeSurface] }), /motion_contract_profile_surface_count/);
  const evidenceRuntimeSurface = profileSurface({
    surfaceKind: "evidence-surface",
    evidenceSurfaceBounded: "true",
    materialIds: "b20-evidence"
  }, "rgba(255,255,255,0.18)");
  assert.doesNotThrow(() => runProfileMotionContract({ treatment: "evidence-surface", surfaces: [evidenceRuntimeSurface], materialIds: "b20-evidence" }));
  assert.throws(() => runProfileMotionContract({ treatment: "evidence-surface", surfaces: [profileSurface({ surfaceKind: "evidence-surface", materialIds: "b20-evidence" }, "rgba(255,255,255,0.18)")], materialIds: "b20-evidence" }), /motion_contract_evidence_surface/);
  assert.throws(() => runProfileMotionContract({ treatment: "evidence-surface", surfaces: [profileSurface({ surfaceKind: "evidence-surface", evidenceSurfaceBounded: "true", materialIds: "b20-evidence" }, "rgba(255,255,255,0.18)", { boxShadow: "rgba(0,0,0,0.9) 0px 0px 0px 756px" })], materialIds: "b20-evidence" }), /motion_contract_evidence_surface/, "b20: runtime rejects a shadow that paints beyond the compact evidence surface");
  assert.throws(() => runProfileMotionContract({ treatment: "evidence-surface", surfaces: [profileSurface({ surfaceKind: "evidence-surface", evidenceSurfaceBounded: "true", materialIds: "b20-evidence" }, "rgba(255,255,255,0.18)", { overflow: "visible" })], materialIds: "b20-evidence" }), /motion_contract_evidence_surface/);
  const overhangingEvidenceChild = {
    dataset: {},
    children: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1080, bottom: 1920, width: 1080, height: 1920 })
  };
  assert.throws(() => runProfileMotionContract({ treatment: "evidence-surface", surfaces: [profileSurface({ surfaceKind: "evidence-surface", evidenceSurfaceBounded: "true", materialIds: "b20-evidence" }, "rgba(255,255,255,0.18)", { children: [overhangingEvidenceChild] })], materialIds: "b20-evidence" }), /motion_contract_evidence_surface/);
  const darkDirectChild = {
    dataset: {},
    backgroundColor: "rgba(0,0,0,0.9)",
    children: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 })
  };
  assert.throws(() => runProfileMotionContract({ treatment: "direct-overlay", surfaces: [profileSurface({ surfaceKind: "direct-overlay" }, "transparent", { children: [darkDirectChild] })] }), /motion_contract_direct_overlay_surface/);
  const secondaryEvidenceInputPath = path.join(evidenceFixture.jobRoot, "input", "evidence", "secondary.png");
  fs.writeFileSync(secondaryEvidenceInputPath, "secondary evidence fixture");
  const evidenceWithUnshownMaterial = JSON.parse(fs.readFileSync(evidenceBeatMapPath, "utf8"));
  evidenceWithUnshownMaterial.materials.push({
    id: "b20-secondary",
    path: "input/evidence/secondary.png",
    kind: "screenshot",
    sha256: sha256File(secondaryEvidenceInputPath),
    sourceOrRights: "test fixture",
    privacyStatus: "approved",
    visibleFacts: ["Secondary evidence fixture."],
    forbiddenInferences: ["Do not infer anything beyond the fixture."]
  });
  evidenceWithUnshownMaterial.beats[0].materialRefs.push({
    materialId: "b20-secondary",
    role: "secondary-evidence",
    displayStartFrame: 30,
    displayEndFrame: 45,
    crop: "contain",
    masking: "none"
  });
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(evidenceWithUnshownMaterial));
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('data-material-ids="b20-evidence"', 'data-material-ids="b20-evidence,b20-secondary"'));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /every referenced evidence material.*bound display source/i, "b20: every materialRef must have a real displayed image source");
  fs.writeFileSync(evidenceBeatMapPath, JSON.stringify(evidenceBeatMap));
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment);
  fs.writeFileSync(evidenceStylePath, ".decoy { overflow: hidden; } .evidence-surface { overflow: visible; background: rgba(255, 255, 255, 0.18); }");
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /bounded.*overflow|overflow.*bounded|visual treatment/i, "b20: an evidence surface cannot opt out of clipping");
  fs.writeFileSync(evidenceStylePath, evidenceStyle);
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace(' data-evidence-surface-bounded="true"', ""));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /exactly one bounded evidence-surface/i, "b20: evidence surfaces must declare their bounded treatment");
  fs.writeFileSync(evidenceFragmentPath, `<div data-beat-id="beat-001">${evidenceSurface}<div data-motion-surface="container" data-border-policy="none" data-surface-kind="evidence-surface" data-evidence-surface-bounded="true" data-material-ids="b20-evidence"></div></div>`);
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /exactly one bounded evidence-surface/i, "b20: multiple evidence containers must fail");
  fs.writeFileSync(evidenceFragmentPath, `<div data-beat-id="beat-001">${evidenceSurface}<img src="../input/evidence/registered.png" data-material-id="b20-evidence" alt="outside bounded surface"></div>`);
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /inside.*bounded evidence-surface|evidence source|sole root child/i, "b20: a registered image outside the bounded evidence surface must not bypass surface controls");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('data-material-id="b20-evidence"', ""));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /data-material-id|registered material path|must display/i, "b20: every evidence display node must declare the material it renders");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace(' src="../input/evidence/registered.png"', ' src="../input/evidence/registered.png" srcset="../input/evidence/registered.png 1x"'));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /registered material src|literal img|srcset/i, "b20: srcset cannot create an untracked alternate evidence path");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('<span data-motion-protected', '<span style="background:url(https://example.invalid/unbound.png)" data-motion-protected'));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /inline style|evidence source/i, "b20: inline CSS image URLs cannot bypass evidence source binding");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('<img ', '<svg><image href="../input/evidence/unregistered.png" data-material-id="b20-evidence"></image></svg><img '));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /registered material path|evidence source|cannot use SVG/i, "b20: href-like image sources cannot bypass the literal evidence image contract");
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment);
  fs.writeFileSync(evidenceStylePath, ".evidence-surface { overflow: hidden; background-image: image-set(\"https://example.invalid/unbound.png\" 1x); }");
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /CSS.*source|CSS.*url|image-set/i, "b20: stylesheet image-set sources cannot bypass evidence source binding");
  fs.writeFileSync(evidenceStylePath, ".evidence-surface { overflow: hidden; background: u\\72l(https://example.invalid/unbound.png); }");
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /CSS.*escapes|dynamic source/i, "b20: CSS escapes cannot hide a stylesheet source");
  fs.writeFileSync(evidenceStylePath, evidenceStyle);
  for (const invalidSource of ["../input/evidence/unregistered.png", "https://example.invalid/evidence.png", "data:image/png;base64,AAAA", "blob:fixture"]) {
    fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace("../input/evidence/registered.png", invalidSource));
    assert.throws(() => buildComposition(evidenceFixture.hyperframes), /registered material path|registered material src|evidence source/i, `b20: ${invalidSource} must not bypass evidence source binding`);
  }
  fs.writeFileSync(evidenceFragmentPath, evidenceFragment.replace('data-material-id="b20-evidence"', 'data-material-id="different-evidence"'));
  assert.throws(() => buildComposition(evidenceFixture.hyperframes), /registered material path|evidence source/i, "b20: a material ID must not contradict its displayed registered source");

  assert.throws(
    () => buildComposition(fixture.hyperframes, { startFrame: 0.5, endFrame: 30 }),
    /half-open integer frame window/
  );
  assert.throws(
    () => buildComposition(fixture.hyperframes, { outputPath: path.join(fixture.jobRoot, "state", "workflow.json") }),
    /Composition output must be/
  );
  const escapedChunkDirectory = path.join(fixture.hyperframes, "chunks", "escape");
  fs.mkdirSync(path.dirname(escapedChunkDirectory), { recursive: true });
  fs.symlinkSync(path.join(fixture.jobRoot, "state"), escapedChunkDirectory);
  assert.throws(
    () => buildComposition(fixture.hyperframes, { outputPath: path.join(escapedChunkDirectory, "index.html") }),
    /resolves outside/
  );
  fs.unlinkSync(escapedChunkDirectory);

  const timelinePath = path.join(fixture.moduleDirectory, "timeline.mjs");
  const validTimeline = fs.readFileSync(timelinePath, "utf8");
  fs.writeFileSync(timelinePath, 'import { gsap } from "gsap";');
  assert.throws(() => buildComposition(fixture.hyperframes), /without imports/);
  fs.writeFileSync(timelinePath, "gsap.timeline();");
  assert.throws(() => buildComposition(fixture.hyperframes), /second timeline/);
  fs.writeFileSync(timelinePath, validTimeline);

  const beatMapPath = path.join(fixture.jobRoot, "state", "beat-map.json");
  const duplicated = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
  duplicated.beats.push({ ...duplicated.beats[0] });
  fs.writeFileSync(beatMapPath, JSON.stringify(duplicated));
  assert.throws(() => buildComposition(fixture.hyperframes), /Duplicate Beat ID/);
  duplicated.beats.pop();
  fs.writeFileSync(beatMapPath, JSON.stringify(duplicated));

  fs.writeFileSync(
    fragmentPath,
    '<div data-beat-id="beat-001" id="mg-beat-001"></div>'
  );
  assert.throws(() => buildComposition(fixture.hyperframes), /reserved generated wrapper ID/);
  const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
  beatMap.captionMode = "subtitles";
  beatMap.beats.push({ id: "beat-missing", start: 1.6, end: 1.8, mgScope: "local" });
  fs.writeFileSync(beatMapPath, JSON.stringify(beatMap));
  assert.throws(() => buildComposition(fixture.hyperframes), /approved motion Beat is missing its MG module/);

  const scaffoldSource = path.join(temporaryRoot, "source.mp4");
  const scaffoldJob = path.join(temporaryRoot, "scaffold-job");
  fs.writeFileSync(scaffoldSource, "fixture");
  execFileSync("bash", [path.join(repositoryRoot, "scripts", "scaffold-project.sh"), scaffoldJob, scaffoldSource], { stdio: "pipe" });
  assert.equal(fs.existsSync(path.join(scaffoldJob, "hyperframes", "index.html")), true, "scaffold must build index.html");

  console.log("Composition builder tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
