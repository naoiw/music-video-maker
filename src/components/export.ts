import { reportError } from "./diagnostics";
import { parseOutputSettings, outputIds, type Encoder } from "../services/settings-schema";
import { encoderLabels, qualityLabel } from "../services/encoder";
import { readSettingControls } from "../services/settings-controls";
import { getSelectedAudio } from "./audio-source";
import { getFilterChain } from "./audio-filters";
import { getSelectedVisual, refreshVisualPreview } from "./visual-source";
import type { LayerEditor } from "./layer-editor";
import { cancelEncode, encodeVideo, getEncodeProgress, getEncoderCapabilities, selectOutput, type EncoderCapability, type OutputSettings } from "../services/video";

export function initializeExport(
  available: boolean,
  refreshPreview: () => void,
  layerEditor: LayerEditor,
): () => void {
  const audioButton = document.querySelector<HTMLButtonElement>("#select-audio");
  const visualButton = document.querySelector<HTMLButtonElement>("#select-visual");
  const resetSettingsButton = document.querySelector<HTMLButtonElement>("#settings-reset");
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
  const encoder = document.querySelector<HTMLSelectElement>("#encoder");
  const encoderStatus = document.querySelector<HTMLElement>("#encoder-status");
  const detectButton = document.querySelector<HTMLButtonElement>("#detect-encoders");
  const preview = document.querySelector<HTMLElement>("#visual-preview");
  const filterPanel = document.querySelector<HTMLElement>("#filter-title")?.parentElement;
  const filterSummary = document.querySelector<HTMLElement>("#export-filter-summary");
  if (!filterPanel || !filterSummary || !fieldset || !resolution || !fps || !fit || !quality || !encoder || !encoderStatus || !detectButton || !preview ||
      !audioButton || !visualButton || !resetSettingsButton || !outputButton || !startButton ||
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
  let detecting = false;
  let capabilities: EncoderCapability[] = [];
  let detected = false;
  let detectionError = false;

  function refreshEncoderChoices(): void {
    for (const option of encoder!.options) {
      const key = option.value as Encoder;
      if (key === "cpu" || key === "auto") continue;
      const info = capabilities.find(item => item.encoder === key);
      // Preserve a restored unavailable selection, so its CPU fallback is explicit.
      option.disabled = !info?.available && key !== encoder!.value;
      option.textContent = encoderLabels[key] + (info?.available ? "" : detected ? "（利用不可）" : "（未検出）");
      option.title = info?.reason ?? "";
    }
    for (const option of quality!.options) {
      option.textContent = qualityLabel(encoder!.value as Encoder, Number(option.value));
    }
    detectButton!.disabled = !available || encoding || detecting;
    const ready = capabilities.filter(item => item.available).map(item => encoderLabels[item.encoder]);
    const chosen = encoder!.value as Encoder;
    encoderStatus!.textContent = !available ? "FFmpeg が必要です。" : detecting ? "GPU の試験エンコードを実行中…" :
      detectionError ? "GPU の検出に失敗しました。CPU は利用できます。" :
      !detected ? "GPU は未検出です。" :
      chosen !== "cpu" && chosen !== "auto" && !capabilities.some(item => item.encoder === chosen && item.available)
        ? "選択した GPU は利用できないため、生成時に再検査して CPU へ切り替えます。" :
      ready.length ? `利用可能: ${ready.join(" / ")}（生成時に再検査）` : "利用可能な GPU はありません。CPU で生成できます。";
  }

  async function detectEncoders(): Promise<void> {
    if (!available || encoding || detecting) return;
    detecting = true;
    detectionError = false;
    refreshEncoderChoices();
    if (encoder!.value !== "cpu") refresh();
    try {
      capabilities = await getEncoderCapabilities();
    } catch (error) {
      capabilities = [];
      detectionError = true;
      reportError("runtime", error);
    } finally {
      detecting = false;
      detected = true;
      refreshEncoderChoices();
      if (encoder!.value !== "cpu") refresh();
    }
  }

  detectButton.addEventListener("click", () => { void detectEncoders(); });

  function readSettings(): OutputSettings | null {
    return parseOutputSettings(readSettingControls(outputIds));
  }

  function validFilterInputs(): boolean {
    return Array.from(filterPanel!.querySelectorAll<HTMLInputElement>("input[type=number], input[type=range]"))
      .every(input => input.matches(":disabled") || (Number.isFinite(input.valueAsNumber) && input.validity.valid));
  }

  function refresh(): void {
    const settings = readSettings();
    fieldset!.disabled = !available || encoding;
    refreshEncoderChoices();
    layerEditor.refresh(settings, encoding);
    resetSettingsButton!.disabled = encoding;
    for (const section of filterPanel!.querySelectorAll<HTMLFieldSetElement>(":scope > fieldset")) {
      section.disabled = !available || encoding;
    }
    const activeCount = getFilterChain().filter(entry => entry.enabled).length;
    filterSummary!.textContent = activeCount ? `音声フィルタ: ${activeCount} 種類を適用` : "音声フィルタ: なし";
    cancelButton!.disabled = !encoding || !canCancel || cancelRequested;
    if (settings) {
      preview!.dataset.resolution = resolution!.value;
      preview!.dataset.fit = settings.fit;
      refreshVisualPreview(settings);
    }
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    outputButton!.disabled = !available || encoding || choosingOutput;
    startButton!.disabled = !available || encoding || choosingOutput ||
      audioButton!.disabled || visualButton!.disabled ||
      !audio || !visual || !outputPath || !settings || !validFilterInputs() || !layerEditor.ready() ||
      (detecting && settings.encoder !== "cpu");
    if (encoding || choosingOutput) return;
    progress!.value = 0;
    status!.textContent = !available ? "FFmpegとFFprobeが必要です。" :
      !audio || !visual || !outputPath ? "音声・画像と保存先を選択してください。" :
      !settings ? "出力設定が無効です。" :
      !layerEditor.ready() ? "追加レイヤーの読み込み・設定を確認してください。" :
      !validFilterInputs() ? "音声フィルタの設定値を確認してください。" :
      detecting && settings.encoder !== "cpu" ? "GPU の検出結果を確認しています…" :
      `${settings.width} × ${settings.height} / ${settings.fps} fps / ${qualityLabel(settings.encoder, settings.crf)} / ${encoderLabels[settings.encoder]} で生成できます。`;
  }

  fieldset.addEventListener("change", refresh);
  filterPanel.addEventListener("input", refresh);
  filterPanel.addEventListener("change", refresh);
  filterPanel.addEventListener("click", event => {
    if (event.target instanceof HTMLButtonElement && event.target.id.endsWith("-reset")) refresh();
  });

  outputButton.addEventListener("click", async () => {
    choosingOutput = true;
    refresh();
    let errorMessage: string | null = null;
    try {
      const audio = getSelectedAudio();
      const path = await selectOutput(audio ? audio.name.replace(/\.[^.]+$/, ".mp4") : "music-video.mp4");
      if (path) {
        outputPath = path.toLowerCase().endsWith(".mp4") ? path : `${path}.mp4`;
        outputName.textContent = outputPath;
      }
    } catch (error) {
      errorMessage = reportError("output", error);
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
      const stage = info.phase === "filtering" ? "音声を加工しています" : "動画を生成しています";
      const method = info.encoder ? ` · ${encoderLabels[info.encoder]}${info.fallback ? "（GPUから切替）" : ""}` : "";
      status!.textContent = `${stage}… ${Math.floor(percent)}%${method}`;
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
      status.textContent = reportError("cancel", error);
    }
  });

  startButton.addEventListener("click", async () => {
    const audio = getSelectedAudio();
    const visual = getSelectedVisual();
    const settings = readSettings();
    if (startButton.disabled || !audio || !visual || !outputPath || !settings || !validFilterInputs() || !layerEditor.ready()) return;
    const filters = getFilterChain();
    const id = ++nextJobId;
    activeJobId = id;
    cancelRequested = false;
    canCancel = false;
    encoding = true;
    audioButton.disabled = true;
    visualButton.disabled = true;
    refreshPreview();
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
      const info = await encodeVideo(audio.path, visual.path, outputPath, settings, filters, id, layerEditor.getOverlays());
      succeeded = true;
      resultMessage = `生成完了 · ${info.durationSeconds.toFixed(1)} 秒 · ${(info.sizeBytes / 1024 / 1024).toFixed(2)} MiB · ${encoderLabels[info.encoder]} · 所要 ${info.elapsedSeconds.toFixed(1)} 秒`;
      if (info.fallbackReason) {
        reportError("encode", `[MVM:PROCESS_FAILED] GPU から CPU に切り替えました: ${info.fallbackReason}`);
        resultMessage += "（GPU利用不可・CPUで生成成功。詳細は診断情報）";
      }
      // Require a new destination for the next export; never overwrite.
      outputPath = null;
    } catch (error) {
      resultMessage = String(error) === "ENCODE_CANCELLED"
        ? "生成を中断しました。再実行できます。"
        : reportError("encode", error);
    } finally {
      activeJobId = null;
      window.clearInterval(timer);
      cancelRequested = false;
      canCancel = false;
      encoding = false;
      audioButton.disabled = false;
      visualButton.disabled = false;
      refreshPreview();
      refresh();
    }
    progress.value = succeeded ? 100 : 0;
    status.textContent = resultMessage;
  });

  refresh();
  void detectEncoders();
  return refresh;
}
