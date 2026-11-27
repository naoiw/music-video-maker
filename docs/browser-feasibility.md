# ブラウザ版の技術検証（#28）

調査日: 2026-11-28。対象は MVP v0.1.0（main の c5958e51277e7c0bf4dfd84330c084d1e638436b）。ここでの結論は公開資料と現行コードに基づく設計評価であり、ブラウザでの実測・デプロイ成功を意味しない。

## 結論

- 静的ホスティングで UI とブラウザ内動画生成を提供することは技術的に可能。ただし現在の Tauri IPC をそのまま利用することはできない。
- GitHub Pages は単一スレッド版を候補にする。標準の Pages で任意の COOP / COEP レスポンスヘッダーを設定する公式機能は確認できず、マルチスレッドを前提としない。
- Cloudflare Pages は _headers によるオリジン間分離を構成できる。ただし配信アセットの1ファイル25 MiB制限があり、標準 FFmpeg.wasm core 0.12.10 の wasm（32.2 MB）はそのまま配信できない。
- 現在の「ソースのみ公開し FFmpeg バイナリを再配布しない」方針を維持する。WASM もコンパイル済みバイナリであり、Pages に配置する行為は別の再配布になる。#29 のローカル試作と公開判断を分け、ライセンス・ソース提供・コーデック特許の確認と明示的な公開方針の決定なしに公開しない。
- 当面の推奨はデスクトップ版を主系統に保ち、#29 はユーザーが依存を取得して localhost で動かす試作から始める。静的ホストの公開は別途判断する。

## 1. ホスティング比較

| 観点 | GitHub Pages | Cloudflare Pages |
| --- | --- | --- |
| Vite 静的サイト | 可。プロジェクト Pages のパスに合わせて base を設定 | 可。通常はルート配下 |
| ネイティブ Tauri IPC | 不可 | 不可 |
| WebAssembly 単一スレッド | 条件付き可 | 条件付き可 |
| WebAssembly マルチスレッド | 標準構成では非推奨（任意ヘッダー設定未確認） | _headers とリソース側の CORS/CORP が適合すれば可 |
| アセット | 公開サイト全体 1 GB 上限 | 個別ファイル 25 MiB 上限 |
| 標準 core 0.12.10 の直接配置 | 容量面では候補 | wasm 約32.2 MBのため不可 |
| 配布条件 | 対応ソース・告知等の確認が前提 | 同左 |

Cloudflare で公開する場合、必要なコーデックに絞った core の再ビルド・サイズ実測、またはサイズ上限に適合する別の配信基盤を検討する。単に CDN に移すだけでライセンス義務や供給網のリスクが解消されるとは扱わない。ランタイムは外部へ素材を送信しない。外部 CDN に依存する自動取得やサービスワーカーによる擬似ヘッダー設定は初期案には採用しない。

