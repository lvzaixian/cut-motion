# Motion Plan

> `state/beat-map.json` is the machine source of truth. The user-facing `docs/creative-confirmation.md` is generated from it as the complete visual-arrangement table; this concise plan does not duplicate object timing or material facts.

| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |
| --- | --- | --- | --- | --- | --- | --- |

## Global direction

- Caption mode:
- Typography:
- Palette:
- A/B-axis strategy:
- Finale strategy:
- Subtitle MG cadence (when the copied design system enables it): roughly one meaningful local-MG passage per 10 seconds; passage starts at least 7 seconds apart; list every no-MG exception longer than 12 seconds in `state/beat-map.json` as `mgCadenceExceptions` with a bounded range and reason.
- Visual orchestration V1: register every shown input asset with its hash, visible facts and forbidden inferences; every local MG records `materialRefs` (or `[]`) and object cues before generating the user review package.
- Future visual orchestration V2: each `mgScope: local` Beat chooses `annotation`, `argument`, or `evidence` and records its information delta, basis, and fallback; each `mgScope: none` Beat records a concrete `noMgReason`.

## Screenshot execution checks

Apply repository `docs/unscripted-talking-head-standard.md` sections 4–7 when screenshots are used, including scripted jobs. Keep actual material facts and timings in `state/beat-map.json`; this checklist does not establish a second plan.

- Material coverage: every supplied/requested asset has a recorded use or an explicit reason for omission in content analysis; new selected material enters the existing visual-arrangement review.
- Reading task: distinguish whole-page recognition, cumulative proof of a planning system, and specific detail reading in `viewerQuestion` / `visualEncoding` / `materialRefs.role`. Quick stacking does not claim that every line was read.
- Whole-image default: preserve the aspect ratio with contain; retain page context. Record an explicit benefit for any crop. Masks cover sensitive source fields only and share the image transform.
- Group and trigger: group related materials by the spoken point and bind entry to the specific enumeration/claim words, rather than the broad section start. Independent points use separate groups.
- Budget: derive adjacent-entry spacing, time to complete the stack, last-settled-to-completely-hidden margin, and each image's recognizable window from `objectCues`. That final margin includes exit motion; stable reading ends at the actual exit-motion onset. Do not judge pace only by the overall Beat length or inherit a prior job's frame counts.
- Layout: allocate enough image width, check upper/middle placement against the current picture and caption safe zone, and inspect masks during entry, rotation/scale, hold and exit. Resolve any conflict with the current stage/surface budget in motion-plan; document necessary job-only layout changes in the existing creative package instead of fragmenting the source or silently weakening global constraints.
- Generated package: ensure reading purpose, contain/crop reason, masks, placement and cue phases appear in the actual generated table through the existing fields; editing the Markdown template alone will be overwritten.
- Risk check: for a first complex screenshot group or a concrete timing/masking/overlap risk, inspect only its encoded context window within the approved plan before the full candidate. Record the artifact and actual inspection scope; add no user gate or full automatic audit.

## Review decision

- Recommended option:
- User decision:
- Revision notes:
