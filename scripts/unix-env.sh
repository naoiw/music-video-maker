#!/usr/bin/env bash
# Shared environment checks for setup.sh, build.sh and run.sh.
# Sourced after changing to the repository root.

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing $1. See docs/setup.md."
}

prepare_path() {
    export PATH="$HOME/.cargo/bin:$PATH"
    if [[ "$(uname -s)" == Darwin ]]; then
        if ! command -v brew >/dev/null 2>&1; then
            if [[ "$(uname -m)" == arm64 && -x /opt/homebrew/bin/brew ]]; then
                export PATH="/opt/homebrew/bin:$PATH"
            elif [[ -x /usr/local/bin/brew ]]; then
                export PATH="/usr/local/bin:$PATH"
            fi
        fi
        # ffmpeg-full is keg-only on some Homebrew versions. Prefer it when
        # explicitly installed, without changing the user's global brew links.
        if command -v brew >/dev/null 2>&1; then
            local prefix
            prefix="$(brew --prefix ffmpeg-full 2>/dev/null || true)"
            if [[ -n "$prefix" && -x "$prefix/bin/ffmpeg" && -x "$prefix/bin/ffprobe" ]]; then
                export PATH="$prefix/bin:$PATH"
            fi
        fi
    fi
}

check_platform() {
    case "$(uname -s):$(uname -m)" in
        Darwin:arm64|Darwin:x86_64|Linux:x86_64|Linux:aarch64) ;;
        *) fail "Unsupported platform: $(uname -s) $(uname -m)." ;;
    esac
}

check_node() {
    require_command node
    local wanted actual
    wanted="$(tr -d '[:space:]' < .node-version)"
    actual="$(node -p 'process.versions.node.split(".")[0]')"
    [[ "$actual" == "$wanted" ]] || fail "Node.js $wanted is required (found $actual). Select the required version; existing Node is not replaced."
}

pinned_pnpm() {
    node -e 'const p = require("./package.json").packageManager; if (!/^pnpm@\d+\.\d+\.\d+$/.test(p)) process.exit(1); console.log(p)'
}

check_pnpm() {
    require_command pnpm
    local wanted actual
    wanted="$(pinned_pnpm)" || fail "package.json must pin pnpm."
    actual="$(pnpm --version)"
    [[ "$actual" == "${wanted#pnpm@}" ]] || fail "$wanted is required (found $actual). Select the pinned version."
}

check_native() {
    case "$(uname -s)" in
        Darwin)
            xcode-select -p >/dev/null 2>&1 || fail "Run xcode-select --install first."
            xcrun --find clang >/dev/null 2>&1 || fail "Xcode Command Line Tools are unavailable."
            ;;
        Linux)
            require_command pkg-config
            require_command cc
            pkg-config --exists webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 || fail "Missing Tauri system libraries. Run bash setup.sh or see docs/setup.md."
            ;;
    esac
}

check_media() {
    require_command ffmpeg
    require_command ffprobe
    ffmpeg -version >/dev/null
    ffprobe -version >/dev/null
    # Here-strings avoid SIGPIPE from grep -q terminating a producer early.
    local encoders filters feature
    encoders="$(ffmpeg -hide_banner -encoders)"
    for feature in libx264 aac libmp3lame libopus libvpx-vp9 libwebp libwebp_anim ffv1; do
        grep -Eq "[[:space:]]${feature}[[:space:]]" <<< "$encoders" || fail "FFmpeg encoder unavailable: $feature. Install a full FFmpeg build."
    done
    filters="$(ffmpeg -hide_banner -filters)"
    for feature in afftdn equalizer highpass lowpass loudnorm alimiter volume overlay gblur showfreqs showwaves showvolume showspectrum colorkey apad tpad; do
        grep -Eq "[[:space:]]${feature}[[:space:]]" <<< "$filters" || fail "FFmpeg filter unavailable: $feature."
    done
}

check_build_environment() {
    check_platform
    check_node
    check_pnpm
    check_native
    require_command rustup
    rustup run stable cargo -V
    check_media
}
