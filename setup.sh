#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source scripts/unix-env.sh

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --check ) ]]; then
    fail "Usage: bash setup.sh [--check]"
fi

prepare_path
check_platform
check_node
require_command rustup

if [[ $# -eq 0 ]]; then
    case "$(uname -s)" in
        Darwin)
            check_native
            require_command brew
            # Use the full formula if the existing FFmpeg lacks features.
            if ! (check_media) >/dev/null 2>&1; then
                brew install ffmpeg-full
                prepare_path
            fi
            ;;
        Linux)
            require_command apt-get
            require_command sudo
            printf 'Installing Tauri system dependencies and FFmpeg using apt.\n'
            sudo apt-get update
            sudo apt-get install -y build-essential pkg-config curl wget file \
                libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev \
                libayatana-appindicator3-dev librsvg2-dev ffmpeg
            ;;
    esac
    if ! rustup run stable cargo -V >/dev/null 2>&1; then
        rustup toolchain install stable
    fi
    if ! command -v pnpm >/dev/null 2>&1; then
        require_command npm
        package_manager="$(pinned_pnpm)" || fail "package.json must pin pnpm."
        npm install --global "$package_manager"
    fi
fi

check_build_environment
printf 'Setup checks passed. Run bash build.sh.\n'
