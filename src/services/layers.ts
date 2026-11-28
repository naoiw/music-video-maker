/** Relative coordinates use hundredths of a percent, matching Rust's IPC contract. */
export const MAX_OVERLAYS = 8;
export const COORDINATE_SCALE = 10_000;

export interface LayerGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export const visualizerStyles = ["frequency", "waveform", "volume", "spectrogram"] as const;
export type VisualizerStyle = (typeof visualizerStyles)[number];
export type VisualizerAudioSource = "original" | "processed";

export interface VisualizerConfig {
  style: VisualizerStyle;
  audioSource: VisualizerAudioSource;
  color: string;
  transparent: boolean;
}

export type OverlayLayer = LayerGeometry & (
  | { path: string; visualizer?: never }
  | { path?: never; visualizer: VisualizerConfig }
);

export const defaultVisualizer = (): VisualizerConfig => ({
  style: "frequency", audioSource: "processed", color: "#ffffff", transparent: true,
});

export const defaultVisualizerGeometry = (): LayerGeometry => ({
  x: 1000, y: 7500, width: 8000, height: 2000, opacity: 100,
});

export const visualizerLabels: Record<VisualizerStyle, string> = {
  frequency: "周波数バー", waveform: "音声波形", volume: "音量メーター", spectrogram: "スペクトログラム",
};

export function validVisualizer(value: VisualizerConfig): boolean {
  return visualizerStyles.includes(value.style) &&
    (value.audioSource === "original" || value.audioSource === "processed") &&
    /^#[0-9a-f]{6}$/i.test(value.color) && typeof value.transparent === "boolean";
}

export const defaultLayerGeometry = (): LayerGeometry => ({
  x: 2500, y: 2500, width: 5000, height: 5000, opacity: 100,
});

export function validLayerGeometry(g: LayerGeometry): boolean {
  return [g.x, g.y, g.width, g.height, g.opacity].every(Number.isInteger) &&
    g.x >= 0 && g.y >= 0 && g.width > 0 && g.height > 0 &&
    g.x + g.width <= COORDINATE_SCALE && g.y + g.height <= COORDINATE_SCALE &&
    g.opacity >= 0 && g.opacity <= 100;
}

/** Convert GUI percentages without accepting empty, fractional-hundredth or out-of-range fields. */
export function parseLayerGeometry(values: Record<keyof LayerGeometry, string>): LayerGeometry | null {
  const percent = (value: string): number => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return NaN;
    return Math.round(Number(value) * 100);
  };
  const geometry = {
    x: percent(values.x), y: percent(values.y),
    width: percent(values.width), height: percent(values.height),
    opacity: /^\d+$/.test(values.opacity) ? Number(values.opacity) : NaN,
  };
  return validLayerGeometry(geometry) ? geometry : null;
}

/** Match the integer rounding used for the native output rectangle. */
export function layerPixelRect(g: LayerGeometry, canvasWidth: number, canvasHeight: number) {
  const x = Math.floor(g.x * canvasWidth / COORDINATE_SCALE);
  const y = Math.floor(g.y * canvasHeight / COORDINATE_SCALE);
  const right = Math.floor((g.x + g.width) * canvasWidth / COORDINATE_SCALE);
  const bottom = Math.floor((g.y + g.height) * canvasHeight / COORDINATE_SCALE);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function moveLayer<T>(layers: T[], index: number, direction: -1 | 1): boolean {
  const target = index + direction;
  if (!Number.isInteger(index) || index < 0 || index >= layers.length || target < 0 || target >= layers.length) return false;
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return true;
}
