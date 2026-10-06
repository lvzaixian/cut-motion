import fs from "node:fs";
import path from "node:path";
import {
  assertRegularContainedFile,
  jobRootForWorkflow,
  readJson,
  sha256File
} from "./workflow-utils.mjs";

const [workflowArgument, renderedVideoArgument] = process.argv.slice(2);

if (!workflowArgument || !renderedVideoArgument || process.argv.length !== 4) {
  console.error("Usage: node check-titles.mjs <workflow.json> <rendered-video-path>");
  process.exit(64);
}

const expectedPlatforms = [
  { id: "douyin", displayName: "抖音", prefix: "DY" },
  { id: "video-account", displayName: "视频号", prefix: "SPH" },
  { id: "xiaohongshu", displayName: "小红书", prefix: "XHS" },
  { id: "bilibili", displayName: "B站", prefix: "BIL" },
  { id: "kuaishou", displayName: "快手", prefix: "KS" }
];
const internalProductionCopy = /(?:第一条口播|粗剪|封面候选|内部版本|素材待定|待确认)/u;

const fail = (message) => {
  throw new Error(`Title package invalid: ${message}`);
};

const checkXlsxSignature = (filePath) => {
  const descriptor = fs.openSync(filePath, "r");
  const header = Buffer.alloc(4);
  try {
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) fail("workbook is empty");
  } finally {
    fs.closeSync(descriptor);
  }
  if (header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 0x03 || header[3] !== 0x04) {
    fail("workbook is not an XLSX-compatible ZIP file");
  }
};

try {
  const workflowPath = path.resolve(workflowArgument);
  const jobRoot = fs.realpathSync(jobRootForWorkflow(workflowPath));
  const stateRoot = path.join(jobRoot, "state");
  const outputRoot = path.join(jobRoot, "output");
  const renderedVideoPath = assertRegularContainedFile(outputRoot, path.resolve(renderedVideoArgument), "Rendered video");
  const renderedVideoRelativePath = path.relative(jobRoot, renderedVideoPath);
  const titlesPath = assertRegularContainedFile(stateRoot, path.join(stateRoot, "titles.json"), "Title record");
  const titles = readJson(titlesPath);

  if (titles.schemaVersion !== "1.0.0" || titles.status !== "ready") fail("status must be ready");
  if (titles.publicLanguageReviewed !== true) fail("public-language review is not recorded");
  if (!titles.generatedAt) fail("generatedAt is missing");
  if (titles.sourceDelivery?.path !== renderedVideoRelativePath) {
    fail(`source delivery path does not match this render (${titles.sourceDelivery?.path ?? "missing"} !== ${renderedVideoRelativePath})`);
  }
  if (titles.sourceDelivery?.sha256 !== sha256File(renderedVideoPath)) fail("source delivery SHA-256 does not match this render");
  if (titles.workbook?.path !== "output/titles.xlsx") fail("workbook path must be output/titles.xlsx");

  const workbookPath = assertRegularContainedFile(outputRoot, path.join(outputRoot, "titles.xlsx"), "Title workbook");
  checkXlsxSignature(workbookPath);
  if (titles.workbook.sha256 !== sha256File(workbookPath)) fail("workbook SHA-256 does not match title record");

  if (!Array.isArray(titles.platforms) || titles.platforms.length !== expectedPlatforms.length) {
    fail(`must contain exactly ${expectedPlatforms.length} platform groups`);
  }
  for (const expected of expectedPlatforms) {
    const platform = titles.platforms.find((candidate) => candidate?.id === expected.id);
    if (!platform || platform.displayName !== expected.displayName) fail(`missing ${expected.displayName} group`);
    if (!Array.isArray(platform.candidates) || platform.candidates.length !== 5) {
      fail(`${expected.displayName} must contain exactly five title candidates`);
    }
    const expectedIds = Array.from({ length: 5 }, (_, index) => `${expected.prefix}-${String(index + 1).padStart(2, "0")}`);
    const actualIds = platform.candidates.map((candidate) => candidate?.id);
    if (new Set(actualIds).size !== 5 || !expectedIds.every((id) => actualIds.includes(id))) {
      fail(`${expected.displayName} candidate IDs must be ${expected.prefix}-01 through ${expected.prefix}-05`);
    }
    for (const candidate of platform.candidates) {
      if (typeof candidate.title !== "string" || !candidate.title.trim()) fail(`${candidate.id} needs a title`);
      if (internalProductionCopy.test(candidate.title)) fail(`${candidate.id} uses internal production language`);
      if (!Array.isArray(candidate.keywords) || candidate.keywords.length === 0 || candidate.keywords.some((keyword) => typeof keyword !== "string" || !keyword.trim())) {
        fail(`${candidate.id} needs at least one keyword`);
      }
      if (typeof candidate.hookType !== "string" || !candidate.hookType.trim()) fail(`${candidate.id} needs a hookType`);
      if (typeof candidate.contentSupport !== "string" || !candidate.contentSupport.trim()) fail(`${candidate.id} needs content support`);
    }
  }

  console.log(JSON.stringify({
    path: "output/titles.xlsx",
    sha256: titles.workbook.sha256,
    sourceDelivery: titles.sourceDelivery.path,
    sourceDeliverySha256: titles.sourceDelivery.sha256,
    platforms: expectedPlatforms.map(({ id, displayName }) => ({ id, displayName, candidates: 5 }))
  }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
