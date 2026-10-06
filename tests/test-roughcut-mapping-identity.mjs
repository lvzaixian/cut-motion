import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File } from "../scripts/workflow-utils.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-map-identity-"));
const script = fileURLToPath(new URL("../scripts/prepare-rough-cut.mjs", import.meta.url));
const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
try {
  fs.mkdirSync(path.join(root, "state"));
  fs.mkdirSync(path.join(root, "input"));
  fs.writeFileSync(path.join(root, "input/source.mov"), "immutable source fixture");
  write("state/project.json", { sourceVideo: "input/source.mov", fps: 60 });
  write("state/workflow.json", { currentState: "motion-plan" });
  write("state/chatcut-roughcut.json", { projectId: "project", timelineIds: ["timeline"], activeTimelineId: "timeline", sourceAssetId: "asset" });
  write("state/source-audio-waveform-index.json", { source: { sha256: sha256File(path.join(root, "input/source.mov")), durationUs: 1_000_000 } });
  const page = { projectId: "project", state: { id: "timeline", fps: 60, durationFrames: 48 }, timeline: {
    totalEntries: 1, entries: [{ id: "clip", itemType: "video", trackId: "video", asset: { id: "asset" },
      playbackRate: 1.25, timelineRange: { fromFrame: 0, toFrame: 48 }, sourceRange: { start: 0, end: 1_000_000 } }]
  } };
  const run = (input, ok, pattern) => {
    write("state/response.json", { structuredContent: input });
    const result = spawnSync(process.execPath, [script, root, "windows", path.join(root, "state/response.json")], { encoding: "utf8" });
    if (ok) assert.equal(result.status, 0, result.stderr);
    else { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); }
  };
  run(page, true);
  const mapPath = path.join(root, "state/timeline-source-windows.json");
  const map = JSON.parse(fs.readFileSync(mapPath));
  assert.deepEqual(map.timelineFps, { numerator: 60, denominator: 1 });
  assert.equal(map.clips[0].playbackRateNumerator / map.clips[0].playbackRateDenominator, 1.25);
  assert.equal(map.projectId, "project");
  const original = sha256File(mapPath);
  run({ ...page, projectId: "wrong-project" }, false, /recorded ChatCut/);
  const wrongAsset = structuredClone(page); wrongAsset.timeline.entries[0].asset.id = "wrong-asset";
  run(wrongAsset, false, /source asset differs/);
  const gap = structuredClone(page); gap.timeline.totalEntries = 2; gap.state.durationFrames = 49;
  gap.timeline.entries[0].timelineRange.toFrame = 24; gap.timeline.entries[0].sourceRange.end = 500_000;
  gap.timeline.entries.push({ ...gap.timeline.entries[0], id: "second", timelineRange: { fromFrame: 25, toFrame: 49 }, sourceRange: { start: 500_000, end: 1_000_000 } });
  run(gap, false, /contiguous/);
  write("state/workflow.json", { currentState: "composition" });
  run(page, false, /Reopen rough-cut/);
  assert.equal(sha256File(mapPath), original, "Rejected snapshots must not rewrite the current mapping");
  console.log("Rough-cut identity, rate, gap and approved-plan mapping checks passed.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
