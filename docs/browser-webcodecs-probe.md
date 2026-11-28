# WebCodecs代替方式の初期検証（#29）

現行のFFmpeg.wasmを置き換えず、ブラウザ標準コーデックでMP4を作れるかを独立評価する。実アプリやPages成果物に組み込まない。npm依存、lockfile、公開承認は変更しない。

## 試験

- 1280×720・30fps・2秒、1920×1080・30fps・30秒。Canvasで赤／青を1秒ごとに切り替え、48kHzステレオ440Hz正弦波を合成する。
- VideoEncoderのavc1.420028（AVC形式、realtime、no-preference）、AudioEncoderのmp4a.40.2（192kbps）の対応を個別に確認する。対応時は実エンコードし、非対応を明記する。
- 検証専用の最小MP4 writer（非fragmented、単一chunk/track、DTSとPTSが同順、最大31秒・64MiB、Bフレームやedit list非対応）でコンテナ化。デコーダ設定の変化、非単調時刻等は拒否する。音声の先頭タイムスタンプは0基準に正規化し、AAC primingの厳密な補正は未実装。
- ネイティブFFprobeで形式・尺・寸法・フレーム数を検査し、FFmpegで赤/青の色サンプル、AAC RMS、全ストリームのデコードを検証する。FFmpegは検証ツールであり、ブラウザ内での生成には使用しない。
- ローカルページ、JSモジュール、favicon以外のリクエストは失敗。CSPでconnect-src 'none'。CDNやコアダウンロードなし。CDPでページ通信を観測する（OS/ブラウザ全体の通信保証ではない）。
- 対応していると報告したコーデックで生成・検証に失敗した場合はCI失敗。片方または双方が未対応の場合はその事実を記録し、完全なH.264/AAC MP4成功とは扱わない。

## 実行

Node.js 26、Chrome/Edge、FFmpeg/FFprobeを用意。環境変数CHROME_BINにブラウザ実行ファイルを設定し、リポジトリルートで node scripts/webcodecs-probe.mjs を実行する。既存のWindows CIでChromeとEdge、ブラウザCIでLinux Chromeを検証し、Actions Summaryに対応状況と実測時間を記録する。合成データ・一時ファイルだけを使用し、成果物をアップロードしない。

## 判断

初回CI未確認。短尺・30秒合成素材は実曲・PNG/JPEG/GIF、5分、CRF・色品質、音声フィルタ同等性、キャンセル、実機ハードウェア支援、YouTube互換性、特許の検証に代わるものではない。本番用muxerの採用も未決定。現行FFmpeg.wasmの公開ゲートは維持。初期結果が良好なら、MP3と静止画を使用する入力経路と本番用MP4 mux方式を次に評価する。

参考: [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)、[Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)、[Mediabunny media sources](https://mediabunny.dev/guide/media-sources)（本番muxer候補・未採用）。
