#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source scripts/unix-env.sh

prepare_path
check_platform
require_command ffmpeg
require_command ffprobe
binary="$PWD/src-tauri/target/release/music-video-maker"
[[ -x "$binary" ]] || fail "Executable missing. Run bash build.sh first."
exec "$binary" "$@"
