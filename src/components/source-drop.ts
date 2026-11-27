import { getCurrentWebview } from "@tauri-apps/api/webview";
import { classifyDroppedSources } from "../services/source-drop";

type LoadSource = (path: string) => Promise<void>;

export async function initializeSourceDrop(
  loadAudio: LoadSource | null,
  loadVisual: LoadSource,
): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[aria-labelledby="source-title"]');
  const hint = document.querySelector<HTMLElement>("#source-drop-hint");
  const status = document.querySelector<HTMLElement>("#source-drop-status");
  const audioButton = document.querySelector<HTMLButtonElement>("#select-audio");
  const visualButton = document.querySelector<HTMLButtonElement>("#select-visual");
  if (!panel || !hint || !status || !audioButton || !visualButton) {
    throw new Error("Missing source drop elements");
  }

  let loading = false;
  async function accept(paths: readonly string[]): Promise<void> {
    try {
      const sources = classifyDroppedSources(paths);
      if (loading || (audioButton!.disabled && visualButton!.disabled)) {
        throw new Error("処理中は素材を変更できません。");
      }
      if (sources.audio && !loadAudio) throw new Error("MP3の読み込みにはFFprobeが必要です。");
      if ((sources.audio && audioButton!.disabled) || (sources.visual && visualButton!.disabled)) {
        throw new Error("処理中は素材を変更できません。");
      }
      status!.textContent = "";
      loading = true;
      try {
        // Both loaders synchronously disable their buttons before awaiting IPC.
        // Existing validation and per-source error displays are shared with dialogs.
        await Promise.all([
          sources.audio && loadAudio ? loadAudio(sources.audio) : undefined,
          sources.visual ? loadVisual(sources.visual) : undefined,
        ]);
      } finally {
        loading = false;
      }
    } catch (error) {
      status!.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter") {
      panel.dataset.dropActive = "true";
    } else if (payload.type === "leave" || payload.type === "drop") {
      delete panel.dataset.dropActive;
      if (payload.type === "drop") void accept(payload.paths);
    }
  });
  hint.hidden = false;
  window.addEventListener("pagehide", unlisten, { once: true });
}
