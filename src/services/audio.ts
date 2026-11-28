import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface AudioSource {
  path: string;
  name: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitRate: number | null;
}

export async function selectAudio(): Promise<AudioSource | null> {
  if (!isTauri()) return null;
  const path = await open({
    title: "音声素材を選択",
    multiple: false,
    directory: false,
    filters: [{ name: "音声・動画", extensions: ["mp3", "wav", "flac", "aac", "m4a", "mp4", "webm"] }],
  });
  if (path === null) return null;
  if (typeof path !== "string") throw new Error("音声素材を1ファイル選択してください。");

  return loadAudio(path);
}

export async function loadAudio(path: string): Promise<AudioSource> {
  const info = await invoke<Omit<AudioSource, "path">>("probe_audio", { path });
  return { ...info, path };
}
