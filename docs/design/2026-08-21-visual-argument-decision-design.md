# Visual Argument Decision Layer

**Status:** proposed design for user review (2026-08-21)
**Scope:** future Chinese talking-head jobs using Cut Motion; no existing delivery, rough cut, caption package, or V1 visual package is migrated by this design.

## Goal

Make the agent decide whether a motion-graphics passage is justified before it decides how the passage looks. The default output is not “an animation for every important word.” The default output is the least demanding treatment that gives the viewer one additional, recording- or material-supported piece of understanding.

The mechanism serves an AI-cognition account whose primary promise is trust in the speaker’s judgement. It uses **冷静底色 + 锋利落点** as a rendering direction, but treats that direction as a presentation layer rather than as the reason to add motion.

## Problem

The current workflow already records a viewer question, support role, removal loss, visual encoding, still-frame value, factual claims, and object-level timing. Those values are independent prose fields. A plan can therefore say that a beat explains a selection while the composition merely enlarges the word “筛选”. Object cues can prove when something appears, but not whether an object, operation, and result form a visual argument.

This leads to four recurrent failures:

1. captions and MG repeat the same keyword instead of dividing information work;
2. verbs become typography effects rather than visible changes to an object or relationship;
3. long passages become “appear → hold → disappear” rather than a continuing argument;
4. cadence pressure can turn a lack of visual justification into decorative filler.

## Decision

Add one `visualDecision` object to each V2 local-MG Beat Map entry. It reuses existing `viewerQuestion`, `supportRole`, `removalLoss`, `visualEncoding`, `stillFrameValue`, factual-claim, material, caption, and cue fields. It does not create a second truth source or a new workflow state.

```text
locked transcript clause
  → agent identifies the viewer cognition gap
  → agent chooses none / annotation / argument / evidence
  → agent declares the new information, basis, objects, operation, and states
  → existing visual-arrangement review exposes the decision and phase frames
  → composition may proceed only after the existing user approval
```

### Treatment modes

| Mode | When it is allowed | What it does not allow |
| --- | --- | --- |
| `none` | Captions and talking head already answer the viewer question. | Cadence-filling decoration. |
| `annotation` | A compact label or trace adds a supported memory anchor but no new argument. | A large restatement of the active caption. |
| `argument` | The recording supports a relation, comparison, selection, causal chain, state change, consequence, or decision aid. | Invented evidence, unexplained extra concepts, or a keyword-only effect. |
| `evidence` | Registered material supports the claim, including a quotation rendered from a registered document or screenshot. | Synthetic dashboards or inferred facts beyond the material boundary. |

`none` is a successful decision, not a missing one. A planner may not change it merely to satisfy a graphic-coverage target.

`mode: "evidence"` and `supportRole: "evidence"` are a one-to-one pair. An evidence beat must use both and must have registered material; a beat with `supportRole: "evidence"` cannot serialize as `annotation` or `argument`.

### Lean V2 decision contract

For `annotation`, `argument`, and `evidence`, `visualDecision` contains:

```json
{
  "mode": "argument",
  "informationDelta": {
    "kind": "selection",
    "statement": "The viewer sees a supported candidate set narrow into a retained result.",
    "basis": "spoken-structure",
    "supportingWordIds": ["timeline-012:word-004", "timeline-012:word-010", "timeline-012:word-016"]
  },
  "objectFamily": "candidate expressions",
  "visualVerb": "filter",
  "evolutionMode": "evolve",
  "argumentStates": [
    {
      "id": "candidates-established",
      "anchorWordId": "timeline-012:word-004",
      "operation": "introduce",
      "activeObjectCueIds": ["candidate-set"],
      "stateChange": "The starting candidate set becomes inspectable.",
      "readability": "clear"
    },
    {
      "id": "candidate-set-narrows",
      "anchorWordId": "timeline-012:word-010",
      "operation": "filter",
      "activeObjectCueIds": ["candidate-set", "selection-trace"],
      "stateChange": "The set visibly changes from many candidates to a smaller retained set.",
      "readability": "clear"
    },
    {
      "id": "result-remains",
      "anchorWordId": "timeline-012:word-016",
      "operation": "resolve",
      "activeObjectCueIds": ["retained-result"],
      "stateChange": "The retained result becomes the readable conclusion.",
      "readability": "clear"
    }
  ],
  "fallback": "caption-only because no supported selection criterion exists"
}
```

Allowed `informationDelta.kind` values are:

```text
evidence | quote-context | comparison | causal-chain | selection |
state-change | consequence | decision-aid
```

Allowed `basis` values are:

```text
spoken-structure | registered-material | both
```

Allowed phase operations are:

```text
introduce | compare | filter | link | transform | resolve
```

`argumentStates` references existing `objectCues`; it does not duplicate their frame windows. A state boundary is resolved from its word anchor and the referenced cue frames. Each state records what changed, not merely that an element entered.

