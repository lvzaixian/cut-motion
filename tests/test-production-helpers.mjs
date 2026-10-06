// Optional focused regression test; temporary fixtures only, no media downloads.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTimelineCut, retimeDocument } from "../scripts/timeline-cut-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-helpers-"));
const put = (relative, content) => {
  const file = path.join(temporary, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const run = (script, args, env = {}, success = true) => {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status === 0, success, `${result.stdout}\n${result.stderr}`);
  return result;
};
try {
  const cut = createTimelineCut(60, 120, 180);
  const beatMap = { fps: 60, duration: 10, materials: [{ id: "proof", path: "input/proof.png" }],
    mgCadenceExceptions: [{ start: 4, end: 6, reason: "spoken pause", coveredNoneBeatIds: ["after"] }], beats: [
      { id: "before", start: 0, end: 2, objectCues: [{ id: "first", preMotionFrame: 0,
        firstLegibleFrame: 2, settledFrame: 8, invisibleFrame: 120 }] },
      { id: "removed", start: 2, end: 3 },
      { id: "after", start: 4, end: 6, audioAnchorTime: 4, entryAnchorTime: 4.1, exitAnchorTime: 5.9,
        entryAnchorWordId: "main-001:measured-word-001", exitAnchorOffsetFrames: 2, exitFrames: 6,
        microEvents: [{ time: 4.2, duration: .2 }],
        objectCues: [{ id: "proof", preMotionFrame: 240, firstLegibleFrame: 244,
          settledFrame: 252, invisibleFrame: 360, spokenTriggerWordId: "main-001:measured-word-001",
          exitTriggerWordId: "main-001:measured-word-002" }],
        materialRefs: [{ materialId: "proof", displayStartFrame: 244, displayEndFrame: 354,
          crop: "contain", masking: "private field" }], assets: [{ mediaStart: 19, duration: 2 }] }
    ] };
  const retimed = retimeDocument(beatMap, cut);
  assert.deepEqual(retimed.removedIds, ["removed"]);
  const after = retimed.document.beats[1];
  assert.deepEqual([after.start, after.end, after.audioAnchorTime, after.entryAnchorTime, after.exitAnchorTime].map(time => Number(time.toFixed(6))), [3, 5, 3, 3.1, 4.9]);
  assert.deepEqual(after.objectCues.map(cue => [cue.preMotionFrame, cue.firstLegibleFrame, cue.settledFrame, cue.invisibleFrame]), [[180, 184, 192, 300]]);
  assert.deepEqual(after.materialRefs.map(reference => [reference.displayStartFrame, reference.displayEndFrame]), [[184, 294]]);
  assert.equal(after.entryAnchorWordId, "main-001:measured-word-001");
  assert.equal(after.objectCues[0].spokenTriggerWordId, "main-001:measured-word-001");
  assert.equal(after.exitAnchorOffsetFrames, 2, "relative frame offsets stay unchanged");
  assert.equal(after.assets[0].mediaStart, 19, "asset-local offsets stay unchanged");
  assert.deepEqual(retimed.document.materials, beatMap.materials, "registered source material is unchanged");
  assert.equal(retimed.document.mgCadenceExceptions[0].start, 3);
  assert.ok(retimed.invalidatedArtifacts.includes("state/mg-speech-timing.json"));
  assert.ok(retimed.invalidatedArtifacts.includes("state/timeline-source-windows.json"));
  assert.equal(beatMap.beats[2].objectCues[0].preMotionFrame, 240, "source plan is immutable");
  for (const field of ["objectCues", "materialRefs"]) {
    const bad = structuredClone(beatMap);
    if (field === "objectCues") bad.beats[2].objectCues[0].preMotionFrame = 150;
    else bad.beats[2].materialRefs[0].displayStartFrame = 150;
    assert.throws(() => retimeDocument(bad, cut), /crosses/);
  }
  const unknown = structuredClone(beatMap);
  unknown.beats[2].objectCues[0].unexpectedFrame = 250;
  assert.throws(() => retimeDocument(unknown, cut), /unknown absolute frame/);
  const removedCrossing = structuredClone(beatMap);
  removedCrossing.beats[1].objectCues = [{ id: "crossing", preMotionFrame: 118, firstLegibleFrame: 122,
    settledFrame: 130, invisibleFrame: 179 }];
  assert.throws(() => retimeDocument(removedCrossing, cut), /crosses/);
  const shiftInput = put("shift/source.json", JSON.stringify(beatMap));
  const shiftOutput = path.join(temporary, "shift/candidate.json");
  const shifted = spawnSync(process.execPath, [path.join(root, "scripts/shift-timestamps.mjs"), shiftInput, "2", "3", shiftOutput], { encoding: "utf8" });
  assert.equal(shifted.status, 0, shifted.stderr);
  assert.equal(JSON.parse(fs.readFileSync(`${shiftOutput}.retime.json`)).status.startsWith("candidate-only"), true);
  assert.notEqual(spawnSync(process.execPath, [path.join(root, "scripts/shift-timestamps.mjs"), shiftInput, "2", "3", shiftInput]).status, 0);
  for (const name of ["install-font.sh", "align-export.sh"]) {
    put(`repo/scripts/${name}`, fs.readFileSync(path.join(root, "scripts", name)));
    run("-n", [path.join(temporary, "repo/scripts", name)]);
  }
  const fontScript = path.join(temporary, "repo/scripts/install-font.sh");
  const font = put("repo/assets/fonts/smiley-sans-oblique.ttf", Buffer.from("00010000010203", "hex"));
  const license = put("repo/assets/fonts/LICENSE.txt", "Font license fixture");
  put("repo/LICENSE.txt", "Repository license must never substitute for font license");
  const makeJob = (name, family = "Smiley Sans") => {
    put(`${name}/state/design-system.json`, JSON.stringify({ typography: { displayFamily: family, fontAsset: "assets/fonts/display.woff2" } }));
    put(`${name}/hyperframes/index.template.html`, `@font-face {font-family: "Smiley Sans"; src: local("Smiley Sans"), url("old.woff2") format("woff2");}\n@font-face {font-family: "Code Mono"; src: url("mono.woff2");}`);
    return path.join(temporary, name);
  };
  const job = makeJob("job");
  run(fontScript, [job]);
  const css = fs.readFileSync(path.join(job, "hyperframes/index.template.html"), "utf8");
  assert.match(css, /smiley-sans-oblique.ttf.*truetype/);
  assert.match(css, /font-family: "Code Mono"; src: url\("mono.woff2"\)/);
  assert.doesNotMatch(css, /old.woff2|local\(/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(job, "state/design-system.json"))).typography.fontAsset, "assets/fonts/smiley-sans-oblique.ttf");
  run(fontScript, [makeJob("other-family", "Unknown Family")], {}, false);
  assert.match(run(fontScript, [makeJob("download-needs-approval", "Unknown Family"), "--download"], {}, false).stderr, /requires --download --yes/);
  const escapedJob = makeJob("escaped-font");
  put("escaped-font/state/design-system.json", JSON.stringify({ typography: { displayFamily: "Smiley Sans", fontAsset: "../../escaped.ttf" } }));
  assert.match(run(fontScript, [escapedJob], {}, false).stderr, /stay inside this job/);
  const linkedJob = makeJob("linked-target");
  fs.mkdirSync(path.join(linkedJob, "hyperframes/assets/fonts"), { recursive: true });
  fs.symlinkSync(font, path.join(linkedJob, "hyperframes/assets/fonts/smiley-sans-oblique.ttf"));
  assert.match(run(fontScript, [linkedJob], {}, false).stderr, /job-owned files/);
  const disguised = put("bad/font.woff2", fs.readFileSync(font));
  put("bad/LICENSE.txt", "Font license fixture");
  assert.match(run(fontScript, [makeJob("bad-job"), "--from", disguised], {}, false).stderr, /Invalid or unsupported/);
  fs.unlinkSync(license);
  assert.match(run(fontScript, [makeJob("no-license"), "--from", font], {}, false).stderr, /Missing adjacent font LICENSE/);

  const mock = (name, source) => {
    const file = put(`bin/${name}`, `#!${process.execPath}\n${source}`);
    fs.chmodSync(file, 0o755);
  };
  mock("ffprobe", `const staged=process.argv.at(-1).includes('.align-'); process.stdout.write(staged?process.env.AFTER_PROBE:process.env.BEFORE_PROBE);`);
  mock("ffmpeg", `require('fs').writeFileSync(process.argv.at(-1),'new-media');`);
  const probe = (video, audio, frames = "60") => JSON.stringify({ format: { duration: String(Math.max(video, audio)) }, streams: [
    { codec_type: "video", duration: String(video), r_frame_rate: "30/1", nb_frames: frames },
    { codec_type: "audio", duration: String(audio) }
  ] });
  const env = { PATH: `${path.join(temporary, "bin")}:${process.env.PATH}`, BEFORE_PROBE: probe(2, 2), AFTER_PROBE: probe(2, 2) };
  const input = put("media/input.mp4", "source");
  const output = put("media/output.mp4", "previous-delivery");
  const align = path.join(temporary, "repo/scripts/align-export.sh");
  assert.equal(run(align, [input, "--output", output], env).stdout.trim(), input);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.BEFORE_PROBE = probe(2, 3);
  env.AFTER_PROBE = probe(2, 3);
  run(align, [input, "--output", output], env, false);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.AFTER_PROBE = probe(1, 1, "0");
  run(align, [input, "--output", output], env, false);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.AFTER_PROBE = probe(2, 2);
  assert.equal(run(align, [input, "--output", output], env).stdout.trim(), output);
  assert.equal(fs.readFileSync(output, "utf8"), "new-media");
  assert.equal(fs.readFileSync(input, "utf8"), "source");
  assert.equal(fs.readdirSync(path.dirname(output)).some((name) => name.startsWith(".align-")), false);

  for (const name of ["compose-job.mjs", "workflow-utils.mjs", "motion-window-utils.mjs", "visual-orchestration-version.mjs", "frame-window-utils.mjs"]) {
    put(`repo/scripts/${name}`, fs.readFileSync(path.join(root, "scripts", name)));
  }
  put("repo/scripts/assemble-mg.mjs", "console.log('assembled');\n");
  put("repo/scripts/workflow-state.mjs", `import fs from 'node:fs';
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file));
state.currentState = state.currentState === 'motion-plan' ? (state.visualArrangementReviewRequired ? 'visual-arrangement-review' : 'composition') : 'render';
fs.writeFileSync(file, JSON.stringify(state));
fs.appendFileSync(file + '.steps', 'advance\\n');\n`);
  const composeJob = "compose job'quoted";
  const composePut = (relative, value) => put(`${composeJob}/${relative}`, JSON.stringify(value));
  const roughcutMedia = put(`${composeJob}/roughcut/approved.mp4`, "approved roughcut fixture");
  const { sha256File } = await import("../scripts/workflow-utils.mjs");
  composePut("state/workflow.json", { currentState: "motion-plan", captionMode: "motion-copy",
    roughCutReviewDecision: "manual-approved", authoritativeMediaPath: "roughcut/approved.mp4",
    authoritativeMediaSha256: sha256File(roughcutMedia) });
  composePut("state/transcript.json", { segments: [{ id: "main-001", words: [{ start: 1, end: 5 }, { start: 8, end: 12 }] }] });
  composePut("state/beat-map.json", { fps: 30, duration: 15, beats: [
    { id: "first", start: 1, end: 6, entryAnchorWordId: "main-001:word-001", exitAnchorWordId: "main-001:word-001", exitAnchorOffsetFrames: 3, exitFrames: 6 },
    { id: "second", start: 8, end: 13, entryAnchorWordId: "main-001:word-002", exitAnchorWordId: "main-001:word-002", exitAnchorOffsetFrames: 0, exitFrames: 6 }
  ] });
  for (const id of ["first", "second"]) {
    for (const file of ["fragment.html", "style.css", "timeline.mjs"]) put(`${composeJob}/hyperframes/mg/${id}/${file}`, "fixture module");
  }
  const composeRoot = path.join(temporary, composeJob);
  const composeResult = spawnSync(process.execPath, [path.join(temporary, "repo/scripts/compose-job.mjs"), composeRoot], { encoding: "utf8" });
  assert.equal(composeResult.status, 0, composeResult.stderr);
  assert.equal(fs.existsSync(path.join(composeRoot, "state/motion-index.json")), false);
  assert.match(composeResult.stdout, /snapshot --at 5\.066667,11\.966667 --no-end --describe false --output/);
  assert.match(composeResult.stdout, /npm --prefix .* run render/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(composeRoot, "state/workflow.json"))).currentState, "render");
  assert.equal(fs.readFileSync(path.join(composeRoot, "state/workflow.json.steps"), "utf8"), "advance\nadvance\n");
  const pendingJob = path.join(temporary, "pending-review");
  put("pending-review/state/workflow.json", JSON.stringify({ currentState: "motion-plan", visualArrangementReviewRequired: true }));
  const pendingResult = spawnSync(process.execPath, [path.join(temporary, "repo/scripts/compose-job.mjs"), pendingJob], { encoding: "utf8" });
  assert.equal(pendingResult.status, 0, pendingResult.stderr);
  assert.match(pendingResult.stdout, /Visual arrangement ready for user review/);
  assert.doesNotMatch(pendingResult.stdout, /assembled|Composition ready/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pendingJob, "state/workflow.json"))).currentState, "visual-arrangement-review");
  assert.equal(fs.readFileSync(path.join(pendingJob, "state/workflow.json.steps"), "utf8"), "advance\n");
  console.log("Production helper tests passed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
