import "./styles.css";
import { reportError } from "./components/diagnostics";
import { initializeAudioSource } from "./components/audio-source";
import { initializeAudioFilters } from "./components/audio-filters";
import { initializeAudioPreview } from "./components/audio-preview";
import { initializePresets } from "./components/presets";
import { initializeSettingsPersistence, restoreSettings } from "./components/settings";
import { initializeSourceDrop } from "./components/source-drop";
import { initializeExport } from "./components/export";
import { getSelectedVisual, initializeVisualSource } from "./components/visual-source";
import { initializeLayerEditor } from "./components/layer-editor";
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
    const savedSettings = await restoreSettings();
    let refreshExport = (): void => {};
    const loadVisual = initializeVisualSource(() => refreshExport());
    const layerEditor = initializeLayerEditor(() => getSelectedVisual() !== null, () => refreshExport());
    const result = await getMediaToolStatus();
    if (!result) {
      media.textContent = "メディア処理環境を取得できません。";
      return;
    }
    const available = Boolean(result.ffmpeg.version && result.ffprobe.version);
    const refreshFilters = initializeAudioFilters(available);
    const refreshPreview = initializeAudioPreview(available);
    const loadAudio = result.ffprobe.version ? initializeAudioSource(() => {
      refreshFilters();
      refreshPreview();
      refreshExport();
    }) : null;
    if (!loadAudio) {
      const audioStatus = document.querySelector<HTMLElement>("#audio-status");
      if (audioStatus) audioStatus.textContent = "FFprobeが必要です。実行環境を確認してください。";
    }
    refreshExport = initializeExport(available, refreshPreview, layerEditor);
    const applyFilterSettings = initializeSettingsPersistence(savedSettings, refreshFilters);
    await initializePresets(applyFilterSettings);
    // Failure to register native drag/drop must not disable the existing dialogs.
    await initializeSourceDrop(loadAudio, loadVisual, layerEditor.load).catch(error => {
      const dropStatus = document.querySelector<HTMLElement>("#source-drop-status");
      if (dropStatus) dropStatus.textContent = reportError("drop", error);
    });
    media.textContent = [
      `FFmpeg: ${result.ffmpeg.version ?? reportError("runtime", result.ffmpeg.error ?? "FFmpeg未検出")}`,
      `FFprobe: ${result.ffprobe.version ?? reportError("runtime", result.ffprobe.error ?? "FFprobe未検出")}`,
    ].join(" / ");
  } catch (error) {
    status.textContent = "環境確認エラー";
    media.textContent = reportError("runtime", error);
  }
}

void initialize();
