#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/check-environment.sh check
  scripts/check-environment.sh chatcut [probe arguments]
  scripts/check-environment.sh install-job <job-directory> [--yes]

check verifies local cut-motion runtime dependencies. Use ChatCut tools already
loaded in the active Agent session; if unavailable, report it and stop. Run the
endpoint probe only to diagnose a specific connection failure.

install-job reuses complete exact-version packages locally. New downloads need
--yes and install only into the selected job; other jobs and caches stay intact.
It never installs global packages, Agent plugins, fonts, or system dependencies.
EOF
}

command_name="${1:-check}"

require_command() {
  local name="$1"
  local hint="$2"

  if command -v "$name" >/dev/null 2>&1; then
    printf 'ok       %s\n' "$name"
    return
  fi

  printf 'missing  %s — %s\n' "$name" "$hint"
  missing_count=$((missing_count + 1))
}

check_environment() {
  local node_major
  missing_count=0

  require_command bash "install a Bash-compatible shell"
  require_command node "install Node.js 22 or newer"
  require_command npm "install npm with Node.js 22 or newer"
  require_command npx "install npm with Node.js 22 or newer"
  require_command ffmpeg "install FFmpeg with libx264 and AAC support"
  require_command ffprobe "install FFmpeg/FFprobe"
  require_command jq "install jq"

  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 22 )); then
      printf 'ok       Node.js %s\n' "$(node --version)"
    else
      printf 'missing  Node.js 22+ — found %s\n' "$(node --version)"
      missing_count=$((missing_count + 1))
    fi
  fi

  if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
    printf 'ok       FFmpeg libx264 encoder\n'
  else
    printf 'missing  FFmpeg libx264 encoder — install a full FFmpeg build\n'
    missing_count=$((missing_count + 1))
  fi
  if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE '^[[:space:]]*A.*[[:space:]]aac[[:space:]]'; then
    printf 'ok       FFmpeg AAC encoder\n'
  else
    printf 'missing  FFmpeg AAC encoder — install a full FFmpeg build\n'
    missing_count=$((missing_count + 1))
  fi

  printf '%s\n' 'manual   Licensed display font — required in each job before composition; missing media blocks rendering'

  printf '%s\n' 'manual  ChatCut — use currently loaded Agent tools; report immediately if unavailable'

  if (( missing_count > 0 )); then
    printf '\nLocal preflight failed: %d required system tool(s) missing. Follow the OS setup guide; ask before installing global or system dependencies.\n' "$missing_count" >&2
    return 1
  fi

  printf '\nLocal dependencies passed. Verify the required display font before rendering.\n'
}

