import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertCompositionReady, collectWorkflowDrift, resolveLockedHyperframesCli, sha256File, visualPlanChanges, writeJsonAtomic } from "../scripts/workflow-utils.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-workflow-update-"));
const script = fileURLToPath(new URL("../scripts/workflow-state.mjs", import.meta.url));
const environmentKeys = ["HYPERFRAMES_BROWSER_PATH", "PRODUCER_BROWSER_GPU_MODE", "CUT_MOTION_RENDER_WORKERS"];
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
try {
  for (const directory of ["state", "input", "roughcut", "hyperframes/node_modules/hyperframes/bin", "hyperframes/node_modules/.bin"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
  writeJsonAtomic(path.join(root, "hyperframes/package.json"), { devDependencies: { hyperframes: "0.7.60" } });
  writeJsonAtomic(path.join(root, "hyperframes/node_modules/hyperframes/package.json"), { version: "0.7.60", bin: { hyperframes: "bin/cli.mjs" } });
  const binary = path.join(root, "hyperframes/node_modules/hyperframes/bin/cli.mjs");
  fs.writeFileSync(binary, "#!/usr/bin/env node\n");
  fs.chmodSync(binary, 0o755);
  fs.symlinkSync("../hyperframes/bin/cli.mjs", path.join(root, "hyperframes/node_modules/.bin/hyperframes"));
  const browser = path.join(root, "browser");
  fs.writeFileSync(browser, "browser-v1");
  process.env.HYPERFRAMES_BROWSER_PATH = browser;
  const initial = resolveLockedHyperframesCli(root);
  assert.equal(initial.environment.browserSha256, sha256File(browser));
  process.env.CUT_MOTION_RENDER_WORKERS = "2";
  assert.notEqual(resolveLockedHyperframesCli(root).fingerprint, initial.fingerprint, "worker changes must invalidate renderer reuse");
  delete process.env.CUT_MOTION_RENDER_WORKERS;
  fs.appendFileSync(browser, "-changed");
  assert.notEqual(resolveLockedHyperframesCli(root).fingerprint, initial.fingerprint, "same path with changed browser bytes must invalidate reuse");
  fs.chmodSync(binary, 0o644);
  assert.throws(() => resolveLockedHyperframesCli(root), /binary is missing/);

  const transcriptPath = path.join(root, "state/transcript.json");
  const workflowPath = path.join(root, "state/workflow.json");
  writeJsonAtomic(transcriptPath, { segments: [{ id: "source-001", text: "原片", start: 0, end: 1 }] });
  writeJsonAtomic(workflowPath, { currentState: "transcription", mode: "review", captionMode: "subtitles", revisionId: 1, gates: {}, history: [] });
  const lock = () => spawnSync(process.execPath, [script, workflowPath, "lock-transcript"], { encoding: "utf8" });
  assert.equal(lock().status, 0);
  const frozen = fs.readFileSync(path.join(root, "state/source-transcript.json"));
  assert.equal(JSON.parse(fs.readFileSync(workflowPath)).currentState, "transcription", "locking must not accept cover or advance a state");
  const lockedWorkflow = fs.readFileSync(workflowPath);
  assert.equal(lock().status, 0);
  assert.deepEqual(fs.readFileSync(workflowPath), lockedWorkflow, "relocking is idempotent");
  assert.deepEqual(fs.readFileSync(path.join(root, "state/source-transcript.json")), frozen);
  fs.appendFileSync(path.join(root, "state/source-transcript.json"), " ");
  assert.notEqual(lock().status, 0, "relocking must reject source-timeline tampering");

  fs.writeFileSync(path.join(root, "roughcut/a-roll.mp4"), "locked media");
  const composition = { currentState: "composition", roughCutReviewDecision: "manual-approved", authoritativeMediaPath: "roughcut/a-roll.mp4", authoritativeMediaSha256: sha256File(path.join(root, "roughcut/a-roll.mp4")) };
  assert.doesNotThrow(() => assertCompositionReady(root, composition), "legacy approved exports remain compatible");
  assert.throws(() => assertCompositionReady(root, { ...composition, authoritativeMediaPath: path.join(root, "roughcut/a-roll.mp4") }), /job-relative/);
  assert.throws(() => assertCompositionReady(root, { ...composition, roughCutReviewDecision: "pending" }), /approved rough-cut/);
  assert.throws(() => assertCompositionReady(root, { ...composition, visualArrangementReviewRequired: true, visualArrangementReviewDecision: "pending", gates: { "rough-cut-review": { status: "approved" } } }), /approved visual arrangement/);
  fs.appendFileSync(path.join(root, "roughcut/a-roll.mp4"), " changed");
  assert.throws(() => assertCompositionReady(root, composition), /changed or is not bound/);
  assert.equal(collectWorkflowDrift(root, composition).length, 1);

  assert.deepEqual(visualPlanChanges({ beats: [{ id: "a", layout: { x: 1, y: 2 } }] }, { beats: [{ id: "a", layout: { y: 2, x: 1 } }] }), []);
  const differences = visualPlanChanges({ beats: [{ id: "a" }, { id: "b" }] }, { beats: [{ id: "a", text: "new" }, { id: "c" }] });
  assert.deepEqual(differences.map(change => [change.beatId, change.change]), [[null, "updated"], ["a", "updated"], ["b", "removed"], ["c", "added"]]);
  console.log("Workflow update contracts passed: frozen source lock, composition prewrite gates, renderer environment, revision diagnostics.");
} finally {
  for (const [key, value] of Object.entries(originalEnvironment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  fs.rmSync(root, { recursive: true, force: true });
}
