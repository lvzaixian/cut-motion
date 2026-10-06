# cut-motion Agent Protocol

cut-motion turns a talking-head video and an optional reference script into a tightly cut, motion-designed video. This repository is an Agent workflow, not a LangGraph, LlamaIndex, or fixed-template application.

`AGENTS.md` is the canonical operating contract. Codex, Claude Code, and compatible coding agents must follow it before editing media or authoring motion.

## Existing local transcription — check this first

**This Mac already has a reusable local `mlx-whisper` environment and Whisper large-v3 model.** Before declaring transcription unavailable or proposing an installation, read the first section of `docs/agent-setup.md` and check its absolute CLI/model paths, Metal and FFmpeg. The package is `mlx-whisper`; the executable is `mlx_whisper` inside a separate virtual environment. A missing command on PATH, a missing package in the default Python, or disconnected ChatCut is not evidence that this local tool is unavailable. When the user has not chosen an engine and the local checks pass, reuse it offline without reinstalling or downloading; keep new inputs, raw results and logs in the current job. Verify again on other hosts; do not assume this Mac's paths exist there.

## Minimum input

- A local talking-head video.
- Optional preferences: caption mode, reference script, visual-axis strategy, output aspect, style references, and autonomy mode.

If media is missing, ask for its local path and stop. After receiving it, ask once for any known preferences without blocking progress when the user has none. When a reference script is supplied, persist its immutable copy in the job and use its recording-confirmed wording for release; ChatCut/ASR supplies timing and alignment. The recording remains authoritative for what was actually spoken.

A reference script may contain local visual notes in full-width `【】`. These are medium-strength, non-exhaustive references for the immediately preceding semantic clause unless a note explicitly names another local range. Only its speech text, after recording reconciliation, enters released wording; visual notes remain separate planning evidence and never replace whole-video MG and edit analysis or count as final axis or motion approval. Ordinary `[]` remains spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.

For recordings without a reference script, read `docs/unscripted-talking-head-standard.md` before content analysis. It defines early listening-capability disclosure, batch wording reconciliation, picture-and-sound performance review, and whole-screenshot evidence choreography. Its screenshot guidance also applies to scripted jobs using user-provided screenshots. Fill the corresponding content-analysis and motion-plan template sections; do not register cleaned ASR as a user reference script or inherit a prior job's listening waiver.

## Required outputs

Each run creates a job directory containing:

```text
jobs/<job-id>/
├── input/
├── state/
│   ├── project.json
│   ├── source-transcript.json
│   ├── transcript.json
│   ├── transcript-reconciliation.json
│   ├── reference-script-annotations.json
│   ├── cover.json
│   ├── titles.json
│   ├── chatcut-roughcut.json
│   ├── roughcut-selection.json
│   ├── trim-plan.json
│   ├── design-system.json
│   ├── creative-confirmation.json
│   ├── workflow.json
│   ├── beat-map.json
│   └── render-manifest.json
├── roughcut/
│   └── a-roll.mp4
├── docs/
│   ├── content-analysis.md
│   ├── caption-plan.md  # subtitles only
│   ├── creative-confirmation.md
│   └── motion-plan.md
├── captions/
├── hyperframes/
├── previews/
│   └── cover/
├── checkpoints/
├── logs/
└── output/
    ├── cover.png
    ├── final.mp4
    └── titles.xlsx
```

Never overwrite the original source video. Every destructive-looking operation must produce a new artifact and update `state/project.json`.

Each job directory is an isolated working directory. Do not place job media, generated state, previews, or logs in the cut-motion repository root.

## Toolchain

Use the first available tool in each stage:

1. **Transcription and content analysis:** transcribe the full recording with ChatCut or the existing local mlx-whisper runtime documented in `docs/agent-setup.md`, reconcile against audio and an optional reference script, then map the narrative and repeated takes before cover copy or cutting. ASR does not replace the recording as authority.
2. **Rough cut:** ChatCut project and editable timeline, using the analyzed narrative and latest complete repeated takes.
3. **Precision trim:** FFmpeg and FFprobe.
4. **Motion design:** HyperFrames HTML/CSS with a single seek-safe GSAP timeline.
5. **Validation and render:** HyperFrames build/render and FFprobe. Additional automatic validation is enabled only by the explicit `auto` mode.

Remotion and Vibe Motion are not part of the default stack. Use them only when the user explicitly requests them and record the deviation in `state/project.json`.

## Operating modes

- `review` is the default fast path. It pauses at `rough-cut-review` for the editable ChatCut timeline, then at `visual-arrangement-review` after the motion plan so the user can inspect the creative package before composition. The latter is a package review, not a second rough-cut edit review. After approval it performs basic media checks, builds HyperFrames, and renders once; it does not run full automatic validation or a routine standard preview/sample. A first complex screenshot group or an identified masking, overlap, or timing risk may use one bounded encoded context diagnostic under `docs/unscripted-talking-head-standard.md`; it is internal evidence, not another user gate.
- `auto` follows the same state route only after the user explicitly selects `auto`. It records automatic acceptance of the visual package instead of pausing there, explicitly enables automatic validation at the existing transitions, including the rough-cut audit when applicable, and must warn that the checks and repair may take a long time.

