import { reportError } from "./diagnostics";
import { loadVisual, renderBlurredPreview, selectVisual, type VisualSource } from "../services/visual";
import type { OutputSettings } from "../services/video";

let selectedVisual: VisualSource | null = null;
let originalImage: HTMLImageElement | null = null;
let sourceRevision = 0;
let requestedKey = "";
let pending: { key: string; path: string; width: number; height: number } | null = null;
let rendering = false;

async function drainPreview(preview: HTMLElement): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    while (pending) {
      const request = pending;
      pending = null;
      try {
        const url = await renderBlurredPreview(request.path, request.width, request.height);
        if (requestedKey !== request.key) continue;
        const image = new Image();
        image.alt = "合成プレビュー";
        image.className = "preview-image";
        image.src = url;
        await image.decode();
        if (requestedKey === request.key) preview.replaceChildren(image);
      } catch (error) {
        if (requestedKey === request.key) preview.textContent = reportError("image", error);
      }
    }
  } finally {
    rendering = false;
  }
}

/** Static images use the native composition. GIF preview uses two live image layers. */
function animatedBlurredPreview(image: HTMLImageElement, source: VisualSource, settings: OutputSettings): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "animated-blurred-preview";
  const background = new Image();
  background.alt = "";
  background.className = "gif-blurred-background";
  background.src = image.src;
  const foreground = new Image();
  foreground.alt = source.name;
  foreground.className = "gif-blurred-foreground";
  const scale = Math.min(settings.width / source.width, settings.height * .8 / source.height);
  foreground.style.width = `${source.width * scale / settings.width * 100}%`;
  foreground.style.height = `${source.height * scale / settings.height * 100}%`;
  foreground.src = image.src;
  wrapper.append(background, foreground);
  return wrapper;
}

/** Use exact native composition for static images and live playback for GIFs. */
export function refreshVisualPreview(settings: OutputSettings): void {
  const preview = document.getElementById("visual-preview-base");
  if (!preview || !selectedVisual || !originalImage) return;
  const key = `${sourceRevision}:${settings.width}x${settings.height}:${settings.fit}`;
  if (key === requestedKey) return;
  requestedKey = key;
  if (settings.fit !== "blurred") {
    pending = null;
    if (preview.firstElementChild !== originalImage) preview.replaceChildren(originalImage);
    return;
  }
  if (selectedVisual.format === "GIF") {
    pending = null;
    preview.replaceChildren(animatedBlurredPreview(originalImage, selectedVisual, settings));
    return;
  }
  preview.textContent = "合成プレビューを生成しています…";
  pending = { key, path: selectedVisual.path, width: settings.width, height: settings.height };
  void drainPreview(preview);
}

export function getSelectedVisual(): VisualSource | null {
  return selectedVisual;
}

export function initializeVisualSource(onChange: () => void = () => {}): (path?: string) => Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#select-visual");
  const name = document.querySelector<HTMLElement>("#visual-name");
  const details = document.querySelector<HTMLElement>("#visual-details");
  const status = document.querySelector<HTMLElement>("#visual-status");
  const preview = document.querySelector<HTMLElement>("#visual-preview-base");
  if (!button || !name || !details || !status || !preview) {
    throw new Error("Missing visual source elements");
  }

  button.disabled = false;
  const load = async (path?: string): Promise<void> => {
    if (button.disabled) return;
    button.disabled = true;
    onChange();
    status.textContent = "画像を確認しています…";
    try {
      const selection = (path === undefined ? await selectVisual() : await loadVisual(path));
      if (!selection) {
        status.textContent = "";
        return;
      }
      const { source, previewUrl } = selection;
      const image = new Image();
      image.alt = source.name;
      image.className = "preview-image";
      image.src = previewUrl;
      await image.decode();

      // Keep the previous valid selection until both metadata and preview succeed.
      preview.replaceChildren(image);
      originalImage = image;
      selectedVisual = source;
      sourceRevision += 1;
      requestedKey = "";
      pending = null;
      name.textContent = source.name;
      details.textContent = [
        source.format,
        `${source.width} × ${source.height} px`,
        `${(source.sizeBytes / 1024 / 1024).toFixed(2)} MiB`,
      ].join(" · ");
      status.textContent = "";
    } catch (error) {
      status.textContent = reportError("image", error);
    } finally {
      button.disabled = false;
      onChange();
    }
  };
  button.addEventListener("click", () => { void load(); });
  return load;
}
