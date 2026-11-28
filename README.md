# Music Video Maker

音声素材と1枚以上の画像・動画を合成し、音声フィルタで音質を調整して YouTube 向けの MP4 を生成する デスクトップ用ローカル GUI ツールです。Suno の楽曲にも対応します。素材は外部に送信しません。

## セットアップとビルド（Windows 10 / 11 x64）

本リポジトリはソースコードのみを公開します。コンパイル済みバイナリ・インストーラー・FFmpeg の配布は行いません。

1. GitHub の **Code → Download ZIP** でソースを取得し、すべて展開します（git clone でも可）。
2. `setup.bat` をダブルクリックします。不足している Node.js 26、pnpm、C++ Build Tools、Rust、FFmpeg/FFprobe、WebView2 を WinGet 等で導入します。初回はネット接続が必要で、インストーラーや UAC の確認が出る場合があります。
3. セットアップ完了後、必要に応じて Windows を再起動し、`build.bat` をダブルクリックします。
4. `src-tauri/target/release/music-video-maker.exe` をダブルクリックして起動します。

以降は exe から GUI を使用できます。ソースを更新した場合は再ビルドしてください。FFmpeg/FFprobe は PATH 上に必要です。

依存管理は pnpm を標準とし、コミット済みの `pnpm-lock.yaml` と `src-tauri/Cargo.lock` を使用します。build.bat と CI は固定 lockfile を使用し、pnpm の版は package.json で指定します。

詳細な PowerShell 手順、エラー時の対処は [環境構築とビルド](docs/setup.md) を参照してください。

## セットアップとビルド（macOS / Linux）

macOS（Apple Silicon / Intel）、Ubuntu 24.04 x64 を初期の追加対象とします。Node.js 26 と rustup を事前に導入してください。macOS では Xcode Command Line Tools と Homebrew も必要です。

```bash
bash setup.sh
bash build.sh
bash run.sh
```

生成先は `src-tauri/target/release/music-video-maker` です。macOS・Linux ではシェルの PATH を引き継ぐためターミナルから起動してください。アプリバンドル・インストーラーは生成しません。詳細・Linux の他ディストリビューションに関する制約は [環境構築とビルド](docs/setup.md) を参照してください。

## 使い方

1. 音声素材とベース映像素材を選択する。用途別エリアへのドラッグ＆ドロップも可能。必要に応じて「追加レイヤー」から映像素材を最大8件重ね、順序・位置・サイズ・不透明度を調整する。
2. 解像度・画像配置・映像品質を設定する。横長動画の初期値は 1920 × 1080、30 fps、中央80%・ぼかし背景、CRF 20。
3. 必要に応じて音声フィルタを設定し、原音・加工音を試聴する。
4. 「動画出力」で保存先を選択し、「MP4を生成」を押す。

**詳しい操作、設定項目、トラブルシューティングは [ユーザーガイド](docs/user-guide.md) を参照してください。**

## 主な機能

- 対応音声素材と画像・動画 の合成、H.264 / AAC の MP4 出力。
- 中央80%・ぼかし背景（既定）、全体表示（余白）、画面いっぱい（切り抜き）。
- GIF・動画はベースのすべての配置と追加レイヤーで音声終了までアニメーションを繰り返す。ぼかし背景でも前景・背景が動く。
- ベース映像素材と最大8件の追加レイヤーを合成。表示順・位置・サイズ・不透明度を設定でき、プレビューに反映する。
- ノイズ除去、周波数・音量フィルタ、原音・加工音の比較試聴（最大30秒）。
- 出力・音声フィルタ設定の自動保存と復元、名前付きフィルタプリセット。
- CPU (libx264) または対応 GPU の H.264 エンコード、自動検出・CPU フォールバック。GPU は環境依存のため CPU を初期値とする。
- 生成進捗と中断、既存出力の保護、エラー時の対処方法と診断情報。

対象は Windows 10 / 11 x64、macOS（Apple Silicon / Intel）、Ubuntu 24.04 x64（追加対象の実機 GUI は要確認）。音声入力は MP3 / PCM WAV / FLAC / AAC / M4A / MP4 / WebM / MOV / MKV（動画コンテナは音声トラックのみ、8～48 kHz、1～2ch）、映像入力は PNG / JPEG / GIF / 静止画 WebP / MP4 / WebM / MOV / MKV（動画コンテナは映像トラックのみ）です。動画は最大2 GiB、静止画・GIFは最大32 MiB、4000万画素以下。アニメーションWebPは未対応です。詳細・対応コーデックは[ユーザーガイド](docs/user-guide.md)を参照してください。

## 開発

Rust / Tauri / TypeScript / Vite / pnpm / FFmpeg を使用しています。

- [MVP仕様](docs/specification.md)
- [システム構成](docs/architecture.md)
- [UI仕様](docs/ui.md)
- [音声フィルタ処理基盤](docs/audio-filters.md)
- [開発フロー](docs/development.md)
- [テスト・検証](docs/testing.md)
- [環境構築とビルド](docs/setup.md)
- [FFmpeg / FFprobe](docs/ffmpeg.md)
- [MVP総合検証](docs/mvp-validation.md)
- [Issues](https://github.com/naoiw/music-video-maker/issues)

## License

```text
Copyright 2026 Naoki

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

[Apache License 2.0](LICENSE)。FFmpeg は別途導入する独立したプログラムであり、各ソフトウェアのライセンスが適用されます。
