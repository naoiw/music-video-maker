import { describeError, operationLabels, type ErrorOperation } from "../services/errors";

const MAX_ENTRIES = 8;

/** Keep recent diagnostics locally in the DOM; never upload or persist them. */
export function reportError(operation: ErrorOperation, error: unknown): string {
  const info = describeError(operation, error);
  const panel = document.querySelector<HTMLDetailsElement>("#diagnostics");
  const list = document.getElementById("diagnostic-list");
  if (panel && list) {
    const entry = document.createElement("section");
    const label = document.createElement("h3");
    const detail = document.createElement("pre");
    label.textContent = `${operationLabels[operation]} · ${info.code} · ${new Date().toLocaleTimeString("ja-JP")}`;
    detail.textContent = info.detail || "診断情報なし";
    entry.append(label, detail);
    list.prepend(entry);
    while (list.children.length > MAX_ENTRIES) list.lastElementChild?.remove();
    panel.hidden = false;
  }
  return `${info.message}（詳細は画面下部の診断情報）`;
}
