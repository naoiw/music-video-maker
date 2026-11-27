import { readSavedSettings, writeSavedSettings } from "../services/settings";
import {
  defaultSettings, isSettingId, parseSettings, settingsFields, settingsIds,
  validateSettings, type SettingId, type SettingsValues,
} from "../services/settings-schema";
import { createSettingsWriter, type SaveState } from "../services/settings-writer";

function control(id: SettingId): HTMLInputElement | HTMLSelectElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement)) {
    throw new Error(`Missing setting control: ${id}`);
  }
  return node;
}

function apply(values: SettingsValues): void {
  for (const id of settingsIds) {
    const node = control(id);
    const value = values[id];
    if (node instanceof HTMLInputElement && settingsFields[id].kind === "boolean") {
      node.checked = value === true;
    } else {
      node.value = String(value);
    }
  }
}

function snapshot(): SettingsValues | null {
  const values = Object.fromEntries(settingsIds.map(id => {
    const node = control(id);
    const field = settingsFields[id];
    if (node instanceof HTMLInputElement) {
      if (field.kind === "boolean") return [id, node.checked];
      if (field.kind === "number") return [id, node.valueAsNumber];
    }
    return [id, node.value];
  }));
  return validateSettings(values);
}

function status(): HTMLElement {
  const node = document.getElementById("settings-status");
  if (!node) throw new Error("Missing settings status");
  return node;
}

/** Restore controls before filter components register listeners or read values. */
export async function restoreSettings(): Promise<SettingsValues | null> {
  let values: SettingsValues | null = null;
  let message = "初期設定を使用しています。";
  try {
    const raw = await readSavedSettings();
    if (raw !== null) {
      values = parseSettings(raw);
      message = values ? "前回の設定を復元しました。" : "保存設定が破損しているか未対応のため、初期設定を使用します。";
    }
  } catch (error) {
    message = `設定を読み込めませんでした。初期設定を使用します: ${String(error)}`;
  }
  apply(values ?? defaultSettings());
  status().textContent = message;
  return values;
}

export function initializeSettingsPersistence(
  initial: SettingsValues | null,
  refreshFilters: () => void,
): void {
  const reset = document.querySelector<HTMLButtonElement>("#settings-reset");
  const filterPanel = document.getElementById("filter-title")?.parentElement;
  if (!reset || !filterPanel) throw new Error("Missing settings elements");
  const output = status();
  const messages: Record<SaveState, string> = {
    saving: "設定を保存しています…",
    saved: "設定を保存しました。",
    invalid: "無効な設定値があるため、最後に保存した有効な設定を保持します。",
    error: "設定を保存できませんでした。",
  };
  const save = createSettingsWriter(writeSavedSettings, (state, error) => {
    output.textContent = state === "error" ? `${messages.error} ${String(error)}` : messages[state];
  }, initial);
  const persist = (): void => { void save(snapshot()); };

  // Bubbling listeners run after filter-specific handlers, including auto-limiter.
  document.addEventListener("input", event => {
    const node = event.target;
    if (node instanceof HTMLInputElement && isSettingId(node.id) && settingsFields[node.id].kind === "number") {
      persist();
    }
  });
  document.addEventListener("change", event => {
    const node = event.target;
    if ((node instanceof HTMLInputElement || node instanceof HTMLSelectElement) && isSettingId(node.id)) {
      persist();
    }
  });
  filterPanel.addEventListener("click", event => {
    if (event.target instanceof HTMLButtonElement &&
        ["noise-reset", "frequency-reset", "volume-reset"].includes(event.target.id)) {
      persist();
    }
  });
  reset.addEventListener("click", () => {
    if (reset.disabled) return;
    apply(defaultSettings());
    refreshFilters();
    // Existing preview/export listeners invalidate cached audio and update the output.
    // Do not dispatch individual checkbox changes (they would auto-enable the limiter).
    filterPanel.dispatchEvent(new Event("input", { bubbles: true }));
    persist();
  });
}
