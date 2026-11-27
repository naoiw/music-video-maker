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
    cargo test --manifest-path src-tauri/Cargo.toml
    npm run desktop:build

初期実装はローカルの依存解決・Windows 実機ビルドが未検証。ロックファイル生成と CI の確認を開発基盤の完了条件とする。