For `annotation`, `visualDecision` contains `mode`, `memoryAnchor`, and nonempty `supportingWordIds`; it does not declare an `informationDelta`. For `none`, the existing `noMgReason` remains the only required decision record. For a factual `evidence` decision, registered `materialRefs`, visible facts, and forbidden inferences remain authoritative. `spoken-structure` and `both` require nonempty, transcript-resolved `supportingWordIds`; `registered-material` and `both` require nonempty registered `materialRefs`.

The exact annotation shape is:

```json
{
  "mode": "annotation",
  "memoryAnchor": "A compact trace retains the already-resolved distinction.",
  "supportingWordIds": ["timeline-014:word-006"],
  "fallback": "caption-only because the anchor adds no durable memory value"
}
```

`memoryAnchor` and `fallback` are nonempty strings; `supportingWordIds` is a nonempty array of transcript-resolved word IDs. `fallback` is required for every non-`none` decision and records the conservative downgrade, not a second creative option.

`evolutionMode` is `replace` by default. `replace` keeps the current short A-axis replacement rule. `evolve` is allowed only for an `argument` that keeps one object family through three to four information states and therefore two to three observable transitions. It may run for 2.4–4.5 seconds only when its persistent cue uses `holdKind: causal-sequence`; it cannot accumulate unrelated cards, repeat a caption as its readable state, or defer its actual result to the exit. Every phase anchor must resolve inside every referenced cue lifecycle. A planned `none` decision may be covered only by an explicit root-level `mgCadenceExceptions` range whose nonempty `coveredNoneBeatIds` names the covered `none` Beat IDs; coverage is never allowed to override that decision.

For V2, a cadence exception has this additional field while V1 keeps its current shape:

```json
{
  "start": 42.0,
  "end": 49.5,
  "reason": "This passage has no grounded visual argument.",
  "coveredNoneBeatIds": ["b07"]
}
```

An `evidence` decision may use only `registered-material` or `both` as its basis. It cannot claim evidence from spoken structure alone.

### Field ownership

The V2 fields do not replace the existing planning fields:

| Field | Single job |
| --- | --- |
| `viewerQuestion` | The cognition gap created by the spoken clause. |
| `informationDelta` | The one new cognition the picture contributes. |
| `removalLoss` | What understanding is lost if the visual decision is removed. |
| `visualEncoding` | The actual rendering method used to express the delta. |
| `stillFrameValue` | What a paused, resolved frame still communicates. |
| `argumentStates` | The ordered changes that produce the delta. |

The confirmation renderer expands these fields directly from `state/beat-map.json`; it never creates a parallel manual explanation.

## Agent decision policy

The planner must make this decision autonomously for every semantic node:

1. **Ask the cognition question.** What does a viewer still not understand after hearing this clause?
2. **Find the information delta.** Is there exactly one relationship, proof, comparison, process, consequence, or decision aid that can answer it?
3. **Verify the basis.** Is the delta explicit in the recording, supported by registered material, or both? If not, choose `none`.
4. **Name an object family.** What concrete thing is compared, filtered, connected, transformed, or evidenced? If the answer is only “the keyword”, choose `none` or a small `annotation`.
5. **Choose the lowest-cost mode.** Evidence before an invented representation; a simple relation before a dense scene; annotation before a visual argument; captions alone when sufficient.
6. **Write the state path.** `before → operation → after → residue`. An `argument` has three to four ordered states using the same object family. An `evidence` scene may have one reading state plus one interpretive state.
7. **Choose the visual verb.** The verb changes the declared object family. It never merely changes the appearance of the word that named it.
8. **Apply authority-fit.** The result uses calm hierarchy, legible whitespace, and one dominant focus. A sharp impact is allowed only for an actual state reversal or resolution.
9. **Run the conservative fallback.** If any step is uncertain, unsupported, or too attention-expensive for the available time, choose `none` and document the reason.

This policy deliberately makes the agent conservative. It is better to retain a credible talking head and caption than to simulate understanding with decorative kinetic type.

## Verbs and visual operations

| Spoken action | Required visible change | Invalid substitute |
| --- | --- | --- |
| 筛选 | Candidate count, membership, or retention basis changes. | A word being crossed out or enlarged. |
| 击中 | A retained object locks to the relevant human/problem criterion and leaves a readable result. | “击中人心” bouncing, scaling, or receiving a generic target icon. |
| 对比 | Two objects align on the same dimension and their difference becomes visible. | Two unrelated labels entering from opposite sides. |
| 推导 | A prior state becomes the cause of the next state. | An arrow with no changed endpoints. |
| 打破 | A prior proposition is removed, split, or contradicted before its replacement resolves. | A transient shake or smash effect. |
| 背书 | Source, exact claim, and current conclusion form an explicit relationship. | A quotation styled as an unsupported decorative card. |

Face coverage is permitted only for a short `impact` transition. It cannot carry information that must be read. A readable `clear` state must restore the viewer’s best reading route, including the speaker when the speaker supplies trust or expression.

## Hard plan rejections

The agent runs these semantic rejections before it writes a local MG into the Beat Map:

