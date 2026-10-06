#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
mode="${1:---static}"
[[ "$mode" == "--static" || "$mode" == "--runtime" ]] || {
  echo "Usage: scripts/verify-repository.sh [--static|--runtime]" >&2
  exit 64
}

node "$repository_root/scripts/check-repository-privacy.mjs"

while IFS= read -r json_file; do
  jq -e . "$json_file" >/dev/null
done < <(
  find "$repository_root" \
    -type d \( -name .git -o -name node_modules -o -name jobs -o -name .hyperframes \) -prune \
    -o -name '*.json' -type f -print
)

while IFS= read -r shell_file; do
  bash -n "$shell_file"
done < <(find "$repository_root/scripts" "$repository_root/tests" -name '*.sh' -type f)

while IFS= read -r module_file; do
  node --check "$module_file"
done < <(find "$repository_root/scripts" "$repository_root/tests" -name '*.mjs' -type f)

bash "$repository_root/scripts/check-environment.sh" check

required_files=(
  AGENTS.md
  README.md
  docs/agent-setup.md
  docs/quality-gates.md
  docs/title-standard.md
  assets/design-system.default.json
  config/validation-evidence-contracts.json
  schemas/chatcut-roughcut.schema.json
  schemas/roughcut-selection.schema.json
  schemas/cover.schema.json
  schemas/titles.schema.json
  schemas/workflow.schema.json
  schemas/render-manifest.schema.json
  schemas/validation-receipt.schema.json
  scripts/build-composition.mjs
  scripts/check-cover.mjs
  scripts/check-roughcut-selection.mjs
  scripts/check-titles.mjs
  scripts/render-manifest.mjs
  scripts/render-chunks.mjs
  scripts/run-validation-check.mjs
  scripts/validation-receipt.mjs
  scripts/workflow-state.mjs
  templates/hyperframes/index.template.html
  templates/hyperframes/package.json
  templates/job/workflow.json
)
for relative_path in "${required_files[@]}"; do
  [[ -s "$repository_root/$relative_path" ]] || {
    echo "Missing required file: $relative_path" >&2
    exit 1
  }
done
[[ ! -e "$repository_root/templates/hyperframes/index.html" ]] || {
  echo "Generated templates/hyperframes/index.html must not be tracked" >&2
  exit 1
}

# Local editorial fixtures remain alongside upstream regression coverage.
node "$repository_root/scripts/test-composition-builder.mjs"
node "$repository_root/scripts/test-planning-contracts.mjs"
node "$repository_root/scripts/test-approve-creative.mjs"
for test_file in "$repository_root"/tests/test-*.mjs; do
  case "$(basename "$test_file")" in
    test-delivery-workflow.mjs|test-prepare-rough-cut.mjs|test-source-audio-index.mjs|test-media-promotion.mjs) continue ;;
  esac
  node "$test_file"
done
bash "$repository_root/tests/test-media-pipeline.sh" --static

if [[ "$mode" == "--runtime" ]]; then
  runtime_font="${CUT_MOTION_FONT:-${MOTIONSCRIPT_FONT:-}}"
  [[ -f "$runtime_font" && -r "$runtime_font" ]] || {
    echo "Runtime verification requires CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2" >&2
    exit 66
  }
  bash "$repository_root/tests/test-media-pipeline.sh" --runtime
  node "$repository_root/tests/test-prepare-rough-cut.mjs"
  node "$repository_root/tests/test-source-audio-index.mjs"
  node "$repository_root/tests/test-media-promotion.mjs"
  node "$repository_root/tests/test-delivery-workflow.mjs" "$runtime_font"
fi

echo "cut-motion repository verification passed ($mode)."