`rough-cut-review` is the only edit-review state. `visual-arrangement-review` is a separate review of `docs/creative-confirmation.md`, not an editable-timeline review. After transcription and content analysis, the user selects a final cover package with `approve-cover` before entering rough cut. This checkpoint does not add a state, and a later cover-only revision never reopens the video edit.

## Workflow state machine

`state/workflow.json` is the authoritative state. `currentState` may only be one of `intake`, `transcription`, `rough-cut`, `rough-cut-review`, `rough-cut-export`, `motion-plan`, `visual-arrangement-review`, `composition`, `render`, or `complete`. Never advance by assumption or by merely creating the next artifact.

Use `scripts/workflow-state.mjs` for every transition:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json status
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-mode auto --actor user
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-cover --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json advance --artifact <path> --note <summary>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-creative --actor agent --note <internal-validation-summary>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-visual-arrangement --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json revise --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json revise-visual-arrangement --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note <reason>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json waive-v1-roughcut-selection-for-ffmpeg-fallback --actor user --note <reason>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json reopen <rough-cut|motion-plan|composition|delivery> --actor user --note <feedback>
```

`approve-cover`, `approve`, and `revise` record the cover and editable rough-cut decisions. `approve-cover` validates a prepared 3:4 PNG package, records the cover choice, and never moves or reopens the video state; its approval is required at `transcription → rough-cut`, not `intake → transcription`. `approve` records the `rough-cut-review` decision and `revise` returns to `rough-cut`. `approve-creative` is an Agent-only structural/fingerprint validation action, allowed only at `motion-plan` after `manual-approved`; it never enters composition. New jobs then enter `visual-arrangement-review` with `docs/creative-confirmation.md` as the recorded artifact. Only `approve-visual-arrangement --actor user --note ...` can move that review to `composition`; `revise-visual-arrangement` returns to `motion-plan`. In explicitly selected `auto`, the same valid package is recorded as `automatic-accepted`. Never infer approval or an automatic decision from silence.

Every creative round has a `revisionId`. Preserve prior decisions in `history`; revisions invalidate downstream hashes and return to the earliest affected state. `currentState` and `pendingGate` identify the active position.

Do not interpret silence as approval in `review` mode.

Completed jobs stay in the same job directory when the user requests revision. Use `reopen`: editorial cuts return to `rough-cut`, MG structure or copy returns to `motion-plan`, parameter-only visual changes return to `composition`, and encoding-only changes return to `render`. A parameter-only change should be rebuilt and checked in a local 1–3 second window before any full delivery render. Render a delivery revision to `output/final.candidate.mp4` when preserving the last delivery matters; otherwise the user may inspect the new output directly.

The fast path renders once at the requested delivery quality and lets the user inspect that file. A temporary affected-window preview is allowed for a parameter-only revision or the bounded screenshot-risk diagnostic above, but it is not a workflow state or a routine required precursor to delivery.

After the final video file is rendered but before `render` can advance to `complete`, produce the title package described in `docs/title-standard.md`: `state/titles.json` and `output/titles.xlsx`. The checker requires five platform groups—抖音、视频号、小红书、B站、快手—with exactly five public, recording-supported candidates each, and binds the workbook to the SHA-256 of this render. This is a delivery requirement, not a user gate and never authorizes auto-publishing.

## Caption modes

`captionMode` is independent of workflow mode:

- `motion-copy` is the no-subtitle mode. Every spoken phrase appears inside the designed motion; there is no separate subtitle layer.
- `subtitles` is the default release path. Captions carry the spoken transcript; motion graphics carry only supplemental meaning such as diagrams, tool labels, counters, comparisons, icons, and semantic emphasis.

If the user has no caption preference, analyze the locked edit and record a recommendation before `rough-cut-review`. Resolve the choice with the rough-cut decision; a late caption-mode change at or after planning returns to `motion-plan`.

For `subtitles` mode:

- treat `docs/subtitle-segmentation-standard.md` as the binding wording, grouping, timing, and single-line specification;
- treat `docs/subtitle-mg-standard.md` as the binding MG selection specification;
- use white 得意黑;
- inherit `captions.fontWeight`, which defaults to `400`; do not use `700` or synthetic bold unless a confirmed brand requirement changes the design system;
- use a soft downward black shadow, not an opaque subtitle bar;
- render exactly one line per cue. Segment by complete lexical units, syntax, clauses, breath, and reading rhythm before applying width constraints. Never split a protected word or fixed phrase, isolate a function word or particle, or create a cue merely to satisfy a raw character count;
- allow `?` or `？` only as the final character of a cue; replace every other punctuation mark, including internal commas and enumeration commas, with a single space;
- target 4–10.5 measured display units and 0.8–2.5 seconds per cue; allow up to 11.8 measured units with cue-level fitting between 88–96px. A meaningful short closing phrase may be an explicit exception, but a one-character cue is always invalid;
- keep captions centered in the lower safe zone;
- do not repeat the same sentence as a large motion headline;
- when a reference script is supplied, persist its immutable job-local copy and use its recording-confirmed wording for release; use ChatCut/ASR output for timing and alignment, not released wording. Without a reference script, use the reconciled recording-backed transcript as wording authority;
- retain `captions/chatcut-pages.json` as raw timing evidence, but do not preserve its `/` pagination blindly. Build `captions/caption-review-plan.json` by aligning the approved wording to word timestamps and authoring semantic one-line groups;
- run `scripts/check-caption-review-plan.mjs` when preparing or explicitly auditing the plan. Promote the settled wording/timing plan to `captions/captions.json`, then run `scripts/check-captions.mjs` and `scripts/install-captions.mjs <captions> <composition> <design-system>` when captions are installed;
- build released captions in HyperFrames. Add MG only at selected semantic nodes after the caption baseline is viable. Never cover captions, PiP, product evidence, protected UI, or platform chrome. The speaker is not a default protected zone: intentional face coverage is allowed only when it improves the current semantic understanding. Global MG is forbidden in `subtitles` mode.
- default to A-axis overlays in `subtitles` mode: keep the talking-head video full-frame beneath localized MG. A B-axis stage is a recorded motion-plan preference, not a new workflow gate.

## Visual axis modes

Use these user-facing names; do not call them A-roll and B-roll:

- **A-axis overlay mode:** the talking-head video remains full-frame and localized MG appears above it.
- **B-axis stage mode:** motion design owns the full frame and the speaker may remain in a protected live PiP.

Infer the axis recommendation from the locked edit, content-display needs, and available supporting media. Record the recommendation and its reason with the rough-cut decision, then implement the chosen axis in HyperFrames. The creative-confirmation package defines the treatment; a later B-axis change returns to `motion-plan` and updates the recorded preference without adding another workflow gate. Record decisions in `state/workflow.json` and `state/creative-confirmation.json`.

## Canonical workflow

### 0. Environment preflight

Detailed host setup, job installation, render, and repository-maintenance commands are collected in `docs/agent-setup.md`.

Before creating a job, check the existing local transcription runtime under `docs/agent-setup.md`, inspect the active Agent tool surface for ChatCut, then run:

```bash
./scripts/check-environment.sh check
```

ChatCut is an Agent integration and cannot be reliably discovered from the shell. HyperFrames Agent integration is optional authoring guidance; the required renderer is the exact job-local CLI resolved below.

This repository preflight does not check the separate mlx-whisper environment. Its missing Node/npm or rendering dependencies do not establish that local transcription is unavailable. Report each blocker against its stage and continue independent transcription/content work when its own inputs and dependencies are ready; restore job-setup dependencies before scaffolding. Missing ChatCut concerns the editable rough-cut stage and must not block an available local ASR run. Reusing installed tools requires no new installation approval.

If required ChatCut or a local dependency is unavailable:

1. Explain the missing items, their purpose, and the exact installation scope in one concise prompt.
2. Wait for explicit user approval. Do not install packages, alter global Agent configuration, or start OAuth before approval.
3. For ChatCut, after approval instruct the active Agent with `Read https://chatcut.io/chatgpt to install and use the ChatCut plugin` in Codex or `Read https://chatcut.io/claude to install and use the ChatCut plugin` in Claude Code. Do not add a deterministic ChatCut installer to this repository.
4. After a job is scaffolded, run `./scripts/check-environment.sh install-job jobs/<job-id> --yes` only after approval. It must first search the configured npm `_npx` cache for the exact declared HyperFrames version and reuse it through a job-local package symlink. Download HyperFrames only when no exact cache exists. Resolve GSAP independently so a missing GSAP package never forces a second HyperFrames download.

