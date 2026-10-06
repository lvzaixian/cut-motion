import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256File } from "./workflow-utils.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-sha256-"));
const filePath = path.join(root, "over-2gib.bin");

try {
  const descriptor = fs.openSync(filePath, "w");
  fs.writeSync(descriptor, Buffer.from([0x7f]), 0, 1, 2 * 1024 * 1024 * 1024);
  fs.closeSync(descriptor);
  assert.match(sha256File(filePath), /^[a-f0-9]{64}$/);
  console.log("Large-file SHA-256 passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
