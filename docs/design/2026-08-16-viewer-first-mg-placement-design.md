# Viewer-First MG Placement

**Status:** approved design (2026-08-16)

## Goal

Make motion-graphics placement serve the viewer's immediate understanding in the real feed viewport. The talking head provides credibility and connection, but is not a default protected region. Do not push primary information into the top or bottom merely to avoid the speaker's face.

## Decision

1. Put the current semantic answer in the clearest focal position for the viewer. A central focal group is an allowed future default for A-axis overlays; edge placement needs a compositional reason rather than being an automatic face-avoidance tactic.
2. Captions, live PiP, necessary evidence, protected UI, canvas bounds, and platform chrome remain protected. The face does not join that list: an MG may intentionally cover it when doing so makes the current relationship, evidence, or decision easier to see.
3. Keep A-axis replacement, one primary focal group, measured typography, and entrance/peak/hold/exit checks. Remove the automatic three-second face-coverage failure; duration is governed by the semantic scene and legibility, not by face avoidance.
4. For every motion-bearing beat, the motion plan records the viewer question, chosen focal placement, and what (if anything) is intentionally covered. Review those four key frames at feed scale against the existing caption/PiP/evidence exclusions and likely platform chrome.

## Control Changes

- Future A-axis defaults use `viewer-cognition-first` and permit `center` alongside `side`; historic `brief-semantic-only` records remain valid.
- The visual-plan and runtime contracts continue to record face coverage, but no longer reject it solely because it exceeds three seconds.
- Canonical instructions, subtitle-MG guidance, caption-mode guidance, creator templates, schema, and validators use the same policy language.

## Non-goals

- No face detector, platform-specific coordinate table, new workflow state, or new user approval gate.
- No modification, re-render, or migration of existing video deliveries.
- No relaxation of caption, PiP, evidence, UI, canvas, source, or accessibility protections.

## Acceptance Checks

- New job templates expose the central viewer-first policy.
- Existing historic creative-confirmation records remain schema-valid.
- Static visual-plan and HyperFrames checks no longer contain a hard face-duration rejection.
- Repository static verification passes without changing unrelated cover/title work.
