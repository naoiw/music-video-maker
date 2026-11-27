import { invoke } from "@tauri-apps/api/core";
import type { FilterChain } from "./audio-filters";

interface AudioPreviewResponse {
  wavBase64: string;
}

/** Only a bounded WAV excerpt is returned; no filesystem permission is granted. */
export async function renderAudioPreview(
  path: string,
  startSeconds: number,
  filters: FilterChain,
): Promise<string> {
  const result = await invoke<AudioPreviewResponse>("render_audio_preview", {
    path, startSeconds, filters,
  });
  const binary = atob(result.wavBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
