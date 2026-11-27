# Windows の環境構築とビルド

対象は Windows 10 / 11 x64。ソースのみ公開し、各利用者がビルドする。インストーラー・コンパイル済み exe・FFmpeg の配布は行わない。初回にはインターネット接続、十分な空き容量、インストーラーに応じた管理者権限が必要。

## バッチで準備

1. リポジトリを clone、または GitHub の Code → Download ZIP から取得し、すべて展開する。
2. `setup.bat` をダブルクリックする。Node.js 26、Microsoft C++ Build Tools（C++によるデスクトップ開発・Windows SDK）、rustup と Rust stable x64 MSVC、FFmpeg/FFprobe、WebView2 Runtime を確認し、不足分を導入する。WinGet（Microsoft Store の App Installer）が必要。インストール・UAC・利用規約の確認が出たら内容を確認する。
3. 成功表示を確認し、必要なら Windows を再起動する。PATH が反映されない場合も再起動して再実行する。
4. `build.bat` をダブルクリックする。npm で依存関係を導入し、Tauri をリリースビルドする。成功すると exe の絶対パスを表示する。
5. `src-tauri/target/release/music-video-maker.exe` を起動する。以降はソースを更新しない限り再ビルド不要。FFmpeg/FFprobe は引き続き PATH 上に必要。

既存の Node.js が26系でない場合は自動で置き換えず停止する。Node.js 未導入時は確認済み26系（26.7.0）を指定する。Rust の既定 toolchain は変更せず、stable-x86_64-pc-windows-msvc を使用する。C++ Build Tools が入っていても必要なコンポーネントが不足する場合は Visual Studio Installer で追加する。既存の FFmpeg はバージョン・必要機能を確認して利用する。

setup.bat は同梱の scripts/setup.ps1 をプロセス限定の ExecutionPolicy Bypass で実行する。Windows 全体の実行ポリシーは変更しない。スクリプトの内容を確認してから実行する。企業等のポリシーでブロックされる場合は管理者の指示に従う。

## PowerShell で手動セットアップ

不足分のみ実行する。既存 Node.js は26系を選択すること。

```powershell
winget install --id OpenJS.NodeJS -e --version 26.7.0
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup -e
winget install --id Gyan.FFmpeg -e
winget install --id Microsoft.EdgeWebView2Runtime -e
```

PowerShellを開き直し、必要なら再起動する。

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
node -v
npm -v
rustup run stable-x86_64-pc-windows-msvc cargo -V
ffmpeg -version
ffprobe -version
.\build.bat
```

npm の代わりに既に pnpm を使用している場合は `.\build.bat --pnpm` を実行できる（pnpm は別途導入済みとする）。CIでは `--no-pause --skip-install` を使用する。通常利用者にこれらのオプションは不要。

参照: [Tauri 事前準備](https://v2.tauri.app/ja/start/prerequisites/)、[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/ja/visual-cpp-build-tools/)、[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)、[FFmpeg](ffmpeg.md)。

## 開発用起動と検証

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
npm install
npm run desktop:dev
```

ブラウザで UI のみ確認する場合は npm run dev。ネイティブ処理は利用できない。テストは [テスト・検証](testing.md) を参照。ビルドキャッシュは target に保持されるため毎回削除する必要はない。依存関係の lockfile 管理は別途対応する。
