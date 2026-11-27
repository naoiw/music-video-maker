import "./styles.css";
import { getMediaToolStatus, getRuntimeInfo } from "./services/runtime";

const status = document.querySelector<HTMLElement>("#status");
if (!status) throw new Error("Missing status element");

async function initialize(element: HTMLElement): Promise<void> {
  try {
    const runtime = await getRuntimeInfo();
    element.textContent = runtime.kind === "desktop"
      ? `Desktop / ${runtime.os} / v${runtime.version}`
      : "Browser preview — デスクトップ処理は利用できません。";
  } catch (error) {
    element.textContent = `実行環境の取得に失敗しました: ${String(error)}`;
  }
}

void initialize(status);

async function initializeMediaTools(): Promise<void> {
  const element = document.querySelector<HTMLElement>("#media-status");
  if (!element) return;
  try {
    const result = await getMediaToolStatus();
    if (!result) return;
    element.textContent = [
      `FFmpeg: ${result.ffmpeg.version ?? result.ffmpeg.error ?? "未検出"}`,
      `FFprobe: ${result.ffprobe.version ?? result.ffprobe.error ?? "未検出"}`,
    ].join(" / ");
  } catch (error) {
    element.textContent = `メディア処理環境の取得に失敗しました: ${String(error)}`;
  }
}

void initializeMediaTools();
