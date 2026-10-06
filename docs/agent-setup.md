# Agent Setup and Maintenance

This document is for Agents and repository contributors. End users should follow `README.md` or `README-EN.md` and interact through natural language.

## 本机本地转写：mlx-whisper

**本机已经安装 `mlx-whisper`，并已有可离线复用的 Whisper large-v3 模型。新任务先检查并使用现有工具，不必重新安装或下载。** 包名为 `mlx-whisper`，CLI 名为 `mlx_whisper`（下划线）；必须调用下表的虚拟环境绝对路径，不能只检查默认 Python、`whisper` 命令或 PATH。用户未指定转写引擎且本地检查通过时，直接复用本地 ASR；ChatCut 未连接不阻断转写与内容解析，仍须在后续可编辑粗剪前恢复其能力。

之后新视频默认无脚本。原素材到达后，先用上述本地工具完整转写所有原片与补录，检查输出、通读全片并完成 `docs/content-analysis.md`，再安排封面、选段、粗剪、字幕和包装；不得要求先补脚本或以局部转写替代整体理解。分析须写清主旨、叙述顺序、背景与前提、重录组和原词疑点，保留“逻辑完整 → 个人表达 → 节奏紧凑”。本地转写失败时报告具体路径或依赖问题，后续安排等待恢复；其他引擎只按用户对本任务的明确选择启用并记录。ASR 提供原始文本与时间证据，不代替录音核对。以下包版本、CLI 参数、模型链接目标、FFmpeg 与 Metal 可用性已于 2026-10-06 核实；这次未重新运行整片推理。

| 项目 | 本机位置或版本 |
| --- | --- |
| 已安装环境 | `/Users/maxwellbrooks/Workspace/cut-motion/jobs/07-dont-study-too-long/.venv/` |
| Python | 上述目录的 `bin/python`，Python 3.9.6，arm64 |
| CLI | 上述目录的 `bin/mlx_whisper`，mlx-whisper 0.4.3 |
| MLX | mlx / mlx-metal 0.29.3；需要 Apple Silicon 与可用 Metal |
| 模型 | `mlx-community/whisper-large-v3-mlx`，权重约 3.08 GB |
| 固定模型目录 | `/Users/maxwellbrooks/Workspace/cut-motion/jobs/07-dont-study-too-long/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11` |

复用时只读取旧任务运行时和模型，输入、输出与日志全部属于新任务。该环境不是全局安装；保留旧任务 `.venv` 和 `.cache`，不要把依赖移进口播目录的 `.cut-motion/`。模型快照使用指向缓存 blobs 的符号链接，只复制快照中的链接不能完成迁移。其他主机或路径不存在时先核实环境，不能假定可用。

### 新任务的快速检查（不下载、不转写）

```bash
ASR_ROOT="/Users/maxwellbrooks/Workspace/cut-motion/jobs/07-dont-study-too-long"
ASR_MODEL="$ASR_ROOT/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11"

test -x "$ASR_ROOT/.venv/bin/mlx_whisper" &&
test -r "$ASR_MODEL/config.json" && test -r "$ASR_MODEL/weights.npz" &&
PATH="/opt/homebrew/bin:$PATH" command -v ffmpeg &&
HF_HUB_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 "$ASR_ROOT/.venv/bin/python" \
  -c 'import mlx.core as mx; assert mx.metal.is_available(), "Metal unavailable"; print("Metal OK")' &&
HF_HUB_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 "$ASR_ROOT/.venv/bin/mlx_whisper" --help
```

核对上述每项及其报错，不能只凭文件存在宣称推理成功。通过后即可执行下方命令；失败时说明具体路径或依赖问题。仓库 `check-environment.sh check` 检查的是通用剪辑/渲染依赖，没有检查这个独立 ASR 环境；其缺少 Node/npm 的结果不能用来宣布“无法转写”，但创建任务仍须满足脚手架依赖。

### 在新任务中离线转写

从 Cut Motion 仓库运行，替换新任务 ID 和实际源文件后缀：

