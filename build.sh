#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source scripts/unix-env.sh

skip_install=0
for arg in "$@"; do
    case "$arg" in
        --skip-install) skip_install=1 ;;
        *) fail "Unknown option: $arg" ;;
    esac
done

prepare_path
check_build_environment
export RUSTUP_TOOLCHAIN=stable
export CARGO_TARGET_DIR="$PWD/src-tauri/target"
if [[ "$skip_install" == 0 ]]; then
    pnpm install --frozen-lockfile
fi
pnpm run desktop:build
binary="$CARGO_TARGET_DIR/release/music-video-maker"
[[ -x "$binary" ]] || fail "Build did not produce $binary."
printf '\nBuild complete:\n%s\nRun: bash run.sh\n' "$binary"
