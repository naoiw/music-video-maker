import { reportError } from "./diagnostics";
import { getSelectedAudio } from "./audio-source";
import { getFilterChain } from "./audio-filters";
import { renderAudioPreview } from "../services/audio-preview";

type Mode = "original" | "processed";

function element<T extends HTMLElement>(id: string): T {
  const node = document.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing preview element: ${id}`);
  return node;
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function initializeAudioPreview(available: boolean): () => void {
  const player = element<HTMLAudioElement>("audio-preview");
  const start = element<HTMLInputElement>("preview-start");
  const range = element<HTMLOutputElement>("preview-range");
  const original = element<HTMLButtonElement>("preview-original");
  const processed = element<HTMLButtonElement>("preview-processed");
  const status = element<HTMLElement>("audio-preview-status");
  const filterPanel = element<HTMLElement>("filter-title").parentElement;
  const sourceButton = element<HTMLButtonElement>("select-audio");
  const cache = new Map<Mode, string>();
  let sourcePath: string | null = null;
  let generation = 0;
  let busy = false;
  let mode: Mode | null = null;
  let switchPosition = 0;

  function updateControls(): void {
    const audio = getSelectedAudio();
    const ready = available && !!audio && !sourceButton.disabled;
    start.disabled = !ready || busy;
    original.disabled = !ready || busy;
    processed.disabled = !ready || busy;
    const offset = start.valueAsNumber;
    range.value = audio
      ? `${formatTime(offset)} ～ ${formatTime(Math.min(offset + 30, audio.durationSeconds))}`
      : "未選択";
    original.setAttribute("aria-pressed", String(mode === "original"));
    processed.setAttribute("aria-pressed", String(mode === "processed"));
  }

  function invalidate(message: string): void {
    generation += 1;
    player.pause();
    player.onloadedmetadata = null;
    player.removeAttribute("src");
    player.load();
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    mode = null;
    switchPosition = 0;
    status.textContent = message;
    updateControls();
  }

  function refreshSource(): void {
    const audio = getSelectedAudio();
    if (audio?.path !== sourcePath || sourceButton.disabled) {
      const changed = audio?.path !== sourcePath;
      sourcePath = audio?.path ?? null;
      if (changed) start.value = "0";
      start.max = String(Math.max(0, Math.floor((audio?.durationSeconds ?? 0) - 0.1)));
      invalidate(audio ? "試聴する音声を選択してください。" : "MP3を選択してください。");
    } else {
      updateControls();
    }
  }

  start.addEventListener("input", () => invalidate("試聴区間を変更しました。"));
  filterPanel?.addEventListener("input", () => invalidate("フィルタ設定を変更しました。再試聴できます。"));
  filterPanel?.addEventListener("change", () => invalidate("フィルタ設定を変更しました。再試聴できます。"));
  filterPanel?.addEventListener("click", event => {
    if (event.target instanceof HTMLButtonElement && event.target.id.endsWith("-reset")) {
      invalidate("フィルタ設定を変更しました。再試聴できます。");
    }
  });

  async function play(next: Mode): Promise<void> {
    const audio = getSelectedAudio();
    if (!available || !audio || busy || sourceButton.disabled) return;
    if (mode === next && player.src) {
      if (player.paused) {
        try { await player.play(); } catch { status.textContent = "再生ボタンから試聴してください。"; }
      }
      return;
    }
    const current = ++generation;
    switchPosition = mode && !player.ended ? player.currentTime : 0;
    player.pause();
    busy = true;
    updateControls();
    const label = next === "original" ? "原音" : "加工音";
    status.textContent = `${label}の試聴データを準備しています…`;
    try {
      let url = cache.get(next);
      if (!url) {
        const chain = next === "processed" ? getFilterChain() : [];
        url = await renderAudioPreview(audio.path, start.valueAsNumber, chain);
        if (current !== generation) {
          URL.revokeObjectURL(url);
          return;
        }
        cache.set(next, url);
      }
      if (current !== generation) return;
      mode = next;
      player.onloadedmetadata = () => {
        if (current !== generation) return;
        player.currentTime = Math.min(switchPosition, Math.max(0, player.duration - 0.05));
        status.textContent = `${label} · 同じ区間で比較できます。`;
        void player.play().catch(() => {
          if (current === generation) status.textContent = `${label} · 再生ボタンから試聴してください。`;
        });
      };
      player.src = url;
      player.load();
    } catch (error) {
      if (current === generation) {
        const message = reportError("preview", error);
        invalidate(message);
      }
    } finally {
      busy = false;
      updateControls();
    }
  }

  player.addEventListener("error", () => {
    if (player.hasAttribute("src")) {
      const message = reportError("preview", player.error?.message || "試聴データの再生に失敗しました。");
      invalidate(message);
    }
  });
  original.addEventListener("click", () => { void play("original"); });
  processed.addEventListener("click", () => { void play("processed"); });
  window.addEventListener("pagehide", () => {
    generation += 1;
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
  });
  refreshSource();
  return refreshSource;
}