ChatCut is used only to create the editable rough cut. If it is unavailable, record `roughCutEngine: "ffmpeg-fallback"`. A job containing `state/roughcut-selection.json` may use the conservative fallback only after the user runs `waive-v1-roughcut-selection-for-ffmpeg-fallback --actor user --note <reason>`; it records the user, timestamp, and reason before switching the active policy to null. Setting the policy null or deleting its origin by hand is rejected while that selection file exists. Only historic workflows without `state/roughcut-selection.json` remain compatible with the legacy null fallback. Do not claim that ChatCut ran. Captions, MG, and B-axis composition always belong to HyperFrames. HyperFrames requires no global install: `install-job` reuses an exact `_npx` cache entry when available and otherwise installs the pinned npm dependency inside the job.

### 1. Intake and probe

1. Create a job with `scripts/scaffold-project.sh`.
2. Copy or link the source into `input/`; never modify it.
3. Probe duration, dimensions, frame rate, codecs, sample rate, and rotation with FFprobe.
4. Preserve the uncut source for the later cover checkpoint. Enter transcription without waiting for a cover; write cover copy only after understanding the actual content.
5. Ask once for optional caption, reference-script, and visual-axis preferences. Record supplied choices; otherwise keep them deferred and continue.
6. Normalize the project timeline to the source frame rate unless the user specifies another rate, then save the resolved inputs and defaults.

