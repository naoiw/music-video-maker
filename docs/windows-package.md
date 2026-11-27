# Windows x64 ポータブル配布（#24）

## 方針

インストーラーではなく ZIP を採用する。展開したフォルダ内の music-video-maker.exe を起動する。既存の Rust 実装が実行ファイルの隣にある FFmpeg/FFprobe を優先するため、Tauri の設定や開発用ビルドを変更しない。ユーザーは Node.js / Rust / FFmpeg を個別インストールしない。WebView2 Evergreen Runtime は別途必要であり、未導入環境では Microsoft 公式のランタイムを導入する（https://learn.microsoft.com/ja-jp/microsoft-edge/webview2/concepts/distribution）。署名済み配布物・完全オフラインでの初回導入は現段階では保証しない。

## FFmpeg の配布審査（未完了）

候補は Gyan 8.1.2 essentials ZIP。GitHub の固定タグの asset digest を packaging/ffmpeg-lock.json に記録した。latest URL は使用しない。候補であって採用・配布承認済みではない。

- FFmpeg は libx264 を有効化するため GPL 条件が適用される。アプリ本体の Apache-2.0 とは区別する。参考: https://ffmpeg.org/legal.html
- バイナリと厳密に対応する FFmpeg・リンクされたライブラリのソース、パッチ、ビルド・インストール用スクリプト、設定、ライセンス文書を取得して照合する。上流の一般的なソースリンクや単なる FFmpeg の同名バージョンでは代用しない。
- 実行ファイルの -version / configuration、GPL 条件、nonfree 無効、必要なコーデックとフィルタを確認する。H.264/AAC の特許等の条件も別途確認する。
- アプリの Rust・フロントエンドなど実際に配布物に含まれる第三者依存の著作権表示・ライセンスを収集する。
- 上記をレビューし、対応ソース ZIP と第三者通知テキストの SHA-256、正確な configuration 文字列、レビュー記録を lock に追加して approved を true にする。ハッシュ一致は出所の照合であり、法的適合を自動で証明するものではない。
- 審査に必要な情報が取得できない候補は採用しない。必要なら自前ビルドに切り替える。

現時点では approved=false のためパッケージ生成を停止する。未審査バイナリはリポジトリ・CI Artifact・Releases に同梱しない。

## 開発者向けパッケージ生成

審査完了後、Windows x64 のリポジトリルートで実行する。入力は承認済みの3ファイルを指定する。ZIPをネットから実行時取得しない。

```powershell
npm run desktop:build
npm run package:windows -- <ffmpeg.zip> <corresponding-source.zip> <third-party-notices.txt> <output.zip>
```

pnpm の場合は npm run を pnpm run に置き換える。既存の実行ファイル生成方法を維持する。生成処理では3入力の SHA-256、実行ファイルのバージョン・ビルド構成、合成素材による H.264/AAC の生成と FFprobe の検証を確認する。失敗時は一時ディレクトリを削除し、既存 ZIP は上書きしない。配布物内に対応ソース、ライセンス、通知、固定情報を含める。

```
Music Video Maker/
  music-video-maker.exe
  ffmpeg.exe
  ffprobe.exe
  README.txt
  LICENSE
  third-party/
    FFmpeg-LICENSE.txt
    THIRD-PARTY-NOTICES.txt
    corresponding-source.zip
    ffmpeg-lock.json
```

## 残る検証

- 承認した FFmpeg/FFprobe を PATH の先頭に置いて既存の全結合テストを実行する。実際に使われたバージョンを確認する。
- Windows 10/11 x64 の開発ツール・FFmpeg 未導入環境（WebView2 導入済みおよび未導入）で、ZIP展開・GUI起動・MP3とPNG/JPEG/GIF読み込み・フィルタあり/なしのMP4生成・FFprobe検証を行う。
- 署名・SmartScreen・WebView2 の扱いを実機で確認する。
- 審査と実機確認が完了するまで #24 は閉じない。タグによる自動配布は #25 で扱う。

## 自動配布（#25）

リリース時は上記の審査済み3入力を HTTPS 取得先（binaryArchive.url、sourceArchiveUrl、noticesUrl）と SHA-256 で固定し、CI が取得・検証してからパッケージを生成する。ローカル生成時は引き続きファイルを直接指定できる。詳細は [リリース手順](release.md) を参照。
