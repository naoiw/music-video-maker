import { visualizerLabels, type VisualizerConfig } from "../services/layers";

/** A static placement guide, not a sample of the user's audio. */
export function drawVisualizerGuide(canvas: HTMLCanvasElement, config: VisualizerConfig): void {
  canvas.width = 640;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!config.transparent) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 640, 180);
  }
  ctx.fillStyle = config.color;
  ctx.strokeStyle = config.color;
  if (config.style === "frequency") {
    for (let i = 0; i < 64; i++) {
      const h = 12 + 120 * Math.exp(-i / 38) * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7)));
      ctx.fillRect(i * 10 + 1, 180 - h, 8, h);
    }
  } else if (config.style === "waveform") {
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 640; i++) {
      const y = 90 + 60 * Math.sin(i * 0.11) * Math.abs(Math.sin(i * 0.021));
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
  } else if (config.style === "volume") {
    ctx.fillRect(0, 12, 480, 66);
    ctx.fillRect(0, 102, 384, 66);
  } else {
    const colors = ["#120d31", "#5b167e", "#b73779", "#f68a57", "#fcfdbf"];
    for (let x = 0; x < 80; x++) for (let y = 0; y < 30; y++) {
      const intensity = Math.abs(Math.sin(x * 0.23 + y * 0.7) * Math.cos(x * 0.1 - y * 0.3)) * (0.2 + 0.8 * y / 30);
      if (intensity < 0.08 && config.transparent) continue;
      ctx.fillStyle = colors[Math.min(4, Math.floor(intensity * 5))];
      ctx.fillRect(x * 8, y * 6, 8, 6);
    }
  }
  // The guide label is accessible but never encoded into the video.
  canvas.setAttribute("aria-label", `${visualizerLabels[config.style]}の配置イメージ（実音声ではありません）`);
}
