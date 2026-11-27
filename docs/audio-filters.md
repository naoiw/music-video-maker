# 音声フィルタ処理基盤（#13）

Rust の audio_filters モジュールが型付きの設定を FFmpeg の音声フィルタグラフへ変換する。TypeScript の services/audio-filters.ts は同一の設定スキーマを持ち、Tauri IPC を通じて検証結果を取得できる。

## 設定と適用順序

- フィルタ配列の先頭から順に適用する。複数の同じ種類も指定可能。
- 各要素は enabled と filter（kind と数値パラメータ）で構成する。
- 無効な要素はグラフに含めない。空または全無効なら null を返し、-af 自体を指定しない。
- 最大32要素。任意のフィルタ文字列、未知の種類、数値以外のパラメータを拒否する。Rust 側で有効なフィルタの数値範囲と有限性を検証する。
- サンプリング周波数は読み込んだ MP3 の値を使用する。8～48 kHz を対象とし、周波数設定はナイキスト周波数未満に制限する。

| 種類 | FFmpeg | 暫定の許容値 |
| --- | --- | --- |
| noiseReduction | afftdn | 低減量 0.01～30 dB、ノイズフロア -80～-20 dB |
| highPass | highpass | 20～20000 Hz、ナイキスト未満 |
| lowPass | lowpass | 同上 |
| equalizer | equalizer | 同上、Q 0.1～10、ゲイン -24～24 dB |
| gain | volume | -24～24 dB |

例（無効の要素は無視される）:

    [
      {"enabled":true,"filter":{"kind":"highPass","frequencyHz":80}},
      {"enabled":false,"filter":{"kind":"lowPass","frequencyHz":10000}},
      {"enabled":true,"filter":{"kind":"gain","gainDb":-6}}
    ]

生成結果:

    highpass=f=80,volume=-6dB

このグラフを FFmpeg の -af に1個の引数として渡す。シェルや任意のコマンド文字列は使用しない。

## 段階的な実装

この Issue は設定スキーマ、順序、検証、グラフ生成および FFmpeg での検証まで。現段階では GUI のフィルタ操作は無効のままで、MP4 生成にもフィルタを適用しない。既存の動画生成挙動を変えない。

- #14：ノイズ除去の設定 UI、効果と限界の確認。
- #15：周波数フィルタの設定 UI、周波数応答確認。
- #16：音量処理の設定 UI、ラウドネス正規化・ピーク対策。現在のゲイン上限だけではクリッピング防止にはならない。
- #17：原音と加工音の試聴、一時ファイル管理。
- #18：動画生成と試聴への共通設定適用。

## 検証

単体テストは空・無効・順序・数値検証・JSON スキーマを検証する。FFmpeg 結合テストは合成正弦波で無効時の PCM 一致、2つの -6 dB ゲインの累積効果、5種類のフィルタの組み合わせを確認する。Suno 楽曲の聴感改善・クリッピング対策の確認は後続 Issue で実施する。

    cargo test --manifest-path src-tauri/Cargo.toml audio_filters::tests
    cargo test --manifest-path src-tauri/Cargo.toml audio_filters::tests::processes_ -- --ignored
