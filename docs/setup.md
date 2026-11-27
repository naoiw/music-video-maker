# 開発環境の準備

Windows x64 を初期対象とする。

## 必要なもの

- Node.js 26（.node-version）
- Rust stable / rustup（MSVC ターゲット）
- Microsoft C++ Build Tools（Desktop development with C++）
- Microsoft Edge WebView2 Runtime

詳細: https://v2.tauri.app/start/prerequisites/

## 起動

    npm install
    npm run desktop:dev

ブラウザだけで UI を確認する場合:

    npm run dev

ブラウザプレビューでは Tauri のネイティブ処理は利用できない。

## 検証

    npm run typecheck
    npm run build
    cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo test --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml video::tests::encodes_ -- --ignored --test-threads=1
    cargo test --manifest-path src-tauri/Cargo.toml audio_filters::tests::processes_ -- --ignored
    cargo test --manifest-path src-tauri/Cargo.toml audio_preview::tests::renders_ -- --ignored
    npm run desktop:build

FFmpeg 結合テストには FFmpeg（libmp3lame、libx264、AAC 対応）および FFprobe が必要。CI でも同じ検証を実施する。ローカルの Cargo ビルド成果物は target に保持されるため、通常は毎回削除する必要はない。Cargo.lock と package-lock.json のリポジトリ管理は未対応。
