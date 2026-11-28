import { getSelectedAudio } from "./audio-source";
import { getFilterChain } from "./audio-filters";
import { reportError } from "./diagnostics";
import { analyzeAudio } from "../services/audio-analysis";
import { comparisonDuration, dbLabel, seekValue, type AudioComparison } from "../services/analysis-data";
import { drawSpectrum, drawWaveform, waveformFraction } from "./analysis-charts";

function node<T extends HTMLElement>(id: string): T {
  const value = document.querySelector<T>(`#${id}`);
  if (!value) throw new Error(`Missing analysis element: ${id}`);
  return value;
}

export function initializeAudioAnalysis(available: boolean, onBusyChange: () => void) {
  const button = node<HTMLButtonElement>("analyze-audio");
  const status = node<HTMLElement>("analysis-status");
  const resultPanel = node<HTMLElement>("analysis-result");
  const waveform = node<HTMLCanvasElement>("analysis-waveform");
  const spectrum = node<HTMLCanvasElement>("analysis-spectrum");
  const original = node<HTMLElement>("analysis-original-stats");
  const processed = node<HTMLElement>("analysis-processed-stats");
  const details = node<HTMLElement>("analysis-details");
  const start = node<HTMLInputElement>("preview-start");
  const sourceButton = node<HTMLButtonElement>("select-audio");
  const filterPanel = node<HTMLElement>("filter-title").parentElement;
  let source = getSelectedAudio();
  let generation = 0;
  let busy = false;
  let result: AudioComparison | null = null;

  function validFilters(): boolean {
    return Array.from(filterPanel?.querySelectorAll<HTMLInputElement>("input[type=number], input[type=range]") ?? [])
      .every(input => input.matches(":disabled") || (Number.isFinite(input.valueAsNumber) && input.validity.valid));
  }

  function controls(): void {
    button.disabled = !available || !getSelectedAudio() || sourceButton.disabled || busy || !validFilters();
    button.textContent = busy ? "解析中…" : result ? "再解析" : "全曲を解析";
    waveform.style.cursor = result && !start.disabled ? "pointer" : "default";
  }

  function invalidate(message: string): void {
    generation++;
    result = null;
    resultPanel.hidden = true;
    status.textContent = message;
    controls();
  }

  function refresh(): void {
    const current = getSelectedAudio();
    if (current !== source) {
      source = current;
      invalidate(current ? "全曲を解析すると原音と加工音を比較できます。" : "音声素材を選択してください。");
    }
    controls();
  }

  function redraw(): void {
    if (!result) return;
    drawWaveform(waveform, result, start.valueAsNumber);
    drawSpectrum(spectrum, result);
  }

  function display(data: AudioComparison): void {
    result = data;
    resultPanel.hidden = false;
    const stats = (track: AudioComparison["original"]) =>
      `Peak ${dbLabel(track.peak)} / RMS ${dbLabel(track.rms)} / 0 dBFS超過 ${track.overRangeSamples.toLocaleString("ja-JP")} samples`;
    original.textContent = stats(data.original);
    processed.textContent = stats(data.processed);
    details.textContent = `${data.sampleRate / 1000} kHz · ${data.channels} ch · FFT ${data.fftSize} · ${(data.sampleRate / data.fftSize).toFixed(2)} Hz/bin · 原音 ${data.original.durationSeconds.toFixed(2)} 秒 / 加工音 ${data.processed.durationSeconds.toFixed(2)} 秒`;
    status.textContent = Math.abs(data.original.durationSeconds - data.processed.durationSeconds) > 0.2
      ? "解析完了。原音と加工音の尺に差があります（0.2秒超）。"
      : "解析完了。波形をクリックすると試聴区間を変更できます。";
    redraw();
  }

  button.addEventListener("click", async () => {
    const audio = getSelectedAudio();
    if (!audio || button.disabled) return;
    const current = ++generation;
    result = null;
    resultPanel.hidden = true;
    busy = true;
    status.textContent = "原音・加工音のPCMを解析しています…";
    controls();
    onBusyChange();
    try {
      const data = await analyzeAudio(audio.path, getFilterChain());
      if (current === generation && audio === getSelectedAudio()) display(data);
    } catch (error) {
      if (current === generation) status.textContent = reportError("analysis", error);
    } finally {
      busy = false;
      controls();
      onBusyChange();
    }
  });

  function filterChanged(): void {
    invalidate(busy ? "設定が変わりました。現在の解析終了後に再解析してください。" : "フィルタ設定を変更しました。再解析してください。");
  }
  filterPanel?.addEventListener("input", filterChanged);
  filterPanel?.addEventListener("change", filterChanged);
  filterPanel?.addEventListener("click", event => {
    if (event.target instanceof HTMLButtonElement && event.target.id.endsWith("-reset")) filterChanged();
  });
  start.addEventListener("input", () => {
    if (result) drawWaveform(waveform, result, start.valueAsNumber);
  });
  waveform.addEventListener("click", event => {
    if (!result || start.disabled || sourceButton.disabled) return;
    start.value = String(seekValue(waveformFraction(waveform, event.clientX), comparisonDuration(result), Number(start.max)));
    start.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const observer = new ResizeObserver(redraw);
  observer.observe(waveform);
  observer.observe(spectrum);
  const theme = matchMedia("(prefers-color-scheme: dark)");
  theme.addEventListener("change", redraw);
  window.addEventListener("pagehide", () => {
    generation++;
    observer.disconnect();
    theme.removeEventListener("change", redraw);
  });
  if (!available) status.textContent = "FFmpegとFFprobeが必要です。";
  refresh();
  return { refresh, isBusy: () => busy };
}
