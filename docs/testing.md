# テスト・検証（#23）

## 実行方法

Node.js は .node-version、パッケージマネージャーは pnpm、Rust は stable、FFmpeg/FFprobe は PATH または実行ファイルと同じフォルダに配置する。FFmpeg 結合テストには libmp3lame、libx264、AAC、音声フィルタ、lavfi が必要。

リポジトリルートで実行する。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
ffmpeg -version
ffprobe -version
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1
```

コミット済みの pnpm-lock.yaml と src-tauri/Cargo.lock を使用する。Vite のビルド後に Rust テストを行う。CI も package.json の固定 pnpm と --frozen-lockfile、Cargo の --locked を使用し、終了時に両 lockfile に変更がないことを検証する。

## CI とテスト対象

Windows CI ではフロントエンドの型チェック・単体テスト、Rust の整形・lint・単体テスト、FFmpeg 結合テスト、デスクトップ実行ファイル生成を順に実行する。FFmpeg が必要な Rust テストは理由付きの ignore を付ける。CI は FFmpeg/FFprobe を準備し、名前の接頭辞ではなく ignore を付けた全テストを直列実行する（動画生成等のロック競合を避ける）。ignore は任意の失敗を隠す目的で使用しない。

| 対象 | 主な検証 |
| --- | --- |
| フロントエンド | ドロップ分類、レイヤー座標・順序・入力検証、設定スキーマ・保存順序、プリセット、エラー案内・診断 |
| Rust 単体 | 出力設定81通り、引数の分離、FFprobe JSON検証、音声フィルタ範囲・順序、素材読み込み、設定ファイル、進捗・中断、I/Oエラー分類 |
| 音声結合 | ノイズ低減、周波数応答、ゲイン、ラウドネス、リミッター、原音・加工音・末尾試聴 |
| 動画結合 | PNG/JPEG/GIF、複数レイヤーの順序・透過、中央80%・ぼかし背景、GIF全配置および追加レイヤーのループ（ぼかし背景と前景の色変化を含む）、出力設定、加工音との尺・音量、中断・再試行、破損素材からの復帰、既存出力の保護 |
| 出力の独立検証 | 保存済みMP4をFFprobeで再取得し、H.264/AAC、映像寸法、FPS、yuv420p、映像・音声・コンテナの尺を確認 |

## テスト素材

外部楽曲や画像、配布制約のあるサンプルは使用しない。FFmpeg の lavfi でサイン波やノイズを合成し、Rust image クレートで単色画像・GIF等を生成する。JSONのメタデータもテスト内で生成する。破損素材は短い任意のバイト列で作る。各テストは専用の一時ディレクトリで動作し、終了後に破棄する。素材ファイルをリポジトリに保存する必要はない。

## Windows 実機確認（自動テストの対象外）

- デスクトップ起動、ファイルダイアログ・ドラッグ＆ドロップ、日本語パス、素材プレビュー
- 3種類の解像度、24/30/60 FPS、画像配置、実際の音楽での聴感と動画の尺
- 原音・加工音比較、フィルタ切替、再起動後の設定・プリセット復元
- 破損素材、アクセス権限、ディスク容量不足、FFmpeg未検出、エラー診断、再試行、中断
- YouTubeへの投稿・再生互換性、setup.bat / build.bat による初回導入・起動

自動テストはGUI操作、実際の楽曲の品質、全FFmpegバージョンでの互換性を保証しない。実機確認の結果は確認した環境・バージョンとともに記録する。既存の出力検証の許容差や音質テストの閾値は緩和しない。


## ローカルビルドと総合検証

CI は FFmpeg の固定 ZIP を上流から SHA-256 照合してテスト用に取得し、結合テストを実行する。setup.ps1 の構文を確認し、build.bat --no-pause で exe を生成する。exe や FFmpeg は Artifact として公開しない。クリーン Windows での環境構築・手動操作は [総合検証](mvp-validation.md) で確認する。

## 追加レイヤー（#30）

Rust単体テストで相対座標の変換・範囲、不透明度、合成順、FFmpeg引数のパス分離と音声マッピングを検証する。ignore付き結合テストでは合成PNGを用い、重なり順、元画像のアルファと不透明度の乗算、レイヤー外の背景、出力尺を確認する。フロントエンド単体テストで百分率の変換、座標の検証、3解像度のピクセル矩形、重なり順を確認する。既存のGIF結合テストでは、ループ指定なし・有限回・無限回のGIFをベースの3配置に加えて追加レイヤーとして生成し、元GIFの尺を超えた複数時点の画素と音声尺を検証する。Windows実機では追加・削除・順序・位置・サイズ・不透明度、無効値での生成抑止、キャンセル、生成中の編集禁止、非同期のベースプレビュー更新後のレイヤー保持を確認する。

## 音声入力形式・用途別ドロップ（#31 / #32）

単体テストでコンテナとコーデックの組み合わせ、音声尺の優先順位、ドロップ先と単一ファイル制約を確認する。FFmpeg 結合テストでは WAV / FLAC / AAC / M4A / 音声付き MP4 / WebM / MOV / MKV を生成し、原音・加工音試聴と MP4 出力、音声の長さ、動画由来の映像が混入しないことを確認する。Windows 実機では DPI・スクロール時のドロップ位置とエリアの強調を確認する。

映像入力の結合テストでは合成した MP4 / WebM / MOV / MKV をベースの動的ぼかし背景および追加レイヤーに使い、ループ後の画素、出力尺を確認する。静止画WebPの3種類の配置と非対応ストリームも検証する。Windows実機のプレビュー・ドロップ操作は別途確認する。
