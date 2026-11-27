import { reportError } from "./diagnostics";
import { compileAudioFilters, type FilterChain } from "../services/audio-filters";
import { getSelectedAudio } from "./audio-source";

const defaults = { gainDb: 0, targetLufs: -14, truePeakDb: -1.5, ceilingDb: -1 };

let filters: FilterChain = [
  { enabled: false, filter: { kind: "gain", gainDb: defaults.gainDb } },
  { enabled: false, filter: { kind: "loudness", targetLufs: defaults.targetLufs, truePeakDb: defaults.truePeakDb } },
  { enabled: false, filter: { kind: "limiter", ceilingDb: defaults.ceilingDb } },
];

export function getVolumeFilters(): FilterChain {
  return filters.map(entry => ({ ...entry, filter: { ...entry.filter } }));
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing volume filter element: ${id}`);
  return node;
}

export function initializeVolumeFilters(available: boolean): () => void {
  const root = element<HTMLFieldSetElement>("volume-filters");
  const gainEnabled = element<HTMLInputElement>("gain-enabled");
  const loudnessEnabled = element<HTMLInputElement>("loudness-enabled");
  const limiterEnabled = element<HTMLInputElement>("limiter-enabled");
  const gainParameters = element<HTMLFieldSetElement>("gain-parameters");
  const loudnessParameters = element<HTMLFieldSetElement>("loudness-parameters");
  const limiterParameters = element<HTMLFieldSetElement>("limiter-parameters");
  const gain = element<HTMLInputElement>("volume-gain");
  const gainValue = element<HTMLOutputElement>("volume-gain-value");
  const target = element<HTMLInputElement>("loudness-target");
  const peak = element<HTMLInputElement>("loudness-peak");
  const ceiling = element<HTMLInputElement>("limiter-ceiling");
  const reset = element<HTMLButtonElement>("volume-reset");
  const status = element<HTMLElement>("volume-status");

  root.disabled = !available;
  let revision = 0;

  async function refresh(): Promise<void> {
    const current = ++revision;
    const audio = getSelectedAudio();
    gainParameters.disabled = !available || !gainEnabled.checked;
    loudnessParameters.disabled = !available || !loudnessEnabled.checked;
    limiterParameters.disabled = !available || !limiterEnabled.checked;
    gainValue.value = `${gain.valueAsNumber > 0 ? "+" : ""}${gain.valueAsNumber} dB`;
    filters = [
      { enabled: gainEnabled.checked, filter: {
        kind: "gain", gainDb: gainEnabled.checked ? gain.valueAsNumber : defaults.gainDb,
      } },
      { enabled: loudnessEnabled.checked, filter: {
        kind: "loudness",
        targetLufs: loudnessEnabled.checked ? target.valueAsNumber : defaults.targetLufs,
        truePeakDb: loudnessEnabled.checked ? peak.valueAsNumber : defaults.truePeakDb,
      } },
      { enabled: limiterEnabled.checked, filter: {
        kind: "limiter", ceilingDb: limiterEnabled.checked ? ceiling.valueAsNumber : defaults.ceilingDb,
      } },
    ];
    if (!available) {
      status.textContent = "FFmpegとFFprobeが必要です。";
      return;
    }
    if (!filters.some(entry => entry.enabled)) {
      status.textContent = "音量フィルタは無効です。";
      return;
    }
    const activeInputs = [
      ...(gainEnabled.checked ? [gain] : []),
      ...(loudnessEnabled.checked ? [target, peak] : []),
      ...(limiterEnabled.checked ? [ceiling] : []),
    ];
    if (activeInputs.some(input => !Number.isFinite(input.valueAsNumber) || !input.validity.valid)) {
      status.textContent = "音量フィルタの設定値が無効です。";
      return;
    }
    status.textContent = "設定を確認しています…";
    try {
      await compileAudioFilters(getVolumeFilters(), audio?.sampleRate ?? 48_000);
      if (current !== revision) return;
      const warning = gainEnabled.checked && gain.valueAsNumber > 0 && !limiterEnabled.checked
        ? " · ピーク保護なし（クリッピングに注意）" : "";
      status.textContent = `設定有効${warning}${audio ? "" : " · MP3を選択してください。"}`;
    } catch (error) {
      if (current !== revision) return;
      status.textContent = reportError("filter", error);
    }
  }

  const update = (): void => { void refresh(); };
  for (const input of [gainEnabled, loudnessEnabled]) {
    input.addEventListener("change", () => {
      if (input.checked) limiterEnabled.checked = true;
      update();
    });
  }
  limiterEnabled.addEventListener("change", update);
  for (const input of [gain, target, peak, ceiling]) input.addEventListener("input", update);
  reset.addEventListener("click", () => {
    gain.value = String(defaults.gainDb);
    target.value = String(defaults.targetLufs);
    peak.value = String(defaults.truePeakDb);
    ceiling.value = String(defaults.ceilingDb);
    update();
  });
  update();
  return update;
}
