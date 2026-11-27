# GitHub Releases による配布（#25）

## 公開フロー

安定版タグ vMAJOR.MINOR.PATCH を push すると Release ワークフローが動作する。PR・develop の更新では公開しない。タグは main に含まれるコミットを指し、package.json、src-tauri/Cargo.toml、src-tauri/tauri.conf.json のバージョンと一致する必要がある。現時点では prerelease タグは対象外。

1. FFmpeg の配布審査（#24）を完了し、packaging/ffmpeg-lock.json に承認済みバイナリ・対応ソース・第三者通知の HTTPS 取得先と SHA-256、ビルド構成、レビュー記録を固定する。取得先は認証なしで取得可能な承認済みの場所とする。
2. 総合動作確認（#27）と main への統合を行う。バージョン変更が必要な場合は3つのマニフェストを揃える。
3. main の対象コミットにタグを作り push する。以下は初回公開時の例であり、現時点で実行する手順ではない。

```powershell
git switch main
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

4. Windows CI が入力のハッシュ検証、ビルド、既存の単体テスト、ポータブル ZIP 生成、同梱 FFmpeg による全結合テストを実行する。
5. 成功時のみ別ジョブが ZIP の SHA-256 とタグの指すコミットを再確認し、GitHub Release を下書きで作成する。全ファイルのアップロードに成功してから公開する。

## 配布ファイル

- music-video-maker-v0.1.0-windows-x64.zip（アプリ、FFmpeg/FFprobe、ライセンス、第三者通知、対応ソースを含む）
- SHA256SUMS.txt（ZIP の SHA-256）

[Releases](https://github.com/naoiw/music-video-maker/releases) から取得する。配布物の構成は [Windows 配布パッケージ](windows-package.md) を参照。

## 安全策と失敗時

- 承認前、URLやハッシュの欠損・不一致、バージョン不一致、main 外のタグではビルド・公開しない。
- ビルドジョブは contents: read、公開ジョブのみ contents: write。標準の GITHUB_TOKEN を使用し、別途 PAT は不要。
- 既存 Release は上書きしない。アップロード失敗時は下書きが残る場合がある。管理者が内容・タグ・失敗理由を確認し、未公開の下書きのみ削除した後に再実行する。公開済み Release やタグは自動削除・変更しない。
- ビルドの Artifact は7日間保持する。PR 用 CI の開発確認用 Artifact は従来通り。
- 初回リリースは #27 で行う。現在は #24 の承認が未完了のため公開できない。実際のタグ push と公開経路の確認は未実施。

## 公開前の候補ビルド（#27）

`npm run release:check -- v0.1.0 --check` はダウンロードせず実マニフェストと配布審査情報を検証する（未承認は失敗）。承認後は Release の Run workflow で main または develop、候補版を指定するとビルド・テスト・ZIP Artifact 生成までを実行できる。手動実行では公開ジョブを起動しない。ワークフローが既定ブランチに存在する必要がある。実際の公開は [総合検証](mvp-validation.md) の完了・ユーザー承認後のタグ push に限る。
