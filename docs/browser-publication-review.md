# ブラウザ版公開条件（#29）

## 現状

2026-11-28時点。GitHub PagesのSourceはユーザーがGitHub Actionsに設定済み。公開は未実施。web/core-lock.json の approved=false を維持する。

| 項目 | 判定 |
| --- | --- |
| core 0.12.10のnpm tarball整合性・CDN実バイト照合 | CI成功、固定ハッシュ記録済み |
| 公開物へのcore JS/WASM混入防止 | CI成功 |
| 720p短尺・MP4生成 | PNG/JPEG/GIFでCI成功 |
| 長尺1080p・中断再試行 | PR #78 / main CI 成功。静止画最適化後の再測定待ち |
| 実楽曲・ユーザーPC | 未確認 |
| 対応ソース・ライセンスと結合形態 | 未確定 |
| H.264/AACの特許 | 未確定 |
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

## 公開までの判断

1. 長尺ベンチマークとPC上の実楽曲テストの結果を記録。
2. 上流の正確なソースとライセンスを照合し、公開形態の適合性、特許、CDN利用条件、依存コアの脆弱性を確認。必要なら専門家へ確認。ユーザーの明示的な公開判断を記録。
3. 公開物の第三者ライセンス表示・ソースへの案内・ネットワーク動作を確認。条件を満たせない場合は公開せず、WebCodecs等の代替方式を評価するかブラウザ版を中止する。
4. 条件を満たした場合のみ core-lock.json の review と approved を更新し、mainの Browser preview and Pages を deploy=true で手動実行。Pages実URLで確認。

本書は技術上の予備調査であり、法的適合性を保証しない。Windows版のソースのみ公開方針は維持する。

## 一次資料

- [FFmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
- [上流 core package.json](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json)
- [FFmpeg License and Legal Considerations](https://ffmpeg.org/legal.html)
- [jsDelivr 利用条件](https://www.jsdelivr.com/terms/acceptable-use-policy)
- [jsDelivr ドキュメント](https://www.jsdelivr.com/documentation)
