Each motion-graphics Beat owns one directory named after its Beat ID:

```text
mg/<beat-id>/
├── fragment.html
├── style.css
└── timeline.mjs
```

Beat IDs match `^[a-z0-9][a-z0-9-]*$`. `fragment.html` contains exactly
one root with `data-beat-id="<beat-id>"`; do not author the reserved
`id="mg-<beat-id>"`, which belongs to the generated wrapper.
The builder wraps `style.css` in `@scope (#mg-<beat-id>)`; shared at-rules and
declarations belong in `index.template.html`.

Legacy modules receive `timeline`, `beat`, `root`, and `select`. They may tween
only `root` or `select("...")`, must not access global or parent DOM, and must
not create a separate timeline. The builder rejects imports and explicit second
timelines, then applies the root exit using `beat.exitStartTime`,
`beat.exitAnchorTime`, and `beat.exitDuration`.

`motionProfile: "thoughtful-editorial-v1"` is deliberately narrower. Its
fragment must have exactly one `data-cue-id` for every declared object cue; its
`timeline.mjs` may only call `motion.reveal("cue-id", visualOptions)`, exactly
once per cue. It must not reference `root`, `timeline`, `select`, or `gsap`,
and its CSS may not use `@keyframes`, animation, transition, filter,
backdrop-filter, fixed positioning, `@import`, `url(...)`, or `image-set(...)`.
Inline `style`, event handlers, SVG, external-document elements, and dynamic
URLs are also forbidden. The builder owns every cue's factual frame timing and
the root lifecycle. It derives the local-frame-zero state from the output
window: future cues start hidden, already-active cues remain visible in a
visual sample or chunk, and the root stays visible through the latest cue
invisible frame without a separate root fade. `visualOptions` are static object
literals limited to `from`, `legible`, `settled`, and `exit`, with
translation/scale and an approved editorial ease only (`none`, `linear`,
`power*.out`, `sine.out`, or `expo.out`); timings, visibility, repeats,
callbacks, keyframes, rotation, bounce, and elastic easing are builder-owned
or forbidden.

For this profile, declare exactly one `data-motion-surface="container"`.
The `data-beat-id` element is only a structural wrapper: do not give it an ID
or class, and do not target it, the generated `#mg-<beat-id>` wrapper, or a
pseudo-element from profile CSS. Profile CSS uses flat rules only; this keeps
the wrapper transparent and passive rather than becoming an untracked visual
carrier. Box/text shadows, borders, outlines, filters, CSS transitions, CSS
image sources, and all pseudo-elements are forbidden.
`surfaceTreatment: "direct-overlay"` is the default; its one surface must use
`data-surface-kind="direct-overlay"`, contain every cue, and be the only child
of the fragment root. It has no `materialRefs` and may not contain a source-
bearing element or CSS background, overflow, or fixed-position treatment. Use
`evidence-surface` only with referenced material: its one surface must use
`data-surface-kind="evidence-surface"`, `data-evidence-surface-bounded="true"`,
`data-material-ids="material-id"`, and the `evidence-surface` CSS class with
`overflow: hidden` or `clip`. It must render every referenced material through
a literal, quoted `<img data-material-id="material-id" src="../input/...">`;
`srcset`, `poster`, CSS image URLs, SVG/media alternatives, and unbound paths
are rejected. The builder resolves each `src` relative to
`hyperframes/index.html` and checks it against the registered `input/...`
material path. The authored `../input/...` path is provenance-only: generated
main, visual-sample, and chunk HTML replace it with
`./assets/evidence/<basename>`. Before that replacement, the builder verifies
the registered SHA-256 and creates or refreshes only a non-symlink regular
mirror under `hyperframes/assets/evidence/`; samples and chunks reuse their
local `assets` link rather than reaching above the project root. Never author
the generated mirror URL yourself. `data-material-id` alone is not evidence.
The runtime checks that the evidence surface is compact, light, clipped, and
that no visible child escapes its bounds. Profile fragments still obey the
shared layout contract: visible content must live in a declared motion group or
protected content region.

Legacy modules may use this lifecycle baseline:

```css
[data-beat-id="<beat-id>"] {
  opacity: 0;
  visibility: hidden;
}
```

```js
timeline.set(root, { autoAlpha: 1 }, beat.start);
```

The module owns its entrance and internal motion; the builder owns the final
root exit.
