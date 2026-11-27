# Music Video Maker

楽曲と画像・動画を合成し、音声フィルタ処理を行って YouTube 向けの MP4 を生成するツールです。

## 開発状況

MVP（v0.1.0）の開発中です。現時点では配布用アプリケーションはありません。

## MVP の目標

- MP3 と PNG / JPEG / GIF の合成（ファイル選択・ドラッグ＆ドロップ）
- ノイズ除去、周波数・音量フィルタの設定と試聴
- H.264 / AAC の MP4 出力
- 出力・音声フィルタ設定の自動保存と復元
- Windows でのローカル GUI 実行（素材を外部サーバーへ送信しない）

## 開発

Rust / Tauri / TypeScript / FFmpeg を使用する方針です。

- [MVP仕様](docs/specification.md)
- [システム構成](docs/architecture.md)
- [音声フィルタ処理基盤](docs/audio-filters.md)
- [開発フロー](docs/development.md)
- [Issues](https://github.com/naoiw/music-video-maker/issues)

## License

[Apache License 2.0](LICENSE)。外部ライブラリおよび FFmpeg の配布条件は別途確認します。