### 2. Transcript, content analysis, and cover

1. Transcribe the entire recording before cutting, including videos with a reference script. Use ChatCut or the already installed local mlx-whisper runtime in `docs/agent-setup.md`; retain raw ASR output separately from the reconciled transcript and release captions.
2. If a reference script is supplied, persist the immutable original under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. Reconcile its wording with the recording: remove unspoken text, restore spoken omissions, and use the confirmed script wording for release.
3. When the reference contains `【】`, use only `speechText` from `state/reference-script-annotations.json` for released wording and retain every visual note separately.
4. Store timestamps in `state/transcript.json` and evidence in `state/transcript-reconciliation.json`; run the reconciliation checker.
5. Advancing transcription snapshots the source-timeline word timings to immutable `state/source-transcript.json`; its workflow hash survives rough-cut revisions.
6. Preserve uncertainty. A release-impact wording conflict is resolved against the recording before release; it does not create a separate default user gate.
7. Before cover copy or editing, fill `docs/content-analysis.md` with the main claim, recording-supported hook, narrative order, original time ranges/segment IDs, prerequisite context, and repeated-take groups. Prioritize logical completeness, personal delivery, then tight pacing. Protect background, causal setup, section transitions and meaningful emphasis. This is an editorial working document, not another user gate or evidence that the Agent listened.
8. Group retries of the same intended content chronologically and select the last complete take by default: the speaker stops repeating when satisfied. Do not choose an earlier take just because it is shorter or smoother. A later incomplete, mistaken or content-losing attempt requires concrete evidence before falling back. Preserve unique necessary setup as its own segment; emphasis, recaps and later developments are not failed takes. Carry these decisions into `state/roughcut-selection.json` when the ChatCut timeline is built.
9. Complete `docs/cover-standard.md` after analysis: present exactly 24 uncut source frames for new V2.1 jobs, record the selected 3:4 crop, optionally calibrate style separately, then render exactly six complete direct-crop previews from the shared base. Historical V1/V2.0 packages retain eight-frame verification. Favor a supported concrete experience/result plus the core thesis or contrast; align cover, opening and eventual titles without promising unsupported outcomes. Record the user's selected `output/cover.png` with `approve-cover` before advancing to rough cut. The cover never enters the video timeline.

### 3. Shared edit lock

1. Create or target a ChatCut project and import the source.
2. Use ChatCut only to build the editable talking-head rough-cut timeline; do not add released captions, MG, or B-axis composition there.
3. Build the analyzed narrative using the latest complete repeated takes, then remove clear false starts and empty delay. Follow `docs/talking-head-trim-standard.md`: check each join for missing prerequisites, retain meaningful setup and emphasis, and judge fillers such as “然后” and “其实” by function rather than deleting them globally. Preserve natural breath and rhetorical pauses. Compare pickups for picture, loudness, tone and semantic continuity before including them; decide playback speed per job before captioning, never inherit a fixed 1.25× or a blanket ban on pickups.
4. Record the ChatCut project and timeline IDs in `state/chatcut-roughcut.json`; this is the review artifact and is not a video export.
5. New jobs use `reference-aligned-last-complete-take-v1`: fill `state/roughcut-selection.json` with the locked source/reconciliation/reference hashes, the SHA-256 of the current `state/chatcut-roughcut.json`, a `verifiedAt` timestamp no earlier than that record's `recordedAt`, active ChatCut project/timeline, one latest complete selected take per semantic group, and an audio-reviewed candidate or documented discard for every recording-backed reconciliation source segment. Every candidate, including the selected take, needs nonempty audio-reviewed evidence. A `releaseImpact: true` source segment cannot be discarded. Reference-backed items cannot be discarded and must occur in their selected complete take; only an item explicitly resolved `omitted-unspoken` is exempt. Any ChatCut mutation must update its rough-cut record and regenerate the selection. `scripts/check-roughcut-selection.mjs` must pass before the review gate and again before approval or automatic fallback. Only a historic workflow without `state/roughcut-selection.json` may use the legacy null fallback.
6. In `review`, record deferred caption and axis recommendations with `set-caption-mode` and `set-axis-mode`, open the ChatCut project in the Codex in-app browser, and stop at the editable rough-cut gate. Do not export or run automatic seam repair before the user decides.
7. If the user requests a revision, revise the ChatCut timeline and reopen the same browser review. If the user approves, record the manual approval and export once to `roughcut/a-roll.mp4`; perform only the basic media probe and lock.
8. In `auto`, warn that automatic export, three-threshold checking, and repair may take a long time, then resolve `rough-cut-review` with the automatic fallback on the same state path.
9. Promote the approved export with `scripts/promote-job-media.mjs <job> roughcut <export> --consume-source` before advancing `rough-cut-export`. It atomically replaces `roughcut/a-roll.mp4` and refreshes the HyperFrames input through a hard link when possible.
10. For `subtitles`, retain any ChatCut timing output only as raw alignment evidence; released captions are authored and installed in HyperFrames. Released wording comes from the persisted reference script when supplied, otherwise from the reconciled recording transcript.

