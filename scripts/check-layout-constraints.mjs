import fs from "node:fs";
import path from "node:path";

const [compositionPath, designSystemPath] = process.argv.slice(2);

if (!compositionPath || !designSystemPath) {
  console.error("Usage: node check-layout-constraints.mjs <index.html> <design-system.json>");
  process.exit(64);
}

const composition = fs.readFileSync(compositionPath, "utf8");
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const beatMapSchema = JSON.parse(fs.readFileSync(new URL("../schemas/beat-map.schema.json", import.meta.url), "utf8"));
const informationRoles = beatMapSchema.properties.beats.items.properties.supportRole.enum;
const informationRolePattern = new RegExp(
  `data-information-role=["'](${informationRoles.join("|")})["']`,
  "i"
);
const errors = [];
const typography = designSystem.typography ?? {};
const bAxisPolicy = designSystem.axisPolicies?.B ?? {};
const motionContract = designSystem.motionContract ?? {};
const attribute = (tag, name) => new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
const scopedCss = (scopeId) => {
  const marker = `@scope (#${scopeId}) {`;
  const start = composition.indexOf(marker);
  if (start === -1) return "";
  const open = composition.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < composition.length; index += 1) {
    if (composition[index] === "{") depth += 1;
    if (composition[index] === "}") {
      depth -= 1;
      if (depth === 0) return composition.slice(open + 1, index);
    }
  }
  return "";
};
const sectionContents = (id) => {
  const opening = new RegExp(`<section\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>`, "i").exec(composition);
  if (!opening || opening.index === undefined) return "";
  const sectionTag = /<\/?section\b[^>]*>/gi;
  sectionTag.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let match; (match = sectionTag.exec(composition));) {
    if (/^<\/section\b/i.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return composition.slice(opening.index, match.index + match[0].length);
  }
  return "";
};
const sectionInnerContents = (id) => {
  const section = sectionContents(id);
  const opening = /^<section\b[^>]*>/i.exec(section)?.[0];
  if (!opening) return "";
  return section.slice(opening.length, section.lastIndexOf("</section>"));
};
const stripCssComments = (source) => source.replace(/\/\*[^]*?\*\//g, "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const thoughtfulCssRules = (source) => {
  if (/::|:(?:before|after|first-line|first-letter|selection|backdrop|marker|placeholder|file-selector-button)\b/i.test(source)
    || /@(?:[a-z-]+)\b/i.test(source)) return null;
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const rules = [...source.matchAll(rulePattern)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2]
  }));
  return source.replace(rulePattern, "").trim() ? null : rules;
};
const onlyEvidenceSurfaceSelectors = (selector) => selector.split(",")
  .every((part) => part.trim() === ".evidence-surface");
const sourceBearingTag = /<[a-z][a-z0-9:-]*\b[^>]*(?:\s(?:src|srcset|poster|href|xlink:href|data)\s*=)[^>]*>/i;

if (typography.orphanLineAllowed !== false || typography.minimumLastLineCharacters < 2) {
  errors.push("design system must forbid single-character orphan lines");
}

