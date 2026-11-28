import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { droppedPath, isDropTarget, type DropTarget } from "../services/source-drop";

type LoadSource = (path: string) => Promise<void>;

export async function initializeSourceDrop(
  loadAudio: LoadSource | null,
  loadVisual: LoadSource,
  loadOverlay: LoadSource,
): Promise<void> {
  const hint = document.querySelector<HTMLElement>("#source-drop-hint");
  const status = document.querySelector<HTMLElement>("#source-drop-status");
  if (!hint || !status) throw new Error("Missing source drop elements");
  const zones = Array.from(document.querySelectorAll<HTMLElement>("[data-drop-target]"));
  const nativeWindow = getCurrentWindow();
  const loaders: Record<DropTarget, LoadSource | null> = {
    audio: loadAudio, visual: loadVisual, overlay: loadOverlay,
  };
  let scale = await nativeWindow.scaleFactor();
  let loading = false;

  function zoneAt(position: { x: number; y: number }): HTMLElement | null {
    const hit = document.elementFromPoint(position.x / scale, position.y / scale);
    return hit?.closest<HTMLElement>("[data-drop-target]") ?? null;
  }

  function highlight(zone: HTMLElement | null): void {
    for (const item of zones) {
      if (item === zone) item.dataset.dropActive = "true";
      else delete item.dataset.dropActive;
    }
  }

  async function accept(paths: readonly string[], zone: HTMLElement | null): Promise<void> {
    try {
      const target = zone?.dataset.dropTarget;
      if (!isDropTarget(target)) throw new Error("音声・ベース映像素材・追加レイヤーのエリアにドロップしてください。");
      const loader = loaders[target];
      const button = zone?.querySelector("button");
      if (loading || !loader || !button || button.matches(":disabled")) {
        throw new Error("現在このエリアに素材を追加できません。");
      }
      const path = droppedPath(paths);
      status!.textContent = "";
      loading = true;
      try { await loader(path); } finally { loading = false; }
    } catch (error) {
      status!.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const unlistenScale = await nativeWindow.onScaleChanged(({ payload }) => { scale = payload.scaleFactor; });
  const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter" || payload.type === "over") {
      highlight(zoneAt(payload.position));
    } else if (payload.type === "drop") {
      highlight(null);
      void accept(payload.paths, zoneAt(payload.position));
    } else {
      highlight(null);
    }
  });
  hint.hidden = false;
  window.addEventListener("pagehide", () => {
    unlisten();
    unlistenScale();
  }, { once: true });
}
