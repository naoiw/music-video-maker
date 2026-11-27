import { settingsFields } from "../../src/services/settings-schema";
import { defaultFilterSettings, filterIds, validateFilterSettings, type FilterSettings } from "../../src/services/preset-schema";
import { activeFilterNames, filterGroups } from "./audio-filter-plan";
import { applySettingControls, readSettingControls } from "../../src/services/settings-controls";

function get<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing audio filter control: "+id);
  return el as T;
}

export function initializeWebAudioFilters(onChange: () => void) {
  const root = get<HTMLFieldSetElement>("web-filter-controls");
  const status = get<HTMLElement>("filter-status");
  const summary = get<HTMLElement>("export-filter-summary");
  const defaults = defaultFilterSettings();
  for (const id of ["noise-filter","frequency-filters","volume-filters"])
    get<HTMLFieldSetElement>(id).disabled = false;
  // Shared schema is the authority for ranges and defaults.
  for (const group of filterGroups) {
    const enabled = get<HTMLInputElement>(group.enabled);
    enabled.checked = false;
    for (const id of group.fields) {
      const field = settingsFields[id];
      const control = get<HTMLInputElement>(id);
      control.min = String(field.min);
      control.max = String(field.max);
      control.step = String(field.step);
      control.value = String(field.initial);
    }
  }
  function readValues(includeDisabled: boolean): FilterSettings {
    const result = readSettingControls(filterIds);
    if (!includeDisabled) {
      for (const group of filterGroups)
        if (result[group.enabled] !== true)
          for (const id of group.fields) result[id] = defaults[id];
    }
    const valid = validateFilterSettings(result);
    if (!valid) throw new Error("音声フィルタの設定値を確認してください。");
    return valid;
  }
  function values(): FilterSettings { return readValues(false); }
  function snapshot(): FilterSettings { return readValues(true); }
  function apply(raw: unknown, notify = true) {
    const valid = validateFilterSettings(raw);
    if (!valid) throw new Error("音声フィルタの設定値を確認してください。");
    applySettingControls(valid,filterIds);
    // Do not dispatch checkbox events: preserve the saved limiter choice.
    if (notify) update(); else refresh();
  }
  function refresh() {
    for (const group of filterGroups)
      get<HTMLFieldSetElement>(group.parameters).disabled = !get<HTMLInputElement>(group.enabled).checked;
    for (const [id,output] of [["noise-reduction","noise-reduction-value"],["noise-floor","noise-floor-value"],["volume-gain","volume-gain-value"]])
      get<HTMLOutputElement>(output).value = get<HTMLInputElement>(id).value+" dB";
    for (const [id,groups] of [["noise-status",filterGroups.slice(0,1)],["frequency-status",filterGroups.slice(1,4)],["volume-status",filterGroups.slice(4)]] as const)
      get<HTMLElement>(id).textContent = groups.some(group => get<HTMLInputElement>(group.enabled).checked) ? "有効（生成時に検証）" : "無効";
    try {
      const names = activeFilterNames(values());
      const message = "音声フィルタ: "+(names.length ? names.join(" → ") : "なし");
      status.textContent = message;
      summary.textContent = message;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      summary.textContent = "音声フィルタ: 設定エラー";
    }
  }
  function update() { refresh(); onChange(); }
  for (const group of filterGroups) {
    get<HTMLInputElement>(group.enabled).addEventListener("change", () => {
      if ((group.enabled === "gain-enabled" || group.enabled === "loudness-enabled") && get<HTMLInputElement>(group.enabled).checked)
        get<HTMLInputElement>("limiter-enabled").checked = true;
      update();
    });
    for (const id of group.fields) get<HTMLInputElement>(id).addEventListener("input", update);
  }
  for (const id of new Set(filterGroups.map(group => group.reset))) {
    get<HTMLButtonElement>(id).addEventListener("click", () => {
      for (const group of filterGroups.filter(group => group.reset === id))
        for (const field of group.fields) get<HTMLInputElement>(field).value = String(defaults[field]);
      update();
    });
  }
  get<HTMLButtonElement>("filters-reset").addEventListener("click", () => {
    applySettingControls(defaults,filterIds);
    update();
  });
  refresh();
  return { values, snapshot, apply, setBusy(busy: boolean) { root.disabled = busy; } };
}
