# Music Video Maker

MP3 と画像を合成し、音声フィルタで音質を調整して YouTube 向けの MP4 を生成する Windows 用ローカル GUI ツールです。Suno の楽曲にも対応します。素材は外部に送信しません。

## ダウンロード

現在は MVP（v0.1.0）の初回リリース準備中です。正式な配布用 ZIP はまだ公開されていません。

公開後は [GitHub Releases](https://github.com/naoiw/music-video-maker/releases) の Assets から Windows x64 向けポータブル ZIP をダウンロードし、すべて展開して `music-video-maker.exe` を起動します。Node.js・Rust・FFmpeg の個別インストールやコマンド操作は不要です。WebView2 Runtime が未導入の場合は別途導入が必要です。

## 使い方

1. MP3 と画像（PNG / JPEG / GIF）を選択する。ドラッグ＆ドロップも可能。
2. 解像度・画像配置・映像品質を設定する。横長動画の初期値は 1920 × 1080、30 fps、中央80%・ぼかし背景、CRF 20。
3. 必要に応じて音声フィルタを設定し、原音・加工音を試聴する。
4. 「動画出力」で保存先を選択し、「MP4を生成」を押す。

**詳しい操作、設定項目、トラブルシューティングは [ユーザーガイド](docs/user-guide.md) を参照してください。**

## 主な機能

- MP3 と PNG / JPEG / GIF の合成、H.264 / AAC の MP4 出力。
- 中央80%・ぼかし背景（既定）、全体表示（余白）、画面いっぱい（切り抜き）。
- GIF は既定のぼかし背景では静止画、他の配置では音声終了までアニメーションを繰り返す。
- ノイズ除去、周波数・音量フィルタ、原音・加工音の比較試聴（最大30秒）。
- 出力・音声フィルタ設定の自動保存と復元、名前付きフィルタプリセット。
- 生成進捗と中断、既存出力の保護、エラー時の対処方法と診断情報。

対象は Windows 10 / 11 x64。複数素材、動画素材、ブラウザ版は MVP 対象外です。

## 開発

Rust / Tauri / TypeScript / FFmpeg を使用しています。

- [MVP仕様](docs/specification.md)
- [システム構成](docs/architecture.md)
- [UI仕様](docs/ui.md)
- [音声フィルタ処理基盤](docs/audio-filters.md)
- [開発フロー](docs/development.md)
- [テスト・検証](docs/testing.md)
- [Windows 配布パッケージ](docs/windows-package.md)
- [リリース手順](docs/release.md)
- [Issues](https://github.com/naoiw/music-video-maker/issues)

## License

[Apache License 2.0](LICENSE)。外部ライブラリおよび FFmpeg の配布審査は [配布パッケージ](docs/windows-package.md) を参照してください。
