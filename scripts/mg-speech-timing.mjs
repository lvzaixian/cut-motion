import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chatcutPages, chatcutText, unwrapChatcut, normalizeCaptionCards } from "./chatcut-caption-data.mjs";
import { templateMicroEvents } from "./motion-template-library.mjs";

const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const normalize = text => String(text).normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "").toLowerCase();
const micros = value => value.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0) * 1e6;
const ceilFrame = value => Math.ceil(value - 1e-7);

function retainMeasuredWords(jobRoot, next) {
  const previousPath = path.join(jobRoot, "state/mg-speech-timing.json");
  if (!fs.existsSync(previousPath)) return next;
  let previous;
  try { previous = read(previousPath); } catch { return next; }
  if (previous.schemaVersion !== 1 || previous.fps !== next.fps || previous.snapshotSha256 !== next.snapshotSha256
    || (previous.projectId && next.projectId && previous.projectId !== next.projectId)
    || (previous.timelineId && next.timelineId && previous.timelineId !== next.timelineId)) return next;
  if (previous.windowsSha256 !== undefined) {
    const windowsPath = path.join(jobRoot, "state/timeline-source-windows.json");
    if (!fs.existsSync(windowsPath) || previous.windowsSha256 !== digest(windowsPath)) return next;
  }
  const retained = (previous.words ?? []).filter(word => word.timingProvenance === "measured"
    && Number.isInteger(word.startFrame) && Number.isInteger(word.endFrame) && word.endFrame > word.startFrame);
  const added = next.words.filter(word => !retained.some(existing => existing.segmentId === word.segmentId
    && normalize(existing.text) === normalize(word.text) && existing.startFrame < word.endFrame && word.startFrame < existing.endFrame));
  return { ...next, words: [...retained, ...added].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame) };
}

// ChatCut reports source milliseconds; placement frames are rounded and may include trimmed words.
export function mapSourceWord(word, clip, fps) {
  const sourceStartUs = Math.max(word.sourceStartUs, clip.srcStartUs);
  const sourceEndUs = Math.min(word.sourceEndUs, clip.srcEndUs);
  if (sourceEndUs <= sourceStartUs) return null;
  const rate = clip.playbackRateNumerator / clip.playbackRateDenominator;
  if (!(rate > 0)) throw new Error("MG speech timing requires a positive playback rate");
  const clipEnd = clip.timelineStartFrame + clip.durationFrames;
  const frameAt = sourceUs => clip.timelineStartFrame + (sourceUs - clip.srcStartUs) / 1e6 * fps / rate;
  const startFrame = Math.min(clipEnd, ceilFrame(frameAt(sourceStartUs)));
  const endFrame = Math.min(clipEnd, ceilFrame(frameAt(sourceEndUs)));
  return endFrame > startFrame ? { ...word, sourceStartUs, sourceEndUs, startFrame, endFrame, itemId: clip.itemId,
    playbackRateNumerator: clip.playbackRateNumerator, playbackRateDenominator: clip.playbackRateDenominator } : null;
}

