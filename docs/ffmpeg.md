# FFmpeg / FFprobe

開発段階では実行ファイルと同じディレクトリ、または PATH 上の ffmpeg / ffprobe を使用する。GUI 起動後に各バージョン・エラーが表示される。

## 開発時の確認

FFmpeg と FFprobe を同じビルドから取得し、PATH に追加する。

    ffmpeg -version
    ffprobe -version
    npm run desktop:dev

H.264 (libx264)、AAC、GIF デコード、afftdn 等の有効性は対応機能の実装時に確認する。

## 配布方針

- FFmpeg 本体は別プロセスで実行し、シェルは介さない。
- 配布用バイナリの提供元、バージョン、チェックサム、ビルド構成、ライセンスを確定するまで同梱しない。
- GPL/LGPL 等の条件、対応ソースと告知の提供方法を #24 で確認する。
- 自作コードの Apache-2.0 と FFmpeg のライセンスを混同しない。

現時点では開発環境でのバイナリ検出用実装のみ。配布用パッケージは未作成。
