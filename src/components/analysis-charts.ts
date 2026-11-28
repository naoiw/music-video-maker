import { comparisonDuration, spectrumX, timeLabel, waveformScale, type AudioComparison } from "../services/analysis-data";

const LEFT = 47;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 24;

function surface(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= LEFT + RIGHT || height <= TOP + BOTTOM) return null;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  const style = getComputedStyle(canvas);
  const colors = {
    text: style.color,
    grid: style.borderTopColor,
    original: getComputedStyle(document.querySelector(".analysis-original")!).color,
    processed: getComputedStyle(document.querySelector(".analysis-processed")!).color,
  };
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  return { ctx, colors, width, height, plotWidth: width - LEFT - RIGHT, plotHeight: height - TOP - BOTTOM };
}

export function waveformFraction(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left - LEFT) / Math.max(1, rect.width - LEFT - RIGHT);
}

export function drawWaveform(canvas: HTMLCanvasElement, data: AudioComparison, position: number): void {
  const s = surface(canvas);
  if (!s) return;
  const { ctx, colors, plotWidth, plotHeight } = s;
  const duration = comparisonDuration(data);
  const scale = waveformScale(data);
  const rowHeight = plotHeight / 2;
  const tracks = [
    { track: data.original, label: "原音", color: colors.original },
    { track: data.processed, label: "加工音", color: colors.processed },
  ];
  for (const [index, { track, label, color }] of tracks.entries()) {
    const middle = TOP + (index + 0.5) * rowHeight;
    const amplitudeHeight = rowHeight * 0.43;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(label, 3, middle - 5);
    ctx.fillStyle = colors.text;
    ctx.fillText(`±${scale.toFixed(scale > 10 ? 0 : 1)}`, 3, middle + 10);
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(LEFT, middle);
    ctx.lineTo(LEFT + plotWidth, middle);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [i, bin] of track.waveform.entries()) {
      const start = i * track.framesPerBin / data.sampleRate;
      const end = Math.min(track.durationSeconds, start + track.framesPerBin / data.sampleRate);
      const x = LEFT + (start + end) / 2 / duration * plotWidth;
      ctx.moveTo(x, middle - bin.max / scale * amplitudeHeight);
      ctx.lineTo(x, middle - bin.min / scale * amplitudeHeight);
    }
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = colors.text;
  const divisions = plotWidth < 300 ? 3 : 4;
  for (let i = 0; i <= divisions; i++) {
    const x = LEFT + plotWidth * i / divisions;
    ctx.textAlign = i === 0 ? "left" : i === divisions ? "right" : "center";
    ctx.fillText(timeLabel(duration * i / divisions), x, TOP + plotHeight + 16);
  }
  const cursor = LEFT + Math.max(0, Math.min(1, position / duration)) * plotWidth;
  ctx.strokeStyle = colors.text;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cursor, TOP);
  ctx.lineTo(cursor, TOP + plotHeight);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawSpectrum(canvas: HTMLCanvasElement, data: AudioComparison): void {
  const s = surface(canvas);
  if (!s) return;
  const { ctx, colors, plotWidth, plotHeight } = s;
  const nyquist = data.sampleRate / 2;
  const upper = Math.max(0, Math.ceil(Math.max(...data.original.spectrumDb, ...data.processed.spectrumDb) / 20) * 20);
  const lower = -100;
  const x = (hz: number) => LEFT + spectrumX(hz, nyquist) * plotWidth;
  const y = (db: number) => TOP + (upper - Math.max(lower, Math.min(upper, db))) / (upper - lower) * plotHeight;
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "right";
  for (let db = upper; db >= lower; db -= 20) {
    ctx.beginPath();
    ctx.moveTo(LEFT, y(db));
    ctx.lineTo(LEFT + plotWidth, y(db));
    ctx.stroke();
    ctx.fillText(String(db), LEFT - 5, y(db) + 4);
  }
  ctx.textAlign = "center";
  const ticks = [20, 100, 1000, 10000].filter(hz => hz < nyquist);
  // Avoid overlapping the last decade label and Nyquist at low sample rates.
  if (ticks.length && x(nyquist) - x(ticks[ticks.length - 1]) < 44) ticks.pop();
  ticks.push(nyquist);
  for (const hz of ticks) {
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(x(hz), TOP);
    ctx.lineTo(x(hz), TOP + plotHeight);
    ctx.stroke();
    ctx.textAlign = hz === 20 ? "left" : hz === nyquist ? "right" : "center";
    ctx.fillText(hz >= 1000 ? `${Number((hz / 1000).toFixed(2))}k` : String(hz), x(hz), TOP + plotHeight + 16);
  }
  for (const [track, color] of [[data.original, colors.original], [data.processed, colors.processed]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (const [i, db] of track.spectrumDb.entries()) {
      const hz = i * data.sampleRate / data.fftSize;
      if (hz < 20 || hz > nyquist) continue;
      if (!started) ctx.moveTo(x(hz), y(db));
      else ctx.lineTo(x(hz), y(db));
      started = true;
    }
    ctx.stroke();
  }
}
