import { getSelectedAudio } from "./audio-source";
import { getSelectedVisual } from "./visual-source";
import { encodeVideo, selectOutput } from "../services/video";

export function initializeExport(available: boolean): () => void {
  const audioButton = document.querySelector<HTMLButtonElement>("#select-audio");
  const visualButton = document.querySelector<HTMLButtonElement>("#select-visual");
  const outputButton = document.querySelector<HTMLButtonElement>("#select-output");
  const startButton = document.querySelector<HTMLButtonElement>("#start-encode");
  const outputName = document.querySelector<HTMLElement>("#output-path");
  const status = document.querySelector<HTMLElement>("#encode-status");
  const progress = document.querySelector<HTMLProgressElement>("#encode-progress");
  if (!audioButton || !visualButton || !outputButton || !startButton ||
      !outputName || !status || !progress) {
    throw new Error("Missing export elements");
  }

  let outputPath: string | null = null;
  let encoding = false;
  let choosingOutput = false;

  function refresh(): void {
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    outputButton!.disabled = !available || encoding || choosingOutput;
    startButton!.disabled = !available || encoding || choosingOutput ||
      audioButton!.disabled || visualButton!.disabled ||
      !audio || !visual || !outputPath;
    if (encoding || choosingOutput) return;
    progress!.value = 0;
    status!.textContent = !available ? "FFmpegとFFprobeが必要です。" :
      !audio || !visual || !outputPath ? "音声・画像と保存先を選択してください。" :
      "1920 × 1080 / 30 fps で生成できます。";
  }

  outputButton.addEventListener("click", async () => {
    choosingOutput = true;
    refresh();
    let errorMessage: string | null = null;
    try {
      const audio = getSelectedAudio();
      const path = await selectOutput(audio ? audio.name.replace(/\.mp3$/i, ".mp4") : "music-video.mp4");
      if (path) {
        outputPath = path.toLowerCase().endsWith(".mp4") ? path : `${path}.mp4`;
        outputName.textContent = outputPath;
      }
    } catch (error) {
      errorMessage = `保存先の選択に失敗: ${String(error)}`;
    } finally {
      choosingOutput = false;
      refresh();
      if (errorMessage) status.textContent = errorMessage;
    }
  });

  startButton.addEventListener("click", async () => {
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    if (startButton.disabled || !audio || !visual || !outputPath) return;
    encoding = true;
    audioButton.disabled = true;
    visualButton.disabled = true;
    refresh();
    progress.removeAttribute("value");
    status.textContent = "動画を生成しています…";
    let resultMessage: string;
    let succeeded = false;
    try {
      const info = await encodeVideo(audio.path, visual.path, outputPath);
      succeeded = true;
      resultMessage = `生成完了 · ${info.durationSeconds.toFixed(1)} 秒 · ${(info.sizeBytes / 1024 / 1024).toFixed(2)} MiB`;
      // Require a new destination for the next export; never overwrite.
      outputPath = null;
    } catch (error) {
      resultMessage = `生成失敗: ${String(error)}`;
    } finally {
      encoding = false;
      audioButton.disabled = false;
      visualButton.disabled = false;
      refresh();
    }
    progress.value = succeeded ? 100 : 0;
    status.textContent = resultMessage;
  });

  refresh();
  return refresh;
}