The shared baseline for both caption modes is: protected regions take precedence over decoration; protect any active caption, PiP, product evidence, protected or necessary UI, and platform chrome. The speaker is a trust and connection carrier, not a default protected zone: place MG for the viewer's current cognitive need and feed-scale visibility, not mechanically at the top or bottom to avoid the face. Intentional face coverage is allowed only when it improves the current semantic understanding and preserves one dominant focal group. Check text wrapping, entrance/peak/hold/exit bounds at real feed scale, and audio continuity before adding decorative motion. Caption mode changes only how speech is represented and how much motion is appropriate, not the rough-cut, source-lock, safe-area, or HyperFrames validation discipline.

If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and perform only conservative silence and false-start removal. A job with `state/roughcut-selection.json` must first carry the explicit user waiver described above; the entry and review-decision checks both reject a changed engine, policy/origin, or waiver. Historic legacy null workflows remain supported only when that selection file is absent. Never pretend the ChatCut stage ran.

### 4. Edit-lock precision procedure

This procedure is the automatic rough-cut check. In `review`, the user's ChatCut decision supplies the seam decision and the export performs only basic media checks. In `auto`, the same `rough-cut-review` transition enables this procedure and its derived audit.

1. Run `scripts/detect-silence.sh` at `-30`, `-35`, and `-40 dB`; use the median detected speech boundary instead of trusting one threshold or an ASR word endpoint.
2. Convert candidates into `state/trim-plan.json` as editing decisions only: integer timeline `startFrame`/`endFrame`, explicit classification, reason, semantic evidence, confidence and actual audio-transition frames. Never author derived acoustic boundaries, audit booleans or media hashes.
3. For the default `tight-talking-head` profile, trim asymmetrically: retain about 20 ms after outgoing speech and 50 ms before incoming speech, quantized to the normalized timeline frame grid. Tighten the outgoing decay independently; never move the incoming boundary later merely to make both sides equally tight. These are safety handles, not a target pause duration.
4. Preserve a pause when meaning and visible delivery remain continuous. Remove it when the speaker looks at a script, stops articulating, resets posture or gaze, or prepares a restart. A topic boundary alone does not justify keeping extra dead air.
5. After the physical cut is correct, inspect the first two to three incoming timeline frames and restore one or two frames when the onset sounds shaved; do not restore the whole discarded pause. Then apply zero to two frames of audio transition only when it neither attenuates the incoming onset nor restores discarded tail noise. Two frames is a ceiling, not a requirement.
6. Run the structural trim-plan check and apply the plan only on the automatic fallback. Advancing `rough-cut-export` after `fallback-auto` runs the canonical trim finalizer against the immutable source-timeline transcript, derives both word and three-threshold acoustic handles, binds source and rough-cut hashes, then validates the result. A cut touching a transcript word—including English, numbers, or proper-name tokens—is invalid. Removable resets and false starts may retain at most 80ms, quantized down to timeline frames. Natural pauses are exempt from that ceiling, but a pause above 180ms requires an internal filmstrip-waveform diagnostic and concrete finding.
7. Re-align every later transcript word and animation cue by the cumulative removed duration. Use `scripts/shift-timestamps.sh` when a late cut changes existing state files.

Natural pauses inside continuous delivery remain at their performed length; they are not normalized to an arbitrary 80 ms. A cut is invalid if it clips a phoneme, removes a breath needed for comprehension, retains a visible reading/reset action, or creates a mismatched jump. A low-confidence boundary falls back to 50–120 ms of conservative padding and must be marked for review.

### 5. Semantic beat map and motion plan

Create `state/beat-map.json` before writing animation code.

Copy `assets/design-system.default.json` to `state/design-system.json`, then change it only when the user or supplied brand requires a different system. 得意黑 is the required default display face; missing font media is a blocking preflight failure, not permission to silently fall back.

Every spoken sentence must be represented. Split long sentences into meaningful phrases. Every beat records timing, source, intent, axis, and coverage; only `motion-copy` or approved local-MG beats require motion recipes and micro-events. Caption-only subtitle beats use `mgScope: none` with empty motion fields.

