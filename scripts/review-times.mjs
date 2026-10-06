import fs from "node:fs";
import { isVisualOrchestrationV2 } from "./visual-orchestration-version.mjs";

const [beatMapPath, transcriptPath] = process.argv.slice(2);
if (!beatMapPath) {
  console.error("Usage: node review-times.mjs <beat-map.json> [transcript.json]");
  process.exit(64);
}

const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const times = new Set();
const beats = beatMap.beats ?? [];
const motionBeats = beats.filter((beat) =>
  beatMap.captionMode === "motion-copy"
  || beat.mgScope === "local"
  || (beat.microEvents?.length ?? 0) > 0
);

for (const beat of motionBeats) {
  const duration = beat.end - beat.start;
  const edgeInset = Math.min(0.1, duration * 0.1);
  const resolvedState = beat.microEvents?.at(-1)?.time ?? beat.start + duration * 0.65;
  times.add((beat.start + edgeInset).toFixed(3));
  times.add(resolvedState.toFixed(3));
  times.add((beat.end - edgeInset).toFixed(3));
  if (beat.axis === "B") times.add((beat.start + duration * 0.5).toFixed(3));
}

for (let index = 1; index < beats.length; index += 1) {
  if (beats[index - 1].axis !== beats[index].axis) times.add(Number(beats[index].start).toFixed(3));
}

if (transcriptPath && isVisualOrchestrationV2(beatMap)) {
  const wordsById = new Map(
    (JSON.parse(fs.readFileSync(transcriptPath, "utf8")).segments ?? []).flatMap((segment) =>
      (segment.words ?? []).map((word, index) => [`${segment.id}:word-${String(index + 1).padStart(3, "0")}`, word])
    )
  );
  for (const beat of beats.filter((candidate) => ["argument", "evidence"].includes(candidate.visualDecision?.mode))) {
    const cueById = new Map((beat.objectCues ?? []).map((cue) => [cue.id, cue]));
    for (const state of beat.visualDecision.argumentStates ?? []) {
      const word = wordsById.get(state.anchorWordId);
      if (!word) continue;
      const anchorFrame = Math.ceil(Number(word.start) * Number(beatMap.fps) - 1e-6);
      const settledFrames = (state.activeObjectCueIds ?? [])
        .map((cueId) => cueById.get(cueId)?.settledFrame)
        .filter(Number.isInteger);
      times.add((Math.max(anchorFrame, ...settledFrames) / Number(beatMap.fps)).toFixed(3));
    }
  }
}

if (beats.length > 0) {
  const firstBeat = beats[0];
  const lastBeat = beats.at(-1);
  times.add((firstBeat.start + Math.min(0.1, (firstBeat.end - firstBeat.start) * 0.1)).toFixed(3));
  times.add((lastBeat.end - Math.min(0.1, (lastBeat.end - lastBeat.start) * 0.1)).toFixed(3));
  if (motionBeats.length === 0) times.add(((firstBeat.start + lastBeat.end) * 0.5).toFixed(3));
}

console.log([...times].map(Number).sort((left, right) => left - right).join(","));
