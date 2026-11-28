import { reportError } from "./diagnostics";
import { compileAudioFilters, type FilterChain } from "../services/audio-filters";
import { getSelectedAudio } from "./audio-source";
import { getFrequencyFilters, initializeFrequencyFilters } from "./frequency-filters";
import { getVolumeFilters, initializeVolumeFilters } from "./volume-filters";

import { settingsFields } from "../services/settings-schema";

const DEFAULT_REDUCTION = settingsFields["noise-reduction"].initial;
const DEFAULT_FLOOR = settingsFields["noise-floor"].initial;

interface NoiseSettings {
  enabled: boolean;
  reductionDb: number;
  noiseFloorDb: number;
}

let noise: NoiseSettings = {
  enabled: false,
  reductionDb: DEFAULT_REDUCTION,
  noiseFloorDb: DEFAULT_FLOOR,
};

/** Shared settings for future preview and export. Order is the processing order. */
function noiseChain(): FilterChain {
  const { enabled, reductionDb, noiseFloorDb } = noise;
  return [{
    enabled,
    filter: { kind: "noiseReduction", reductionDb, noiseFloorDb },
  }];
}

export function getFilterChain(): FilterChain {
  return [...noiseChain(), ...getFrequencyFilters(), ...getVolumeFilters()];
}

export function initializeAudioFilters(available: boolean): () => void {
  const fieldset = document.querySelector<HTMLFieldSetElement>("#noise-filter");
  const parameters = document.querySelector<HTMLFieldSetElement>("#noise-parameters");
  const enabled = document.querySelector<HTMLInputElement>("#noise-enabled");
  const reduction = document.querySelector<HTMLInputElement>("#noise-reduction");
  const floor = document.querySelector<HTMLInputElement>("#noise-floor");
  const reductionValue = document.querySelector<HTMLOutputElement>("#noise-reduction-value");
  const floorValue = document.querySelector<HTMLOutputElement>("#noise-floor-value");
  const reset = document.querySelector<HTMLButtonElement>("#noise-reset");
  const status = document.querySelector<HTMLElement>("#noise-status");
  if (!fieldset || !parameters || !enabled || !reduction || !floor ||
      !reductionValue || !floorValue || !reset || !status) {
    throw new Error("Missing noise reduction elements");
  }

  const refreshFrequency = initializeFrequencyFilters(available);
  const refreshVolume = initializeVolumeFilters(available);
  fieldset.disabled = !available;
  let revision = 0;

  async function refresh(): Promise<void> {
    const current = ++revision;
    const audio = getSelectedAudio();
    noise = {
      enabled: enabled!.checked,
      reductionDb: reduction!.valueAsNumber,
      noiseFloorDb: floor!.valueAsNumber,
    };
    reductionValue!.value = `${noise.reductionDb} dB`;
    floorValue!.value = `${noise.noiseFloorDb} dB`;
    parameters!.disabled = !available || !noise.enabled;
    if (!available) {
      status!.textContent = "FFmpegとFFprobeが必要です。";
      return;
    }
    if (!noise.enabled) {
      status!.textContent = "ノイズ除去は無効です。";
      return;
    }
    if (!Number.isFinite(noise.reductionDb) || !Number.isFinite(noise.noiseFloorDb)) {
      status!.textContent = "設定値が無効です。";
      return;
    }

    status!.textContent = "設定を確認しています…";
    try {
      // Noise reduction is independent of sample rate. Use a provisional rate before import.
      await compileAudioFilters(noiseChain(), audio?.sampleRate ?? 48_000);
      if (current !== revision) return;
      status!.textContent = audio
        ? "設定有効（FFTノイズ除去）"
        : "設定有効 · 音声素材を選択してください。";
    } catch (error) {
      if (current !== revision) return;
      status!.textContent = reportError("filter", error);
    }
  }

  const update = (): void => { void refresh(); };
  enabled.addEventListener("change", update);
  reduction.addEventListener("input", update);
  floor.addEventListener("input", update);
  reset.addEventListener("click", () => {
    reduction.value = String(DEFAULT_REDUCTION);
    floor.value = String(DEFAULT_FLOOR);
    update();
  });
  update();
  return () => {
    update();
    refreshFrequency();
    refreshVolume();
  };
}
