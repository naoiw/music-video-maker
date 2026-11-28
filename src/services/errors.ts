export type ErrorOperation =
  | "audio" | "image" | "preview" | "filter" | "output" | "encode"
  | "cancel" | "runtime" | "settings" | "presets" | "drop";

const guidance = {
  PERMISSION: "ファイルまたはフォルダにアクセスできません。読み取り・書き込み権限を確認し、必要に応じて別のフォルダを選択してください。",
  DISK_FULL: "ディスク容量が不足しています。保存先と一時ファイル用ドライブの空き容量を確保して再実行してください。",
  PATH_MISSING: "ファイルまたはフォルダが見つかりません。素材と保存先が移動・削除されていないか確認し、選択し直してください。",
  OUTPUT_EXISTS: "保存先に同名のファイルがあります。上書きせず、別の名前を指定してください。",
  FILE_BUSY: "他のアプリがファイルを使用しています。開いているアプリを閉じるか、別のファイル・保存先を選択してください。",
  TOOL_MISSING: "FFmpegまたはFFprobeが見つかりません。実行ファイルの配置とPATHを確認し、アプリを再起動してください。",
  TOOL_START: "FFmpegまたはFFprobeを起動できません。実行ファイルの権限や破損を確認してください。",
  TOOL_FEATURE: "FFmpegに必要なコーデックまたはフィルタがありません。対応するビルドを使用してください。",
  INVALID_MEDIA: "素材のデコードに失敗しました。破損していない対応形式の素材に変更してください。",
  INPUT_AUDIO: "音声を読み込めません。対応するローカルの音声・動画ファイルを選び直してください。",
  INPUT_IMAGE: "画像を読み込めません。PNG・JPEG・GIF（32 MiB以下、4000万画素以下）の正常な画像を選び直してください。",
  OUTPUT_PATH: "保存先が無効です。存在するフォルダ内のMP4ファイル名を指定してください。",
  OUTPUT_IO: "一時ファイルまたは出力ファイルを操作できません。保存先と一時フォルダの権限・空き容量を確認してください。",
  OUTPUT_SETTINGS: "出力設定が無効です。解像度・フレームレート・品質を確認してください。",
  FILTER: "音声フィルタの設定が無効です。数値と音源のサンプリング周波数を確認し、必要に応じて初期化してください。",
  OUTPUT_VERIFY: "生成結果が期待する形式または再生時間と一致しません。素材・フィルタ設定・FFmpegのバージョンを確認してください。不完全な出力は公開しません。",
  SETTINGS_IO: "設定ファイルを操作できません。アプリ設定フォルダの権限と空き容量を確認してください。",
  PROCESS_FAILED: "FFmpegまたはFFprobeの処理に失敗しました。素材と設定、実行環境を確認して再実行してください。",
} as const;

const fallback: Record<ErrorOperation, string> = {
  audio: "音声を読み込めません。正常なMP3等の対応音声素材とファイルのアクセス権限を確認してください。",
  image: "画像を読み込めません。PNG・JPEG・GIFの形式・容量・破損を確認してください。",
  preview: "試聴に失敗しました。素材・フィルタ・FFmpegの実行環境を確認して再試聴してください。",
  filter: guidance.FILTER,
  output: "保存先を選択できません。フォルダの権限と空き容量を確認してください。",
  encode: "動画の生成に失敗しました。素材・設定・保存先を確認して再実行してください。",
  cancel: "中断を要求できませんでした。処理状態を確認してください。",
  runtime: "実行環境を確認できません。FFmpeg・FFprobeの配置とPATHを確認し、アプリを再起動してください。",
  settings: "設定を読み書きできません。設定フォルダの権限・空き容量を確認してください。",
  presets: "プリセットを読み書きできません。設定フォルダと保存形式を確認してください。",
  drop: "ドラッグ＆ドロップを利用できません。素材の選択ボタンを使用してください。",
};

export const operationLabels: Record<ErrorOperation, string> = {
  audio: "音声読み込み", image: "画像読み込み", preview: "音声試聴",
  filter: "フィルタ設定", output: "保存先選択", encode: "動画生成",
  cancel: "生成中断", runtime: "実行環境", settings: "設定保存・復元",
  presets: "プリセット", drop: "ドラッグ＆ドロップ",
};

export interface Diagnostic {
  code: string;
  message: string;
  detail: string;
}

export function describeError(operation: ErrorOperation, error: unknown): Diagnostic {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const match = /^\[MVM:([A-Z_]+)\]\s*/.exec(raw);
  const candidate = match?.[1];
  const known = candidate !== undefined && Object.hasOwn(guidance, candidate);
  const code = known ? candidate : "UNKNOWN";
  const detail = known && match ? raw.slice(match[0].length) : raw;
  return {
    code,
    message: known ? guidance[candidate as keyof typeof guidance] : fallback[operation],
    detail: detail.length > 8192 ? detail.slice(0, 8192) + "… (truncated)" : detail,
  };
}