- exact start and end time;
- source transcript segment IDs;
- semantic intent and emphasis;
- A-axis or B-axis treatment;
- one primary motion recipe when motion is approved;
- one `primaryFlowAxis` (`horizontal` or `vertical`) and `visualReference` when motion is approved;
- one `semanticTopology` and word-level `entryAnchorWordId` when motion is approved;
- one word-level `exitAnchorWordId` plus `exitAnchorOffsetFrames` when motion is approved;
- motion family and transition family when motion is approved;
- micro-event timestamps and topology roles; connector/container events share a `revealGroup`;
- supporting components;
- entrance, hold, and exit timing;
- measured typography and layout bounds;
- collision, `focalPlacement` (`center` or `side`), its viewer-visible rationale, any required face-cover rationale, and safe-area notes.

Run `scripts/check-visual-plan.mjs` while preparing a motion-bearing plan or when `auto` validation is enabled. For a new default-policy `subtitles` plan of at least 20 seconds, it is also a hard workflow condition: review mode needs the approved, fingerprinted creative package before `motion-plan` advances. New jobs then stop at `visual-arrangement-review`, where the user reviews that package before composition; explicitly selected `auto` records automatic acceptance instead.

For `subtitles`, write exact one-line segmentation to `docs/caption-plan.md`; for `motion-copy`, review complete designed-speech coverage in the beat map and motion plan without a caption plan. Bundle the applicable artifacts with reconciliation, MG mappings, copy, information gain, style, timing, axis, and intentional no-MG passages in one creative confirmation package. The Agent validates and fingerprints it internally; new review-mode jobs then present it for the separate visual-arrangement decision before HyperFrames composition.

If `state/reference-script-annotations.json` contains visual notes, bind each note to the locked recording timeline and list it in the creative confirmation package as `adopted`, `adjusted`, or `rejected`, with its resolved local scope, final treatment, reason, and relevant beat IDs. Plan every unannotated passage normally. Correct or reject a note that conflicts with the recording, available evidence, visual-value rules, protected regions, or coherent axis behavior.

Any later change to caption segmentation, the MG node set or count, on-screen copy, support role, visual style, or axis mode is a plan change. Use `replan` to return to `motion-plan` and regenerate the package. Only parameter-only corrections that preserve the selected nodes, copy, meaning, style family, and axis—such as a small position, size, or easing adjustment—may return directly to implementation.

In `motion-copy` mode, do not add a separate subtitle band; spoken wording appears inside the designed effects. In `subtitles` mode, the ChatCut-derived caption file carries complete transcript coverage and the beat map contains only supplemental visuals. The first subtitle-mode deliverable is caption-only; continue into local MG only where the creative confirmation package identifies a semantic node and a viewer-first placement that preserves captions, PiP, evidence, protected UI, and platform chrome. English may support Chinese copy, but cannot replace essential Chinese meaning.

Every subtitle-mode local MG must close one documented viewer cognition gap and follow `docs/subtitle-mg-standard.md`. Record its viewer question, support role, concrete removal loss, visual encoding, still-frame value, attention cost, factual-claim sources, and plain-language term explanations in `state/beat-map.json`. New information without sufficient editorial value is not a reason to add MG.

For `subtitles`, preserve ChatCut timing pages only as evidence, align the settled release wording to word timestamps, and write the proposed semantic segmentation to `captions/caption-review-plan.json`. Validate it for transcript completeness, protected terms, function-word isolation, duration, overlap, and measured single-line width when preparing or when `auto` validation is enabled. Promote that exact plan to `captions/captions.json` and install it as timed `.clip` layers in HyperFrames after wording and timing are settled.

### 6. HyperFrames composition

