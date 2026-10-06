# Workflow Architecture

Each job owns its source, state, previews, logs, and output under `jobs/<job-id>/`. Never overwrite the source or place generated media in the repository root.

## Stage contracts

| State | Contract |
| --- | --- |
| `intake` | Validate immutable source media and record deferred preferences; do not wait for cover approval. |
| `transcription` | Transcribe the full recording, reconcile wording, analyze narrative and repeated takes in `docs/content-analysis.md`, then approve the content-grounded cover and lock source word timings. |
| `rough-cut` | Build the analyzed narrative in ChatCut using the last complete take in each retry group; preserve required setup and record the editable project/timeline. |
| `rough-cut-review` | User approves, revises, or explicitly chooses `fallback-auto`. |
| `rough-cut-export` | Export the approved rough cut and perform the basic media lock; `fallback-auto` also runs the trim audit. |
| `motion-plan` | Author wording, captions, beat map, MG, axis, and timing for HyperFrames. |
| `visual-arrangement-review` | User reviews `docs/creative-confirmation.md` and approves the planned visual arrangement or returns it to planning. |
| `composition` | Build deterministic HyperFrames HTML/CSS/GSAP composition. |
| `render` | Produce the requested delivery, verify media, then generate the SHA-bound platform title package. |
| `complete` | Keep the job available for scoped revisions. |

## Human-first path

ChatCut is only the rough-cut editor. Do not add released subtitles or motion graphics there. HyperFrames owns captions, B-axis treatment, MG, composition timing, and final rendering so caption timing and MG remain bound to one timeline.

After full transcription and content analysis, prepare the cover within `transcription` before entering `rough-cut`: new `2.1.0` jobs present exactly 24 real source frames, record the user's selected 3:4 crop, and—only if needed—calibrate the locked style separately in `checkpoints/`. Then give the user exactly six complete `talking-head-opinion-poster-v2` direct-crop previews that all reuse one cropped base and fixed eye-above two-line layout but have different public copy. Historical V1 and `2.0.0` packages retain their eight-frame checks. Render the selected formal preview to `output/cover.png`, and record it with `approve-cover`. The cover is a separate publishing asset; it does not enter the video timeline or affect `output/final.mp4`. A later cover-only revision records another approval without reopening rough cut, composition, or delivery.

After the final render exists, generate `state/titles.json` and `output/titles.xlsx` under `docs/title-standard.md`. The package holds exactly five candidates for 抖音、视频号、小红书、B站、快手 and is verified against the hash of this render before `render → complete`. It is a publication-preparation deliverable, not an automated publishing action or user approval gate.

In `review` mode, the user inspects the ChatCut timeline before export, then the planned visual arrangement package before composition, and finally the rendered file. The visual-arrangement review is not a second rough-cut edit review: it confirms the package's planned captions, MG, copy, timing, and visual axis. The default path does not render a standard preview, run a full visual QA pass, or compare two encodes.

## Automatic path

Only after the user explicitly selects `auto`, it follows the same state route, selects the rough-cut fallback after recording the timeline, records automatic acceptance of the validated visual package, warns about the delay, and runs deterministic transcript, plan, render, and media checks. Optional reports or `previews/final-preview.mp4` may be generated when the user explicitly asks for an audit or preview.

## Wording and visual axis

The recording remains authoritative for spoken content. A supplied reference script is preserved and reconciled; it can provide release wording only where the recording supports it. ChatCut or the existing local mlx-whisper runtime supplies draft text and timing evidence; see `docs/agent-setup.md` for verified host paths and use. Complete the content analysis before editing even when a reference script exists. Follow `docs/talking-head-trim-standard.md` for latest-take selection and context-preserving cuts.

Without a reference script, follow [the unscripted talking-head standard](unscripted-talking-head-standard.md): establish the actual listening/review capability during transcription, resolve known wording doubts in one batch before release-caption planning, and review both speech and visible resets before the first rough-cut review. Use the existing template sections; this adds no state or user decision. ASR and narrow user confirmations never establish full-source listening, and a previous job's exception cannot be inherited.

For screenshots, that standard requires an early complete material inventory, whole-image presentation with field-level masking by default, an explicit reading task, specific spoken-word anchors, and separate entry/interval/final-hold budgets. Store executable facts in the existing Beat Map fields and regenerate the creative package. Within an approved plan, a first complex screenshot group or an identified masking, overlap, or timing risk may receive a bounded encoded context diagnostic before the delivery render; this does not change the default prohibition on routine standard previews or full automatic QA. The user's requested complete version remains the review artifact.

`subtitles` uses HyperFrames subtitle layers for the settled wording and reserves MG for supplemental meaning. `motion-copy` puts spoken wording inside designed motion. A-axis keeps the talking head full-frame with localized overlays; B-axis makes motion design the stage with a protected live PiP. B-axis and hybrid require explicit user choice.

## Revisions

Use `reopen rough-cut|motion-plan|composition|delivery` for completed jobs. Parameter-only changes should use an affected-window preview before a full delivery render. Delivery revisions render to `output/final.candidate.mp4`, require a regenerated title package bound to that candidate, and are promoted by the workflow after media and title-package verification.
