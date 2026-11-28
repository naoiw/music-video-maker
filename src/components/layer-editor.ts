import { reportError } from "./diagnostics";
import type { VisualSource } from "../services/visual";
import { loadVisualPreview } from "./visual-preview";
import {
  MAX_OVERLAYS, defaultLayerGeometry, layerPixelRect, moveLayer, parseLayerGeometry,
  type LayerGeometry, type OverlayLayer,
} from "../services/layers";
import type { OutputSettings } from "../services/video";

interface LayerEntry {
  source: VisualSource;
  geometry: LayerGeometry;
  valid: boolean;
  image: HTMLImageElement;
  row: HTMLDivElement;
  forward: HTMLButtonElement;
  backward: HTMLButtonElement;
}

export interface LayerEditor {
  ready(): boolean;
  getOverlays(): OverlayLayer[];
  refresh(settings: OutputSettings | null, encoding: boolean): void;
  load(path?: string): Promise<void>;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

export function initializeLayerEditor(hasBase: () => boolean, onChange: () => void): LayerEditor {
  const fieldset = document.querySelector<HTMLFieldSetElement>("#overlay-editor");
  const add = document.querySelector<HTMLButtonElement>("#add-overlay");
  const list = document.querySelector<HTMLElement>("#overlay-list");
  const host = document.querySelector<HTMLElement>("#overlay-preview");
  const status = document.querySelector<HTMLElement>("#overlay-status");
  if (!fieldset || !add || !list || !host || !status) throw new Error("Missing layer editor elements");

  const entries: LayerEntry[] = []; // Back to front, as in the native compositor.
  let loading = false;
  let locked = false;
  let lastSettings: OutputSettings | null = null;

  function ready(): boolean {
    return !loading && entries.every(entry => entry.valid);
  }

  function getOverlays(): OverlayLayer[] {
    return entries.map(entry => ({ path: entry.source.path, ...entry.geometry }));
  }

  function refresh(settings: OutputSettings | null, encoding: boolean): void {
    locked = encoding;
    if (settings) lastSettings = settings;
    fieldset!.disabled = encoding || loading || !hasBase();
    add!.disabled = entries.length >= MAX_OVERLAYS;
    if (!lastSettings) return;
    const { width, height } = lastSettings;
    entries.forEach(entry => {
      const rect = layerPixelRect(entry.geometry, width, height);
      Object.assign(entry.image.style, {
        left: rect.x / width * 100 + "%",
        top: rect.y / height * 100 + "%",
        width: rect.width / width * 100 + "%",
        height: rect.height / height * 100 + "%",
        opacity: String(entry.geometry.opacity / 100),
      });
    });
  }

  function reorder(): void {
    // Keep image nodes and playback; z-index follows the back-to-front array.
    entries.forEach((entry, i) => {
      entry.image.style.zIndex = String(i);
      entry.forward.disabled = i === entries.length - 1;
      entry.backward.disabled = i === 0;
    });
    list!.replaceChildren(...entries.slice().reverse().map(entry => entry.row));
    onChange();
  }

  function makeEntry(source: VisualSource, image: HTMLImageElement): LayerEntry {
    const geometry = defaultLayerGeometry();
    const row = document.createElement("div");
    row.className = "overlay-row";
    const title = document.createElement("h3");
    title.textContent = source.name;
    const details = document.createElement("p");
    details.className = "muted";
    details.textContent = source.format + " · " + source.width + " × " + source.height + " px";
    const actions = document.createElement("div");
    actions.className = "actions";
    const fields = document.createElement("div");
    fields.className = "fields";
    const error = document.createElement("p");
    error.className = "muted";
    error.setAttribute("role", "status");
    const forward = button("前面へ", () => {
      if (locked || loading) return;
      if (moveLayer(entries, entries.indexOf(entry), 1)) reorder();
    });
    const backward = button("背面へ", () => {
      if (locked || loading) return;
      if (moveLayer(entries, entries.indexOf(entry), -1)) reorder();
    });
    const remove = button("削除", () => {
      if (locked || loading) return;
      entries.splice(entries.indexOf(entry), 1);
      entry.image.remove();
      entry.row.remove();
      reorder();
    });
    const entry: LayerEntry = { source, geometry, valid: true, image, row, forward, backward };
    actions.append(forward, backward, remove);
    const inputs = {} as Record<keyof LayerGeometry, HTMLInputElement>;
    const definitions: [keyof LayerGeometry, string][] = [
      ["x", "X位置 (%)"], ["y", "Y位置 (%)"], ["width", "幅 (%)"],
      ["height", "高さ (%)"], ["opacity", "不透明度 (%)"],
    ];
    for (const [key, label] of definitions) {
      const wrapper = document.createElement("label");
      wrapper.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = key === "width" || key === "height" ? "0.01" : "0";
      input.max = "100";
      input.step = key === "opacity" ? "1" : "0.01";
      input.required = true;
      input.value = String(key === "opacity" ? geometry[key] : geometry[key] / 100);
      inputs[key] = input;
      wrapper.append(input);
      fields.append(wrapper);
      input.addEventListener("input", () => {
        const values = {
          x: inputs.x.value, y: inputs.y.value,
          width: inputs.width.value, height: inputs.height.value,
          opacity: inputs.opacity.value,
        };
        const parsed = parseLayerGeometry(values);
        entry.valid = parsed !== null;
        if (parsed) entry.geometry = parsed;
        row.dataset.invalid = String(!entry.valid);
        error.textContent = parsed ? "" : "位置・サイズを画面内に収め、不透明度を0～100にしてください。";
        onChange();
      });
    }
    row.append(title, details, actions, fields, error);
    return entry;
  }

  async function load(path?: string): Promise<void> {
    if (locked || loading || !hasBase() || entries.length >= MAX_OVERLAYS) return;
    loading = true;
    onChange();
    status!.textContent = "画像を確認しています…";
    try {
      const selection = await loadVisualPreview("overlay-image", path);
      if (!selection) {
        status!.textContent = "";
        return;
      }
      const { source, image } = selection;
      entries.push(makeEntry(source, image));
      host!.append(image);
      reorder();
      status!.textContent = "";
    } catch (error) {
      status!.textContent = reportError("image", error);
    } finally {
      loading = false;
      onChange();
    }
  }
  add.addEventListener("click", () => { void load(); });
  return { ready, getOverlays, refresh, load };
}
