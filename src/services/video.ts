import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export interface OutputSettings {
  width: number;
  height: number;
  fps: number;
  crf: number;
  fit: "contain" | "cover";
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
): Promise<VideoInfo> {
  return invoke<VideoInfo>("encode_video", { audioPath, visualPath, outputPath, settings });
}
