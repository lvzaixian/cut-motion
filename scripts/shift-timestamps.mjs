import fs from "node:fs";
import path from "node:path";
import { cutFromSeconds, retimeDocument } from "./timeline-cut-utils.mjs";

const [input, start, end, output, explicitFps] = process.argv.slice(2);
if (!input || !output || process.argv.length > 7) {
  console.error("Usage: node shift-timestamps.mjs <input.json> <cut-start-seconds> <cut-end-seconds> <new-output.json> [fps]");
  process.exit(64);
}
const document = JSON.parse(fs.readFileSync(input, "utf8"));
const fps = explicitFps === undefined ? document.source?.fps ?? document.fps : Number(explicitFps);
const cut = cutFromSeconds(fps, Number(start), Number(end));
const result = retimeDocument(document, cut);
const metadataPath = `${output}.retime.json`;
// Never replace a settled artifact, including through a symlink or hard link.
if (path.resolve(input) === path.resolve(output) || fs.existsSync(output) || fs.existsSync(metadataPath)) throw new Error("Output must be a new candidate file");
fs.mkdirSync(path.dirname(output), { recursive: true });
const metadata = { input: path.resolve(input), output: path.resolve(output), cut, removedIds: result.removedIds,
  invalidatedArtifacts: result.invalidatedArtifacts,
  requiredWorkflowAction: "reopen rough-cut before applying the media cut; rebuild timing evidence and refresh rough-cut and visual approvals",
  status: "candidate-only: update the editable timeline, re-align transcript and measured anchors, rebuild media/composition, and refresh approvals before delivery" };
fs.writeFileSync(output, JSON.stringify(result.document, null, 2) + "\n", { flag: "wx" });
try {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
} catch (error) {
  fs.unlinkSync(output);
  throw error;
}
console.log(JSON.stringify({ ...metadata, metadataPath }));
