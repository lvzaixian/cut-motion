# Talking-Head Precision Trim Standard

This standard combines editorial selection used in every talking-head job with precision seam checks used only for automatic fallback or an explicit audit. In default `review`, apply the content and take-selection guidance, let the user inspect the live ChatCut timeline, and do not run the full automatic seam audit before that decision.

## Content before cuts

Transcribe and parse the entire recording before selecting clips, whether or not a script exists. Use `docs/content-analysis.md` to map the main claim, hook, narrative order, source times, setup dependencies and retry groups. Logical completeness comes before personal delivery, which comes before compact pacing. At every join, ask whether the incoming statement still has its premise. Protect the speaker’s background and relevant life context, transitions into a point, explanatory premises and emphasis such as “你没有听错，是限制学习时间”. Do not remove these merely because their words resemble earlier material.

## Unscripted wording and performance pass

Follow [the unscripted talking-head standard](unscripted-talking-head-standard.md) when no reference script exists. Keep the raw ASR distinct from the recording-reconciled transcript; collect known wording ambiguities in the content-analysis template and resolve them together before formal caption segmentation. Preserve confirmed spoken wording even when it is less grammatical than an editorial rewrite. Do not convert that rewrite into a reference script or claim that automatic retranscription is human listening.

Before showing the first rough cut, inspect identified hesitations and restarts in both sound and moving picture, then review visible continuity of the selected delivery for remaining sentence-internal resets. Treat an empty filler plus gaze/body reset as one candidate removal interval. Protect neighboring phonemes and meaningful speech; normal blinks, ordinary eye movements, and purposeful pauses remain contextual decisions. Record actual review coverage and capability gaps. This is editorial preparation in review mode, not the full automatic seam audit.

For user timecoded feedback, record which source/rough-cut/delivery version, FPS and rate the time refers to; localize it with surrounding speech and the active source mapping. Recalculate after cuts or rate changes instead of applying stale seconds or silently interpreting a frame timecode as decimal seconds.

## Default profile

Use `tight-talking-head` unless the user requests a slower conversational, dramatic, or lecture rhythm.

| Setting | Default |
| --- | --- |
| Boundary evidence | median of `-30`, `-35`, and `-40 dB` speech boundaries |
| Outgoing safety handle | 20 ms after the last acoustic speech boundary |
| Incoming safety handle | 50 ms before the first acoustic speech boundary |
| Seam audio transition | 0–2 frames at 30 fps; use only when it survives onset/tail audit |
| Review coverage | every seam, in picture and sound |

Convert milliseconds to the source frame grid only after calculating the boundary. At 30 fps, the handles normally become 0–1 outgoing frame and 1–2 incoming frames. The handles protect speech; they are not silence that must be manufactured between clips.

Finish every removable seam asymmetrically:

1. Tighten the outgoing side to remove weak decay, breath, room tone, and visible reset without clipping the final phoneme.
2. Inspect the first two to three frames of the incoming phrase. If its onset sounds shaved, restore one or two source frames; never restore the whole discarded pause by default.
3. Add at most two transition frames only after the physical boundaries are correct. Use zero when a transition attenuates the onset or pulls discarded tail audio back into the cut.

Do not create a separate trim profile for this behavior. It is the default meaning of `tight-talking-head`.

## Three-layer decision for automatic fallback

1. **Semantic selection:** use the settled release wording and complete spoken thought to choose the valid take, remove false starts and duplicates, and preserve connective language. A persisted reference script supplies release wording when available; ASR timestamps do not set physical cut frames.
2. **Acoustic boundary:** run silence or speech-boundary detection at all three default thresholds and use the median result. This avoids late cuts caused by room tone, breath noise, or one permissive threshold.
3. **Performance classification:** inspect gaze, mouth, head, and torso around the candidate. Preserve continuous delivery; remove reading, searching, restart preparation, and visible reset behavior.

Cut to the acoustic boundary when the speaker has stopped delivering and entered a reset. Do not retain 180–400 ms merely because it falls at a sentence or topic boundary. Conversely, do not compress an intentional pause to 80 ms when eye contact, pose, breath, and meaning remain continuous.

## Editorial heuristics

These guide ChatCut selection and Agent judgment. They do not add schema fields, validator failures, or review gates.

- **Repeated expression:** remove repetitions that add no information. For genuine retries of the same content, select the final complete take by default: stopping the retries signals the speaker’s acceptance. Shorter duration, smoother delivery or a preferred expression in an earlier take is not sufficient to override this. Only concrete incompleteness, a mistake or content loss in the later attempt justifies an evidenced fallback. Keep necessary unique context separately; do not splice earlier and later wording to invent a take. Preserve intentional emphasis, recap, and comic repetition.
- **Fillers and emphasis:** judge “然后”, “其实” and similar words in context. Remove empty hesitation or consecutive redundant starts; keep words that signal a turn, emphasis or personal voice. Preserve a meaningful pause after a key point or between sections instead of applying a uniform silence target.
- **Pickups and speed:** assess picture, loudness, tone and semantic continuity before inserting a pickup. Omit an unnecessary pickup that disrupts continuity. Choose and lock speed per video with the rough-cut review; a prior 1.25× decision is not a universal default.
- **Correction and restart:** remove confirmed slips, failed openings, and production chatter such as requests to restart, then keep the successful delivery. Preserve meaningful negation, contrast, and rhetorical self-correction.
- **Breath and pacing:** remove reading, searching, restart preparation, and empty delay while retaining natural breath and pauses needed for comprehension or emphasis. Prefer a conservative boundary when a tighter cut creates a distracting gaze, mouth, or posture jump.