1. Use HyperFrames for media ownership, caption installation, MG, A/B-axis composition, timing, checks, and render.
2. Use HTML/CSS for layout and visual components.
3. Use one paused GSAP timeline registered with HyperFrames. All motion must be deterministic and seek-safe.
4. Keep `<video>` and `<audio>` as direct children of the composition root.
5. Use transforms, opacity, color, and border-radius for motion. Avoid runtime layout measurements and nondeterministic values.
6. Keep the A-roll moving when shown in a picture-in-picture window.
7. Embed 得意黑 through `@font-face`. Run `scripts/check-font.sh` when `auto` validation is enabled or when font behavior is in doubt.
8. Measure text in its final font before animation. Reserve room for outline, shadow, rotation, and overshoot at their peak values.
9. Use `scripts/check-information-value.mjs` and `scripts/check-layout-constraints.mjs` when `auto` validation is enabled. They are not additional workflow gates.
10. Preserve `data-motion-contract="enforced"` and the browser contract from the scaffold. Generic container borders, non-token connector colors, decorative labels, and caption-offset drift are blocking failures; HyperFrames remains responsible for computed peak-frame bounds.
11. Put every authored visual inside one `data-motion-group` that declares axis, primary/auxiliary role, active time, face-cover policy, primary flow, and topology. Mark connectors with their reveal group and rendered flow axis. Mark icon/status roots as `data-motion-role="indicator"` and other composite collision boxes as `data-collision-unit`; an intentional overlap exception applies only to the exact unit carrying `data-overlap-policy="intentional"`. Every `data-motion-role="label"` declares `data-information-role` as `evidence`, `explanation`, `calibration`, `organization`, `action`, or `consequence`; these values match Beat Map `supportRole`. The existing browser contract enforces bounds, protected-region separation, A-axis replacement, group lifetime, and primary-flow continuity during timeline updates.
12. Author each MG Beat under `hyperframes/mg/<beat-id>/` as `fragment.html`, `style.css`, and `timeline.mjs`. Beat IDs match `^[a-z0-9][a-z0-9-]*$`; `mg-<beat-id>` is reserved for the generated wrapper. The builder encloses each stylesheet in `@scope (#mg-<beat-id>)`; keep shared declarations in `index.template.html`. Start the authored Beat root hidden, reveal it explicitly on the shared timeline, and let the builder own its hard exit. Run `scripts/build-composition.mjs` before checks or renders; `hyperframes/index.html` is deterministic generated output and must not be edited. Do not ship a placeholder `*.motion.json`; any motion sidecar must match the checked HTML basename and reference real composition selectors.

### 7. A/B-axis direction

- The A-axis is the talking-head footage with designed effects layered over it.
- A-axis effects use replacement, not accumulation: one primary information group and at most one auxiliary group may remain visible. The prior group exits before the next group enters.
- Within one evidence group, related screenshots may reveal sequentially downward and remain until the group's shared exit; this is not accumulation of separate ideas. Bind each asset to its spoken point, preserve meaningful content and privacy, and verify every requested asset in encoded frames. Keep proof montages only slightly longer than adjacent lifestyle photos (normally about one extra second or less); detailed reading needs a different planned window rather than an unreadably dense montage. Do not hard-code the reference video's 1.95-second timing.
- Inside an approved subtitles-mode A-axis MG passage, prefer 1.8–3.0 second information groups. Caption-only passages have no intra-passage animation cadence requirement; default-policy `subtitles` videos of at least 20 seconds still require meaningful local-MG passages at roughly 10-second coverage, unless a bounded no-MG exception is recorded.
- Place A-axis MG in the viewer's most legible feed-scale focal position for the current semantic task; do not push core information to the top or bottom merely to preserve the face.
- The speaker is a trust and connection carrier, not a default protected zone. Intentional face coverage is allowed when it improves current semantic understanding and does not cover captions, PiP, evidence, protected or necessary UI, or platform chrome. Inspect entrance, peak, hold, and exit at real feed scale, and retain one dominant focal group.
- A-axis surfaces may use localized semi-transparent glass with a restrained blur and the existing typography, borders, shadows, palette and easing. Full-frame glass, haze, or blur is forbidden.
- Every MG declares a horizontal or vertical primary flow. The main chain cannot turn 90 degrees; a secondary-axis branch is allowed only from a terminal node.
- Reuse the visual reference or component named by `visualReference` when only copy, timing, or size changes. A changed primary flow, hierarchy, or animation grammar is a new visual plan.
- The B-axis is a full motion-design stage with the speaker optionally retained in a live circular or shaped window.
- B-axis effects may accumulate within one semantic scene, then exit as a group at that scene boundary. The live PIP remains protected and visibly moving.
- The B-axis PIP exclusion zone is fixed by `design-system.json`; no non-PIP component may overlap it at entrance, peak, hold, or exit. Reserve the zone in CSS before adding lower-third content.
- Use B-axis only when a phrase benefits from a full visual stage. Do not switch axes merely to create activity.
- Avoid rapid A/B/A/B alternation. One coherent B-axis passage is usually stronger than many short cuts.
- The effect may intentionally cover the face when it makes the current meaning clearer; at real feed scale, keep it compositionally balanced, preserve the protected-region exclusions, and retain one dominant focal group.

### 8. Timing and density