install_job() {
  local job_directory="${1:-}" approval="${2:-}"
  [[ -n "$job_directory" && ( $# -eq 1 || ( $# -eq 2 && "$approval" == "--yes" ) ) ]] || { usage >&2; exit 64; }
  job_directory="$(cd "$job_directory" && pwd -P)"
  local hyperframes_directory="$job_directory/hyperframes"
  local node_modules_directory="$hyperframes_directory/node_modules"
  [[ ! -L "$hyperframes_directory" ]] || { echo "HyperFrames directory must belong to this job" >&2; exit 66; }
  local required_hyperframes_version required_gsap_version npm_cache download_cache candidate staging
  [[ -f "$hyperframes_directory/package.json" ]] || { echo "Missing generated HyperFrames package: $hyperframes_directory/package.json" >&2; exit 66; }
  for tool in node npm; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required for job dependencies" >&2; exit 69; }; done
  read -r required_hyperframes_version required_gsap_version < <(
    node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log((p.devDependencies??p.dependencies).hyperframes,(p.devDependencies??p.dependencies).gsap)' "$hyperframes_directory/package.json"
  )
  [[ "$required_hyperframes_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && "$required_gsap_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || {
    echo "Job dependencies must declare exact HyperFrames and GSAP versions" >&2; exit 66;
  }
  # A directory symlink would let CLI repairs mutate another job or shared cache.
  [[ ! -L "$node_modules_directory" && ! -L "$node_modules_directory/.bin" ]] || { echo "Job node_modules must be a job-owned directory; preserve and detach its shared link first" >&2; exit 66; }
  npm_cache="$(npm config get cache)"
  download_cache="${CUT_MOTION_NPM_CACHE:-$npm_cache}"
  if [[ -z "${CUT_MOTION_NPM_CACHE:-}" && -d "$repository_root/../口播/.cut-motion" ]]; then
    download_cache="$repository_root/../口播/.cut-motion/npm-cache"
  fi

  module_valid() {
    node - "$1" "$2" "$3" <<'NODE'
const fs = require("node:fs"), path = require("node:path");
const [directory, name, version] = process.argv.slice(2);
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
  if (manifest.version !== version) process.exit(1);
  if (name === "gsap") {
    if (!fs.statSync(path.join(directory, "dist/gsap.min.js")).isFile()) process.exit(1);
  } else {
    const binary = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.hyperframes;
    if (!binary) process.exit(1);
    const resolved = path.resolve(directory, binary), relative = path.relative(directory, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) process.exit(1);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || !(stat.mode & 0o111)) process.exit(1);
    // Check declared runtime packages without executing cached code or downloading.
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      let parent = fs.realpathSync(directory);
      let found = fs.existsSync(path.join(path.dirname(parent), dependency, "package.json"));
      while (!found) {
        if (fs.existsSync(path.join(parent, "node_modules", dependency, "package.json"))) { found = true; break; }
        const next = path.dirname(parent); if (next === parent) break; parent = next;
      }
      if (!found) process.exit(1);
    }
  }
} catch { process.exit(1); }
NODE
  }
  tree_valid() {
    module_valid "$1/hyperframes" hyperframes "$required_hyperframes_version" \
      && module_valid "$1/gsap" gsap "$required_gsap_version"
  }
  preflight_destinations() {
    local candidate
    [[ ! -L "$hyperframes_directory/assets" && ! -L "$hyperframes_directory/assets/gsap.min.js" ]] || { echo "GSAP browser asset must belong to this job" >&2; return 1; }
    for candidate in "$hyperframes_directory/assets" "$node_modules_directory/.bin"; do
      [[ ! -e "$candidate" || ( -d "$candidate" && -w "$candidate" && ! -L "$candidate" ) ]] || { echo "Dependency destination must be a writable job directory: $candidate" >&2; return 1; }
    done
    for candidate in "$hyperframes_directory/assets/gsap.min.js" "$hyperframes_directory/package-lock.json"; do
      [[ ! -L "$candidate" && ( ! -e "$candidate" || ( -f "$candidate" && -w "$candidate" ) ) ]] || { echo "Dependency destination must be a writable job file: $candidate" >&2; return 1; }
    done
    [[ -w "$hyperframes_directory" && ! -d "$node_modules_directory/.bin/hyperframes" ]] || { echo "Dependency destination is not writable" >&2; return 1; }
  }
  finish_job() {
    local binary asset_candidate="$hyperframes_directory/assets/.gsap-runtime-$$"
    binary="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1])).bin; process.stdout.write(typeof b==="string"?b:b.hyperframes)' "$node_modules_directory/hyperframes/package.json")" || return 1
    preflight_destinations || return 1
    mkdir -p "$node_modules_directory/.bin" "$hyperframes_directory/assets" || return 1
    rm -f "$node_modules_directory/.bin/hyperframes" || return 1
    ln -s "../hyperframes/$binary" "$node_modules_directory/.bin/hyperframes" || return 1
    [[ ! -e "$asset_candidate" && ! -L "$asset_candidate" ]] || return 1
    if cp "$node_modules_directory/gsap/dist/gsap.min.js" "$asset_candidate" \
      && mv "$asset_candidate" "$hyperframes_directory/assets/gsap.min.js"; then
      return 0
    fi
    rm -f "$asset_candidate"
    return 1
  }
  publish_job() {
    local prepared="$1" prepared_lock="${2:-}" previous="$hyperframes_directory/.dependencies-previous-$$" candidate
    preflight_destinations || return 1
    [[ ! -e "$previous" && ! -L "$previous" ]] || { echo "Dependency backup already exists: $previous" >&2; return 1; }
    mkdir "$previous" || return 1
    # Keep both dependencies and generated resources until every preparation step succeeds.
    for candidate in gsap.min.js package-lock.json; do
      local source="$hyperframes_directory/$candidate"
      [[ "$candidate" != gsap.min.js ]] || source="$hyperframes_directory/assets/$candidate"
      if [[ -f "$source" ]] && ! cp "$source" "$previous/$candidate"; then rm -rf "$previous"; return 1; fi
    done
    if [[ -f "$prepared_lock" ]] && ! cp "$prepared_lock" "$previous/new-package-lock.json"; then rm -rf "$previous"; return 1; fi
    if [[ -e "$node_modules_directory" ]] && ! mv "$node_modules_directory" "$previous/node_modules"; then rm -rf "$previous"; return 1; fi
    if mv "$prepared" "$node_modules_directory" && finish_job \
      && { [[ ! -f "$previous/new-package-lock.json" ]] || mv "$previous/new-package-lock.json" "$hyperframes_directory/package-lock.json"; }; then
      rm -rf "$previous" || echo "Prepared dependencies passed; retained backup: $previous" >&2
      return 0
    fi
    rm -rf "$node_modules_directory" || { echo "Rollback needs recovery from $previous" >&2; return 1; }
    [[ ! -e "$previous/node_modules" ]] || mv "$previous/node_modules" "$node_modules_directory" || { echo "Rollback needs recovery from $previous" >&2; return 1; }
    for candidate in gsap.min.js package-lock.json; do
      local destination="$hyperframes_directory/$candidate"
      [[ "$candidate" != gsap.min.js ]] || destination="$hyperframes_directory/assets/$candidate"
      if [[ -f "$previous/$candidate" ]]; then
        mv "$previous/$candidate" "$destination" || { echo "Rollback needs recovery from $previous" >&2; return 1; }
      else
        rm -f "$destination" || { echo "Rollback needs recovery from $previous" >&2; return 1; }
      fi
    done
    rm -rf "$previous"
    echo "Dependency preparation failed; previous dependencies and resources were restored" >&2
    return 1
  }

  preflight_destinations || exit 66

  if tree_valid "$node_modules_directory"; then
    finish_job
    echo "Reused job dependencies: $hyperframes_directory"
    return
  fi
  for candidate in "$repository_root"/jobs/*/hyperframes/node_modules "$repository_root/node_modules"; do
    [[ -d "$candidate" && ! -L "$candidate" && "$candidate" != "$node_modules_directory" ]] || continue
    tree_valid "$candidate" || continue
    staging="$(mktemp -d "$hyperframes_directory/.dependency-reuse.XXXXXX")"
    if cp -R -L "$candidate/." "$staging/" && tree_valid "$staging"; then
      publish_job "$staging" || { rm -rf "$staging"; exit 66; }
      echo "Copied pinned dependencies into this job from $candidate"
      return
    fi
    rm -rf "$staging"
  done
  local cached_hyperframes="" cached_gsap="" package_json module_directory
  for package_json in "$npm_cache"/_npx/*/node_modules/hyperframes/package.json; do
    module_directory="${package_json%/package.json}"
    module_valid "$module_directory" hyperframes "$required_hyperframes_version" || continue
    cached_hyperframes="$(cd "$module_directory" && pwd -P)"; break
  done
  for package_json in "$npm_cache"/_npx/*/node_modules/gsap/package.json; do
    module_directory="${package_json%/package.json}"
    module_valid "$module_directory" gsap "$required_gsap_version" || continue
    cached_gsap="$(cd "$module_directory" && pwd -P)"; break
  done
  if [[ -n "$cached_hyperframes" && -n "$cached_gsap" ]]; then
    staging="$(mktemp -d "$hyperframes_directory/.dependency-reuse.XXXXXX")"
    ln -s "$cached_hyperframes" "$staging/hyperframes"
    ln -s "$cached_gsap" "$staging/gsap"
    publish_job "$staging" || { rm -rf "$staging"; exit 66; }
    echo "Linked exact npm-cached dependencies into this job"
    return
  fi
  [[ "$approval" == "--yes" ]] || {
    echo "No complete exact-version dependency cache. Download requires --yes; current job dependencies were preserved." >&2
    exit 77
  }
  staging="$(mktemp -d "$hyperframes_directory/.dependency-install.XXXXXX")"
  cp "$hyperframes_directory/package.json" "$staging/package.json"
  [[ ! -f "$hyperframes_directory/package-lock.json" ]] || cp "$hyperframes_directory/package-lock.json" "$staging/package-lock.json"
  if ! npm install --cache "$download_cache" --prefix "$staging" --no-audit --no-fund || ! tree_valid "$staging/node_modules"; then
    rm -rf "$staging"
    echo "Pinned job dependency installation failed; previous dependencies were preserved" >&2; exit 69
  fi
  publish_job "$staging/node_modules" "$staging/package-lock.json" || { rm -rf "$staging"; exit 66; }
  rm -rf "$staging"
  echo "Installed pinned dependencies into this job: $hyperframes_directory"
}

case "$command_name" in
  check)
    [[ $# -eq 1 ]] || { usage >&2; exit 64; }
    check_environment
    ;;
  chatcut)
    shift
    node "$script_directory/check-chatcut.mjs" "$@"
    ;;
  install-job)
    shift
    install_job "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
