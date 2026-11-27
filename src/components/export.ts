import { getSelectedAudio } from "./audio-source";
import { getSelectedVisual } from "./visual-source";
import { cancelEncode, encodeVideo, getEncodeProgress, selectOutput, type OutputSettings } from "../services/video";

export function initializeExport(available: boolean): () => void {
  const audioButton = document.querySelector<HTMLButtonElement>("#select-audio");
  const visualButton = document.querySelector<HTMLButtonElement>("#select-visual");
  const outputButton = document.querySelector<HTMLButtonElement>("#select-output");
  const startButton = document.querySelector<HTMLButtonElement>("#start-encode");
  const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-encode");
  const outputName = document.querySelector<HTMLElement>("#output-path");
  const status = document.querySelector<HTMLElement>("#encode-status");
  const progress = document.querySelector<HTMLProgressElement>("#encode-progress");
  const fieldset = document.querySelector<HTMLFieldSetElement>("#output-settings");
  const resolution = document.querySelector<HTMLSelectElement>("#resolution");
  const fps = document.querySelector<HTMLSelectElement>("#fps");
  const fit = document.querySelector<HTMLSelectElement>("#fit");
  const quality = document.querySelector<HTMLSelectElement>("#quality");
  const preview = document.querySelector<HTMLElement>("#visual-preview");
  if (!fieldset || !resolution || !fps || !fit || !quality || !preview ||
      !audioButton || !visualButton || !outputButton || !startButton ||
      !outputName || !status || !progress || !cancelButton) {
    throw new Error("Missing export elements");
  }

  let outputPath: string | null = null;
  let encoding = false;
  let choosingOutput = false;
  let nextJobId = 0;
  let activeJobId: number | null = null;
  let cancelRequested = false;
  let canCancel = false;

  function readSettings(): OutputSettings | null {
    const size = resolution!.value;
    const frames = Number(fps!.value);
    const crf = Number(quality!.value);
    const mode = fit!.value;
    if (!["1920x1080", "1080x1080", "1080x1920"].includes(size) ||
        ![24, 30, 60].includes(frames) || ![16, 20, 24].includes(crf) ||
        (mode !== "contain" && mode !== "cover")) return null;
    const [width, height] = size.split("x").map(Number);
    return { width, height, fps: frames, crf, fit: mode };
  }

  function refresh(): void {
    const settings = readSettings();
    fieldset!.disabled = !available || encoding;
    cancelButton!.disabled = !encoding || !canCancel || cancelRequested;
    if (settings) {
      preview!.dataset.resolution = resolution!.value;
      preview!.dataset.fit = settings.fit;
    }
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    outputButton!.disabled = !available || encoding || choosingOutput;
    startButton!.disabled = !available || encoding || choosingOutput ||
      audioButton!.disabled || visualButton!.disabled ||
      !audio || !visual || !outputPath || !settings;
    if (encoding || choosingOutput) return;
    progress!.value = 0;
    status!.textContent = !available ? "FFmpegとFFprobeが必要です。" :
      !audio || !visual || !outputPath ? "音声・画像と保存先を選択してください。" :
      !settings ? "出力設定が無効です。" :
      `${settings.width} × ${settings.height} / ${settings.fps} fps / CRF ${settings.crf} で生成できます。`;
  }

  fieldset.addEventListener("change", refresh);

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

  async function poll(jobId: number): Promise<void> {
    try {
      const info = await getEncodeProgress(jobId);
      if (activeJobId !== jobId || !info) return;
      canCancel = info.phase !== "saving" && !info.cancelled;
      cancelButton!.disabled = !canCancel || cancelRequested;
      if (cancelRequested || info.cancelled) {
        status!.textContent = "中断処理中…";
        return;
      }
      if (info.phase === "preparing") {
        status!.textContent = "素材を確認しています…";
        return;
      }
      if (info.phase === "verifying" || info.phase === "saving") {
        progress!.value = 99;
        status!.textContent = info.phase === "verifying" ? "出力を検証しています…" : "保存しています…";
        return;
      }
      const percent = info.durationSeconds > 0
        ? Math.min(99, Math.max(0, info.processedSeconds / info.durationSeconds * 100))
        : 0;
      progress!.value = percent;
      status!.textContent = `動画を生成しています… ${Math.floor(percent)}%`;
    } catch {
      // Progress transport errors must not interrupt the actual encode.
    }
  }

  cancelButton.addEventListener("click", async () => {
    const id = activeJobId;
    if (id === null || !canCancel || cancelRequested) return;
    cancelRequested = true;
    cancelButton.disabled = true;
    status.textContent = "中断処理中…";
    try {
      const accepted = await cancelEncode(id);
      if (activeJobId !== id) return;
      if (!accepted) {
        cancelRequested = false;
        canCancel = false;
        status.textContent = "保存処理中または終了済みです。";
      }
    } catch (error) {
      if (activeJobId !== id) return;
      cancelRequested = false;
      cancelButton.disabled = !canCancel;
      status.textContent = `中断要求に失敗: ${String(error)}`;
    }
  });

  startButton.addEventListener("click", async () => {
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    const settings = readSettings();
    if (startButton.disabled || !audio || !visual || !outputPath || !settings) return;
    const id = ++nextJobId;
    activeJobId = id;
    cancelRequested = false;
    canCancel = false;
    encoding = true;
    audioButton.disabled = true;
    visualButton.disabled = true;
    refresh();
    progress.removeAttribute("value");
    status.textContent = "素材を確認しています…";
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try { await poll(id); } finally { polling = false; }
    }, 200);
    let resultMessage: string;
    let succeeded = false;
    try {
      const info = await encodeVideo(audio.path, visual.path, outputPath, settings, id);
      succeeded = true;
      resultMessage = `生成完了 · ${info.durationSeconds.toFixed(1)} 秒 · ${(info.sizeBytes / 1024 / 1024).toFixed(2)} MiB`;
      // Require a new destination for the next export; never overwrite.
      outputPath = null;
    } catch (error) {
      resultMessage = String(error) === "ENCODE_CANCELLED"
        ? "生成を中断しました。再実行できます。"
        : `生成失敗: ${String(error)}`;
    } finally {
      activeJobId = null;
      window.clearInterval(timer);
      cancelRequested = false;
      canCancel = false;
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
