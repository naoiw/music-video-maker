import { defaultSettings, validateSettings, type SettingsValues } from "../../src/services/settings-schema.ts";
import { parsePresets, serializePresets, type FilterPreset } from "../../src/services/preset-schema.ts";
import { browserResolutions } from "./encode-plan.ts";

// localStorage is origin-wide: namespace keys to avoid other GitHub Pages projects.
export const SETTINGS_KEY = "music-video-maker:web:settings:v1";
export const PRESETS_KEY = "music-video-maker:web:presets:v1";
const VERSION = 1;
type Store = Pick<Storage, "getItem" | "setItem">;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function defaultWebSettings(): SettingsValues {
  return { ...defaultSettings(), resolution: "1280x720" };
}
export function validateWebSettings(value: unknown): SettingsValues | null {
  if (!isRecord(value) || !browserResolutions.some(r=>r===value.resolution)) return null;
  // Keep desktop bounds as the authority; 720p is a browser-only choice.
  const valid = validateSettings({ ...value, resolution: "1920x1080" });
  return valid ? { ...valid, resolution: value.resolution as string } : null;
}
export function parseWebSettings(raw: string): SettingsValues | null {
  try {
    const parsed:unknown = JSON.parse(raw);
    return isRecord(parsed) && parsed.version === VERSION ? validateWebSettings(parsed.values) : null;
  } catch { return null; }
}
export function serializeWebSettings(raw: unknown): string {
  const values = validateWebSettings(raw);
  if (!values) throw new Error("設定値が無効です。");
  return JSON.stringify({ version:VERSION, values });
}

export function createWebStore(access: () => Store) {
  return {
    readSettings() {
      const raw=access().getItem(SETTINGS_KEY);
      if(raw===null)return null;
      const valid=parseWebSettings(raw);
      if(!valid)throw new Error("保存設定が破損しているか未対応の形式です。");
      return valid;
    },
    writeSettings(values: unknown) {
      const encoded=serializeWebSettings(values);
      access().setItem(SETTINGS_KEY,encoded);
    },
    readPresets(): FilterPreset[] {
      const raw=access().getItem(PRESETS_KEY);
      if(raw===null)return [];
      const valid=parsePresets(raw);
      if(!valid)throw new Error("保存済みプリセットが破損しているか未対応の形式です。");
      return valid;
    },
    writePresets(presets: readonly FilterPreset[]) {
      const encoded=serializePresets(presets);
      access().setItem(PRESETS_KEY,encoded);
    },
  };
}
export type WebStore = ReturnType<typeof createWebStore>;
