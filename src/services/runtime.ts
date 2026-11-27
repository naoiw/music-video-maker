import { invoke, isTauri } from "@tauri-apps/api/core";

interface NativeRuntimeInfo {
  os: string;
  version: string;
}

export type RuntimeInfo =
  | ({ kind: "desktop" } & NativeRuntimeInfo)
  | { kind: "browser" };

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  if (!isTauri()) return { kind: "browser" };
  const info = await invoke<NativeRuntimeInfo>("runtime_info");
  return { kind: "desktop", ...info };
}

interface ToolStatus {
  version: string | null;
  error: string | null;
}

export interface MediaToolStatus {
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
}

export async function getMediaToolStatus(): Promise<MediaToolStatus | null> {
  if (!isTauri()) return null;
  return invoke<MediaToolStatus>("media_tool_status");
}