- Phrase animation begins within three frames of its acoustic onset unless an intentional anticipation is documented.
- The first meaningful event is word-anchored and appears within 400ms. Connector and downstream container events in one reveal group start within two frames.
- In `motion-copy` mode, create a meaningful micro-event every 0.35–0.9 seconds and normally keep major layouts for 1.8–3.5 seconds.
- In `subtitles` mode, only approved local-MG passages use the 0.8–1.8 second supplemental-motion cadence. For the default policy at 20 seconds or longer, separate meaningful passages start at least 7 seconds apart and every no-MG gap over 12 seconds needs a bounded, reasoned exception; caption-only material does not authorize decorative filler.
- A micro-event may reveal a clause, complete a diagram, strike a tool, move a playhead, change hierarchy, or trigger a semantic particle burst. Do not treat every micro-event as a new scene.
- No more than two consecutive phrases may use the same transition family.
- Reusing a complete visual signature requires one `reuseGroup` and a concrete `reuseReason`.
- Use incremental composition across ideas only on the B-axis. On the A-axis, replace information groups; staged components within one coherent evidence group may share its lifetime and exit.
- Hold important words long enough to read. Fleeting symbols and plus signs are defects.
- Decorative loops must continue through their intended scene end; never freeze before the audio ends.
- Each active frame has one primary focal group and one to four supporting elements. More is noise; fewer may be visually empty unless the emptiness is intentional and documented.
- Primary content should occupy roughly 28–65% of the vertical frame. Large blank cards and crowded edge-to-edge panels both fail.

### 8.1 Typography and layout

- For a 1080×1920 vertical video, primary Chinese copy is normally 84–156 px; secondary copy is at least 42 px.
- Display line height stays between 0.92 and 1.12. Body or explanatory copy stays between 1.15 and 1.35.
- Keep at least 54 px horizontal and 88 px vertical canvas clearance. Reserve at least 18 px around outlined or transformed glyphs.
- Panel padding is normally 48–72 px. Never solve crowding by shrinking primary text below the minimum.
- A rendered Chinese line must never end or begin as a single-character orphan. Use a measured single line, balanced multi-line grouping, or an explicit semantic break with at least two visible Chinese characters on each line.
- Primary content should normally sit between 22% and 78% of frame height. The top strip is for small status labels, not the main sentence.
- Empty components are forbidden. A panel must contain copy, an icon, a status, a diagram, or visible animated state.
- Evaluate entrance, peak overshoot, hold, and exit frames. A layout that works only at rest is not valid.

### 9. Validation and delivery

`review` mode:

1. Build the HyperFrames composition and fix failures that prevent it from rendering.
2. Render once at the requested delivery quality. Use a monolithic render by default; use chunked rendering only for a long video or when the user explicitly asks for it.
3. Verify output existence, duration, frame rate, dimensions, and audio stream with FFprobe.
4. After the file is rendered, generate `state/titles.json` and `output/titles.xlsx` according to `docs/title-standard.md`; `check-titles.mjs` binds that title package to the rendered video before completion.
5. Present the file and title workbook for direct user inspection. These basic checks mean only that the files are structurally usable; they do not judge the edit, animation, aesthetics, or title performance.
6. Do not run full automatic validation, a standard preview, or a routine short sample unless the user explicitly requests one. The bounded screenshot-risk diagnostic above and parameter-revision checks remain allowed; neither authorizes a full automatic audit or an extra approval loop. When the user asks for the complete version, present the current complete encoded candidate after the scoped changes, rather than substituting a local preview.

`auto` mode:

1. Run the applicable automatic checks in `docs/quality-gates.md` at the existing state transitions. The state machine enforces the rough-cut audit, plan/reconciliation checks, and detailed render receipt; deeper HyperFrames/content diagnostics remain explicit commands when requested.
2. Keep the same state sequence and render the delivery from `composition` to `render`; any diagnostic preview is evidence only and never becomes a state.
3. Reuse unchanged evidence only when the existing contract accepts it; do not present an automated pass as editorial or aesthetic approval.

Only canonical large media persists: immutable `input/source.*`, `roughcut/a-roll.mp4`, HyperFrames input, optional local diagnostics, and `output/final.mp4`. Use `promote-job-media.mjs` for explicit external exports; it must reject immutable input, escaped directories, and approved artifacts. Never scan download folders or delete unregistered user files.

## Gold-standard visual language

The finished reference is not a fixed template. It is a reusable motion grammar.

Use recipes from `recipes/` as semantic building blocks, then redesign their layout and choreography for the current sentence. Never paste the same card, transition, or palette across an entire video.

Required qualities:

- large, expressive typography that can overlap the speaker;
- clean surfaces with controlled color, not global haze or dirt;
- soft but saturated accents, restrained shadows, and selective glass;
- clear foreground, midground, and background depth;
- meaningful icons and components rather than empty colored shapes;
- varied motion families joined by consistent typography and easing;
- high animation density without high visual noise.

Read `docs/visual-language.md` before authoring. Treat its anti-patterns as render blockers.

## Failure policy

- Stop on missing input, unreadable media, invalid timing data, or failed final checks.
- Retry a tool operation only when the failure is transient and the retry is safe.
- Never hide a fallback or failed assertion.
- Preserve the last known-good rough cut and HyperFrames composition before a major revision.

## Completion definition

A job is complete on the `review` path when the approved `output/cover.png`, final video, and SHA-bound `output/titles.xlsx` exist, basic media/title checks pass, and the user has the opportunity to inspect the video and title options. Automatic-validation completion is claimed only when the user explicitly selected `auto` and the applicable checks passed.
