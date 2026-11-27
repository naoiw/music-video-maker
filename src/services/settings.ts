import { invoke } from "@tauri-apps/api/core";

export function readSavedSettings(): Promise<string | null> {
  return invoke<string | null>("read_settings");
}

export function writeSavedSettings(json: string): Promise<void> {
  return invoke<void>("write_settings", { json });
}

export function readSavedPresets(): Promise<string | null> {
  return invoke<string | null>("read_presets");
}

export function writeSavedPresets(json: string): Promise<void> {
  return invoke<void>("write_presets", { json });
}
