import "./styles.css";
import { initializeAudioSource } from "./components/audio-source";
import { getMediaToolStatus, getRuntimeInfo } from "./services/runtime";

async function initialize(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#runtime-status");
  const media = document.querySelector<HTMLElement>("#media-status");
  if (!status || !media) throw new Error("Missing status elements");

  try {
    const runtime = await getRuntimeInfo();
    status.textContent = runtime.kind === "desktop"
      ? `Desktop · v${runtime.version}`
      : "Browser preview";
    if (runtime.kind === "browser") {
      media.textContent = "デスクトップ処理は利用できません。";
      return;
    }
    const result = await getMediaToolStatus();
    if (!result) {
      media.textContent = "メディア処理環境を取得できません。";
      return;
    }
    if (result.ffprobe.version) initializeAudioSource();
    else {
      const audioStatus = document.querySelector<HTMLElement>("#audio-status");
      if (audioStatus) audioStatus.textContent = "FFprobeが必要です。実行環境を確認してください。";
    }
    media.textContent = [
      `FFmpeg: ${result.ffmpeg.version ?? result.ffmpeg.error ?? "未検出"}`,
      `FFprobe: ${result.ffprobe.version ?? result.ffprobe.error ?? "未検出"}`,
    ].join(" / ");
  } catch (error) {
    status.textContent = "環境確認エラー";
    media.textContent = String(error);
  }
}

void initialize();