export function prepareSpeechTiming(jobRoot, lookup) {
  lookup = unwrapChatcut(lookup);
  const snapshotPath = path.join(jobRoot, "state/chatcut-main-timeline.json");
  const windowsPath = path.join(jobRoot, "state/timeline-source-windows.json");
  const pages = chatcutPages(read(snapshotPath));
  const inputsPath = path.join(jobRoot, "state/planning-inputs.json");
  const corrections = fs.existsSync(inputsPath) ? read(inputsPath).corrections ?? {} : {};
  const lookupPages = chatcutPages(lookup);
  const isCaptionData = lookupPages.some(page => Array.isArray(page?.cards) || /^\[C\d+\]/mu.test(page?.text ?? ""));
  if (isCaptionData) {
    const fps = pages[0]?.state?.fps ?? pages[0]?.fps
      ?? (fs.existsSync(windowsPath) ? (() => { const windows = read(windowsPath); return windows.timelineFps.numerator / windows.timelineFps.denominator; })() : undefined);
    const captionData = normalizeCaptionCards(lookup, { fps, projectId: pages[0]?.projectId, timelineId: pages[0]?.state?.id });
    const entries = pages.flatMap(page => page.transcript?.entries ?? []);
    const words = [];
    const seen = new Set();
    for (const card of captionData.cards) for (const word of card.words) {
      // A custom/estimated token or whole card range is never measured word evidence.
      if (word.timingProvenance !== "measured") continue;
      const key = `${word.id}:${word.startFrame}:${word.endFrame}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const [index, entry] of entries.entries()) {
        const range = entry.timelineRange ?? entry.range ?? {};
        const start = range.fromFrame ?? range.startFrame;
        const end = range.toFrame ?? range.endFrame;
        if (word.startFrame < end && start < word.endFrame) words.push({ ...word,
          startFrame: Math.max(word.startFrame, start), endFrame: Math.min(word.endFrame, end),
          segmentId: `main-${String(index + 1).padStart(3, "0")}` });
      }
    }
    if (!words.length) throw new Error("Caption response contains no measured word timestamps; query only the affected MG keywords");
    return { schemaVersion: 1, provider: "chatcut.read_captions", projectId: pages[0]?.projectId, timelineId: pages[0]?.state?.id,
      fps: captionData.fps, corrections, snapshotSha256: digest(snapshotPath), words: words.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame) };
  }
  const windows = read(windowsPath);
  if (lookup.provider !== "chatcut.find_transcript" || lookup.assetId !== windows.sourceAssetId
    || pages.some(page => page.projectId !== lookup.projectId || page.state.id !== lookup.timelineId)) throw new Error("MG word lookup provenance does not match the approved cut");
  const fps = windows.timelineFps.numerator / windows.timelineFps.denominator;
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error("MG speech timing requires a positive timeline FPS");
  const mainEntries = pages.flatMap(page => page.transcript.entries).map((entry, index) => ({ ...entry, segmentId: `main-${String(index + 1).padStart(3, "0")}` }));
  const records = new Map();
  for (const lookupEntry of lookup.lookups) {
    for (const block of chatcutText(lookupEntry).split(/(?:^|\n)\d+\. /).slice(1)) {
      const placements = [...block.matchAll(/\[item ([\w-]+)\]/g)].map(match => match[1].replaceAll("-", ""));
      const clips = windows.clips.filter(clip => placements.some(prefix => clip.itemId.replaceAll("-", "").startsWith(prefix)));
      for (const match of block.matchAll(/\(source ([\d:.]+) → ([\d:.]+)\)\s+([^\n]+)/g)) {
        const sourceWord = { text: match[3].trim(), sourceStartUs: Math.round(micros(match[1])), sourceEndUs: Math.round(micros(match[2])) };
        for (const clip of clips) {
          const mapped = mapSourceWord(sourceWord, clip, fps);
          if (!mapped) continue;
          const entries = mainEntries.filter(entry => entry.itemId === clip.itemId
            && entry.sourceRange.start < mapped.sourceEndUs && mapped.sourceStartUs < entry.sourceRange.end);
          for (const entry of entries) {
            const key = `${entry.segmentId}:${clip.itemId}:${sourceWord.sourceStartUs}:${sourceWord.sourceEndUs}:${normalize(sourceWord.text)}`;
            const bounded = mapSourceWord({ ...sourceWord,
              sourceStartUs: Math.max(sourceWord.sourceStartUs, entry.sourceRange.start),
              sourceEndUs: Math.min(sourceWord.sourceEndUs, entry.sourceRange.end) }, clip, fps);
            if (bounded) records.set(key, { ...bounded, timingProvenance: "measured", segmentId: entry.segmentId });
          }
        }
      }
    }
  }
  if (!records.size) throw new Error("ChatCut lookup contains no usable word timestamps");
  return retainMeasuredWords(jobRoot, { schemaVersion: 1, provider: lookup.provider, projectId: lookup.projectId, timelineId: lookup.timelineId,
    sourceSha256: windows.sourceSha256, fps, snapshotSha256: digest(snapshotPath), windowsSha256: digest(windowsPath),
    corrections, words: [...records.values()].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame) });
}

export function loadSpeechTiming(jobRoot, expectedFps) {
  const timing = read(path.join(jobRoot, "state/mg-speech-timing.json"));
  if (expectedFps !== undefined && Math.abs(timing.fps - expectedFps) > 1e-9) throw new Error("MG speech timing FPS differs from the composition");
  if (timing.schemaVersion !== 1 || timing.snapshotSha256 !== digest(path.join(jobRoot, "state/chatcut-main-timeline.json"))
    || (timing.windowsSha256 !== undefined && timing.windowsSha256 !== digest(path.join(jobRoot, "state/timeline-source-windows.json")))) {
    throw new Error("MG speech timing is stale; regenerate against the approved timeline");
  }
  if (!["chatcut.find_transcript", "chatcut.read_captions"].includes(timing.provider)
    || !Array.isArray(timing.words) || timing.words.some(word => word.timingProvenance !== "measured")) throw new Error("MG speech timing requires measured ChatCut word evidence");
  const inputsPath = path.join(jobRoot, "state/planning-inputs.json");
  return fs.existsSync(inputsPath) ? { ...timing, corrections: read(inputsPath).corrections ?? {} } : timing;
}

export function keywordAnchor(timing, cue) {
  const words = timing.words.filter(word => word.segmentId === cue.segmentId);
  const normalized = words.map(word => normalize(word.text));
  const text = normalized.join("");
  const keyword = normalize(cue.keyword);
  if (!keyword) throw new Error("MG speech cue needs a keyword");
  const offsets = normalized.map((value, index) => normalized.slice(0, index).join("").length);
  const aliases = new Set([keyword]);
  for (const [raw, corrected] of Object.entries(timing.corrections ?? {})) {
    const value = normalize(corrected);
    for (const alias of [...aliases]) if (value && alias.includes(value)) aliases.add(alias.replaceAll(value, normalize(raw)));
  }
  const matches = [];
  const matchedOffsets = new Set();
  for (const alias of aliases) for (let at = text.indexOf(alias); at >= 0; at = text.indexOf(alias, at + 1)) {
    const first = offsets.findLastIndex(offset => offset <= at);
    const last = offsets.findLastIndex(offset => offset < at + alias.length);
    // Disjoint lookup excerpts cannot manufacture a phrase across an unobserved audio gap.
    if (words.slice(first, last).some((word, index) => {
      const next = words[first + index + 1];
      return Number.isFinite(word.sourceEndUs) && Number.isFinite(next.sourceStartUs)
        ? next.sourceStartUs - word.sourceEndUs > 500000
        : next.startFrame - word.endFrame > timing.fps * .5;
    })) continue;
    if (!matchedOffsets.has(at)) { matchedOffsets.add(at); matches.push(words[first]); }
  }
  matches.sort((a, b) => a.startFrame - b.startFrame);
  if (Number.isInteger(cue.occurrence) && cue.occurrence > 0 && cue.occurrence <= matches.length) return matches[cue.occurrence - 1];
  if (cue.occurrence !== undefined) throw new Error(`${cue.segmentId}/${cue.keyword}: occurrence does not resolve; refine only this anchor`);
  if (matches.length !== 1) throw new Error(`${cue.segmentId}/${cue.keyword}: expected one word anchor, found ${matches.length}; refine the cue or fetch its word timestamps`);
  return matches[0];
}

export function keywordFrame(timing, cue) {
  return keywordAnchor(timing, cue).startFrame;
}

/** Freeze measured anchors into the released transcript before package review.
 * Caption coverage still uses segments.words; these anchors never add speech.
 */
export function finalizeSpeechPlan(transcript, beatMap, timing, designSystem) {
  const bySegment = new Map(transcript.segments.map(segment => [segment.id, segment]));
  const anchors = [], anchorByWord = new Map(), counts = new Map();
  for (const word of timing.words) {
    const segment = bySegment.get(word.segmentId);
    if (!segment || word.timingProvenance !== "measured" || !Number.isInteger(word.startFrame) || !Number.isInteger(word.endFrame)
      || word.endFrame <= word.startFrame || word.startFrame / timing.fps < segment.start - 1e-6 || word.endFrame / timing.fps > segment.end + 1e-6) throw new Error("MG measured word must remain inside its released transcript segment");
    const ordinal = (counts.get(word.segmentId) ?? 0) + 1;
    counts.set(word.segmentId, ordinal);
    const anchor = { ...word, id: `${word.segmentId}:measured-word-${String(ordinal).padStart(3, "0")}`,
      start: Number((word.startFrame / timing.fps).toFixed(6)), end: Number((word.endFrame / timing.fps).toFixed(6)),
      timingProvenance: "measured", provider: timing.provider, snapshotSha256: timing.snapshotSha256,
      ...(timing.sourceSha256 ? { sourceSha256: timing.sourceSha256 } : {}),
      ...(timing.windowsSha256 ? { windowsSha256: timing.windowsSha256 } : {}) };
    anchors.push(anchor); anchorByWord.set(word, anchor);
  }
  transcript.timingAnchors = anchors;
  const policy = designSystem.motionProfiles?.["thoughtful-editorial-v1"]?.cueTiming;
  const scale = frames => Math.max(0, Math.floor(frames * timing.fps / (policy?.referenceFps ?? 60)));
  for (const beat of beatMap.beats) {
    if (!beat.templateData?.revealCues) continue;
    const window = { start: beat.start, exitStartTime: beat.end };
    const times = resolveRevealTimes(beat, window, timing);
    beat.templateData.revealTimes = times;
    if (beat.motionProfile !== "thoughtful-editorial-v1") continue;
    if (beat.objectCues?.length && beat.objectCues.length !== times.length) throw new Error(`${beat.id}: objectCues and revealCues need the same slot count`);
    beat.objectCues = times.map((time, index) => {
      const binding = beat.templateData.revealCues[index];
      const frame = Math.round((beat.start + time) * timing.fps);
      const existing = beat.objectCues?.[index] ?? {};
      const word = binding.keyword ? keywordAnchor(timing, binding)
        : timing.words.filter(word => beat.sourceSegmentIds.includes(word.segmentId) && word.startFrame <= frame).at(-1);
      const anchor = anchorByWord.get(word);
      if (!anchor || frame - word.startFrame > scale(policy?.maxFirstLegibleDelayFrames ?? 6)) throw new Error(`${beat.id}: decorative cue needs a nearby measured speech anchor; refine the cue instead of estimating a word`);
      const first = frame;
      return { ...existing, id: existing.id ?? `object-${String(index + 1).padStart(3, "0")}`,
        semanticRole: existing.semanticRole ?? binding.keyword ?? "spoken semantic element", spokenTriggerWordId: anchor.id,
        preMotionFrame: existing.preMotionFrame ?? first,
        firstLegibleFrame: first,
        settledFrame: existing.settledFrame ?? Math.min(Math.round(beat.end * timing.fps), first + scale(9)),
        exitTriggerWordId: existing.exitTriggerWordId ?? beat.exitAnchorWordId,
        invisibleFrame: existing.invisibleFrame ?? Math.round(beat.end * timing.fps),
        holdKind: existing.holdKind ?? (beat.visualDecision?.evolutionMode === "evolve" ? "causal-sequence" : beat.surfaceTreatment === "evidence-surface" ? "evidence-reading" : "standard") };
    });
    if (!beat.entryAnchorWordId || /:word-001$/.test(beat.entryAnchorWordId)) beat.entryAnchorWordId = beat.objectCues[0].spokenTriggerWordId;
    if (beat.microEvents === undefined) beat.microEvents = templateMicroEvents(beat, timing.fps);
  }
  return { transcript, beatMap };
}

export function resolveRevealTimes(beat, window, timing) {
  const cues = beat.templateData?.revealCues;
  if (!cues) return null;
  const frames = [];
  for (const cue of cues) {
    let frame;
    if (cue.keyword && cue.segmentId && Object.keys(cue).every(key => ["keyword", "segmentId", "occurrence"].includes(key))) frame = keywordFrame(timing, cue);
    else if (cue.atStart === true && Object.keys(cue).length === 1) frame = Math.round(window.start * timing.fps);
    else if (Number.isInteger(cue.after) && cue.after >= 0 && cue.after < frames.length && Number.isInteger(cue.delayFrames) && cue.delayFrames > 0 && Object.keys(cue).length === 2) frame = frames[cue.after] + cue.delayFrames;
    else throw new Error(`${beat.id}: invalid reveal cue`);
    const at = frame / timing.fps - window.start;
    if (at < -1e-6 || frame / timing.fps >= window.exitStartTime - 1e-6) throw new Error(`${beat.id}: word reveal falls outside its readable window`);
    frames.push(frame);
  }
  return frames.map(frame => Math.max(0, Number((frame / timing.fps - window.start).toFixed(6))));
}

export function bindSpeechReveals(fragment, beat, window, timing) {
  const times = resolveRevealTimes(beat, window, timing);
  if (!times) return fragment;
  let index = 0;
  const bound = fragment.replace(/\bdata-at=["'][^"']*["']/g, () => `data-at="${times[index++]}"`);
  if (index !== times.length) throw new Error(`${beat.id}: ${index} animation slots differ from ${times.length} speech cues`);
  return bound;
}
