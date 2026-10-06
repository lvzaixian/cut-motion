# cut-motion Job Workspace

This directory belongs to one video job.

**Start with the existing local transcription tool.** This Mac already has `mlx-whisper` and a local Whisper large-v3 model. Read `/Users/maxwellbrooks/Workspace/cut-motion/docs/agent-setup.md` → “本机本地转写：mlx-whisper” for absolute-path checks and the offline command; the executable is `mlx_whisper` in a separate virtual environment. When the checks pass and no other engine was requested, reuse it directly. Missing ChatCut or a command on PATH does not establish that local ASR is unavailable. Read the old runtime/model only; write input copies, raw ASR outputs and logs in this job.

- `input/` contains immutable source media.
- `state/workflow.json` controls progression and approvals.
- `state/` contains machine-readable decisions.
- `state/cover.json` records the 24 V2.1 source-frame choices, the shared direct-crop V2 base, six complete two-line public-cover previews, final hash, and user approval. Historical V1 and V2.0 records retain eight source frames.
- `state/titles.json` records five platform groups of five title candidates, their public-language check, and the hashes tying them to this rendered video and title workbook.
- `state/chatcut-roughcut.json` records the ChatCut project and timeline IDs used for the pre-export manual review.
- `state/roughcut-selection.json` binds the source/reconciliation/reference hashes, current ChatCut record SHA, verification timestamp, and active timeline to complete-take selection and documented source discards; every candidate, including the selected take, carries nonempty audio-reviewed evidence. Regenerate it after any ChatCut record mutation; a `releaseImpact: true` source segment cannot be discarded.
- `state/creative-confirmation.json` records the creative plan and its wording, axis, timing, and MG decisions.
- `state/reference-script-annotations.json` separates local `【】` visual notes from the persisted release wording of the reference script.
- `docs/creative-confirmation.md` bundles caption mode, A/B-axis rules, the storyboard, and optional sample scope; new review-mode jobs present it at `visual-arrangement-review`, which is a package review rather than a second rough-cut edit review.
- `docs/content-analysis.md` records the pre-edit narrative, source-time map, prerequisite context and final-take decisions. Complete it after full transcription and before cover copy or cutting; it adds no user gate.
- `docs/motion-plan.md` is the user-reviewable animation proposal.
- `roughcut/` contains the clean A-roll export produced after manual ChatCut approval or the explicit automatic fallback.
- `captions/` contains generated subtitle data when enabled.
- `hyperframes/` contains the composition.
- `previews/` contains optional short-window or full-audit review artifacts.
- `previews/cover/` contains 24 original V2.1 source-frame choices, one shared direct-crop base, and six complete final cover previews. Optional style-calibration boards stay in `checkpoints/` and do not replace the final six.
- `checkpoints/` preserves optional diagnostics and audit artifacts.
- `logs/` contains tool reports.
- `output/cover.png` is the standalone 3:4 publishing cover; `output/final.mp4` is the video delivery; `output/titles.xlsx` is the five-platform title-choice and publishing-review workbook.

Do not reuse this directory for another source video. Create a new job so the source, wording, timing, and generated artifacts stay together.
