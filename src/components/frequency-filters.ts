import { reportError } from "./diagnostics";
import { compileAudioFilters, type FilterChain } from "../services/audio-filters";
import { getSelectedAudio } from "./audio-source";

const defaults = { highPassHz: 80, lowPassHz: 12_000, eqHz: 1000, q: 1, gainDb: 0 };

let filters: FilterChain = [
  { enabled: false, filter: { kind: "highPass", frequencyHz: defaults.highPassHz } },
  { enabled: false, filter: { kind: "lowPass", frequencyHz: defaults.lowPassHz } },
  { enabled: false, filter: { kind: "equalizer", frequencyHz: defaults.eqHz, q: defaults.q, gainDb: defaults.gainDb } },
];

export function getFrequencyFilters(): FilterChain {
  return filters.map(entry => ({ ...entry, filter: { ...entry.filter } }));
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing frequency filter element: ${id}`);
  return node;
}

export function initializeFrequencyFilters(available: boolean): () => void {
  const root = element<HTMLFieldSetElement>("frequency-filters");
  const highEnabled = element<HTMLInputElement>("highpass-enabled");
  const lowEnabled = element<HTMLInputElement>("lowpass-enabled");
  const eqEnabled = element<HTMLInputElement>("eq-enabled");
  const highParameters = element<HTMLFieldSetElement>("highpass-parameters");
  const lowParameters = element<HTMLFieldSetElement>("lowpass-parameters");
  const eqParameters = element<HTMLFieldSetElement>("eq-parameters");
  const high = element<HTMLInputElement>("highpass-hz");
  const low = element<HTMLInputElement>("lowpass-hz");
  const center = element<HTMLInputElement>("eq-hz");
  const q = element<HTMLInputElement>("eq-q");
  const gain = element<HTMLInputElement>("eq-gain");
  const reset = element<HTMLButtonElement>("frequency-reset");
  const status = element<HTMLElement>("frequency-status");

  root.disabled = !available;
  let revision = 0;

  async function refresh(): Promise<void> {
    const current = ++revision;
    const audio = getSelectedAudio();
    const sampleRate = audio?.sampleRate ?? 48_000;
    const maxHz = Math.min(20_000, Math.ceil(sampleRate / 2) - 1);
    for (const input of [high, low, center]) input.max = String(maxHz);
    highParameters.disabled = !available || !highEnabled.checked;
    lowParameters.disabled = !available || !lowEnabled.checked;
    eqParameters.disabled = !available || !eqEnabled.checked;

    filters = [
      { enabled: highEnabled.checked, filter: { kind: "highPass", frequencyHz: highEnabled.checked ? high.valueAsNumber : defaults.highPassHz } },
      { enabled: lowEnabled.checked, filter: { kind: "lowPass", frequencyHz: lowEnabled.checked ? low.valueAsNumber : defaults.lowPassHz } },
      { enabled: eqEnabled.checked, filter: {
        kind: "equalizer",
        frequencyHz: eqEnabled.checked ? center.valueAsNumber : defaults.eqHz,
        q: eqEnabled.checked ? q.valueAsNumber : defaults.q,
        gainDb: eqEnabled.checked ? gain.valueAsNumber : defaults.gainDb,
      } },
    ];
    if (!available) {
      status.textContent = "FFmpegとFFprobeが必要です。";
      return;
    }
    if (!filters.some(entry => entry.enabled)) {
      status.textContent = "周波数フィルタは無効です。";
      return;
    }
    const activeInputs = [
      ...(highEnabled.checked ? [high] : []),
      ...(lowEnabled.checked ? [low] : []),
      ...(eqEnabled.checked ? [center, q, gain] : []),
    ];
    if (activeInputs.some(input => !Number.isFinite(input.valueAsNumber) || !input.validity.valid)) {
      status.textContent = `設定値が無効です（周波数は20～${maxHz} Hz）。`;
      return;
    }

    status.textContent = "設定を確認しています…";
    try {
      await compileAudioFilters(getFrequencyFilters(), sampleRate);
      if (current !== revision) return;
      status.textContent = audio
        ? `設定有効 · 周波数上限 ${maxHz} Hz`
        : "設定有効 · MP3を選択してください。";
    } catch (error) {
      if (current !== revision) return;
      status.textContent = reportError("filter", error);
    }
  }

  const update = (): void => { void refresh(); };
  for (const input of [highEnabled, lowEnabled, eqEnabled]) input.addEventListener("change", update);
  for (const input of [high, low, center, q, gain]) input.addEventListener("input", update);
  reset.addEventListener("click", () => {
    const maxHz = Math.min(20_000, Math.ceil((getSelectedAudio()?.sampleRate ?? 48_000) / 2) - 1);
    high.value = String(Math.min(defaults.highPassHz, maxHz));
    low.value = String(Math.min(defaults.lowPassHz, maxHz));
    center.value = String(Math.min(defaults.eqHz, maxHz));
    q.value = String(defaults.q);
    gain.value = String(defaults.gainDb);
    update();
  });
  update();
  return update;
}
