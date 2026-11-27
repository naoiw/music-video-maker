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
