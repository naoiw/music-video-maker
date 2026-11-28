# ブラウザ版の最終判断・公開審査記録（#29）

## 最終判断（2026-11-28）

**開発中止・非公開。** ユーザー方針により、現行FFmpeg.wasmでの公開または中止の二択とした。WebCodecs試作PR #92は未マージでクローズ済み。代替エンジン・Cloudflare Pages・localhost専用版は採用しない。

再調査では [公式core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json) と [リリース一覧](https://github.com/ffmpegwasm/ffmpeg.wasm/releases) で現行0.12.10を超える公式コアを確認できなかった。固定上流コミットのDockerfileにはFFmpeg n5.1.4、GPL有効、x264の可変ブランチ、LAMEのmasterが記載される。公開npmバイナリの全依存ソースの特定と修正の取り込み状況は未立証。FFmpeg Securityに5.1.5〜5.1.7の修正が掲載されているが、個々の脆弱性の本アプリからの到達可能性までは確定していない。例えばCVE-2025-9951はJPEG 2000関連であり、通常のJPEG入力と同一ではない。入力制限やハッシュ検証は有効な対策だが、これらだけで安全性は保証できない。

公式FAQはcoreにFFmpegおよび組み込みライブラリのライセンスが適用されると説明している。Apache-2.0とGPLv3の互換性は認められるが、現行の専用Worker/API呼び出し・外部取得方式についての結合と配布条件、必要な対応ソース・表示、特許の適合性は未確定。外部配布元から直接取得すること自体で適合と判断しない。これは違法性や特定の脆弱性の悪用可能性を確定した判断ではない。

機能・合成素材での性能・観測した通信の検証は成功したが、未解決の審査項目を埋めるには上流コアの保守・対応ソースの特定・法的確認・実機確認が必要となる。現プロジェクトの個人開発コストと利益を比較し、公開ゲートは緩和せず中止する。実PCでの実楽曲試験と公開URL試験は未実施。

- 検証終了時の [固定ソーススナップショット](https://github.com/naoiw/music-video-maker/tree/b73dbd9221abae7c6d9f46f174a12817b1a317e2) に、WASM実装、CI、試験、approved=false / review=null の固定コア設定を保存する。Git履歴も保持する。
- ブラウザ専用コード、テスト、ビルドコマンド、Pagesワークフローを現行開発対象から除外する。Windows側で有用な設定・DOM処理の共通化は維持する。
- #29はnot_plannedとして終了し、次はWindows版の複数素材レイヤー（#30）に進む。mainへの反映は整理PRのレビュー・CI成功後、ユーザー確認を経る。

## 検証時点の状況

以下は中止前の検証記録。GitHub Pagesは公開していない。固定コアは未承認のまま保存されている。

| 項目 | 判定 |
| --- | --- |
| core 0.12.10のnpm tarball整合性・CDN実バイト照合 | CI成功、固定ハッシュ記録済み |
| 公開物へのcore JS/WASM混入防止 | CI成功 |
| 720p短尺・MP4生成 | PR #82 / main CI で全3配置×4素材、1080p/12秒GIFも成功 |
| 長尺1080p・中断再試行 | PR #82 / main CI 成功（180秒PNG contain 92.4秒・blurred 93.6秒、295秒JPEG contain 145.9秒。合成素材） |
| 画像ヘッダー・GIFフレーム寸法のデコード前検査 | PR #87 CI成功 |
| 設定保存・プリセット・試聴 | PR #86 / #87 CI成功 |
| 素材・生成物の外部非送信 | PR #88 CI成功（短尺20・長尺4 Worker、想定外通信0件） |
| 実楽曲・ユーザーPC | 未確認 |
| 対応ソース・ライセンスと結合形態 | 未確定 |
| H.264/AACの特許 | 未確定 |
| 公開審査の機械的ゲート | PR #91 CI成功・未承認を維持 |
| GitHub Pages実URL | 未公開・未確認 |

## ライセンスの確認

- @ffmpeg/core 0.12.10 の上流 package.json は GPL-2.0-or-later と記載。公式FAQもcoreはFFmpegと組み込まれたライブラリのライセンスに従うとしている。本プロジェクトのApache-2.0がそのままcoreに適用されるわけではない。
- 現在は公式ラッパーを依存に追加せず、独自Workerからcore APIを呼び、ユーザーのブラウザがjsDelivrから固定版を直接取得する。Pagesはcore本体をホストしない。外部配布と結合形態に関するGPL上の判断は別問題であり、CDN取得だけで義務がなくなるとは断定しない。Apache-2.0とGPLv2-onlyの互換性、GPLv3選択可能性を含む適用条件は別途確認する。
- 正確な対応ソース（FFmpeg本体、依存ライブラリ、パッチ、ビルドレシピ、版/コミットの対応）、必要な著作権・ライセンス表示、結合形態と配布条件の確認が未完了。現時点の上流mainのリンクだけでは正確な対応ソースの確認にならない。
- H.264/AACの特許は著作権ライセンスとは別。FFmpeg公式Legalページも管轄地域・利用形態によることを説明しており、無償サービスであることのみで免除と判断しない。
- jsDelivrの利用条件・プライバシーポリシーも適用される。素材・生成物は送信しない設計でもCDNへのアクセス時に通常のネットワーク情報が渡る。固定版・ハッシュ照合、CSPは安全性対策の一部であり、既知脆弱性がないことの保証ではない。

## 上流ソース・安全性の追加調査

- [v12.15 の core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/packages/core/package.json) は @ffmpeg/core 0.12.10 / GPL-2.0-or-later と一致する。[同コミットの Dockerfile](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile) は Emscripten 3.1.40、FFmpeg n5.1.4、--enable-gpl、libx264/libx265 等を指定する。[ビルドスクリプト](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build) と src/bind / src/fftools も対応候補。
- ただし x264 の4-cores、LAME のmasterなど可変ブランチ参照があり、公開npmバイナリとすべての依存ソースの厳密な対応は未立証。対応ソースの再現性を保証したとは扱わない。
- [FFmpeg Security](https://ffmpeg.org/security.html) では5.1.5〜5.1.7で複数の脆弱性修正を列挙している。n5.1.4ベースの候補コアについて、修正の取り込み・使用するデコーダへの影響を確認するまで公開承認しない。ハッシュ固定、ブラウザサンドボックス、プロトコル制限だけで安全とは判断しない。新しいメンテナンス済みコアを利用できない場合は、WebCodecs等を検討する。
- [FFmpeg Legal](https://ffmpeg.org/legal.html) はGPL有効時のライセンスと、配布バイナリに対応する正確なソースの重要性を説明している。現在の外部直接取得方式についても公開前に適合性を確認する必要がある。

## 2026-11-28 再調査と判断

- [公式リリース一覧](https://github.com/ffmpegwasm/ffmpeg.wasm/releases) と [main の core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json) を確認。公式コアの新しい版は確認できず、0.12.10のまま。ラッパーの版はコアの更新を意味しない。
- [FFmpeg Security](https://ffmpeg.org/security.html#FFmpeg-5.1) は5.1.5〜5.1.7での修正を列挙する。例: CVE-2024-35366（sbg demuxer）、CVE-2024-36613（DXA demuxer）、CVE-2025-59728（DASH）、CVE-2025-59731/59732/59733（EXR）。現在の強制入力形式・プロトコル制限は対象外形式への到達を抑える対策だが、すべての修正の取り込み、対象コードの組み込み状況、MP3/PNG/JPEG/GIFおよびフィルタ等の到達可能性は未確認。これらの例がアプリで悪用可能と断定せず、個別の影響評価と更新可能性の確認を要求する。
- [ASFのGPL互換性説明](https://www.apache.org/licenses/GPL-compatibility) はApache-2.0とGPLv3の互換性を説明する。[GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) の結合・集合物に関する説明も参照。専用WorkerでコアAPIを呼ぶ構成を単なる独立プログラムと断定できず、正確な対応ソースと配布時の条件は引き続き未解決。ライセンス変更は行わない。
- **判断: 現コアは技術検証を継続可能だが、一般公開は保留。** 固定版やCI成功だけでは公開審査の代替にならない。

### 代替方式の比較

| 方式 | 利点 | 残る課題 |
| --- | --- | --- |
| 現行の公式WASM | 実装・CI資産を活用 | 対応ソース、GPL結合・配布、修正の追跡が未解決 |
| 更新したWASMの独自ビルド | 修正・ビルド元を管理できる可能性 | コア非配布方針と衝突しうる。配布元、ソース、維持コスト、GPL・特許を再評価 |
| WebCodecs + Web Audio + MP4 muxer | ブラウザのコーデックを利用でき、FFmpegコアを不要にできる可能性 | H.264/AACの実機対応、MP4 mux、GIF時刻・ぼかし・7フィルタの同等性、特許、第三者ライセンスを検証 |

[MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) と [Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection) を参照。WebCodecsだけではMP4コンテナの生成を完結できない。候補の [Mediabunny](https://mediabunny.dev/) はMPL-2.0を掲げるが採用は未決定で、ライセンス・依存関係は採用時に審査する。次の技術評価ではまずWindows Chrome/EdgeのH.264/AACサポート、最小MP4生成、実測を確認し、現機能を維持できる見込みを判断する。

## 構造化公開ゲート

従来のtruthyなreview確認を廃止。scripts/web-publication-gate.mjsは試験時もコア版・SHA-512/SHA-256の形式と固定値を必須とする。公開時はapprovedが厳密にtrueであり、reviewのschemaVersion=1、reviewer、reviewedOn（YYYY-MM-DD）、decisionReference（明示的な承認記録）、core（lockのversion/registryIntegrity/coreJsSha256/coreWasmSha256の完全一致）、itemsを要求する。itemsの必須キーは以下の通り。それぞれ status=accepted、具体的な証跡を示す非空の evidence を必要とする。

| キー | 審査対象 |
| --- | --- |
| correspondingSource | 正確な対応ソースと依存ビルド |
| licenseAndDistribution | 結合・配布条件とライセンス |
| codecPatents | H.264/AACの特許条件 |
| security | 既知脆弱性の修正・影響評価と更新方針 |
| cdnAndPrivacy | CDN利用条件・プライバシー |
| thirdPartyNotices | 完全な第三者表示・ソース提供条件 |
| browserValidation | 実楽曲・対象PC・実用性能・ネットワーク検証 |

準備前と公開成果物アップロード前の両方で検査する。後者はビルド済みmanifestと承認済みlockの一致および第三者表示ファイルの存在を検証する。空のreviewや文字列、未解決項目、ハッシュ変更、成果物差し替えを拒否する。暫定の第三者表示ページは追加するが、表示の完全性を証明するものではない。機械的な検査は証跡の真実性や法的妥当性を判断できない。全項目を実際に審査して記録するまで approved=false / review=null を維持する。試験用の正例は実際の承認ではない。

## 入力検証の追加対策

従来はプレビュー生成時に未検証の画像をブラウザへ渡し、生成時にデコード後の寸法で4000万画素上限を検査していた。PNGのIHDR、JPEGのSOF（APP等の長さ付きセグメントを走査）、GIFの論理画面と各画像記述子を事前に検証する。32MiBのファイル上限と4000万画素上限は維持する。GIFの画面外フレーム、寸法0、切り詰め、不正シグネチャは拒否する。画像種類は実バイトから判定し、プレビュー用BlobにそのMIMEを指定する。デコード後にも寸法を照合（JPEGのEXIF回転による幅高さ交換は許容）。素材変更中は生成不可とし、非同期結果が古い選択を復元しないようにする。ページ離脱時はURLと処理を解放し、bfcache復帰時は選択素材から再検証する。

これはデコード前の資源制限・入力検証強化であり、悪意ある圧縮データやデコーダの既知・未知の脆弱性を完全に排除するものではない。公開承認は変更しない。単体テストと実Chromeの不正画像拒否・正常画像への復帰を追加。初回CI 46065900078 では画像拒否・正常画像復帰・試聴が成功したが、その後の最初の動画生成がタイムアウトした。ローカルChromiumで同じパスをCDPから再選択するとchangeイベントなしにFileオブジェクトが置き換わることを再現。各生成ケースで選択を明示的に解除してから再選択し、解除時の生成無効化と開始直後の状態を検証する。実際のファイル選択のcancel時や未検証Fileでの生成操作時も再検証する。[PR #87 CI](https://github.com/naoiw/music-video-maker/actions/runs/46067220408) で #86 との統合後も成功。

## 通信監査

Chrome DevTools Protocolでページと専用Workerを監査する。Workerは自動アタッチ時に一時停止し、Network.enable後に実行を再開する。監査は初回ナビゲーション前から素材選択・試聴・設定保存・生成・Blob取得・中断/再実行まで継続する。web:smokeとweb:benchmarkの双方で、公開成果物の実ファイル、ブラウザのfavicon、固定版core JS/WASMの完全一致URLへの本文なしGETのみ許可する。Blob/dataはローカル読み取りとして別集計。未知URL、本文付きリクエスト、GET以外、リダイレクト、WebSocket/WebTransport等を検出した場合はCIを失敗させる。マニフェストと同じWorker内で両core取得を観測できない場合も失敗とする。合成素材のみで試験し、Summaryに件数を記録する（URLのクエリ、本文、ファイル名、素材は記録しない）。referrer policyはno-referrerとする。既存のcore取得ハッシュ・CSP・公開承認条件を維持する。

対象は観測されたアプリページ・専用Workerの通信であり、ブラウザ/OS全体のパケットキャプチャや任意のサイドチャネルの排除ではない。CDN・ホスティングには通常の接続情報が渡る。[PR #88 CI](https://github.com/naoiw/music-video-maker/actions/runs/46068161850) で短尺: サイトGET49、core GET40、manifest GET21、ローカル読み取り200、20 Workerすべて両core取得、想定外0。長尺: サイトGET8、core GET8、manifest GET4、ローカル読み取り88、4 Workerすべて両core取得、想定外0。公開URL・実楽曲は未確認。単体テストで正例、未知URL、本文、リダイレクト、別通信チャネル、監査証拠欠落を検証する。

## 中止時の取り扱い

構造化公開ゲートは中止前のスナップショットに未承認状態で保存する。以降、公開審査の追加実施やデプロイは行わない。上記の技術的調査は法的助言ではなく、法的適合性を保証しない。Windows版のソースのみ公開方針は維持する。

## 一次資料

- [FFmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
- [上流 core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json)
- [FFmpeg License and Legal Considerations](https://ffmpeg.org/legal.html)
- [jsDelivr 利用条件](https://www.jsdelivr.com/terms/acceptable-use-policy)
- [jsDelivr ドキュメント](https://www.jsdelivr.com/documentation)
