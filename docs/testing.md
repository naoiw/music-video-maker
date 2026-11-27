# テスト・検証（#23）

## 実行方法

Node.js は .node-version、Rust は stable、FFmpeg/FFprobe は PATH または実行ファイルと同じフォルダに配置する。FFmpeg 結合テストには libmp3lame、libx264、AAC、音声フィルタ、lavfi が必要。

リポジトリルートで実行する。

```powershell
npm install
npm run build
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
ffmpeg -version
ffprobe -version
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1
```

pnpm を使用するローカル環境では npm install / npm run build / npm test を pnpm install / pnpm run build / pnpm test に置き換えられる。Vite のビルド後に Rust テストを行う。

## CI とテスト対象

Windows CI ではフロントエンドの型チェック・単体テスト、Rust の整形・lint・単体テスト、FFmpeg 結合テスト、デスクトップ実行ファイル生成を順に実行する。FFmpeg が必要な Rust テストは理由付きの ignore を付ける。CI は FFmpeg/FFprobe を準備し、名前の接頭辞ではなく ignore を付けた全テストを直列実行する（動画生成等のロック競合を避ける）。ignore は任意の失敗を隠す目的で使用しない。

| 対象 | 主な検証 |
| --- | --- |
| フロントエンド | ドロップ分類、設定スキーマ・保存順序、プリセット、エラー案内・診断 |
| Rust 単体 | 出力設定81通り、引数の分離、FFprobe JSON検証、音声フィルタ範囲・順序、素材読み込み、設定ファイル、進捗・中断、I/Oエラー分類 |
| 音声結合 | ノイズ低減、周波数応答、ゲイン、ラウドネス、リミッター、原音・加工音・末尾試聴 |
| 動画結合 | PNG/JPEG/GIF、中央80%・ぼかし背景、GIF静止画・従来ループ、出力設定、加工音との尺・音量、中断・再試行、破損素材からの復帰、既存出力の保護 |
| 出力の独立検証 | 保存済みMP4をFFprobeで再取得し、H.264/AAC、映像寸法、FPS、yuv420p、映像・音声・コンテナの尺を確認 |

## テスト素材

外部楽曲や画像、配布制約のあるサンプルは使用しない。FFmpeg の lavfi でサイン波やノイズを合成し、Rust image クレートで単色画像・GIF等を生成する。JSONのメタデータもテスト内で生成する。破損素材は短い任意のバイト列で作る。各テストは専用の一時ディレクトリで動作し、終了後に破棄する。素材ファイルをリポジトリに保存する必要はない。FFmpeg 自体の配布条件は #24 で別途確認する。

## Windows 実機確認（自動テストの対象外）

- デスクトップ起動、ファイルダイアログ・ドラッグ＆ドロップ、日本語パス、素材プレビュー
- 3種類の解像度、24/30/60 FPS、画像配置、実際の音楽での聴感と動画の尺
- 原音・加工音比較、フィルタ切替、再起動後の設定・プリセット復元
- 破損素材、アクセス権限、ディスク容量不足、FFmpeg未検出、エラー診断、再試行、中断
- YouTubeへの投稿・再生互換性、配布物の起動（#24以降）

自動テストはGUI操作、実際の楽曲の品質、全FFmpegバージョンでの互換性を保証しない。実機確認の結果は確認した環境・バージョンとともに記録する。既存の出力検証の許容差や音質テストの閾値は緩和しない。

## 配布パッケージ（#24）

Node.js 単体テストに配布承認情報の検証、SHA-256 の一致・不一致・欠損入力を追加。承認後のパッケージ生成時には同梱する実ファイルを用いて H.264/AAC の短い動画を生成し、FFprobe で確認する。配布用の全結合テストと Windows クリーン環境の GUI 動作は別途実施する。詳細は [Windows 配布パッケージ](windows-package.md) を参照。

## 自動配布（#25）

Node.js 単体テストでタグと3つのバージョンの一致、審査済み lock と HTTPS 取得先の必須条件を検証する。Release ワークフローは ZIP を展開し、必要ファイルの存在と同梱 FFmpeg/FFprobe の検索パスを確認してから既存の全結合テストを直列実行する。公開ジョブでも ZIP の SHA-256 を照合する。実際のタグ push、配布物の公開、Windows クリーン環境の GUI 動作は別途確認する。

## ユーザーガイド（#26）

[ユーザーガイド](user-guide.md) と配布 ZIP の README.txt を、現行 UI・対応形式・既定値・エラー表示と照合する。#27 のクリーン環境ではガイドのみを使い、ZIP の展開、初回起動、素材選択、加工なし/ありの MP4 生成、GIF の配置切替、保存済み設定の復元、異常時の案内を確認する。開発ツールやコマンド操作を要求しないことも確認する。実機確認は別途実施する。

## MVP 総合検証（#27）

[総合検証チェックリスト](mvp-validation.md) を使用し、自動検証と実機確認を分けて記録する。通常CIでは actionlint によるワークフロー検査、実際のマニフェストと配布審査ゲートのテストを追加する。FFmpeg は lock の固定ZIPをSHA-256検証してテスト専用に取得し、通常のArtifactには同梱しない。
