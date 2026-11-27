import { invoke } from "@tauri-apps/api/core";

export function readSavedSettings(): Promise<string | null> {
  return invoke<string | null>("read_settings");
}

export function writeSavedSettings(json: string): Promise<void> {
  return invoke<void>("write_settings", { json });
}
