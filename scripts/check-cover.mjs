import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertRegularContainedFile,
  jobRootForWorkflow,
  readJson,
  sha256File
} from "./workflow-utils.mjs";

const [workflowArgument, ...argumentsList] = process.argv.slice(2);
const readyOnly = argumentsList.includes("--ready");

if (!workflowArgument || argumentsList.some((argument) => argument !== "--ready")) {
  console.error("Usage: node check-cover.mjs <workflow.json> [--ready]");
  process.exit(64);
}

const fail = (message) => {
  throw new Error("Cover package invalid: " + message);
};

const probeImage = (filePath, label) => {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height",
    "-of", "json",
    filePath
  ], { encoding: "utf8" });
  if (result.status !== 0) fail(label + " is not a decodable image");
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!stream || !Number.isInteger(stream.width) || !Number.isInteger(stream.height)) {
    fail(label + " has no video dimensions");
  }
  return stream;
};

const requireUniqueIds = (items, label) => {
  if (!Array.isArray(items)) fail(label + " must be an array");
  const ids = items.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) {
    fail(label + " must have unique non-empty IDs");
  }
};

const internalProductionCopy = /(?:第一条口播|粗剪|封面候选|内部版本|素材待定|待确认)/u;
const validCrop = (crop) => crop
  && [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
  && crop.x >= 0
  && crop.y >= 0
  && crop.width > 0
  && crop.height > 0
  && crop.width * 4 === crop.height * 3;
const normalizedCopy = (lines) => lines
  .map((line) => line.normalize("NFKC").replace(/\s+/gu, "").toLowerCase())
  .join("\n");
const probeRenderedPreview = (jobRoot, previewRoot, candidate) => {
  const label = "Rendered cover preview " + candidate.id;
  let previewPath;
  try {
    previewPath = assertRegularContainedFile(previewRoot, path.resolve(jobRoot, candidate.previewPath), label);
  } catch {
    fail("rendered preview " + candidate.id + " is missing or outside previews/cover");
  }
  return probeImage(previewPath, label);
};

try {
  const workflowPath = path.resolve(workflowArgument);
  const jobRoot = jobRootForWorkflow(workflowPath);
  const stateRoot = path.join(jobRoot, "state");
  const inputRoot = path.join(jobRoot, "input");
  const previewRoot = path.join(jobRoot, "previews", "cover");
  const outputRoot = path.join(jobRoot, "output");
  const coverPath = path.join(stateRoot, "cover.json");
  assertRegularContainedFile(stateRoot, coverPath, "Cover record");
  const cover = readJson(coverPath);
  const expectedStatus = readyOnly ? "ready" : "approved";
  const supportedPackages = {
    "1.0.0": { styleId: "centered-talking-head-yellow-v1", frameCandidateCount: 8, frameCandidateCountWords: "eight" },
    "2.0.0": { styleId: "talking-head-opinion-poster-v2", frameCandidateCount: 8, frameCandidateCountWords: "eight" },
    "2.1.0": { styleId: "talking-head-opinion-poster-v2", frameCandidateCount: 24, frameCandidateCountWords: "twenty-four" }
  };
  const packageContract = supportedPackages[cover.schemaVersion];
  if (!packageContract) fail("schemaVersion must be 1.0.0, 2.0.0, or 2.1.0");
  if (cover.status !== expectedStatus) fail("status must be " + expectedStatus);
  if (cover.styleId !== packageContract.styleId) fail("styleId does not match the locked cover style");
  if (typeof cover.sourceVideo !== "string" || !cover.sourceVideo) fail("sourceVideo is missing");
  const project = readJson(path.join(stateRoot, "project.json"));
  if (cover.sourceVideo !== project.sourceVideo) fail("sourceVideo must match project sourceVideo");
  assertRegularContainedFile(inputRoot, path.resolve(jobRoot, cover.sourceVideo), "Cover source video");

  requireUniqueIds(cover.frameCandidates, "frameCandidates");
  if (cover.frameCandidates.length !== packageContract.frameCandidateCount) {
    fail("frameCandidates must contain exactly " + packageContract.frameCandidateCountWords + " original source-frame choices");
  }
  const frameProbes = new Map();
  for (const candidate of cover.frameCandidates) {
    if (!Number.isFinite(candidate.timestampSeconds) || candidate.timestampSeconds < 0) {
      fail("frame " + candidate.id + " needs a non-negative timestampSeconds");
    }
    if (!Array.isArray(candidate.reasons) || candidate.reasons.length === 0 || candidate.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
      fail("frame " + candidate.id + " needs at least one selection reason");
    }
    const label = "Cover frame " + candidate.id;
    const probe = probeImage(assertRegularContainedFile(previewRoot, path.resolve(jobRoot, candidate.path), label), label);
    frameProbes.set(candidate.id, probe);
  }

  requireUniqueIds(cover.renderedCandidates, "renderedCandidates");
  if (cover.renderedCandidates.length !== 6) fail("renderedCandidates must contain exactly six full cover previews");
  const selectedFrame = cover.frameCandidates.find((candidate) => candidate.id === cover.selection?.frameId);
  const selectedRenderedCandidate = cover.renderedCandidates.find((candidate) => candidate.id === cover.selection?.renderedCandidateId);
  if (!selectedFrame || !selectedRenderedCandidate) fail("selection must name one frame and one rendered cover choice");
  const selectedFrameProbe = frameProbes.get(selectedFrame.id);

  if (cover.schemaVersion === "1.0.0") {
    const crop = cover.selection?.crop;
    if (!validCrop(crop)) fail("selection crop must be an integer 3:4 rectangle");
    if (crop.x + crop.width > selectedFrameProbe.width || crop.y + crop.height > selectedFrameProbe.height) {
      fail("selection crop escapes the selected frame");
    }
    for (const candidate of cover.renderedCandidates) {
      if (candidate.frameId !== selectedFrame.id) fail("rendered cover " + candidate.id + " must use the selected frame");
      if (!["x", "y", "width", "height"].every((key) => candidate.crop?.[key] === crop[key])) {
        fail("rendered cover " + candidate.id + " must use the selected crop");
      }
      for (const field of ["topLines", "bottomLines"]) {
        const lines = candidate[field];
        if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2 || lines.some((line) => typeof line !== "string" || !line.trim())) {
          fail("rendered cover " + candidate.id + " needs one or two non-empty " + field);
        }
      }
      if (!["reference-script", "user-brief"].includes(candidate.source)) fail("rendered cover " + candidate.id + " needs a public copy source");
      if (internalProductionCopy.test([...candidate.topLines, ...candidate.bottomLines].join(" "))) {
        fail("rendered cover " + candidate.id + " uses internal production language");
      }
      const preview = probeRenderedPreview(jobRoot, previewRoot, candidate);
      if (preview.codec_name !== "png" || preview.width !== 1080 || preview.height !== 1440) {
        fail("rendered preview " + candidate.id + " must be a 1080x1440 PNG");
      }
    }
  } else {
    const base = cover.coverBase;
    if (!base || base.sourceFrameId !== selectedFrame.id) fail("cover base must use the selected frame");
    if (base.method !== "direct-source-crop") fail("cover base method must be direct-source-crop");
    if (!validCrop(base.crop)) fail("cover base crop must be an integer 3:4 rectangle");
    if (base.crop.x + base.crop.width > selectedFrameProbe.width || base.crop.y + base.crop.height > selectedFrameProbe.height) {
      fail("cover base crop escapes the selected frame");
    }
    if (base.width !== 1080 || base.height !== 1440) fail("cover base must be 1080x1440");
    if (typeof base.path !== "string" || !base.path) fail("cover base path is missing");
    const basePath = assertRegularContainedFile(previewRoot, path.resolve(jobRoot, base.path), "Cover base");
    const baseProbe = probeImage(basePath, "Cover base");
    if (baseProbe.codec_name !== "png" || baseProbe.width !== 1080 || baseProbe.height !== 1440) {
      fail("cover base must be a 1080x1440 PNG");
    }
    if (typeof base.sha256 !== "string" || base.sha256 !== sha256File(basePath)) fail("cover base SHA-256 does not match cover record");
    const reviewFields = ["subjectIntegrity", "headlineAboveEyes", "thumbnailReadable", "noOpaqueTextBackdrop", "noDarkGradient", "safeAreaChecked"];
    if (!reviewFields.every((field) => cover.visualReview?.[field] === true)) fail("visual review is incomplete");
    const headlineCopies = new Set();
    for (const candidate of cover.renderedCandidates) {
      if (Object.hasOwn(candidate, "topLines") || Object.hasOwn(candidate, "bottomLines") || Object.hasOwn(candidate, "crop")) {
        fail("rendered cover " + candidate.id + " uses legacy topLines or bottomLines fields");
      }
      if (candidate.frameId !== selectedFrame.id) fail("rendered cover " + candidate.id + " must use the selected frame");
      if (candidate.basePath !== base.path) fail("rendered cover " + candidate.id + " must use the shared cover base path");
      const lines = candidate.headlineLines;
      if (!Array.isArray(lines) || lines.length !== 2 || lines.some((line) => typeof line !== "string" || !line.trim())) {
        fail("rendered cover " + candidate.id + " needs exactly two non-empty headlineLines");
      }
      if (!["reference-script", "user-brief"].includes(candidate.source)) fail("rendered cover " + candidate.id + " needs a public copy source");
      if (internalProductionCopy.test(lines.join(" "))) fail("rendered cover " + candidate.id + " uses internal production language");
      const copyKey = normalizedCopy(lines);
      if (headlineCopies.has(copyKey)) fail("rendered cover headline copy must be distinct across all six candidates");
      headlineCopies.add(copyKey);
      const preview = probeRenderedPreview(jobRoot, previewRoot, candidate);
      if (preview.codec_name !== "png" || preview.width !== 1080 || preview.height !== 1440) {
        fail("rendered preview " + candidate.id + " must be a 1080x1440 PNG");
      }
    }
  }

  if (cover.publicLanguageReviewed !== true) fail("public-language review is not recorded");
  if (cover.output?.path !== "output/cover.png" || cover.output.width !== 1080 || cover.output.height !== 1440 || cover.output.colorSpace !== "sRGB") {
    fail("output must be the 1080x1440 sRGB output/cover.png master");
  }
  const outputPath = assertRegularContainedFile(outputRoot, path.join(outputRoot, "cover.png"), "Cover output");
  const outputProbe = probeImage(outputPath, "Cover output");
  if (outputProbe.codec_name !== "png" || outputProbe.width !== 1080 || outputProbe.height !== 1440) {
    fail("output must be a decodable 1080x1440 PNG");
  }
  const outputSha256 = sha256File(outputPath);
  if (cover.output.sha256 && cover.output.sha256 !== outputSha256) fail("output SHA-256 does not match cover record");

  if (!readyOnly) {
    if (cover.review?.status !== "approved" || cover.review.actor !== "user" || !cover.review.decidedAt || !cover.review.note) {
      fail("user approval is not recorded");
    }
    if (cover.output.sha256 !== outputSha256) fail("approved cover must record the output SHA-256");
  }

  console.log(JSON.stringify({ path: "output/cover.png", sha256: outputSha256, width: 1080, height: 1440 }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
