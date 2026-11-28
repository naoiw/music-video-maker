# GitHub Pages ブラウザ版（#29・技術検証）

対象 URL: https://naoiw.github.io/music-video-maker/ （未公開）。

Windows 版の Tauri GUI は変更しない。まず独立したブラウザ検証画面を実装し、既存のスタイルを再利用する。単一スレッド core 0.12.10 を専用 Worker で動かし、ユーザー選択の MP3 と PNG/JPEG/GIF から 720p/1080p/正方形/縦長・24/30/60fps H.264/AAC MP4 を生成する。中央80%・ぼかし背景（既定）、全体表示・切り抜きに対応する。音声フィルタと原音・加工音の試聴を統合する。プリセット・設定永続化もブラウザに実装する。共通GUI・設定定義の段階的統合を進める。

## ローカル検証

    pnpm install --frozen-lockfile
    pnpm web:prepare
    pnpm web:build
    pnpm web:preview

http://127.0.0.1:4173/music-video-maker/ を開く。公開成果物と同じCSP・パスで確認する。開発用 pnpm web:dev（port 1421）はCSPによりスタイル注入等が制約されるため、動作確認には静的プレビューを使用する。Node 26、固定 pnpm、tar が必要。Windowsのバッチは従来通り。

- 初回は処理エンジンの取得が必要（約32 MB）。素材は送信しない。
- MP3 50 MiB、画像32 MiB・4000万画素、音声5分を試作上限とする。デスクトップ版の上限は変更しない。720pをブラウザ独自の初期値とする。1080p横長・正方形・縦長、24/30/60fps、CRF16/20/24はWindows版と同じ選択肢。既定は30fps/CRF20/blurred。エンコードはultrafast、映像6 Mbpsの上限制御を維持するためWindows版とビット単位の画質一致は保証しない。
- 1ジョブごとにWorkerを破棄。中断後は再実行可能。出力Blobは素材変更・再実行・離脱で解放する。
- 公式FFmpeg.wasmの低レベルcore APIに合わせた薄い専用Worker。公式JSラッパーの依存追加はせず、lockfileを維持する。coreのAPI互換性はCIで検証する。

## コアの取得と公開条件

web:prepare はnpmレジストリの指定バージョンのtarballをSHA-512で検証し、tar -xOfで対象2ファイルだけ取得する。jsDelivrからの取得バイトと照合しSHA-256マニフェストを生成する。PR #77 のCIで取得・照合したregistryIntegrity / coreJsSha256 / coreWasmSha256は web/core-lock.json に固定済み。以降の取得はこの固定値とも照合する。ただしハッシュの一致はライセンス・安全性・実用性能の審査完了を意味しない。公開前に審査記録を同ファイルに反映する。approved=false のままでは公開ビルドを拒否する。ブラウザはそのマニフェストと取得バイトを照合してから実行する。CSPは接続先を自サイト・jsDelivrに限定する。コア自体の再配布や再配布条件の免除を宣言しない。

## CI・公開設定

Browser preview and Pages workflow はmain/develop向けPRとmain/developへのpushでビルド、単体テスト、実Chromeで合成素材PNG/JPEG/GIFを使った短尺生成とFFprobe検証を行う。公開成果物にcore JS/WASMが含まれないことを検査する。公開はレビュー後、mainでworkflow_dispatchのdeploy=trueを選択した場合のみ行う。リポジトリ Settings → Pages → Build and deployment → Source を GitHub Actions に設定する。既存のWindows用CIは維持。公開条件が未達の場合は設定してもデプロイされない。

## 性能評価

PR #77 の [ブラウザCI](https://github.com/naoiw/music-video-maker/actions/runs/46036941886) と [main のブラウザCI](https://github.com/naoiw/music-video-maker/actions/runs/46038560587) は成功。PRの1.5秒/720p試験ではPNG 1.0秒、JPEG 1.1秒、GIF 1.0秒で生成し、FFprobeで検証した（初期取得・初期化時間を除く）。

