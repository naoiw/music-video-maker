import { invoke } from "@tauri-apps/api/core";

export type AudioFilter =
  | { kind: "noiseReduction"; reductionDb: number; noiseFloorDb: number }
  | { kind: "highPass"; frequencyHz: number }
  | { kind: "lowPass"; frequencyHz: number }
  | { kind: "equalizer"; frequencyHz: number; q: number; gainDb: number }
  | { kind: "gain"; gainDb: number };

export interface FilterEntry {
  enabled: boolean;
  filter: AudioFilter;
}

/** Array order is processing order; an empty list leaves the source unchanged. */
export type FilterChain = FilterEntry[];

/** Rust validates the values and builds the graph. Never accept raw filter syntax. */
export function compileAudioFilters(
  filters: FilterChain,
  sampleRate: number,
): Promise<string | null> {
  return invoke<string | null>("compile_audio_filters", { filters, sampleRate });
}