Cloudflare の将来のマルチスレッド試験用ヘッダー例（現時点ではファイルを配置しない）:

    /*
      Cross-Origin-Opener-Policy: same-origin
      Cross-Origin-Embedder-Policy: require-corp

HTTPS と実際のレスポンスヘッダー、crossOriginIsolated、SharedArrayBuffer の利用可否を確認する。同一オリジンに worker/core を配置する場合も、MIME（application/wasm）と CSP の許可範囲を確認する。GitHub Pages ではサブパスで worker/asset の URL が壊れないようにする。外部埋め込みや別オリジン素材の制約も考慮する。

## 2. 現行コードとの差分

| 現行 | ブラウザ側で必要な対応 |
| --- | --- |
| src/services/runtime.ts: isTauri 判定 | ブラウザで core の利用可否・状態を検出 |
| audio.ts / visual.ts: OSパス、Tauri dialog、IPC | File input、File/Blob、ドロップ、メタデータ取得 |
| visual.ts: Rustの合成PNG | Canvas等で先頭フレームの背景ぼかし・配置を再現し、出力と同一仕様にする |
| video.ts: OS保存パス、IPC | worker のジョブ、出力 Blob、明示的なダウンロード |
| audio-preview.ts: RustのWAV生成 | 同じフィルタ設定からブラウザ内で最大30秒のWAVを生成 |
| source-drop.ts: パス文字列 | ファイル名による分類と File 参照を分離し、選択の原子性を維持 |
| settings.ts: RustのJSON保存 | localStorage等のアダプター、既存スキーマ・制限を維持 |

UIにOSパスを疑似的に埋め込まず、デスクトップ用とブラウザ用で入力参照の型を区別する。Tauri の実装・挙動を維持したままバックエンド境界を設ける。ブラウザからローカル FFmpeg を直接起動することはできない。サーバーに素材を送る方式は対象外。

## 3. メモリ、速度、ファイル制限

FFmpeg.wasm の公式 FAQ は入力上限を2 GBと説明しているが、そのサイズを実用保証しない。File/ArrayBuffer、仮想FS、デコードされたフレーム、出力データの重複で消費メモリが増える。1920×1080 RGBA 1フレームだけでも約7.9 MiBであり、全曲の生フレームを保持しない設計が必要。初期試作では MP3 50 MiB、画像 32 MiB・4000万画素（現行上限を超えない）、30秒/720pまたは短尺1080p を検証用上限の候補とし、結果に応じて決める。これは現行デスクトップ仕様を変更するものではない。

公式 Performance ページの WebM→MP4 ベンチマーク（FFmpeg n5.1.2、core v0.12.3）はネイティブ平均5.2秒、単一スレッド128.8秒、マルチスレッド60.4秒。条件が異なるため本アプリの処理時間に外挿しない。実測は #29 で行い、CPU・メモリ・ブラウザ版・解像度・尺・coreバージョンを記録する。

worker に処理を隔離し、進捗の表示とキャンセル（terminate 後に再初期化）、失敗時の仮想ファイル削除、Blob URL の revoke、入力上限の事前検査を実装候補とする。出力は MP4 の H.264/AAC/yuv420p/faststart を維持し、仮想FSから取得したファイルを独立した FFprobe で検証する。コアの実際のエンコーダー・フィルタ一覧を取得するまでは対応を保証しない。

## 4. ライセンスと公開判断

@ffmpeg/ffmpeg の JS ラッパーは MIT、core は FFmpeg と組み込まれたライブラリのライセンスに従う。標準 core は GPL-2.0-or-later 表記であり libx264 を含む構成を想定する。公開する場合は正確なバージョン、ビルド設定、対応ソース・依存ソース・パッチ・ビルドスクリプト、著作権・ライセンス表示、アプリとの結合形態、H.264/AAC 特許を別途確認する。ネイティブ exe の別プロセス起動と同じ法的評価を WASM に無条件に適用しない。

ローカル試作でユーザーがパッケージを直接取得する方式は、リポジトリに WASM をコミット・公開する方式と区別する。公開済みサイトや配布用 ZIP を作らず、CI のアーティファクトにも含めない。WebCodecs 等のブラウザ標準 API を利用する選択肢もあるが、H.264/AAC 対応、MP4 mux、既存 FFmpeg フィルタの再現には別途調査が必要で、現時点では置き換えを決定しない。

## 5. #29 の検証計画

1. ローカル Vite のブラウザ試作で単一スレッド core を読み込む。必要依存の正確な版を選定し、lockfile 更新は明示して管理する。
2. 自作の短いMP3・PNG/JPEG/GIFから H.264/AAC MP4 を生成し、FFprobe で尺・解像度・pixel format を独立検証する。素材を外部送信していないことを Network タブで確認する。
3. worker の中断・再試行・容量制限と、破損素材のエラー処理を試験。Chromium 系（Chrome / Edge）を初期候補とし、Firefox/Safari/モバイルは個別検証。
4. 既存 GUI への段階的統合、試聴、設定・プリセット、画像配置と音声フィルタを検証。Windows版CIと従来の出力条件を維持する。
5. 公開方針の承認・ライセンス確認後に限り、GitHub Pages の単一スレッド構成と Cloudflare Pages のサイズ・ヘッダーを実機検証する。ブラウザでの動作は未確認のため、公開サイトの稼働を完了条件とはしない。

## 参考資料（2026-11-28 閲覧）

- [ffmpeg.wasm Overview](https://ffmpegwasm.netlify.app/docs/overview/)
- [ffmpeg.wasm Usage](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)
- [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
- [ffmpeg.wasm Performance](https://ffmpegwasm.netlify.app/docs/performance/)
- [core 0.12.10 ファイルサイズ（UNPKG）](https://app.unpkg.com/@ffmpeg/core@0.12.10/files/dist/esm)
- [core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Community: COOP / COEP on Pages](https://github.com/orgs/community/discussions/13309)（機能要望・公式仕様ではない）
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [MDN crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)
- [FFmpeg legal](https://ffmpeg.org/legal.html)
