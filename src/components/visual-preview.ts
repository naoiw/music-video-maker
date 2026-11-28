import { loadVisual, selectVisual, type VisualSource } from "../services/visual";

/** Share selection and decoding between base and overlay previews. */
export async function loadVisualPreview(className: string, path?: string): Promise<{
  source: VisualSource;
  image: HTMLImageElement;
} | null> {
  const selection = path === undefined ? await selectVisual() : await loadVisual(path);
  if (!selection) return null;
  const image = new Image();
  image.alt = selection.source.name;
  image.className = className;
  image.src = selection.previewUrl;
  await image.decode();
  return { source: selection.source, image };
}
