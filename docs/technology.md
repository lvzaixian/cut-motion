# Default Technology Stack

- **Local mlx-whisper** — full source transcription before whole-content analysis and downstream planning; see `docs/agent-setup.md` for the existing runtime.
- **ChatCut** — editable rough cut; any later timing evidence supplements the completed local first pass.
- **FFmpeg / FFprobe** — media probing, silence diagnosis, precision trims, and delivery verification.
- **HyperFrames** — HTML composition timing, validation, preview, and rendering.
- **HTML / CSS** — visual structure, typography, panels, diagrams, and decorative systems.
- **GSAP** — seek-safe timeline choreography, transforms, easing, stagger, and depth.

Remotion and Vibe Motion are optional adapters, not default dependencies.

## HyperFrames composition contract

- Build the composition in HTML/CSS and register one paused, seek-safe GSAP timeline. Keep `<video>` and `<audio>` as direct children of the composition root; keep PiP footage moving.
- Embed the confirmed 得意黑 font; missing required font media blocks composition and never silently authorizes a fallback. The composition waits for fonts and evidence images before measuring layout and registering its finished timeline.
- The assembler writes template beats to `hyperframes/mg/<beat-id>/`. Author `fragment.html`, `style.css`, and `timeline.mjs` yourself only for custom MG; use one `data-motion-group` per visual with its axis, kind, time, face policy, flow, and topology.
- Mark labels with their `data-information-role`; connectors with `data-motion-role="connector"`, reveal group, flow axis, and color token/property; indicators and collision units with their roles. Mark only the exact intentional overlap with `data-overlap-policy="intentional"`.
- Start beat roots hidden. For `thoughtful-editorial-v1`, call `motion.reveal` once per object cue; the builder owns the root lifetime and all content timing. Keep shared styles in `index.template.html`; run `scripts/build-composition.mjs` to rebuild `hyperframes/index.html` before rendering.
