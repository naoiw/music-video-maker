# 開発フロー

## ブランチ

- main: 段階ごとに確認済みの安定版。初期構築・仕様・開発基盤は直接反映可。
- develop: Windows版の機能統合・動作確認用。
- feat/*, fix/*, docs/*, chore/*: develop を起点とする個別 Issue の作業ブランチ。

## 手順

1. 原則として若い Issue から着手する。ただしユーザー指定の優先Issueを先に対応する。
2. 初期構築後は develop から作業ブランチを作成する。
3. PR を develop に作成し、差分と CI を確認してマージする。完了する Issue は PR 本文に Closes #番号 を単独行で記載する（複数の場合は1行ずつ）。
4. develop の動作を確認し、段階ごとに develop → main の PR を作成する。
5. develop へのマージ時に専用 Actions が対応 Issue を自動クローズする。部分実装は Refs #番号 とする。main への段階的マージは引き続きユーザー確認後に行う。
6. main の変更を develop に取り込み、次の段階へ進む。

## 段階

- #1–#5: 開発基盤
- #6–#12: 基本的な動画生成
- #13–#18: 音声加工
- #19–#23: 操作性・品質
- #64: 画像配置の既定値改善（#24〜#40より優先、Phase 5開始前）
- #24–#27: MVP のローカルビルド・総合検証（バイナリ配布は中止）

#28 以降は MVP 完成後の拡張とする。#29 のブラウザ版は機能検証まで成功したが、公開条件を満たせず中止した。実装の保存先と理由は [最終判断](browser-publication-review.md) を参照。Windows版の開発を継続し、次は #30 に着手する。個別作業ブランチ → develop の PR で CI を確認し、段階ごとにユーザー確認後に develop → main へ統合する。Pages公開は行わない。

## 注意事項

実際の楽曲・画像や個人情報をコミットしない。検証には再配布可能な素材を使用する。アプリ・FFmpeg のバイナリは公開しない。CI は品質確認のみとする。

## CI の実行時間

Rust の依存クレートとビルド成果物は Swatinem/rust-cache でキャッシュする。
対象ワークスペースは src-tauri、ターゲットディレクトリは src-tauri/target。
src-tauri/Cargo.lock は Git 管理済みで、CI は --locked で検証する。
キャッシュが存在しない場合も通常通りコンパイルする。

- fmt、Clippy、単体テスト、FFmpeg 結合テスト、Windows 実行ファイル生成は従来通り必須の検証項目とする。
- PR のキャッシュは GitHub Actions の PR スコープに保存されるため、develop での初回実行でもキャッシュの作成が必要になる場合がある。
- CI の成功後、キャッシュの復元ログと各ステップの時間を比較する。保存・復元の時間も含めて評価する。
- フロントエンドの依存管理は pnpm を標準とし、`pnpm-lock.yaml` と `src-tauri/Cargo.lock` を Git で管理する。通常は `pnpm install --frozen-lockfile` と Cargo の `--locked` を使用する。依存更新時のみ lockfile を再生成し、差分を確認する。
- package.json の packageManager に pnpm の版を固定する。CI、Tauri のフック、build.bat は pnpm に統一し、npm は setup.bat の pnpm 初回導入にのみ使用する。
- ローカルでのビルド・テストのみへの変更は、キャッシュの効果を確認後に判断する。

Issue の自動クローズは同一リポジトリの develop 向けマージ済み PR のみを対象にし、PR のコードを実行しない。main 向け PR は GitHub 標準のクローズ機能を利用する。

## テストの実行と追加

[テスト・検証](testing.md) を参照。FFmpeg が必要な結合テストは理由付きの ignore を付け、CI では全件を直列実行する。外部素材をコミットせず、テスト内で生成する。

## ソース版の管理

[総合検証](mvp-validation.md) を行い、ユーザー確認後に main へ統合する。必要に応じてバージョンタグを付ける。バイナリ配布ワークフローは使用しない。
