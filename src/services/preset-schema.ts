import {
  defaultSettings, settingsIds, validateSettings, outputIds, type OutputId, type SettingId, type SettingsValues,
} from "./settings-schema.ts";

type FilterId = Exclude<SettingId, OutputId>;
export const filterIds = settingsIds.filter((id): id is FilterId => !outputIds.some(outputId => outputId === id));
export type FilterSettings = Pick<SettingsValues, FilterId>;
export interface FilterPreset {
  name: string;
  filters: FilterSettings;
}

export const PRESET_VERSION = 1;
export const MAX_PRESETS = 50;
export const MAX_NAME_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePresetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().normalize("NFC");
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !/[\x00-\x1f\x7f]/.test(name)
    ? name : null;
}

function key(name: string): string {
  return name.toLowerCase();
}

export function validateFilterSettings(value: unknown): FilterSettings | null {
  if (!isRecord(value)) return null;
  const combined = defaultSettings();
  for (const id of filterIds) {
    if (!Object.hasOwn(value, id)) return null;
    combined[id] = value[id] as SettingsValues[FilterId];
  }
  const valid = validateSettings(combined);
  return valid ? Object.fromEntries(filterIds.map(id => [id, valid[id]])) as FilterSettings : null;
}

export function defaultFilterSettings(): FilterSettings {
  const defaults = defaultSettings();
  return Object.fromEntries(filterIds.map(id => [id, defaults[id]])) as FilterSettings;
}

function validatePresets(value: unknown): FilterPreset[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRESETS) return null;
  const presets: FilterPreset[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const name = normalizePresetName(entry.name);
    const filters = validateFilterSettings(entry.filters);
    if (!name || !filters || seen.has(key(name))) return null;
    seen.add(key(name));
    presets.push({ name, filters });
  }
  return presets;
}

export function parsePresets(raw: string): FilterPreset[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.version === PRESET_VERSION ? validatePresets(value.presets) : null;
  } catch {
    return null;
  }
}

export function serializePresets(presets: readonly FilterPreset[]): string {
  const valid = validatePresets(presets);
  if (!valid) throw new Error("プリセットの設定が無効です。");
  return JSON.stringify({ version: PRESET_VERSION, presets: valid });
}

export function addPreset(
  presets: readonly FilterPreset[], rawName: string, values: unknown,
): FilterPreset[] {
  const name = normalizePresetName(rawName);
  if (!name) throw new Error("プリセット名は1～40文字で指定してください。");
  if (presets.some(preset => key(preset.name) === key(name))) {
    throw new Error("同じ名前のプリセットがあります。別の名前を指定してください。");
  }
  if (presets.length >= MAX_PRESETS) throw new Error("プリセットの上限は50件です。");
  const filters = validateFilterSettings(values);
  if (!filters) throw new Error("フィルタの設定値を確認してください。");
  return [...presets, { name, filters }];
}

export function removePreset(presets: readonly FilterPreset[], name: string): FilterPreset[] {
  return presets.filter(preset => preset.name !== name);
}
