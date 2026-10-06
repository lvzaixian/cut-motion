# Workflow State Machine

`state/workflow.json` is authoritative. `intake` advances to transcription without a cover. After full transcription and content analysis, `transcription → rough-cut` requires an approved standalone cover package; this is a checkpoint within transcription, not a new state. `rough-cut-review` remains the only edit-review state. New review-mode jobs also stop at `visual-arrangement-review` to approve the creative package, not to revise the editable rough cut.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → visual-arrangement-review → composition → render → complete
```

The post-analysis cover checkpoint uses `state/cover.json`, `previews/cover/`, and `output/cover.png`. New `2.1.0` jobs present exactly 24 original source-frame choices, then—after the user selects and crops one—may calibrate font/size/spacing separately in `checkpoints/` before rendering exactly six formal `talking-head-opinion-poster-v2` direct-crop previews from one shared base. The calibration board is not one of the six final public-copy choices. Historical V1 and `2.0.0` packages remain readable with eight source frames. After the user selects one full formal preview, record it with:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-cover --actor user --note "Selected public cover copy"
```

`advance` into `rough-cut` rejects an unapproved or altered cover package. Content analysis is required editorial work recorded in `docs/content-analysis.md`; a successful structural transition does not establish semantic quality. Reconciliation returning directly to a later state retains its existing route and does not add another cover decision. Re-running `approve-cover` after delivery updates only the cover record and image; it does not change the current video state.

The render exit also requires a title package. After `output/final.mp4` (or a delivery revision's `output/final.candidate.mp4`) exists, create `state/titles.json` and `output/titles.xlsx` according to `docs/title-standard.md`. `advance` validates exactly five candidates for each of 抖音、视频号、小红书、B站、快手, checks the workbook hash, and compares the package's source-video hash to this exact render before any candidate is promoted. It does not create another state or user approval point.

`rough-cut` records the ChatCut project and timeline only. ChatCut does not author released captions, MG, or B-axis scenes. After the user approves the timeline, export once to `roughcut/a-roll.mp4` and run only the basic media lock.

To abandon the manual review explicitly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note "Skip manual ChatCut review"
```

The command warns that export, three-threshold seam checking, and repair may take a long time.

## Preferences and transcript

Ask once for caption, reference-script, and visual-axis preferences. If omitted, record an Agent recommendation before rough-cut approval. A reference script is immutable wording evidence; reconcile it with the recording. ChatCut/ASR supplies timing, while HyperFrames owns released captions and all motion graphics.

Use `set-caption-mode` and `set-axis-mode` so changes are recorded. A caption or axis change at or after planning returns to `motion-plan`.

## Modes

`review` is the default: wait at `rough-cut-review`, export once after approval, build HyperFrames, render once, and let the user judge the result.

After that manual rough-cut approval, the Agent may record a fully validated subtitle/MG package without adding a second user gate:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-creative --actor agent --note "Validated creative package after approved rough cut"
```

This command is valid only in `review` mode at `motion-plan` after `manual-approved`; it checks and fingerprints the package but does not move the workflow state.

New review-mode jobs next enter `visual-arrangement-review` with `docs/creative-confirmation.md` recorded in the gate and history. Only the user may approve it:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve-visual-arrangement --actor user --note "Approved visual arrangement"
```

This is a review of the planned captions, MG, axis, copy, and timing package—not another ChatCut rough-cut review. `revise-visual-arrangement --actor user --note ...` returns to `motion-plan` and invalidates its fingerprints. Older workflows without `visualArrangementReviewRequired` retain their direct `motion-plan → composition` route.

Scaffolding always initializes `review`. `auto` is available only after the user explicitly selects it:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-mode auto --actor user
```

It automatically selects the rough-cut fallback when the rough-cut reaches review, records `automatic-accepted` for the validated visual package instead of pausing at its review, and runs the explicit structural/technical checks during planning and delivery. It is slower by design; passing checks is not an aesthetic approval.

## Revisions

Use `reopen` for completed jobs:

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: caption segmentation, MG structure/copy, style, or axis;
- `composition`: parameter-only visual changes;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion. Generate a new title package after each new render; a package bound to the prior video is rejected.
