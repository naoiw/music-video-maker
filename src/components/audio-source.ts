import { selectAudio, type AudioSource } from "../services/audio";

let selectedAudio: AudioSource | null = null;

export function getSelectedAudio(): AudioSource | null {
  return selectedAudio;
}

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

export function initializeAudioSource(): void {
  const button = document.querySelector<HTMLButtonElement>("#select-audio");
  const name = document.querySelector<HTMLElement>("#audio-name");
  const details = document.querySelector<HTMLElement>("#audio-details");
  const status = document.querySelector<HTMLElement>("#audio-status");
  if (!button || !name || !details || !status) {
    throw new Error("Missing audio source elements");
  }

  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "MP3を確認しています…";

    try {
      const source = await selectAudio();
      if (!source) {
        status.textContent = "";
        return;
      }

      selectedAudio = source;
      name.textContent = source.name;
      const channels = source.channels === 1 ? "モノラル" :
        source.channels === 2 ? "ステレオ" : `${source.channels} ch`;
      details.textContent = [
        formatDuration(source.durationSeconds),
        `${source.sampleRate / 1000} kHz`,
        channels,
        ...(source.bitRate === null ? [] : [`${Math.round(source.bitRate / 1000)} kbps`]),
      ].join(" · ");
      status.textContent = "";
    } catch (error) {
      status.textContent = `読み込み失敗: ${String(error)}`;
    } finally {
      button.disabled = false;
    }
  });
}
