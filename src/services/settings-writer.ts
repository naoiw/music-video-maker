import { serializeSettings, type SettingsValues } from "./settings-schema.ts";

export type SaveState = "saving" | "saved" | "invalid" | "error";

/** Serialize IPC writes; coalesce rapid edits to the most recent valid snapshot. */
export function createSettingsWriter(
  write: (json: string) => Promise<void>,
  notify: (state: SaveState, error?: unknown) => void,
  initial: SettingsValues | null,
): (values: SettingsValues | null) => Promise<void> {
  let lastSaved = initial ? serializeSettings(initial) : null;
  let pending: { json: string; revision: number } | null = null;
  let writing = false;
  let revision = 0;

  async function drain(): Promise<void> {
    if (writing) return;
    writing = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        try {
          if (next.json !== lastSaved) {
            await write(next.json);
            lastSaved = next.json;
          }
          if (next.revision === revision) notify("saved");
        } catch (error) {
          if (next.revision === revision) notify("error", error);
        }
      }
    } finally {
      writing = false;
    }
  }

  return async values => {
    const current = ++revision;
    if (!values) {
      // Keep the last valid snapshot, including a previously queued edit.
      notify("invalid");
      return;
    }
    pending = { json: serializeSettings(values), revision: current };
    notify("saving");
    await drain();
  };
}
