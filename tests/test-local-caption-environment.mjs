import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { durationToFrames, frameWindowTiming } from "../scripts/frame-window-utils.mjs";
import { sha256File, computeCreativeAuthorities, computeCreativeDocumentFingerprints } from "../scripts/workflow-utils.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-local-caption-env-"));
const put = (relative, value) => {
  const file = path.join(temporary, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
};
const run = (file, args, success = true, env = {}) => {
  const result = spawnSync(file.endsWith(".sh") ? "bash" : process.execPath, [file, ...args], {
    encoding: "utf8", env: { ...process.env, ...env }
  });
  assert.equal(result.status === 0, success, `${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
};
try {
  assert.equal(durationToFrames(195.116667, 60), 11707, "serialized seconds do not create an extra frame");
  for (const fps of [24, 30, 60]) {
    for (const startFrame of [0, 1, 59, 10001]) {
      const timing = frameWindowTiming({ startFrame, endFrame: startFrame + 7 }, fps);
      assert.ok(timing.start + timing.duration <= timing.end, "outgoing cue never crosses its exclusive end");
    }
  }
  const transcript = { revision: 1, segments: [{ id: "main-001", text: "完整理解观点", start: 0, end: 2 }] };
  const transcriptPath = put("job/state/transcript.json", transcript);
  const design = JSON.parse(fs.readFileSync(path.join(repository, "assets/design-system.default.json")));
  const designPath = put("job/state/design-system.json", design);
  put("job/captions/caption-lexicon.json", { protectedTerms: [] });
  const plan = { status: "approved", wordingAuthority: "state/transcript.json", transcriptRevision: 1,
    transcriptSha256: sha256File(transcriptPath), rules: { exactlyOneLine: true, minimumDurationSeconds: .5,
      targetDurationSeconds: [.8, 2.5], targetDisplayUnits: [4, 10.5], maximumDisplayUnits: 11.8,
      protectedTerms: [], forbiddenStandaloneCues: [] },
    cues: [{ id: "caption-0001", segmentId: "main-001", text: transcript.segments[0].text, start: 0, end: 2 }] };
  const planPath = put("job/captions/caption-review-plan.json", plan);
  const checker = path.join(repository, "scripts/check-caption-review-plan.mjs");
  run(checker, [planPath]);
  const relaxed = structuredClone(plan); relaxed.rules.maximumDisplayUnits = 100;
  put("job/captions/caption-review-plan.json", relaxed);
  assert.match(run(checker, [planPath], false), /cannot relax/);
  const short = structuredClone(plan); short.cues[0].end = .2;
  put("job/captions/caption-review-plan.json", short);
  assert.match(run(checker, [planPath], false), /below/);
  put("job/captions/caption-review-plan.json", plan);
  const pages = { source: "chatcut-viewer-pages", fps: 30, roughCutLocked: true, captionRenderDisabled: true,
    cleanExport: "roughcut/a-roll.mp4", cards: [{ id: "card", startFrame: 0, endFrame: 60, text: transcript.segments[0].text }] };
  const pagesPath = put("job/captions/chatcut-pages.json", pages);
  const captions = { source: { kind: "approved-semantic-plan", reviewPlan: "captions/caption-review-plan.json",
    fps: 30, roughCutLocked: true, captionRenderDisabled: true, cleanExport: pages.cleanExport }, style: design.captions,
    cues: [{ id: "caption-0001", sourcePageId: "approved-semantic-plan", startFrame: 0, endFrame: 60,
      start: 0, end: 2, viewerText: transcript.segments[0].text, lines: [transcript.segments[0].text] }] };
  const captionsPath = put("job/captions/captions.json", captions);
  const html = put("job/hyperframes/index.template.html", "<!-- CUT_MOTION_CAPTIONS_START --><!-- CUT_MOTION_CAPTIONS_END -->");
  run(path.join(repository, "scripts/install-captions.mjs"), [captionsPath, html, designPath]);
  const captionCheck = path.join(repository, "scripts/check-captions.mjs");
  run(captionCheck, [captionsPath, pagesPath, designPath, html]);
  fs.writeFileSync(html, fs.readFileSync(html, "utf8").replace('data-duration="2"', 'data-duration="2.00000001"'));
  assert.match(run(captionCheck, [captionsPath, pagesPath, designPath, html], false), /exclusive end frame/);
  put("job/captions/chatcut-pages.json", { ...pages, captionRenderDisabled: false });
  assert.match(run(captionCheck, [captionsPath, pagesPath, designPath], false), /caption rendering disabled/);
  assert.match(run(path.join(repository, "scripts/check-font.sh"), [path.dirname(html), designPath], false), /Required font asset is missing/);
  put("job/captions/chatcut-pages.json", pages);
  put("job/state/beat-map.json", { fps: 30, duration: 2, beats: [] });
  for (const file of ["creative-confirmation.md", "motion-plan.md", "caption-plan.md"]) put(`job/docs/${file}`, "approved fixture");
  const captionJob = path.join(temporary, "job");
  const confirmation = { review: { status: "approved" }, authorities: computeCreativeAuthorities(captionJob, "subtitles") };
  const confirmationPath = put("job/state/creative-confirmation.json", confirmation);
  put("job/state/workflow.json", { captionMode: "subtitles", mode: "review", currentState: "composition",
    creativeConfirmationSha256: sha256File(confirmationPath),
    creativeDocumentFingerprints: computeCreativeDocumentFingerprints(captionJob, "subtitles") });
  const promoter = path.join(repository, "scripts/promote-caption-review-plan.mjs");
  run(promoter, [captionJob]);
  const acceptedHash = sha256File(captionsPath);
  put("job/captions/chatcut-pages.json", { ...pages, cards: [...pages.cards, ...pages.cards] });
  assert.match(run(promoter, [captionJob], false), /Caption promotion validation failed/);
  assert.equal(sha256File(captionsPath), acceptedHash, "failed candidate validation preserves accepted captions");
  assert.equal(fs.readdirSync(path.dirname(captionsPath)).some(name => name.startsWith(".captions-")), false);
  put("job/state/creative-confirmation.json", { ...confirmation, review: { status: "ready" } });
  assert.match(run(promoter, [captionJob], false), /not approved/);
  assert.equal(sha256File(captionsPath), acceptedHash, "unapproved creative package cannot replace captions");

  // Isolated fake packages prove cache reuse and approval failures without network access.
  const environmentScript = put("repo/scripts/check-environment.sh", fs.readFileSync(path.join(repository, "scripts/check-environment.sh"), "utf8"));
  const job = path.join(temporary, "repo/jobs/new");
  put("repo/jobs/new/hyperframes/package.json", { devDependencies: { hyperframes: "0.7.60", gsap: "3.13.0" } });
  const npm = put("bin/npm", `#!${process.execPath}\nif(process.argv.slice(2).join(' ')==='config get cache') console.log(process.env.FIXTURE_CACHE); else {require('fs').writeFileSync(process.env.INSTALL_MARKER,'called');process.exit(9);}\n`);
  fs.chmodSync(npm, 0o755);
  const env = { PATH: `${path.dirname(npm)}:${process.env.PATH}`, FIXTURE_CACHE: path.join(temporary, "cache"),
    INSTALL_MARKER: path.join(temporary, "install-called") };
  const previous = put("repo/jobs/new/hyperframes/node_modules/keep", "previous package");
  assert.match(run(environmentScript, ["install-job", job], false, env), /Download requires --yes/);
  assert.equal(fs.existsSync(env.INSTALL_MARKER), false);
  assert.equal(fs.readFileSync(previous, "utf8"), "previous package");
  const cached = "cache/_npx/complete/node_modules";
  put(`${cached}/hyperframes/package.json`, { version: "0.7.60", bin: { hyperframes: "dist/cli.js" }, dependencies: { runtime: "1.0.0" } });
  const cli = put(`${cached}/hyperframes/dist/cli.js`, "#!/usr/bin/env node\n"); fs.chmodSync(cli, 0o755);
  put(`${cached}/gsap/package.json`, { version: "3.13.0" }); put(`${cached}/gsap/dist/gsap.min.js`, "gsap fixture");
  assert.match(run(environmentScript, ["install-job", job], false, env), /Download requires --yes/, "missing declared runtime is not a complete cache");
  put(`${cached}/runtime/package.json`, { version: "1.0.0" });
  const oldBrowser = put("repo/jobs/new/hyperframes/assets/gsap.min.js", "previous browser runtime");
  fs.unlinkSync(oldBrowser);
  fs.symlinkSync(path.join(temporary, cached, "gsap/dist/gsap.min.js"), oldBrowser);
  assert.match(run(environmentScript, ["install-job", job], false, env), /must belong to this job/);
  assert.equal(fs.readFileSync(previous, "utf8"), "previous package", "unsafe resource target is rejected before replacing dependencies");
  fs.unlinkSync(oldBrowser);
  put("repo/jobs/new/hyperframes/assets/gsap.min.js", "previous browser runtime");
  const oldCli = put("repo/jobs/new/hyperframes/node_modules/.bin/hyperframes", "previous CLI");
  const oldLock = put("repo/jobs/new/hyperframes/package-lock.json", "previous lock");
  const linkCommand = put("bin/ln", `#!${process.execPath}\nif(process.env.FIXTURE_LN_FAILURE==='1'&&process.argv.at(-1).endsWith('/node_modules/.bin/hyperframes')) process.exit(9);const r=require('child_process').spawnSync('/bin/ln',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);\n`);
  fs.chmodSync(linkCommand, 0o755);
  assert.match(run(environmentScript, ["install-job", job], false, { ...env, FIXTURE_LN_FAILURE: "1" }), /previous dependencies and resources were restored/);
  assert.equal(fs.readFileSync(previous, "utf8"), "previous package", "a failed finishing command restores original dependency tree");
  assert.equal(fs.readFileSync(oldCli, "utf8"), "previous CLI");
  assert.equal(fs.readFileSync(oldBrowser, "utf8"), "previous browser runtime");
  assert.equal(fs.readFileSync(oldLock, "utf8"), "previous lock");
  assert.equal(fs.readdirSync(path.join(job, "hyperframes")).some(name => name.startsWith(".dependencies-previous-") || name.startsWith(".dependency-reuse.")), false);
  run(environmentScript, ["install-job", job], true, env);
  assert.equal(fs.lstatSync(path.join(job, "hyperframes/node_modules")).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(temporary, "repo/node_modules")), false);
  assert.equal(fs.readFileSync(path.join(job, "hyperframes/assets/gsap.min.js"), "utf8"), "gsap fixture");
  assert.equal(fs.existsSync(env.INSTALL_MARKER), false);
  fs.rmSync(path.join(job, "hyperframes/node_modules"), { recursive: true });
  fs.symlinkSync(path.join(temporary, cached), path.join(job, "hyperframes/node_modules"));
  assert.match(run(environmentScript, ["install-job", job], false, env), /job-owned directory/);
  assert.equal(fs.existsSync(path.join(temporary, cached, "hyperframes/package.json")), true);
  console.log("Local caption/environment: exclusive frame ends, width/duration rules, clean A-roll, mandatory font and job-only cache reuse passed");
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