```bash
ASR_ROOT="/Users/maxwellbrooks/Workspace/cut-motion/jobs/07-dont-study-too-long"
ASR_MODEL="$ASR_ROOT/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11"
ASR_JOB="/Users/maxwellbrooks/Workspace/cut-motion/jobs/<new-job-id>"
ASR_INPUT="$ASR_JOB/input/source.mov"
ASR_OUT="$ASR_JOB/checkpoints/asr-source-run-01"

# 如已存在则换一个新的运行编号；不要覆盖原始转写。
mkdir "$ASR_OUT" && PATH="/opt/homebrew/bin:$PATH" HF_HUB_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 \
  "$ASR_ROOT/.venv/bin/mlx_whisper" "$ASR_INPUT" \
  --model "$ASR_MODEL" \
  --language zh \
  --task transcribe \
  --word-timestamps True \
  --condition-on-previous-text False \
  --initial-prompt "这是一段中文口播。请保留原话、重复与未说完的句子。" \
  --output-name source-asr-raw \
  --output-format all \
  --output-dir "$ASR_OUT" \
  > "$ASR_OUT/transcribe.log" 2>&1
```

CLI 经 PATH 中的 FFmpeg 读取媒体并转为 16 kHz 单声道，无须重复编写抽音脚本。`all` 生成 JSON、TXT、SRT、VTT、TSV；JSON 的 `segments[].words[]` 含逐词时间。记录输入 SHA-256、命令、包版本、模型快照和输出目录。补录各自建运行目录；原 `jobs/07-dont-study-too-long/transcribe.py` 固定了旧任务和文件名，不能直接作为下一期入口。

此版本 CLI 可能捕获单文件异常、打印 `Skipping` 后仍正常退出。因此成功至少要求新 JSON 存在、`segments` 非空、起止时间有效且落在媒体范围内，并检查日志和异常长重复；退出码不够。静音或低音频可能触发幻觉，需对可疑窗口核对录音、局部重转并记录源时间偏移，保留失败原稿；关闭上下文不是正确率保证，也不能机械复制第 07 期开头的修复偏移。

原始转写保留全部重录候选，不在 ASR 阶段去重。其 JSON 不是 Cut Motion transcript schema，SRT 也不是发布字幕：完成录音核对后，再整理 `state/transcript.json`、`state/transcript-reconciliation.json` 与 `docs/content-analysis.md`。最后一次完整重录的选择发生在语义选段阶段；真实听校范围必须如实记录。

## Environment preflight

Check the existing local ASR runtime above first. Inspect the active Agent session for ChatCut, then run:

```bash
./scripts/check-environment.sh check
```

If ChatCut is required for the editable rough-cut stage but unavailable, explain that stage-specific blocker and wait for installation/authentication approval; continue available local transcription and content analysis. After approval:

- Codex: `Read https://chatcut.io/chatgpt to install and use the ChatCut plugin`
- Claude Code: `Read https://chatcut.io/claude to install and use the ChatCut plugin`

Do not add or run a deterministic ChatCut installer.

## Local requirements

