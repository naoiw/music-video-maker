import { reportError } from "./diagnostics";
import { snapshotFilterSettings } from "./settings";
import { readSavedPresets, writeSavedPresets } from "../services/settings";
import {
  addPreset, defaultFilterSettings, parsePresets, removePreset, serializePresets,
  MAX_PRESETS, MAX_NAME_LENGTH, type FilterPreset, type FilterSettings,
} from "../services/preset-schema";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing preset control: ${id}`);
  return node as T;
}

export async function initializePresets(applyFilters: (values: FilterSettings) => void): Promise<void> {
  const root = element<HTMLFieldSetElement>("preset-controls");
  const name = element<HTMLInputElement>("preset-name");
  const select = element<HTMLSelectElement>("preset-select");
  const save = element<HTMLButtonElement>("preset-save");
  const load = element<HTMLButtonElement>("preset-load");
  const remove = element<HTMLButtonElement>("preset-delete");
  const defaults = element<HTMLButtonElement>("preset-defaults");
  const clear = element<HTMLButtonElement>("preset-clear");
  const status = element<HTMLElement>("preset-status");
  let presets: FilterPreset[] = [];
  let busy = true;
  let readable = false;
  let confirmClear = false;
  name.maxLength = MAX_NAME_LENGTH;

  function updateControls(): void {
    name.disabled = busy || !readable;
    select.disabled = busy || !readable || !presets.length;
    save.disabled = busy || !readable || !name.value.trim() || presets.length >= MAX_PRESETS;
    load.disabled = remove.disabled = busy || !readable || !select.value;
    defaults.disabled = busy;
    clear.disabled = busy || (readable && presets.length === 0);
    clear.textContent = confirmClear ? "全削除を確定" : "全削除";
  }

  function render(selected = select.value): void {
    select.replaceChildren(new Option("プリセットを選択", ""));
    for (const preset of presets) select.add(new Option(preset.name, preset.name));
    select.value = presets.some(preset => preset.name === selected) ? selected : "";
    updateControls();
  }

  function cancelClear(): void {
    confirmClear = false;
    updateControls();
  }

  async function commit(next: FilterPreset[], selected: string, message: string): Promise<void> {
    busy = true;
    cancelClear();
    status.textContent = "プリセットを保存しています…";
    try {
      await writeSavedPresets(serializePresets(next));
      presets = next;
      readable = true;
      status.textContent = message;
      render(selected);
    } catch (error) {
      status.textContent = reportError("presets", error);
    } finally {
      busy = false;
      updateControls();
    }
  }

  // Selecting or naming a preset is not a filter edit. Do not invalidate audio preview.
  root.addEventListener("input", event => { event.stopPropagation(); cancelClear(); });
  root.addEventListener("change", event => { event.stopPropagation(); cancelClear(); });

  save.addEventListener("click", () => {
    if (root.disabled || save.disabled) return;
    try {
      const next = addPreset(presets, name.value, snapshotFilterSettings());
      const selected = next[next.length - 1].name;
      void commit(next, selected, `「${selected}」を保存しました。`);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  load.addEventListener("click", () => {
    if (root.disabled || load.disabled) return;
    const selected = presets.find(preset => preset.name === select.value);
    if (!selected) return;
    cancelClear();
    applyFilters(selected.filters);
    status.textContent = `「${selected.name}」を適用しました。`;
  });
  remove.addEventListener("click", () => {
    if (root.disabled || remove.disabled) return;
    const selected = select.value;
    void commit(removePreset(presets, selected), "", `「${selected}」を削除しました。`);
  });
  defaults.addEventListener("click", () => {
    if (root.disabled || defaults.disabled) return;
    cancelClear();
    applyFilters(defaultFilterSettings());
    select.value = "";
    updateControls();
    status.textContent = "音声フィルタを初期化しました。保存済みプリセットは維持します。";
  });
  clear.addEventListener("click", () => {
    if (root.disabled || clear.disabled) return;
    if (!confirmClear) {
      confirmClear = true;
      updateControls();
      status.textContent = "保存済みプリセットをすべて削除します。もう一度押すと確定します。";
      return;
    }
    void commit([], "", "プリセット一覧を初期化しました。");
  });

  updateControls();
  try {
    const raw = await readSavedPresets();
    const parsed = raw === null ? [] : parsePresets(raw);
    if (!parsed) throw new Error("破損または未対応の形式です。");
    presets = parsed;
    readable = true;
    status.textContent = presets.length ? `${presets.length} 件のプリセットを読み込みました。` : "プリセットは未登録です。";
  } catch (error) {
    status.textContent = `${reportError("presets", error)} 全削除で初期化できます。`;
  } finally {
    busy = false;
    render("");
  }
}
