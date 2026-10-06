/** Thin data adapter over the approved HTML/CSS/GSAP sources. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateContent } from "./mg-template-content.mjs";

export const templateRoot = fileURLToPath(new URL("../templates/motion-graphics/", import.meta.url));
export const DEFAULT_MG_TOP_PX = 280; // Upper placement on the 1080×1920 template canvas.
const entries = {
  "ordered-steps": ["h3", "p", "h3", "p", "h3", "p", "h3", "p"],
  "parallel-points": ["p", "p", "p", "p"],
  "linear-flow": ["h3", "h3", "h3", "h3"],
  "relation-map": ["h3", "h4", "h4", "h4"],
  "converge-sources": ["h3", "h3", "h3", "h3", "p"],
  "map-transform": ["h3", "p"],
  comparison: ["p", "span", "p", "span", "p"],
  "metric-proof": ["p", "span", "span", "p"],
  "evidence-focus": [],
  quote: ["p", "p"],
  "code-snippet": ["p", "code", "code", "code", "code"],
  correction: ["old", "p"],
  annotation: ["p"],
  "stage/b-axis-horizon-grid": [],
  "stage/axis-stage-transition": []
};
const aliases = { "list-ordered": "ordered-steps", "ordered-list": "ordered-steps", "list-unordered": "parallel-points", "list-build": "parallel-points", "quote-reveal": "quote", "code-block": "code-snippet", "code-build": "code-snippet", "b-axis-horizon-grid": "stage/b-axis-horizon-grid", "axis-stage-transition": "stage/axis-stage-transition" };
export const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const componentNames = () => Object.keys(entries);
export function resolveComponent(reference) {
  const name = aliases[reference] ?? reference;
  if (!Object.hasOwn(entries, name ?? "")) return null;
  const slots = entries[name]; // Legacy sample count, never a content limit.
  // The shared transition helper has no fragment; every other template owns
  // its semantic metadata on the rendered root element.
  let semanticTopology = "demonstration", primaryFlowAxis = "vertical";
  if (name !== "stage/axis-stage-transition") {
    const fragment = fs.readFileSync(path.join(templateRoot, name, "fragment.html"), "utf8");
    const root = fragment.match(/^\s*<div\b[^>]*>/)?.[0] ?? "";
    semanticTopology = root.match(/\bdata-topology=["']([^"']+)["']/)?.[1];
    primaryFlowAxis = root.match(/\bdata-primary-flow-axis=["']([^"']+)["']/)?.[1];
    if (!semanticTopology || !primaryFlowAxis) throw new Error(`${name}: template root needs data-topology and data-primary-flow-axis`);
  }
  return { meta: { name, semanticTopology, primaryFlowAxis, motionFamily: "editorial", transitionFamily: "template-reveal", summary: `Reusable ${name} template`, legacyCopySlots: slots.length, ...(!name.startsWith("stage/") ? { defaultTopPx: DEFAULT_MG_TOP_PX } : {}) }, content: beat => templateContent(name, beat), render: ({ beat }) => renderTemplate(name, beat) };
}
export const describeComponents = () => componentNames().map((name) => resolveComponent(name).meta);
export function templateMicroEvents(beat, fps) {
  const component = resolveComponent(beat.templateId);
  if (!component || !beat.objectCues) return [];
  const slots = [...component.content(beat).body.matchAll(/<[^>]+\bdata-at="[^"]*"[^>]*>/g)].map(match => match[0]);
  return beat.objectCues.flatMap((cue, index) => {
    const name = component.meta.name, slot = slots[index] ?? "";
    let topologyRole = "node";
    if (name === "converge-sources") topologyRole = /converge-result/.test(slot) ? "result" : "input";
    else if (name === "relation-map") topologyRole = /map-source/.test(slot) ? "source" : "branch";
    else if (name === "map-transform") topologyRole = /transform-source/.test(slot) ? "source" : "result";
    else if (name === "comparison") topologyRole = index < Math.ceil(slots.length / 2) ? "comparison-a" : "comparison-b";
    const linked = ["result", "branch"].includes(topologyRole) && ["converge-sources", "relation-map", "map-transform"].includes(name);
    const event = { time: cue.firstLegibleFrame / fps, type: "reveal", semanticChange: cue.semanticRole,
      topologyRole, visualRole: linked ? "container" : "copy", ...(linked ? { revealGroup: cue.id } : {}) };
    return linked ? [event, { ...event, type: "link", semanticChange: `${cue.semanticRole}: relationship becomes visible`, visualRole: "connector" }] : [event];
  });
}
export function componentFor(beat) {
  const requested = beat.templateId ?? beat.mgComponent ?? beat.recipe;
  if (requested === "custom") return { component: null, requested, via: "custom" };
  const component = resolveComponent(requested);
  if (!component) throw new Error(`${beat.id}: unknown template ${requested}; choose a canonical templateId or custom`);
  return { component, requested, via: "templateId" };
}

// Production modules keep semantic structure, while the builder owns all cue
// timing. The upstream sources remain available for legacy modules and galleries.
function renderControlledTemplate(name, beat, content) {
  if (name.startsWith("stage/")) throw new Error(`${beat.id}: stage helpers belong to the shared host; use an approved custom stage plan`);
  const cues = beat.objectCues ?? [];
  let body = content.body;
  let style = "";
  if (name === "evidence-focus") {
    if (beat.surfaceTreatment !== "evidence-surface" || beat.materialRefs?.length !== 1) throw new Error(`${beat.id}: evidence-focus needs one registered evidence-surface material`);
    const data = beat.templateData;
    const materialId = beat.materialRefs[0].materialId;
    // The full image stays intact. Corner marks identify measured regions,
    // rather than panning or cropping the screenshot after approval.
    body = `<div class="evidence-canvas"><div class="evidence-image-cue" data-at="0"><img class="evidence-image" data-material-id="${escapeHtml(materialId)}" src="${escapeHtml(data.image)}" alt="${escapeHtml(data.alt)}">${data.focus.map(({x,y,width,height}, index) => `<span class="focus-region focus-${index}"${index ? ' data-at="0"' : ''} data-collision-unit data-overlap-policy="intentional" aria-hidden="true"><span>⌜</span><span>⌝</span><span>⌞</span><span>⌟</span></span>`).join("")}</div></div>`;
    style += `.evidence-canvas,.evidence-image-cue{position:relative;width:100%;height:100%}.evidence-image{display:block;width:100%;height:100%;object-fit:contain}.focus-region{position:absolute;display:grid;grid-template-columns:1fr 1fr;color:#FFD15C;font-size:48px;line-height:1}.focus-region span:nth-child(even){text-align:right}.focus-region span:nth-child(n+3){align-self:end}\n`;
    const imageWidth = data.imageWidthPx, imageHeight = data.imageHeightPx;
    if (!(Number.isFinite(imageWidth) && imageWidth > 0 && Number.isFinite(imageHeight) && imageHeight > 0)) throw new Error(`${beat.id}: evidence-focus needs actual imageWidthPx/imageHeightPx for full-image focus coordinates`);
    style += `.evidence-canvas{height:auto;aspect-ratio:${imageWidth}/${imageHeight}}\n`;
    style += data.focus.map(({x,y,width,height},i) => `.focus-${i}{left:${x}%;top:${y}%;width:${width}%;height:${height}%}`).join("\n");
  } else {
    body = body.replace(/<svg\b[^]*?<\/svg>/g, "")
      .replace(/<div class="(?:steps|points)-surface"[^]*?<\/div>/g, "")
      .replace(/<span class="(?:point-mark|source-mark)"[^]*?<\/span>/g, "")
      .replace(/<span class="flow-orb"[^]*?<\/span>/g, "")
      .replace(/<div class="transform-link"[^]*?<\/div>/g, "")
      .replace(/<i class="(?:step-link|flow-link|map-drop)"[^>]*><\/i>/g, `<span class="semantic-link" aria-hidden="true">${content.axis === "horizontal" ? "→" : "↓"}</span>`)
      .replace('<div class="quote-rule" data-at="0"></div>', '<span class="quote-rule" data-at="0" aria-hidden="true">“</span>')
      .replace('<span class="correction-strike" data-at="0" aria-hidden="true"></span>', '<span class="correction-strike" data-at="0" aria-hidden="true">×</span>')
      .replace(/(<p class="(?:transform|converge)-result"[^>]*>)/g, `$1<span class="semantic-link" aria-hidden="true">${content.axis === "horizontal" ? "→" : "↓"}</span>`)
      .replace(/\s(?:style|data-motion-surface)="[^"]*"/g, "");
  }
  const count = [...body.matchAll(/data-at=/g)].length;
  if (count !== cues.length || new Set(cues.map(cue => cue.id)).size !== count) throw new Error(`${beat.id}: template has ${count} semantic slots; declare exactly that many unique objectCues`);
  let index = 0;
  const startFrame = Math.min(...cues.map(cue => cue.preMotionFrame));
  const endFrame = Math.max(...cues.map(cue => cue.invisibleFrame));
  const fps = beat.fps ?? 30;
  body = body.replace(/data-at="[^"]*"/g, () => `data-at="${(cues[index].firstLegibleFrame - startFrame) / fps}" data-cue-id="${escapeHtml(cues[index++].id)}"`);
  const bounds = beat.layout?.primaryBoundsNormalized;
  if (!bounds || Object.values(bounds).some(value => !Number.isFinite(value))) throw new Error(`${beat.id}: controlled template needs explicit normalized layout bounds`);
  const font = beat.typography?.fontSizePx ?? 96;
  if (!(Number.isFinite(font) && font > 0)) throw new Error(`${beat.id}: controlled template font size must be positive`);
  const lineHeight = beat.typography?.lineHeight ?? 1.1;
  if (!(Number.isFinite(lineHeight) && lineHeight > 0)) throw new Error(`${beat.id}: controlled template line height must be positive`);
  const surface = beat.surfaceTreatment === "evidence-surface" ? `class="evidence-surface" data-surface-kind="evidence-surface" data-evidence-surface-bounded="true" data-material-ids="${escapeHtml(beat.materialRefs.map(ref => ref.materialId).join(","))}"` : 'class="template-surface" data-surface-kind="direct-overlay"';
  const group = `data-motion-group="${escapeHtml(beat.id)}" data-motion-surface="container" data-border-policy="none" data-axis="${escapeHtml(beat.axis ?? "A")}" data-group-kind="${name === "annotation" ? "auxiliary" : "primary"}" data-group-start="${startFrame / fps}" data-group-duration="${(endFrame - startFrame) / fps}" data-face-cover="${escapeHtml(beat.layout.faceCover ?? "none")}" data-primary-flow-axis="${escapeHtml(beat.primaryFlowAxis ?? content.axis)}" data-semantic-topology="${escapeHtml(beat.semanticTopology)}"`;
  const selector = beat.surfaceTreatment === "evidence-surface" ? ".evidence-surface" : ".template-surface";
  style += `\n${selector}{position:absolute;left:${bounds.x * 100}%;top:${bounds.y * 100}%;width:${bounds.width * 100}%;height:${bounds.height * 100}%;font-family:"Smiley Sans";font-size:${font}px;line-height:${lineHeight};color:#FFFDF5;${beat.surfaceTreatment === "evidence-surface" ? "overflow:hidden;" : ""}}\n`;
  style += `[data-cue-id]{opacity:0;visibility:hidden}p,h3,h4{margin:0}section{display:flex;flex-direction:column;gap:20px}.step,.point,.flow-node,.map-target,.code-line{display:flex;align-items:center;gap:20px}.steps-list,.points-list,.flow-nodes,.map-targets,.code-lines{display:flex;flex-direction:column;gap:20px}.step-number,.code-number,.semantic-link{color:var(--connector,#FFD15C)}.step-description,.point-description,.flow-description,.map-description,.proof-source,.proof-caption,.quote-credit,.compare-kicker{font-size:${Math.max(42, font * .55)}px}.proof-value,.correction-new,.converge-result,.transform-result{color:#FFD15C}.compare-grid{display:grid;grid-template-columns:repeat(${content.normalizedData.items?.length ?? 2},1fr);gap:30px}.converge-inputs{display:grid;grid-template-columns:repeat(${Math.min(3, content.normalizedData.items?.length ?? 1)},1fr);gap:24px}.annotation-caption-copy{display:flex;gap:24px}.correction-old{position:relative}.correction-strike{position:absolute;inset:0;color:#FFD15C;font-size:${font * 1.4}px}.quote-rule{font-size:${font * 1.5}px}.code-highlight{color:#FFD15C}\n`;
  if (content.axis === "horizontal" && name === "linear-flow") style += ".flow-nodes{flex-direction:row}\n";
  if (beat.templateData.layout === "vertical" && name === "comparison") style += ".compare-grid{grid-template-columns:1fr}\n";
  return {
    fragment: `<div data-beat-id="${escapeHtml(beat.id)}"><div ${surface} ${group}>${body}</div></div>\n`,
    style,
    timeline: cues.map(cue => `motion.reveal(${JSON.stringify(cue.id)}, { from: { y: 8 }, legible: { y: 4 }, settled: { y: 0, ease: "power2.out" }, exit: { y: -4 } });`).join("\n") + "\n"
  };
}

export function renderTemplate(name, beat) {
  if (name === "stage/axis-stage-transition") throw new Error("A/B transition belongs to the shared composition timeline");
  const directory = path.join(templateRoot, name);
  let fragment = fs.readFileSync(path.join(directory, "fragment.html"), "utf8");
  const data = beat.templateData ?? {};
  const copy = data.copy ?? beat.onScreenCopy ?? [];
  if (!Array.isArray(copy) || copy.some(value => typeof value !== "string")) throw new Error(`${beat.id}: MG copy must be text strings`);
  if (data.items !== undefined && (!Array.isArray(data.items) || data.items.some(item => typeof item !== "string" && (!item || typeof (item.label ?? item.text) !== "string")))) throw new Error(`${beat.id}: items need text or labelled objects`);
  if (name === "evidence-focus") {
    const inputImage = beat.motionProfile === "thoughtful-editorial-v1" && /^\.\.\/input\/[a-zA-Z0-9_./-]+$/.test(data.image ?? "") && !data.image.slice(3).split("/").includes("..");
    if (!inputImage && (typeof data.image !== "string" || !data.image.replace(/^\.\//, "").startsWith("assets/") || !/^[a-zA-Z0-9_./-]+$/.test(data.image) || data.image.split("/").includes("..")) || typeof data.alt !== "string") throw new Error(`${beat.id}: evidence needs a registered input image (controlled) or local assets/ image (legacy), and alt text`);
    if (!Array.isArray(data.focus) || !data.focus.length) throw new Error(`${beat.id}: evidence needs focus rectangles`);
    for (const { x, y, width, height } of data.focus) {
      if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) throw new Error(`${beat.id}: invalid focus rectangle percentages`);
    }
  }
  const content = templateContent(name, beat);
  if (beat.motionProfile === "thoughtful-editorial-v1") return renderControlledTemplate(name, beat, content);
  if (content) {
    if (name !== "evidence-focus" && !content.copy.length) throw new Error(`${beat.id}: MG needs meaningful content`);
    const rootTag = fragment.match(/^\s*<div\b[^>]*>/)[0].replace(/\s(?:style|data-layout)="[^"]*"/g, "");
    const layout = data.layout ?? (name === "linear-flow" && (data.items?.length ?? copy.length) > 4 ? "vertical" : "default");
    const axis = name === "linear-flow" && layout === "vertical" ? "vertical" : content.axis;
    fragment = `${rootTag}${content.body}</div>\n`.replace(/data-primary-flow-axis="[^"]*"/, `data-primary-flow-axis="${axis}"`);
    fragment = fragment.replace(/^(\s*<div[^>]*)(>)/, `$1 data-layout="${escapeHtml(layout)}"$2`);
  }
  fragment = fragment.replace(/data-beat-id="[^"]*"/, `data-beat-id="${escapeHtml(beat.id)}"`).replace(/data-axis="[^"]*"/, `data-axis="${escapeHtml(beat.axis ?? "A")}"`);
  if (beat.layout?.faceCover) fragment = fragment.replace(/data-face-cover="[^"]*"/, `data-face-cover="${escapeHtml(beat.layout.faceCover)}"`);
  const times = data.revealTimes ?? (beat.microEvents?.length ? beat.microEvents.map((event) => Number(event.time) - Number(beat.start)) : null);
  const count = [...fragment.matchAll(/data-at="[^"]*"/g)].length;
  if (times && (times.length !== count || times.some((time) => !Number.isFinite(time) || time < 0 || time >= beat.end - beat.start))) throw new Error(`${beat.id}: revealTimes needs ${count} relative times inside the beat`);
  let atIndex = 0;
  fragment = fragment.replace(/data-at="([^"]*)"/g, (_, value) => {
    const time = times ? times[atIndex++] : (count <= 1 ? 0 : atIndex++ * Math.min(0.55, (beat.end - beat.start) * 0.55 / (count - 1)));
    if (time >= beat.end - beat.start) throw new Error(`${beat.id}: sample reveal exceeds beat; supply revealTimes`);
    return `data-at="${time}"`;
  });
  const topPx = data.topPx !== undefined ? data.topPx : (!name.startsWith("stage/") ? DEFAULT_MG_TOP_PX : undefined);
  if (topPx !== undefined) {
    if (!Number.isFinite(topPx)) throw new Error(`${beat.id}: topPx must be finite`);
    if (data.widthPx !== undefined && (!Number.isFinite(data.widthPx) || data.widthPx <= 0)) throw new Error(`${beat.id}: widthPx must be positive`);
    const width = data.widthPx === undefined ? "" : `;--mg-width:${data.widthPx}px`;
    fragment = fragment.replace(/^(\s*<div[^>]*)(>)/, `$1 style="--mg-top:${topPx}px${width}"$2`);
  }
  let style = fs.readFileSync(path.join(directory, "style.css"), "utf8");
  return { fragment, style, timeline: fs.readFileSync(path.join(directory, "timeline.mjs"), "utf8") };
}