- Bash on macOS or Linux; Windows users need WSL2 or an equivalent Unix shell.
- Node.js 22 or newer with npm and npx.
- FFmpeg and FFprobe with H.264 and AAC support.
- jq.
- [Smiley Sans WOFF2](https://github.com/atelier-anchor/smiley-sans/releases), released under SIL Open Font License 1.1.
- Microsoft YaHei available to the local cover renderer for `talking-head-opinion-poster-v2`; if it is absent, pause for a user-selected substitute rather than silently falling back or downloading a font.

## Job setup

Create the job:

```bash
./scripts/scaffold-project.sh jobs/<job-id> /absolute/path/to/video.mov review
```

After dependency-install approval:

```bash
./scripts/check-environment.sh install-job jobs/<job-id> --yes
mkdir -p jobs/<job-id>/hyperframes/assets/fonts
cp /path/to/smiley-sans-oblique.woff2 jobs/<job-id>/hyperframes/assets/fonts/smiley-sans-oblique.woff2
```

`install-job` reuses the exact HyperFrames version from npm's `_npx` cache when available. Otherwise it installs the pinned dependency inside the job. It resolves GSAP independently and never requires a global HyperFrames installation.

## Render commands

From `jobs/<job-id>/hyperframes`:

```bash
npm run render:preview
npm run render
```

The preview uses HyperFrames `standard` quality. The final render uses `high` quality with the same composition, resolution, frame rate, timing, and audio.

For a local revision, inspect an encoded affected-window preview with surrounding speech, including entry, full visibility and exit. A successful render log or correct HTML is not proof that all images appeared. Reuse an unchanged encoded section only when timing, codec parameters, splice boundary, captions and audio remain compatible; preserve the last delivery until the candidate is checked. A full render remains the simpler fallback when those conditions are not met.

## Existing job references for targeted reuse

These are inspected examples, not portable commands. Reuse the working approach in the current job and adapt its inputs before execution; do not mutate the approved reference job or copy its approval exceptions.

| Need | Existing source under `jobs/07-dont-study-too-long/` | Reuse boundary |
| --- | --- | --- |
| Sequential evidence screenshots | `hyperframes/mg/e03-income/{fragment.html,style.css,timeline.mjs}` and `state/beat-map.json` | One builder-owned `motion.reveal` per cue, staged downward reveal and shared exit; recalculate asset sizes, word anchors and readability per job. Six images, eight-frame spacing and 1.95 seconds are reference parameters only. |
| Partial delivery revision | `scripts/render-revision-3.py` | Example of native alpha composition, compatible prefix/tail joining and original-audio remux. It hard-codes the old log, paths and frame counts; do not run it unchanged in a new job. Prefer the existing renderer unless reuse is demonstrably safe. |
| Candidate verification | `scripts/verify-corrected-delivery.py` | Reuse media/audio/splice checks and encoded-frame inspection, but replace job-specific dimensions, duration, sample locations and frame counts. It does not prove listening or aesthetic approval. |
| Five-platform workbook | `scripts/build-title-package.mjs` | Reuse the two-sheet workbook/formula layout with the active Spreadsheets skill and bundled runtime; rewrite all candidates for current content and adapt fixed topic/frame assertions. Preserve user selection and publication data. Run repository `scripts/check-titles.mjs` against the current video hash. |

## Repository verification

```bash
./scripts/verify-repository.sh --static
CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

Static verification is the CI-safe default. Runtime verification resolves the job-local HyperFrames runtime and executes real CLI, browser, and media checks.

## Integrated maintenance and new planning

The maintained fork is `lvzaixian/cut-motion`. `origin` identifies upstream; `personal` identifies the user fork. The pre-update branch is `local-workflow/pre-upstream-20261006`, preserving `db84840`; integration uses fixed upstream `41baefb`. Inspect Git state before future updates; never pull over local edits or bulk-regenerate old jobs. See [the integration guide](upstream-integration.md).

This host's shared font/npm cache is `/Users/maxwellbrooks/Workspace/口播/.cut-motion/`. Exact installed runtimes and old-job fonts may be read for reuse; never move or rewrite them. Modules and links remain inside the new job. `CUT_MOTION_FONT_CACHE` and `CUT_MOTION_NPM_CACHE` support other hosts. No project `node_modules`, state or preview belongs in the delivery cache. Reuse needs no approval; downloads follow the existing scoped consent rule.

`install-font.sh <job>` copies a licensed local font; use `--download` only after consent. A missing confirmed font blocks production rather than selecting sans-serif. Endpoint diagnosis is reserved for actual connection errors; a healthy probe does not establish that the active ChatCut tools can edit a project.

New planning and measured timing are routed from [Workflow](workflow.md#unified-planning-for-new-jobs). Compose respects visual approval and media lock. `render:revision` writes `final.candidate.mp4`, which still needs title validation and promotion.

Before publishing code, inspect the staged diff and run `node scripts/check-repository-privacy.mjs --staged`. Jobs, transcripts, credentials, runtime packages and font binaries remain ignored. This common-pattern check is repository maintenance and adds no video approval.
