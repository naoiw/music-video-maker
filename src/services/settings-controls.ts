import { settingsFields, settingsIds, type SettingId, type SettingValue } from "./settings-schema.ts";

type SettingControl = HTMLInputElement | HTMLSelectElement;
function control(id: SettingId): SettingControl {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement))
    throw new Error("Missing setting control: " + id);
  return node;
}

/** Read/write schema-defined DOM controls without emitting synthetic events.
 * Callers retain control of refresh, persistence and backend availability. */
export function readSettingControls(ids: readonly SettingId[] = settingsIds): Record<string, unknown> {
  return Object.fromEntries(ids.map(id => {
    const node = control(id);
    const field = settingsFields[id];
    if (node instanceof HTMLInputElement) {
      if (field.kind === "boolean") return [id, node.checked];
      if (field.kind === "number") return [id, node.valueAsNumber];
    }
    return [id, node.value];
  }));
}

export function applySettingControls(values: Partial<Record<SettingId, SettingValue>>, ids: readonly SettingId[] = settingsIds): void {
  for (const id of ids) {
    const node = control(id);
    const value = values[id];
    if (value === undefined) throw new Error("Missing setting value: " + id);
    if (node instanceof HTMLInputElement && settingsFields[id].kind === "boolean")
      node.checked = value === true;
    else node.value = String(value);
  }
}
