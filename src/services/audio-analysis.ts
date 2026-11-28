import { invoke } from "@tauri-apps/api/core";
import type { FilterChain } from "./audio-filters";
import type { AudioComparison } from "./analysis-data";

export function analyzeAudio(path: string, filters: FilterChain): Promise<AudioComparison> {
  return invoke<AudioComparison>("analyze_audio", { path, filters });
}
