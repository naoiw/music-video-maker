# GitHub Pages ブラウザ版（#29・技術検証）

対象 URL: https://naoiw.github.io/music-video-maker/ （未公開）。

Windows 版の Tauri GUI は変更しない。まず独立したブラウザ検証画面を実装し、既存のスタイルを再利用する。単一スレッド core 0.12.10 を専用 Worker で動かし、ユーザー選択の MP3 と PNG/JPEG/GIF から 720p/1080p・30fps H.264/AAC MP4 を生成する。全体表示・切り抜きに対応する設計。ぼかし背景、フィルタ、試聴、プリセット、共通 GUI への統合は未実装。

## ローカル検証

    pnpm install --frozen-lockfile
    pnpm web:prepare
    pnpm web:build
    pnpm web:preview

http://127.0.0.1:4173/music-video-maker/ を開く。公開成果物と同じCSP・パスで確認する。開発用 pnpm web:dev（port 1421）はCSPによりスタイル注入等が制約されるため、動作確認には静的プレビューを使用する。Node 26、固定 pnpm、tar が必要。Windowsのバッチは従来通り。

- 初回は処理エンジンの取得が必要（約32 MB）。素材は送信しない。
- MP3 50 MiB、画像32 MiB・4000万画素、音声5分を試作上限とする。デスクトップ版の上限は変更しない。720pを初期値とし、1080pも試験可能。出力はCRF20/ultrafast、映像6 Mbpsの上限制御。
- 1ジョブごとにWorkerを破棄。中断後は再実行可能。出力Blobは素材変更・再実行・離脱で解放する。
- 公式FFmpeg.wasmの低レベルcore APIに合わせた薄い専用Worker。公式JSラッパーの依存追加はせず、lockfileを維持する。coreのAPI互換性はCIで検証する。

## コアの取得と公開条件

web:prepare はnpmレジストリの指定バージョンのtarballをSHA-512で検証し、tar -xOfで対象2ファイルだけ取得する。jsDelivrからの取得バイトと照合しSHA-256マニフェストを生成する。PR #77 のCIで取得・照合したregistryIntegrity / coreJsSha256 / coreWasmSha256は web/core-lock.json に固定済み。以降の取得はこの固定値とも照合する。ただしハッシュの一致はライセンス・安全性・実用性能の審査完了を意味しない。公開前に審査記録を同ファイルに反映する。approved=false のままでは公開ビルドを拒否する。ブラウザはそのマニフェストと取得バイトを照合してから実行する。CSPは接続先を自サイト・jsDelivrに限定する。コア自体の再配布や再配布条件の免除を宣言しない。

## CI・公開設定

Browser preview and Pages workflow はPR/mainでビルド、単体テスト、実Chromeで合成素材PNG/JPEG/GIFを使った短尺生成とFFprobe検証を行う。公開成果物にcore JS/WASMが含まれないことを検査する。公開はレビュー後、mainでworkflow_dispatchのdeploy=trueを選択した場合のみ行う。リポジトリ Settings → Pages → Build and deployment → Source を GitHub Actions に設定する。既存のWindows用CIは維持。公開条件が未達の場合は設定してもデプロイされない。

## 性能評価

PR #77 の [ブラウザCI](https://github.com/naoiw/music-video-maker/actions/runs/46036941886) と [main のブラウザCI](https://github.com/naoiw/music-video-maker/actions/runs/46038560587) は成功。PRの1.5秒/720p試験ではPNG 1.0秒、JPEG 1.1秒、GIF 1.0秒で生成し、FFprobeで検証した（初期取得・初期化時間を除く）。

長尺評価は `pnpm web:prepare`、`pnpm web:build` 後に `pnpm web:benchmark` で再現する（Chrome・ffmpeg・ffprobeがPATHに必要）。CIでも180秒のPNGと295秒のJPEGを1920×1080/30fpsで検証し、合成ステレオMP3とテストパターンのみ使用する。MP3のエンコーダー遅延により300秒上限をわずかに超えることを避けるため295秒にする。中断後の再試行、音声/映像/コンテナの尺、コーデック、寸法、fps、pixel formatを検証し、処理時間・全体時間・ファイルサイズ・Linux上のChromeプロセスRSS概算をActionsのSummaryに表示する。各長尺ケースは最大480秒で打ち切る（安全上の試験上限であり実用性の合格基準ではない）。合成素材での結果は実楽曲やユーザーPCの性能を保証しない。

### PR #78 の基準値（最適化前）

[PR CI](https://github.com/naoiw/music-video-maker/actions/runs/46039342378)・[main CI](https://github.com/naoiw/music-video-maker/actions/runs/46041444868) はいずれも成功。main の Chrome 158.0.8127.36 / Xeon 6975P-C (4 logical) / 15.3 GiB の測定値:

| 素材 | 尺 | エンコード | 全体時間 | 出力 | Chrome RSS概算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| PNG | 180秒 | 321.4秒 | 321.9秒 | 7.8 MiB | 1942 MiB |
| JPEG | 295秒 | 335.9秒 | 336.2秒 | 9.1 MiB | 1411 MiB |

別CPUのPR CIでは400.4秒/455.3秒だった。ランナー間の差があるため単純な比較で高速化率を断定しない。

### 静止画処理の改善案

PNG/JPEGは画像のデコード・スケール・配置・yuv420p変換を一度行い、変換済み1フレームだけをloopフィルタで反復する。30fps、CRF20、H.264/AAC、出力サイズ、-shortest、300秒上限を維持する。GIFはコンテナのループ指定を無限再生に正規化し、GIF demuxerの ignore_loop=0 を使用する。stream_loopではWASMでフレーム表示時間が崩れたため使用しない。LZWデータ・表示時間・透過・disposal等は変更しない。GIF専用ループ方式はネイティブFFmpeg 7.1.5で検証済み。WASMの結果はCIで確認する。短いH.264区間をstream copyで反復する二段方式は、ネイティブFFmpegで-shortestだけでは映像尺が大幅に延びることを確認したため採用しない。音声尺の正確さを優先する。改善後のWASM性能はCIで確認する。

ブラウザ短尺CIはcontain/coverの両方でPNG/JPEGの静止画保持、GIFの初回再生後の色変化・繰り返しを実際の出力フレームから確認する。#79のブラウザ側の一部に対応するが、Windows版のぼかし背景や未実装のブラウザ配置モードは対象外。

## 残件

- 静止画最適化後の長尺CI、PC Chrome/Edgeの実楽曲・1080p実測、長尺GIFループ、ネットワーク非送信の実機確認。
- 第三者ライセンス・コーデック特許・安全性のレビュー、公開承認、実URL確認。
- 既存GUIと機能の段階的統合。実用性や公開条件を満たせない場合は#29を中止する。

公開審査の詳細は [ブラウザ公開条件](browser-publication-review.md) を参照。

参考: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/ffmpeg/src/worker.ts 、https://ffmpegwasm.netlify.app/docs/getting-started/usage/ 、https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
