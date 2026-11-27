# GitHub Pages ブラウザ版（#29・技術検証）

対象 URL: https://naoiw.github.io/music-video-maker/ （未公開）。

Windows 版の Tauri GUI は変更しない。まず独立したブラウザ検証画面を実装し、既存のスタイルを再利用する。単一スレッド core 0.12.10 を専用 Worker で動かし、ユーザー選択の MP3 と PNG/JPEG/GIF から 720p/1080p・30fps H.264/AAC MP4 を生成する。全体表示・切り抜きに対応する設計。ぼかし背景、フィルタ、試聴、プリセット、共通 GUI への統合は未実装。

## ローカル検証

    pnpm install --frozen-lockfile
    pnpm web:prepare
    pnpm web:dev

http://127.0.0.1:1421/music-video-maker/ を開く。静的ビルドは pnpm web:build、確認は pnpm web:preview（http://127.0.0.1:4173/music-video-maker/）。Node 26、固定 pnpm、tar が必要。Windowsのバッチは従来通り。

- 初回は処理エンジンの取得が必要（約32 MB）。素材は送信しない。
- MP3 50 MiB、画像32 MiB・4000万画素、音声5分を試作上限とする。デスクトップ版の上限は変更しない。720pを初期値とし、1080pも試験可能。出力はCRF20/ultrafast、映像6 Mbpsの上限制御。
- 1ジョブごとにWorkerを破棄。中断後は再実行可能。出力Blobは素材変更・再実行・離脱で解放する。
- 公式FFmpeg.wasmの低レベルcore APIに合わせた薄い専用Worker。公式JSラッパーの依存追加はせず、lockfileを維持する。coreのAPI互換性はCIで検証する。

## コアの取得と公開条件

web:prepare はnpmレジストリの指定バージョンのtarballをSHA-512で検証し、tar -xOfで対象2ファイルだけ取得する。jsDelivrからの取得バイトと照合しSHA-256マニフェストを生成する。これは試験用照合であって事前に審査された固定ハッシュではない。公開前に確認したregistryIntegrity / coreJsSha256 / coreWasmSha256、ライセンス・安全性・実用性能に関する審査記録を web/core-lock.json に反映する。approved=false のままでは公開ビルドを拒否する。ブラウザはそのマニフェストと取得バイトを照合してから実行する。CSPは接続先を自サイト・jsDelivrに限定する。コア自体の再配布や再配布条件の免除を宣言しない。

## CI・公開設定

Browser preview and Pages workflow はPR/mainでビルド、単体テスト、実Chromeで合成素材PNG/JPEG/GIFを使った短尺生成とFFprobe検証を行う。公開成果物にcore JS/WASMが含まれないことを検査する。公開はレビュー後、mainでworkflow_dispatchのdeploy=trueを選択した場合のみ行う。リポジトリ Settings → Pages → Build and deployment → Source を GitHub Actions に設定する。既存のWindows用CIは維持。公開条件が未達の場合は設定してもデプロイされない。

## 残件

- CI実行結果、PC Chrome/Edgeの3〜5分・1080p実測、メモリと出力尺、GIFループ、中断・再試行、ネットワーク非送信の実機確認。
- 第三者ライセンス・コーデック特許・安全性のレビュー、公開承認、実URL確認。
- 既存GUIと機能の段階的統合。実用性や公開条件を満たせない場合は#29を中止する。

参考: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/ffmpeg/src/worker.ts 、https://ffmpegwasm.netlify.app/docs/getting-started/usage/ 、https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
