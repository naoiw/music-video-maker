import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { FilterChain } from "./audio-filters";

export interface OutputSettings {
  width: number;
  height: number;
  fps: number;
  crf: number;
  fit: "contain" | "cover";
}

export interface EncodeProgress {
  phase: "preparing" | "filtering" | "encoding" | "verifying" | "saving";
  durationSeconds: number;
  processedSeconds: number;
  cancelled: boolean;
}

export interface VideoInfo {
  durationSeconds: number;
  sizeBytes: number;
}

export async function selectOutput(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({
    title: "MP4の保存先を選択",
    defaultPath: defaultName,
    filters: [{ name: "MP4", extensions: ["mp4"] }],
  });
}

export async function encodeVideo(
  audioPath: string,
  visualPath: string,
  outputPath: string,
  settings: OutputSettings,
  filters: FilterChain,
  jobId: number,
): Promise<VideoInfo> {
  return invoke<VideoInfo>("encode_video", { audioPath, visualPath, outputPath, settings, filters, jobId });
}

export function getEncodeProgress(jobId: number): Promise<EncodeProgress | null> {
  return invoke<EncodeProgress | null>("encode_progress", { jobId });
}

export function cancelEncode(jobId: number): Promise<boolean> {
  return invoke<boolean>("cancel_encode", { jobId });
}
