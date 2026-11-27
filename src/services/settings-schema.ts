type Field =
  | { kind: "boolean"; initial: boolean }
  | { kind: "choice"; initial: string; options: readonly string[] }
  | { kind: "number"; initial: number; min: number; max: number; step: number };

export const settingsFields = {
  resolution: { kind: "choice", initial: "1920x1080", options: ["1920x1080", "1080x1080", "1080x1920"] },
  fps: { kind: "choice", initial: "30", options: ["24", "30", "60"] },
  fit: { kind: "choice", initial: "blurred", options: ["blurred", "contain", "cover"] },
  quality: { kind: "choice", initial: "20", options: ["16", "20", "24"] },
  "noise-enabled": { kind: "boolean", initial: false },
  "noise-reduction": { kind: "number", initial: 6, min: 1, max: 30, step: 1 },
  "noise-floor": { kind: "number", initial: -50, min: -80, max: -20, step: 1 },
  "highpass-enabled": { kind: "boolean", initial: false },
  "highpass-hz": { kind: "number", initial: 80, min: 20, max: 20_000, step: 1 },
  "lowpass-enabled": { kind: "boolean", initial: false },
  "lowpass-hz": { kind: "number", initial: 12_000, min: 20, max: 20_000, step: 1 },
  "eq-enabled": { kind: "boolean", initial: false },
  "eq-hz": { kind: "number", initial: 1000, min: 20, max: 20_000, step: 1 },
  "eq-q": { kind: "number", initial: 1, min: 0.1, max: 10, step: 0.1 },
  "eq-gain": { kind: "number", initial: 0, min: -24, max: 24, step: 0.5 },
  "gain-enabled": { kind: "boolean", initial: false },
  "volume-gain": { kind: "number", initial: 0, min: -24, max: 24, step: 0.5 },
  "loudness-enabled": { kind: "boolean", initial: false },
  "loudness-target": { kind: "number", initial: -14, min: -24, max: -10, step: 0.5 },
  "loudness-peak": { kind: "number", initial: -1.5, min: -9, max: -1, step: 0.5 },
  "limiter-enabled": { kind: "boolean", initial: false },
  "limiter-ceiling": { kind: "number", initial: -1, min: -12, max: -0.5, step: 0.5 },
} as const satisfies Record<string, Field>;

export type SettingId = keyof typeof settingsFields;
export type SettingValue = string | boolean | number;
export type SettingsValues = Record<SettingId, SettingValue>;
export const settingsIds = Object.keys(settingsFields) as SettingId[];
export const SETTINGS_VERSION = 1;
export type SettingsTarget = "desktop" | "browser";
export const browserResolutions = ["1280x720", ...settingsFields.resolution.options] as const;
export const outputIds = ["resolution", "fps", "fit", "quality"] as const;
export type OutputId = (typeof outputIds)[number];
export type Fit = (typeof settingsFields.fit.options)[number];
export type BrowserResolution = (typeof browserResolutions)[number];
export interface OutputSettings {
  width: number;
  height: number;
  fps: number;
  crf: number;
  fit: Fit;
}
export function resolutionOptions(target: SettingsTarget): readonly string[] {
  return target === "browser" ? browserResolutions : settingsFields.resolution.options;
}

export function defaultSettings(target: SettingsTarget = "desktop"): SettingsValues {
  const values = Object.fromEntries(settingsIds.map(id => [id, settingsFields[id].initial])) as SettingsValues;
  if (target === "browser") values.resolution = browserResolutions[0];
  return values;
}

export function isSettingId(id: string): id is SettingId {
  return Object.hasOwn(settingsFields, id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validValue(field: Field, value: unknown): value is SettingValue {
  if (field.kind === "boolean") return typeof value === "boolean";
  if (field.kind === "choice") return typeof value === "string" && field.options.includes(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < field.min || value > field.max) {
    return false;
  }
  const steps = (value - field.min) / field.step;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
}

function validSetting(id: SettingId, value: unknown, target: SettingsTarget): value is SettingValue {
  return id === "resolution"
    ? typeof value === "string" && resolutionOptions(target).includes(value)
    : validValue(settingsFields[id], value);
}

/** Output selects use strings; normalize only after validating every choice. */
export function parseOutputSettings(value: unknown, target: SettingsTarget = "desktop"): OutputSettings | null {
  if (!isRecord(value) || !outputIds.every(id => Object.hasOwn(value,id) && validSetting(id,value[id],target))) return null;
  const [width,height] = (value.resolution as string).split("x").map(Number);
  return { width, height, fps:Number(value.fps), crf:Number(value.quality), fit:value.fit as Fit };
}

/** Validate static UI bounds. Sample-rate-dependent limits are checked at use time. */
export function validateSettings(value: unknown, target: SettingsTarget = "desktop"): SettingsValues | null {
  if (!isRecord(value)) return null;
  const result = defaultSettings(target);
  for (const id of settingsIds) {
    const entry = value[id];
    if (!Object.hasOwn(value, id) || !validSetting(id, entry, target)) return null;
    result[id] = entry;
  }
  return result;
}

export function parseSettings(raw: string, target: SettingsTarget = "desktop"): SettingsValues | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== SETTINGS_VERSION) return null;
    return validateSettings(parsed.values, target);
  } catch {
    return null;
  }
}

export function serializeSettings(values: SettingsValues, target: SettingsTarget = "desktop"): string {
  const validated = validateSettings(values, target);
  if (!validated) throw new Error("Invalid settings");
  return JSON.stringify({ version: SETTINGS_VERSION, values: validated });
}