if (!/data-layout-constraints\s*=\s*["']enforced["']/i.test(composition)) {
  errors.push("composition must declare enforced layout constraints");
}
if (!/data-motion-contract\s*=\s*["']enforced["']/i.test(composition)) errors.push("composition must declare the motion contract");
if (!/data-runtime-layout\s*=\s*["']hyperframes["']/i.test(composition)) errors.push("composition must delegate peak-frame layout checks to HyperFrames");
if (!composition.includes("window.__motionContract")) errors.push("composition must execute the browser motion contract");
if (!composition.includes('timeline.eventCallback("onUpdate", () => {')
  || !composition.includes("function checkedTotalTime(value, suppressEvents)")
  || !composition.includes("if (motionContractUpdateSerial === serialBeforeSeek) window.__motionContract(Number(value))")) {
  errors.push("motion contract must cover GSAP updates and direct HyperFrames timeline seeks");
}
if (motionContract.outerFrameAllowed !== false || motionContract.containerBorderPolicy !== "none") errors.push("design system must forbid generic outer frames and container borders");
if (!composition.includes(`--${motionContract.connectorColorToken}:`)) errors.push("composition must define the connector color token");

for (const match of composition.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-motion-surface=["']container["'][^>]*>/gi)) {
  if (!/data-border-policy=["']none["']/i.test(match[0])) errors.push("motion containers must declare border-policy none");
}
for (const wrapper of composition.matchAll(/<section\b(?=[^>]*\bdata-motion-profile=["']thoughtful-editorial-v1["'])[^>]*>/gi)) {
  const wrapperTag = wrapper[0];
  const wrapperId = attribute(wrapperTag, "id");
  const treatment = attribute(wrapperTag, "data-surface-treatment");
  if (!wrapperId || !["direct-overlay", "evidence-surface"].includes(treatment)) {
    errors.push("thoughtful-editorial-v1 wrappers must declare a valid surface treatment");
    continue;
  }
  const fragment = sectionInnerContents(wrapperId);
  const css = stripCssComments(scopedCss(wrapperId));
  const profileCssRules = thoughtfulCssRules(css);
  const structuralRoot = [...fragment.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-beat-id=["'][^"']+["'][^>]*>/gi)][0]?.[0] ?? "";
  if (!structuralRoot || attribute(structuralRoot, "class") || attribute(structuralRoot, "id")) {
    errors.push("thoughtful-editorial-v1 data-beat structural root must remain an unstyled wrapper");
  }
  if (!profileCssRules) {
    errors.push("thoughtful-editorial-v1 CSS must use flat non-pseudo selector rules only");
  } else {
    if (profileCssRules.some(({ selector }) => /\[\s*data-beat-id\b|:scope\b/i.test(selector)
      || new RegExp(`#${escapeRegex(wrapperId)}\\b`, "i").test(selector))) {
      errors.push("thoughtful-editorial-v1 CSS cannot target the structural data-beat root or generated wrapper");
    }
    if (profileCssRules.some(({ selector, declarations }) => (
      /\b(?:background(?:-[a-z]+)?|box-shadow|overflow(?:-[a-z]+)?)\s*:/i.test(declarations)
        && treatment === "evidence-surface"
        && !onlyEvidenceSurfaceSelectors(selector)
    ))) {
      errors.push("thoughtful-editorial-v1 evidence visual treatment belongs only on the bounded evidence-surface");
    }
  }
  const surfaceTags = [...fragment.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-motion-surface=["']container["'][^>]*>/gi)].map((match) => match[0]);
  if (treatment === "direct-overlay") {
    if (surfaceTags.length !== 1 || attribute(surfaceTags[0] ?? "", "data-surface-kind") !== "direct-overlay") {
      errors.push("thoughtful-editorial-v1 direct-overlay requires exactly one declared direct-overlay surface");
    }
    if (/\sstyle\s*=/i.test(fragment)
      || sourceBearingTag.test(fragment)
      || /\bbackground(?:-[a-z]+)?\s*:|\boverflow(?:-[a-z]+)?\s*:|\b(?:box-shadow|text-shadow|border|outline)(?:-[a-z]+)?\s*:|\bposition\s*:\s*fixed\b|\b(?:filter|backdrop-filter|transition)(?:-[a-z]+)?\s*:/i.test(css)) {
      errors.push("thoughtful-editorial-v1 direct-overlay surface must remain transparent and unblurred");
    }
  } else {
    const materialIds = new Set((attribute(wrapperTag, "data-material-ids") ?? "").split(",").filter(Boolean));
    const evidenceSurface = surfaceTags[0] ?? "";
    const surfaceMaterialIds = new Set([
      ...(attribute(evidenceSurface, "data-material-ids") ?? "").split(","),
      attribute(evidenceSurface, "data-material-id") ?? ""
    ].filter(Boolean));
    if (surfaceTags.length !== 1
      || attribute(evidenceSurface, "data-surface-kind") !== "evidence-surface"
      || attribute(evidenceSurface, "data-evidence-surface-bounded") !== "true"
      || surfaceMaterialIds.size === 0
      || [...surfaceMaterialIds].some((materialId) => !materialIds.has(materialId))
      || !/(?:^|\s)class=["'][^"']*\bevidence-surface\b[^"']*["']/i.test(evidenceSurface)
      || !/\.evidence-surface\b\s*\{[^}]*\boverflow\s*:\s*(?:hidden|clip)\b[^}]*\}/i.test(css)
      || /\sstyle\s*=/i.test(fragment)
      || /\b(?:filter|backdrop-filter|transition|box-shadow|text-shadow|border|outline)(?:-[a-z]+)?\s*:/i.test(css)
      || /\bposition\s*:\s*fixed\b/i.test(css)
      || /\b(?:url|image-set)\s*\(/i.test(css)) {
      errors.push("thoughtful-editorial-v1 evidence-surface requires exactly one bounded surface tied to declared material IDs");
    }
    const assetTags = [...fragment.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*(?:\s(?:src|srcset|poster|href|xlink:href|data)\s*=)[^>]*>/gi)].map((match) => match[0]);
    const imageTags = assetTags.filter((tag) => /^<img\b/i.test(tag));
    if (assetTags.length === 0
      || assetTags.length !== imageTags.length
      || imageTags.some((tag) => !/\ssrc=["'][^"']+["']/i.test(tag)
        || /\s(?:srcset|poster|href|xlink:href|data)\s*=/i.test(tag)
        || !/\sdata-material-id=["'][^"']+["']/i.test(tag))) {
      errors.push("thoughtful-editorial-v1 evidence-surface must use literal img data-material-id src elements only");
    }
  }
}
for (const match of composition.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-motion-role=["']connector["'][^>]*>/gi)) {
  if (!new RegExp(`data-color-token=["']${motionContract.connectorColorToken}["']`, "i").test(match[0])) errors.push("connectors must use the design-system connector token");
  if (!/data-color-property=["'](color|background-color|border-color)["']/i.test(match[0])) errors.push("connectors must declare the computed color property");
  if (!/data-reveal-group=["'][^"']+["']/i.test(match[0])) errors.push("connectors must declare a runtime reveal group");
  if (!/data-flow-axis=["'](horizontal|vertical)["']/i.test(match[0])) errors.push("connectors must declare their rendered flow axis");
}
for (const match of composition.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-motion-role=["']label["'][^>]*>/gi)) {
  if (!informationRolePattern.test(match[0])) {
    errors.push(`labels must declare data-information-role as one of: ${informationRoles.join(", ")}`);
  }
}
for (const match of composition.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*data-motion-group=["'][^"']+["'][^>]*>/gi)) {
  for (const declaration of [
    /data-axis=["'](A|B)["']/i,
    /data-group-kind=["'](primary|auxiliary)["']/i,
    /data-group-start=["'][0-9.]+["']/i,
    /data-group-duration=["'][0-9.]+["']/i,
    /data-face-cover=["'](none|partial|intentional)["']/i,
    /data-primary-flow-axis=["'](horizontal|vertical)["']/i,
    /data-semantic-topology=["'][^"']+["']/i
  ]) {
    if (!declaration.test(match[0])) errors.push("motion groups must declare axis, lifetime, face coverage, flow, and topology");
  }
}
if (designSystem.captions) {
  const captionStylesheetPath = path.join(path.dirname(compositionPath), "caption.css");
  if (!fs.existsSync(captionStylesheetPath)) {
    errors.push("composition requires a sibling caption.css");
  } else {
    const captionStylesheet = fs.readFileSync(captionStylesheetPath, "utf8");
    const captionLayerRule = /\.clip\.motion-caption-layer\s*\{([^}]*)\}/i.exec(captionStylesheet)?.[1] ?? "";
    if (!/top\s*:\s*auto\s*;/i.test(captionLayerRule)
      || !/bottom\s*:\s*var\(--caption-bottom\b/i.test(captionLayerRule)) {
      errors.push("caption layer must override generic clip inset and preserve the configured bottom offset");
    }
  }
  const expectedBottomPx = designSystem.canvas.height * designSystem.captions.bottomOffsetRatio;
  if (Math.abs(designSystem.captions.bottomOffsetPx - expectedBottomPx) > 0.5) errors.push("caption bottom offset must equal its canvas ratio");
  const ratio = Number(/data-caption-bottom-ratio=["']([0-9.]+)["']/i.exec(composition)?.[1]);
  if (!Number.isFinite(ratio) || Math.abs(ratio - designSystem.captions.bottomOffsetRatio) > 0.0001) errors.push("composition caption-bottom ratio must match the design system");
  const weight = Number(/data-caption-font-weight=["']([0-9]+)["']/i.exec(composition)?.[1]);
  if (weight !== designSystem.captions.fontWeight || weight > 500) errors.push("composition caption weight must remain the approved normal weight");
  for (const match of composition.matchAll(/<section[^>]*class=["'][^"']*\bmotion-caption-layer\b[^"']*["'][^>]*>/gi)) {
    const bottom = Number(/--caption-bottom\s*:\s*([0-9.]+)px/i.exec(match[0])?.[1]);
    if (!Number.isFinite(bottom) || Math.abs(bottom - expectedBottomPx) > 0.5) {
      errors.push("every caption layer must use the design-system bottom offset");
    }
  }
}

for (const match of composition.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*class=["']([^"']+)["'][^>]*>/gi)) {
  const classes = match[1].split(/\s+/);
  if (classes.some((name) => /(?:^|-)(?:card|panel)$/.test(name)) && !/data-motion-surface=["']container["']/i.test(match[0])) {
    errors.push("card and panel classes must declare a checked motion surface");
  }
  if (classes.some((name) => /(?:^|-)(?:label|tag|badge)$/.test(name)) && !/data-motion-role=["']label["']/i.test(match[0])) {
    errors.push("label, tag, and badge classes must declare an information role");
  }
}
for (const match of composition.matchAll(/\.motion-caption-line\s*\{([^}]*)\}/gi)) {
  if (/font-weight\s*:\s*(?:bold|[6-9]00)\b/i.test(match[1])) errors.push("caption CSS cannot override the approved normal weight");
  if (!/font-synthesis\s*:\s*none/i.test(match[1])) errors.push("caption CSS must disable synthetic bold");
}

for (const declaration of ["overflow-wrap: normal", "word-break: normal", "text-wrap: balance"]) {
  if (!composition.includes(declaration)) errors.push(`composition is missing no-orphan declaration: ${declaration}`);
}

const explicitLines = composition.split(/<br\s*\/?\s*>/i).slice(1);
for (const [index, line] of explicitLines.entries()) {
  const text = line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const firstRun = text.match(/^[\p{Script=Han}]+/u)?.[0] ?? "";
  if (firstRun.length === 1) errors.push(`explicit line ${index + 2} begins with a one-character orphan: ${firstRun}`);
}

const usesPip = /id\s*=\s*["']speaker-pip["']/i.test(composition);
if (usesPip && bAxisPolicy.pipProtectionRequired) {
  const zone = bAxisPolicy.pipExclusionZone;
  if (![zone?.rightPx, zone?.bottomPx, zone?.widthPx, zone?.heightPx].every((value) => Number.isFinite(value) && value > 0)) {
    errors.push("B-axis PIP requires a measurable exclusion zone");
  }
  if (!/data-pip-safe-zone\s*=\s*["']required["']/i.test(composition)) {
    errors.push("PIP composition must mark at least one protected content zone");
  }
  if (!/\.pip-safe-zone\s*\{[^}]*var\(--pip-safe-right\)/s.test(composition)) {
    errors.push("PIP-safe content must reserve the declared right-side exclusion zone");
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);

console.log(`Layout constraints passed: no orphan lines; PIP protection ${usesPip ? "required" : "not used"}`);