1. `informationDelta` merely paraphrases the active caption;
2. there is no object family, operation, or observable before/after state;
3. an `argument` has fewer than two genuine state transitions;
4. an `evidence` concept lacks registered, fact-bounded material;
5. a new factual assertion lacks a recording-supported or material-supported basis;
6. the only readable information is a keyword echo rather than the declared result;
7. the time available cannot support the proposed reader task without competing with captions.

The deterministic checker enforces the parts it can prove: V2 fields, controlled enums, supporting-word IDs, valid word anchors, existing object-cue references, ordered phase boundaries, distinct argument states, material references, fact boundaries, and approved `evolve` duration. It does not pretend to detect paraphrase or “高级感” from free text. The visual-arrangement review and four phase frames remain the backstop for typography, pacing, materiality, and composition.

## User review surface

The existing `motion-plan → visual-arrangement-review → composition` path remains the only user approval boundary.

`docs/creative-confirmation.md` gains two compact additions:

1. a one-page **decision summary**, grouping the video’s approved treatment modes and listing all intentional `none` decisions; and
2. a per-local-MG **argument-state table**, showing information delta, basis, object family, visual verb, phase order, and the existing cue timings.

The package lists four phase-frame points for every local MG. The existing post-composition review capture resolves those points into actual frames. A 3–5 second isolated motion preview is a recommended checkpoint artifact when a grammar has not yet been accepted; it is not a new workflow state or a hidden approval gate. The user reviews the resulting creative judgement, fact boundaries, and exceptions—not individual keyword choices that the agent should make itself.

## Default grammar routing for this account

For AI cognition (“道”) content, the agent defaults to:

1. **argument** for distinctions, mechanisms, trade-offs, selection, and feedback loops;
2. **evidence** for real records, quotation context, and supplied proof;
3. **annotation** for a compact memory anchor after a claim has already been made clear;
4. **none** for emotional conclusions unsupported by an observable structure or source.

For AI technique (“术”) content, the agent defaults to evidence, an operational sequence, or a before/after state. It does not reuse the cognition grammar merely because both videos mention AI.

This is a routing default, not a quota. The video may have long subtitle-only stretches when those best preserve credibility and attention.

## Example: “击中人心”

The phrase is not itself an `argument` basis.

- If the recording or approved material establishes an actual candidate set and selection criterion, the agent may choose `argument: selection`: candidates establish → comparison/filter changes the set → a retained result resolves → a small residue remains.
- If those objects or criteria are absent, the agent must choose `annotation` or `none`. It must not invent ten candidates, a target icon, a human reaction, or a performance claim just to make the verb feel strong.

In either case, impact is a short transition, not the readable conclusion. The post-impact image carries the information.

## Compatibility and migration

- Existing `visualOrchestrationVersion: 1` packages, historic jobs, current deliveries, and the isolated pilots remain valid and unchanged.
- New scaffolds move to `visualOrchestrationVersion: 2` after implementation.
- V2 fields are required only for V2 local MG beats. V1 validators keep their current behavior.
- V2 local MG reuses the existing `thoughtful-editorial-v1` motion profile, object-cue scheduler, surface contract, evidence mirror, and render-window resolver. V2 adds a planning decision layer; it does not introduce a second animation runtime.
- No new workflow state, dependency, external service, full-video renderer, or AI aesthetic score is introduced.
- Any V2 plan change to the decision object, phase order, material basis, on-screen copy, or treatment mode invalidates visual-arrangement approval and returns the job to `motion-plan`.

## Implementation boundary

The implementation is deliberately narrow:

1. add one shared `isVisualOrchestrationVersion()` discriminator, permit V1 and V2 in the Beat Map schema, and write V2 from new scaffold defaults;
2. route the shared discriminator through the visual-plan checker, confirmation renderer/checker, workflow authority fingerprinting and transition checks, and composition builder; V1 keeps its current behavior;
3. add decision and phase validation to `check-visual-plan.mjs`, including supporting words, material basis, state lifecycle, and explicit cognition-null cadence exceptions;
4. expose the new fields in the existing confirmation renderer and confirmation checker, then include phase boundaries in existing review-frame generation;
5. add targeted fixture tests for a rejected keyword echo, unsupported evidence, missing state transition, invalid V2 routing, valid selection argument, V1 compatibility, and approval invalidation.

No new animation framework, autonomous “taste model”, template marketplace, or review gate is needed.

## Acceptance criteria

- A newly scaffolded V2 subtitle job cannot plan a local MG without a grounded visual decision.
- A keyword-only “击中人心” MG fails unless it has a recording- or material-supported object family, state path, and result.
- A valid selection scene proves two or more changed states tied to existing object cues.
- A factual evidence scene cannot bypass registered-material boundaries.
- V1 packages remain valid and can be re-rendered unchanged.
- The confirmation package lets a user identify the information delta and phase sequence for every local MG before composition.
- A planner can choose `none` without triggering a coverage or cadence failure merely because the frame would otherwise be less lively.

## Non-goals

- Automatically deciding whether a frame looks “高级”.
- Replacing the user’s visual-arrangement approval.
- Inventing examples, data, reactions, or selection criteria that the recording and registered materials do not support.
- Retrofitting V2 into the current completed or sample videos.
- Increasing MG density as a proxy for retention.