## Reference-aligned complete-take selection

For a new ChatCut job, `state/roughcut-selection.json` is the hard record before the review gate. It binds the immutable source-transcript and reconciliation hashes, the optional reference-script hash, the SHA-256 of the current `state/chatcut-roughcut.json`, a `verifiedAt` timestamp no earlier than that record's `recordedAt`, and the active ChatCut project/timeline. Any ChatCut mutation must update that record and regenerate the selection. Every recording-backed reconciliation source segment is classified exactly once as a candidate take or an audio-reviewed discard, and every candidate—including the selected complete take—has nonempty audio-reviewed evidence. A `releaseImpact: true` source segment cannot be discarded. A reference-backed item cannot be discarded and must occur in exactly one selected semantic group and its selected complete take. Only an item whose reconciliation resolution is explicitly `omitted-unspoken` is exempt from that selected coverage. Within each group, select the latest chronological `complete` take; a later unselected candidate is allowed only when it is explicitly `later-incomplete`, `later-mistake`, or `later-content-loss` with audio-reviewed evidence. Repeated takes stay in that group rather than being hidden as a generic discard. `ffmpeg-fallback` requires `project.roughCutEngine: "ffmpeg-fallback"`; any job that still contains `state/roughcut-selection.json` additionally requires the V1 origin and user-only `waive-v1-roughcut-selection-for-ffmpeg-fallback` record at entry and review decision. Only a historic workflow without that file may use legacy null fallback.

## Seam classification

Preserve a pause when at least one of these is true and no reset signal is present:

- it supports comprehension, emphasis, humor, or a deliberate change of thought;
- eye contact and body intention continue through the pause;
- the breath is part of continuous delivery and removing it makes speech sound clipped.

Remove a pause when one or more of these is visible or audible:

- gaze leaves the lens to check a script;
- mouth articulation stops and the speaker searches for the next line;
- head or torso resets between takes;
- the next phrase begins like a restart rather than continuous delivery;
- room tone or breath noise extends well beyond the last spoken phoneme.

When evidence conflicts, protect speech with 50–120 ms of padding, record low confidence, and surface only that seam for review.

Use `scripts/inspect-media-window.mjs` only for conflicting or low-confidence evidence. Its aligned filmstrip and waveform help classify gaze, mouth, posture, and audio continuity around the decision; it is internal diagnostic evidence, not a required artifact for every seam or a new review gate.

## Required trim-plan record

Before finalization, the Agent-authored portion of `state/trim-plan.json` contains only:

- the authoritative source path and integer timeline FPS;
- each removed range as integer `startFrame`/`endFrame`;
- an explicit classification, reason, semantic evidence, confidence and actual transition frames;
- for a retained natural pause flagged above 180ms, the existing filmstrip-waveform diagnostic manifest path and the Agent's concrete finding.

Advancing transcription locks `state/source-transcript.json` before timestamps are shifted. On the automatic fallback, run `scripts/finalize-trim-plan.mjs` against the promoted rough cut after `fallback-auto`; it refuses a changed snapshot and replaces all derived sections deterministically with source and rough-cut hashes, transcript-word and three-threshold acoustic handles, output frames, residual silence and any diagnostic hash. Diagnostic manifests bind their filmstrip and waveform to the exact media hash and audited time window. In the manual-first path, do not create derived seam evidence before the user reviews ChatCut. Job-local scripts must not author or preserve derived seam evidence.

## Full-audit acceptance checks

- Every seam has acoustic evidence or an explicit documented exception.
- No cut is based only on a transcript or ASR word endpoint.
- No outgoing phoneme or comprehension-critical breath is clipped, and no incoming onset is shaved or faded early.
- No invalid reading, searching, or body-reset tail remains after speech.
- No audio transition restores discarded tail noise or weak decay.
- The timeline is contiguous, source order is correct, and there are no black frames, overlaps, frozen items, or detached audio.
- Every seam has been listened to and inspected at the frame before and after the cut.
- `natural-pause` is an explicit editorial classification, never a generator default. A long natural pause triggers an internal diagnostic, not an automatic rejection or a new user gate.

In the automatic-fallback or explicit full-audit path, the exported rough-cut artifact must pass these checks. In the manual-first path, the ChatCut timeline is the review artifact, and the user decision precedes export; only the basic media probe is required after approval. The user, not this automated seam audit, decides whether the resulting edit is good.

During the automatic fallback or explicit full audit, `finalize-trim-plan.mjs` measures both source-side cut boundaries and final-export seam silence at `-30`, `-35`, and `-40 dB`, then binds the results to both media hashes. Removed reset, false-start, restart, body-reset, and duplicate-take seams use the 80ms ceiling quantized down to timeline frames; it is not silently widened. Natural or intentional pauses remain exempt from that ceiling, but a measured pause above 180ms requires a hash-bound filmstrip-waveform diagnostic. Automated measurement supplements rather than replaces picture and phoneme review.