長尺評価は `pnpm web:prepare`、`pnpm web:build` 後に `pnpm web:benchmark` で再現する（Chrome・ffmpeg・ffprobeがPATHに必要）。CIでも180秒のPNGと295秒のJPEGを1920×1080/30fpsの全体表示で検証し、180秒のPNGのぼかし背景も追加検証する。合成ステレオMP3とテストパターンのみ使用する。MP3のエンコーダー遅延により300秒上限をわずかに超えることを避けるため295秒にする。中断後の再試行、音声/映像/コンテナの尺、コーデック、寸法、fps、pixel formatを検証し、処理時間・全体時間・ファイルサイズ・Linux上のChromeプロセスRSS概算をActionsのSummaryに表示する。各長尺ケースは最大480秒で打ち切る（安全上の試験上限であり実用性の合格基準ではない）。合成素材での結果は実楽曲やユーザーPCの性能を保証しない。

### PR #78 の基準値（最適化前）

[PR CI](https://github.com/naoiw/music-video-maker/actions/runs/46039342378)・[main CI](https://github.com/naoiw/music-video-maker/actions/runs/46041444868) はいずれも成功。main の Chrome 158.0.8127.36 / Xeon 6975P-C (4 logical) / 15.3 GiB の測定値:

| 素材 | 尺 | エンコード | 全体時間 | 出力 | Chrome RSS概算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| PNG | 180秒 | 321.4秒 | 321.9秒 | 7.8 MiB | 1942 MiB |
| JPEG | 295秒 | 335.9秒 | 336.2秒 | 9.1 MiB | 1411 MiB |

別CPUのPR CIでは400.4秒/455.3秒だった。ランナー間の差があるため単純な比較で高速化率を断定しない。

### 静止画処理の改善案

PNG/JPEGは画像のデコード・スケール・配置・yuv420p変換を一度行い、変換済み1フレームだけをloopフィルタで反復する。30fps、CRF20、H.264/AAC、出力サイズ、-shortest、300秒上限を維持する。GIFはコンテナのループ指定を無限再生に正規化し、GIF demuxerの ignore_loop=0 を使用する。stream_loopではWASMでフレーム表示時間が崩れたため使用しない。LZWデータ・表示時間・透過・disposal等は変更しない。GIF専用ループに変更後もWASMでは0.8秒以降にフレーム単位の遅れが生じた（CI 46046668690）。GIFのGraphic Control Extensionから各フレームの表示時間（1/100秒）を読み、settb/setptsでフレーム番号に対応する累積時間を明示してから30fpsに変換する。2/100秒未満・未指定の遅延はFFmpeg既定の10/100秒を採用する。可変間隔GIFは式の複雑さを制限するため最大4096フレーム（等間隔は対象外）。ネイティブFFmpeg 7.1.5で等間隔・可変間隔2/3フレーム素材を複数周期検証済み。WASM側の結果はCIで確認する。短いH.264区間をstream copyで反復する二段方式は、ネイティブFFmpegで-shortestだけでは映像尺が大幅に延びることを確認したため採用しない。音声尺の正確さを優先する。改善後のWASM性能はCIで確認する。

PR #80時点のブラウザ短尺CIはcontain/coverの両方でPNG/JPEGの静止画保持、GIFの等間隔（200/200ms）と可変間隔（100/300ms・有限ループ指定）の両方を全フレーム検証し、初回以降も正確な周期で再生することを確認する。この時点では#79のブラウザ側の一部に対応していた。Windows版の全配置はPR #81で実装・main CI成功済み。

### PR #80 の最適化後

[main CI](https://github.com/naoiw/music-video-maker/actions/runs/46048982725) は成功。Chrome 158.0.8127.36 / Xeon Platinum 8573C (4 logical) / 15.6 GiB。

| 素材 | 尺 | エンコード | 全体時間 | 出力 | Chrome RSS概算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| PNG | 180秒 | 91.5秒 | 92.3秒 | 7.8 MiB | 1950 MiB |
| JPEG | 295秒 | 140.1秒 | 140.7秒 | 9.1 MiB | 1421 MiB |

PR #78 のmainとCPUが異なるため厳密な同条件比較ではないが、処理時間は大幅に短縮。等間隔・可変間隔GIFのcontain/cover全フレーム検証、中断と再試行も成功。

## ぼかし背景（#79）

Windows版と同じ中央80%（高さ80%以内・幅全体以内）、背景の中央クロップ、短辺2%相当のガウスぼかし、透過の黒合成を採用。PNG/JPEGは合成を一度行ってから変換済みフレームを反復し、GIFは補正済みの時刻で前景・背景を合成して30fpsに変換する。背景は1/4解像度でぼかす。プレビューはCSS近似（元GIFのループ指定に従い、出力と完全な画素・同期一致は保証しない）。

ブラウザ短尺CIを3配置×4素材（PNG/JPEG、等間隔GIF、可変間隔・有限ループGIF）の12ケースへ拡張。前景とぼかし背景を出力フレームから検査する。さらに1080p/12秒の可変間隔GIFで全フレーム検証を行う。180秒PNGのぼかし背景ベンチマークも追加。ネイティブFFmpeg 7.1.5でPNG/JPEG/GIFの720p・1.5秒の前景/背景の全45フレームの色を確認。[main CI](https://github.com/naoiw/music-video-maker/actions/runs/46055461834) は13ケース・長尺3件・中断再試行すべて成功。1080p/12秒GIFは9.2秒で生成、180秒PNGのcontainは92.4秒、blurredは93.6秒（Chrome 157、AMD EPYC 9V74、4 logical/15.6 GiB）。Windows main CIも成功。#79は完了。実機GUI確認・実楽曲・数分のGIF性能は#29の残件とする。

## GUI・出力設定の統合

素材・出力設定を左、プレビュー・動画出力を右へ配置し、Windows版の構成と揃える。既存の共通CSSおよび src/services/settings-schema.ts の解像度・FPS・配置・品質定義を再利用し、ブラウザ独自の720pだけを加える。起動時にHTMLの選択肢と設定定義の一致を検証する。設定初期化、正方形・縦長のプレビュー、出力設定に応じたFPS/CRF指定を追加。ブラウザ設定は後述のlocalStorageに永続化する。ファイル選択とMP4ダウンロードはブラウザ固有のまま。Windows版の動作と依存関係は変更しない。

全出力設定の引数単体テストを追加し、Chrome CIに1080×1080・24fps・CRF24のPNGと1080×1920・60fps・CRF16の可変間隔GIFを追加する。設定初期化、プレビュー比率、FFprobeとGIFの全フレーム検証を行う。初回CIでは既存13ケースと正方形24fpsが成功し、縦長60fpsのGIFで青の色判定が失敗（時刻は正常）。ぼかし合成の2枝の色変換をBT.709・limited range・yuv420pに明示し、出力メタデータも設定する。色検査は16×16画素を直接RGBデコードし、全画素に従来の閾値を適用する。再実行CI 46057571164 でも縦長60fpsの背景上端だけで青の赤成分が66〜91となった（前景とタイミングは成功）。ネイティブFFmpeg 7.1.5で同じ失敗を再現し、エンコード前の入力GIFを全画素デコードすると青フレーム上端に最大108の赤成分が含まれていた。既定のRGB8パレット変換・ディザリングによる素材自体の問題で、中央画素のみの検査では見逃していた。palettegen/paletteuse（dither=none）で正確な赤・青のパレットを生成し、2フレーム6144画素のRGB値が元のrawvideoと完全一致することを検証する。出力側の閾値・全フレーム検査は維持し、背景下端も検査する。ネイティブFFmpeg 7.1.5で修正後の可変間隔GIFを4解像度（横長2種・正方形30fps、縦長60fps）で生成し、前景・背景上端・下端の全画素パッチが全フレームで一致することを確認。WASM側の修正結果と長尺性能はCIで確認する。

## 音声フィルタ（#29）

既存Windows版の7種類の設定、共有スキーマ、処理順序をブラウザに追加。全無効なら従来のMP4生成経路を使用する。有効時はWASMのFFprobeで元MP3を検査し、実サンプルレートで型付き設定を検証してから固定フィルタ式へ変換する。加工音は32bit浮動小数点PCM WAVへ一時変換し、実測尺を-tに渡す（-shortestに依存しない）。サンプルレート・チャンネル・元音声と加工音の尺差0.2秒以下、最終MP4の尺差0.2秒以下を検証。中間WAVは最大約115.2MB（48kHzステレオ5分）を追加使用し、Worker終了時に解放する。ゲイン・正規化の有効化時はリミッターも有効にする。生成中は設定変更不可。ノイズ除去や正規化の効果は実素材に依存する。

ネイティブFFmpeg 7.1.5で7種類併用・6秒MP3の加工WAV・MP4映像・音声の尺6.000秒、最終AACの統合ラウドネス-14.0 LUFSを確認。初回CI 46061091099 では既存15ケースが成功したが、FFprobeの戻り値が-1となり加工前に停止。上流 v12.15 の bind.js は Module.ret を返す一方、ffprobe.c の正常終了は exit_program を経由せず C の戻り値を返す。固定coreのエクスポート済み _ffprobe と stringsToPtr を用い、Cの終了値を直接検証する。非ゼロ・例外は失敗とし、JSON・音声情報・出力尺の検証は維持する。[PR #84 CI](https://github.com/naoiw/music-video-maker/actions/runs/46062388697) で修正結果と複数コマンド実行を確認。-6.00dB、7種類併用のネイティブ参照とのRMS差-0.00dB、既存15ケースと長尺3件成功。実Chromeで-6dBゲインのPCM RMS、7種類併用のネイティブ参照との差・尺を検査する。設定の永続化、プリセットは後述。ブラウザ版の公開承認は変更しない。

## 原音・加工音の試聴（#29）

画像を選択せずにMP3だけで任意の開始位置（1秒刻み）から最大30秒の試聴が可能。Windows版と同じ16bit PCM WAV、元のサンプルレート・チャンネル数、出力側seekと共通フィルタ式を使用する。WASM FFprobeで元音声と試聴WAVの形式・尺を検証し、最大6MiBに制限する。原音・加工音のBlob URLを各1件キャッシュし、切替時に再生位置を引き継ぐ。素材・区間・フィルタ変更、中断、動画生成開始、ページ離脱でWorker停止・URL解放。動画生成中は試聴操作不可。ブラウザの自動再生制限時はプレイヤーの再生ボタンで操作する。AAC出力や全曲のラウドネスとの完全一致は保証しない。

Chrome CIに35秒合成MP3で2秒から30秒、34秒から1秒、-6dB加工音のRMS、切替位置、キャッシュ、設定変更と中断の検証を追加。[PR #85 CI](https://github.com/naoiw/music-video-maker/actions/runs/46063467027) で全試聴検証、既存の動画生成・長尺3件成功。実楽曲試聴は未確認。

## 設定保存・フィルタプリセット（#29）

出力設定と全フィルタ設定を変更時にlocalStorageへ保存し、ページ再読み込み時に復元する。無効化中のフィルタの数値も保持する。ブラウザ独自の720pを許可し、その他はWindows版の設定スキーマを再利用。プリセットは共通の名前・件数・設定検証（1～40文字、最大50件、大文字小文字を区別しない重複禁止）を使い、保存・適用・個別削除・2段階の全削除に対応する。フィルタのみ適用し、出力設定は変えない。適用時は保存済みリミッターの有効/無効を維持し、試聴と出力を無効化する。設定の初期化とプリセット一覧の削除は独立。

保存キーはmusic-video-maker:web:settings:v1とmusic-video-maker:web:presets:v1。GitHub Pagesの同一origin内で他プロジェクトとキーが衝突しないよう名前空間を設ける。MP3・画像・動画・ファイルパスは保存しない。保存は同一origin・同一ブラウザプロファイル内のみ（別端末への同期なし、サイトデータの削除で消失）。保存不可時も生成・試聴は使用可能。破損設定は既定値で起動し、不正な編集は最後の有効設定を上書きしない。破損プリセットは自動上書きせず、明示的な2段階全削除で復旧する。複数タブの同時編集は同期せず、最後に保存したタブの内容が残る。

単体テストで版・範囲・名前空間・保存失敗を検査し、Chrome CIでリロード復元、無効フィルタ値、プリセット保存・適用・削除・破損からの復旧を検証する。[PR #86 develop CI](https://github.com/naoiw/music-video-maker/actions/runs/46066848218) と [PR #87統合CI](https://github.com/naoiw/music-video-maker/actions/runs/46067220408) で成功。公開はdevelopでは行わず、準備完了後のdevelop→main統合とレビュー済み手動デプロイに限定する。

## 通信監査（#29）

Chrome CIの短尺・長尺テストにページと専用Workerの通信監査を追加する。公開成果物と固定core以外へのネットワーク要求、本文付き要求、GET以外、リダイレクト等を拒否判定し、マニフェストと両core取得の観測を必須とする。件数はActions Summaryへ記録。素材・試聴WAV・生成MP4のBlob取得はローカル読み取りとして集計する。通常のCDN接続情報は外部に渡る。アプリの観測範囲を超える通信やサイドチャネルを完全に排除する検証ではない。詳しくは公開条件の通信監査を参照。[PR #88 CI](https://github.com/naoiw/music-video-maker/actions/runs/46068161850) で短尺20 Worker・長尺4 Workerを監査し、両方とも想定外通信0件。

## Workerセッションの共通化（#29）

試聴と動画生成のマニフェスト取得、Worker生成、型付き要求・応答、実サンプルレートに基づくフィルタ式生成、エラー通知、終了・キャンセルを engine-client / engine-session に共通化。1セッション1ジョブとし、終了時にイベントハンドラを解除しWorkerを破棄する。取得中のキャンセルはAbortControllerで中断し、破棄後の応答は無視する。素材読み込み中は従来通り世代番号で古い結果を破棄する（File.arrayBuffer自体は中断しない）。不正な応答、結果種類違い、空データ、無効な進捗・時間を拒否する。既存の上限、FFmpeg引数、フィルタ式、ハッシュ検証、公開条件は維持。単体テストで中断、転送、フィルタ要求、異常応答、リソース解放を検証し、実Chromeでは既存の全テストを再実行する。[PR #89 CI](https://github.com/naoiw/music-video-maker/actions/runs/46069262868) で短尺・長尺・通信監査を含め成功。

## 共通設定・UIの整理（#29）

settings-schema.ts をデスクトップ／ブラウザの明示的な設定プロファイルに対応させ、出力選択肢・既定値・検証・JSONの版管理を共通化。デスクトップの1080p既定とブラウザの720p既定・720p対応の差は維持する。settings-controls.ts で型に応じたDOM設定の取得・適用を共通化し、既存のフィルタ初期値も共有スキーマから参照する。ストレージのキー・JSON形式・IPC・フィルタ式・UI配置・エンコード仕様は維持。無効フィルタ値の保存と有効フィルタのみの実行、復元時にリミッターを自動変更しない挙動も維持する。Rust側の独立検証は削除しない。新規テストで全出力組み合わせ、プロファイル間の保存互換性と不正値拒否、DOM読み書き・イベント非発生を検証する。[PR #90 CI](https://github.com/naoiw/music-video-maker/actions/runs/46070398308) で成功。

## 公開審査の強化（#29）

固定版コアの対応ソース・ライセンス・脆弱性が未解決のため公開を保留する。構造化審査記録と固定コアの完全一致を公開前および成果物アップロード前に検証する。第三者ライセンス・ソース情報の暫定ページを追加した。詳しくは公開条件を参照。WebCodecs等の代替を技術評価する余地はあるが、現実装の置き換え・ライセンス変更・公開承認は未実施。[PR #91 CI](https://github.com/naoiw/music-video-maker/actions/runs/46107070988) で成功。

## WebCodecs代替方式の初期検証（#29）

既存アプリから完全に分離した scripts/webcodecs-probe.mjs を追加。localhostの検証専用ページでH.264 Baseline / AAC-LCのisConfigSupportedを個別に調査し、720p/30fps/2秒と1080p/30fps/30秒の合成Canvas映像・48kHzステレオ正弦波を実エンコードする。依存追加を避けるため検証範囲に限定した小型MP4 writerを使用し、FFprobeでトラック・尺・フレーム数、FFmpegで色・RMS・全ストリームデコードを確認する。片方非対応時は対応トラックのみ検証し、完全なH.264/AAC成功とは表示しない。Windows Chrome/EdgeとLinux ChromeのCIで計測する。公開成果物への混入なし、CDN取得なし。実MP3・画像・GIF・7フィルタ・CRF相当品質・長尺実用性能・特許・本番muxerは未検証。今回のCIは未確認。詳しくは [WebCodecs検証](browser-webcodecs-probe.md) を参照。

## 残件

- WebCodecs代替方式の初期CI結果、PC Chrome/Edgeの実楽曲・1080p実測、数分のGIFループ、ネットワーク非送信の実機確認。
- 第三者ライセンス・コーデック特許・安全性のレビュー、公開承認、実URL確認。
- 既存GUIと機能の段階的統合。実用性や公開条件を満たせない場合は#29を中止する。

公開審査の詳細は [ブラウザ公開条件](browser-publication-review.md) を参照。

参考: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/ffmpeg/src/worker.ts 、https://ffmpegwasm.netlify.app/docs/getting-started/usage/ 、https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
