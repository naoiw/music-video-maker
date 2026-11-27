import { selectVisual, type VisualSource } from "../services/visual";

let selectedVisual: VisualSource | null = null;

export function getSelectedVisual(): VisualSource | null {
  return selectedVisual;
}

export function initializeVisualSource(): void {
  const button = document.querySelector<HTMLButtonElement>("#select-visual");
  const name = document.querySelector<HTMLElement>("#visual-name");
  const details = document.querySelector<HTMLElement>("#visual-details");
  const status = document.querySelector<HTMLElement>("#visual-status");
  const preview = document.querySelector<HTMLElement>("#visual-preview");
  if (!button || !name || !details || !status || !preview) {
    throw new Error("Missing visual source elements");
  }

  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "画像を確認しています…";
    try {
      const selection = await selectVisual();
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
      selectedVisual = source;
      name.textContent = source.name;
      details.textContent = [
        source.format,
        `${source.width} × ${source.height} px`,
        `${(source.sizeBytes / 1024 / 1024).toFixed(2)} MiB`,
      ].join(" · ");
      status.textContent = "";
    } catch (error) {
      status.textContent = `読み込み失敗: ${String(error)}`;
    } finally {
      button.disabled = false;
    }
  });
}
