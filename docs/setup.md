# 環境構築とビルド

## Windows

対象は Windows 10 / 11 x64。ソースのみ公開し、各利用者がビルドする。インストーラー・コンパイル済み exe・FFmpeg の配布は行わない。初回にはインターネット接続、十分な空き容量、インストーラーに応じた管理者権限が必要。

## バッチで準備（pnpm を標準とする）

1. リポジトリを clone、または GitHub の Code → Download ZIP から取得し、すべて展開する。
2. `setup.bat` をダブルクリックする。Node.js 26、pnpm（package.json の固定版）、Microsoft C++ Build Tools（C++によるデスクトップ開発・Windows SDK）、rustup と Rust stable x64 MSVC、FFmpeg/FFprobe、WebView2 Runtime を確認し、不足分を導入する。WinGet（Microsoft Store の App Installer）が必要。インストール・UAC・利用規約の確認が出たら内容を確認する。
3. 成功表示を確認し、必要なら Windows を再起動する。PATH が反映されない場合も再起動して再実行する。
4. `build.bat` をダブルクリックする。pnpm install --frozen-lockfile で依存関係を導入し、Tauri をリリースビルドする。成功すると exe の絶対パスを表示する。
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
# pnpm が未導入の場合のみ（package.json の固定版）
npm install --global pnpm@10.34.6
pnpm --version
rustup run stable-x86_64-pc-windows-msvc cargo -V
ffmpeg -version
ffprobe -version
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
.\build.bat --skip-install
```

setup.bat は pnpm がない場合のみ Node.js 付属の npm で package.json の固定版を導入する。既存 pnpm は固定版を選択して使用し、異なる版を勝手にグローバル更新しない。build.bat は pnpm のみを使用する。`--skip-install` は事前に固定 lockfile で依存関係を導入した場合のオプション。通常は引数なしで実行すればよい。Tauri の開発・ビルドと CI も pnpm に統一し、Cargo は --locked を使用する。

参照: [Tauri 事前準備](https://v2.tauri.app/ja/start/prerequisites/)、[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/ja/visual-cpp-build-tools/)、[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)、[FFmpeg](ffmpeg.md)。

## 開発用起動と検証

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
pnpm install --frozen-lockfile
pnpm run desktop:dev
```

ブラウザで UI のみ確認する場合は pnpm run dev。ネイティブ処理は利用できない。テストは [テスト・検証](testing.md) を参照。ビルドキャッシュは target に保持されるため毎回削除する必要はない。`pnpm-lock.yaml` と `src-tauri/Cargo.lock` は Git 管理済み。依存関係を意図的に変更する場合以外は lockfile を更新しない。


## macOS / Linux（#39）

ソースから各自のOS・CPU向けにネイティブビルドする。macOS Apple Silicon / Intel と Ubuntu 24.04 x64 をCI対象とする。Linux ARM64 や他のDebian系でも同じスクリプトを利用できる可能性があるが、動作保証はしない。他ディストリビューションでは Tauri の事前準備を参考にネイティブ依存を手動導入し、`bash setup.sh --check` で確認する。署名・公証、.app、DMG、deb、AppImage、バイナリ配布は対象外。

### 共通の事前準備

- [Node.js](https://nodejs.org/) の26系（.node-version）とnpm、[rustup](https://rustup.rs/) をユーザー自身で導入し、ターミナルで利用できるようにする。既存の Node を自動置換しない。
- macOS では `xcode-select --install` でCommand Line Toolsを導入し、[Homebrew](https://brew.sh/) を利用可能にする。
- Ubuntu では apt と sudo が利用できるデスクトップ環境を用意する。
- リポジトリを clone または ZIP 展開し、ターミナルでそのディレクトリへ移動する。

```bash
bash setup.sh
bash build.sh
bash run.sh
```

setup.sh は macOS で必要な場合に Homebrew の ffmpeg-full を導入する。Linux では apt で WebKitGTK 4.1、GTK3、C/C++ ツール、OpenSSL、libxdo、libayatana-appindicator、librsvg、FFmpeg 等を導入する。未導入の Rust stable と固定 pnpm を準備し、ツール・コーデック・フィルタを確認する。既存 pnpm の版が異なる場合は勝手に変更せず停止する。OS のパッケージを変更しない確認だけなら `bash setup.sh --check` を実行する。

build.sh は pnpm install --frozen-lockfile、Tauri --no-bundle、Cargo --locked を利用し、`src-tauri/target/release/music-video-maker` を生成する。`--skip-install` は事前に依存を固定 lockfile で導入済みの場合のみ使う。run.sh は Cargo / Homebrew の PATH を補って実行する。スクリプトを bash から実行するので ZIP 展開時の実行ビットにも依存しない。アプリの起動にはデスクトップ環境が必要。

macOS では必要に応じて `brew install ffmpeg-full` と `export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"` を利用する。Linux ではディストリビューションの FFmpeg が必要な機能を含まない場合は別途フル機能の FFmpeg / FFprobe を用意する。

### 開発用起動

```bash
bash setup.sh --check
pnpm install --frozen-lockfile
RUSTUP_TOOLCHAIN=stable pnpm run desktop:dev
```

Homebrew の ffmpeg-full を使う場合は上記 PATH 設定を先に行う。参照: [Tauri事前準備](https://v2.tauri.app/ja/start/prerequisites/)、[Homebrew ffmpeg-full](https://formulae.brew.sh/formula/ffmpeg-full)。
