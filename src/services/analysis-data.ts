export interface Envelope {
  min: number;
  max: number;
}

export interface AnalysisTrack {
  durationSeconds: number;
  framesPerBin: number;
  waveform: Envelope[];
  peak: number;
  rms: number;
  overRangeSamples: number;
  spectrumDb: number[];
}

export interface AudioComparison {
  sampleRate: number;
  channels: number;
  fftSize: number;
  original: AnalysisTrack;
  processed: AnalysisTrack;
}

export function timeLabel(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function dbLabel(amplitude: number): string {
  return amplitude === 0 ? "−∞ dBFS" : `${(20 * Math.log10(amplitude)).toFixed(1)} dBFS`;
}

export function comparisonDuration(data: AudioComparison): number {
  return Math.max(data.original.durationSeconds, data.processed.durationSeconds);
}

export function waveformScale(data: AudioComparison): number {
  return Math.max(1, data.original.peak, data.processed.peak);
}

export function spectrumX(hz: number, nyquist: number): number {
  return Math.log(hz / 20) / Math.log(nyquist / 20);
}

export function seekValue(fraction: number, duration: number, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(Math.max(0, Math.min(1, fraction)) * duration)));
}
