# FFmpeg / FFprobe

利用者が同一ビルドの FFmpeg と FFprobe を別途インストールする。setup.bat は不足時に WinGet の Gyan.FFmpeg を導入する。手動導入は [環境構築とビルド](setup.md) を参照。

必要な機能は libx264、AAC、MP3、PNG/JPEG/GIF、afftdn 等の音声フィルタ。結合テストには libmp3lame と lavfi も必要。画面下部の「実行環境」で検出情報を確認できる。実行ファイルと同じディレクトリに利用者が手動配置した場合はそれを優先し、それ以外は PATH から探す。

FFmpeg は外部プロセスとして起動し、アプリからリンクしない。リポジトリ・Releases・CI Artifact では FFmpeg を再配布しない。各ソフトウェアのライセンスを区別する。FFmpeg の詳細は https://ffmpeg.org/legal.html を参照。

macOSはHomebrewのffmpeg-full、Ubuntuはaptのffmpegを基本とする。setup.shの機能検査で必要なエンコーダ・フィルタを確認し、run.shからシェルのPATHを引き継いで起動する。CIのmacOS/Linuxは各OSのパッケージを用いるためWindowsの固定ビルドとはバージョンが異なる場合がある。

#40 のGPUエンコードはオプション。FFmpegが h264_nvenc / h264_qsv / h264_amf / h264_videotoolbox を備えていても、実際の利用には対応するGPU/ドライバが必要。ソースのみの公開方針は維持し、GPU SDKや追加のバイナリを同梱しない。CPU libx264 は引き続き必須。
