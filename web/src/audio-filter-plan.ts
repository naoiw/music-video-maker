import { validateFilterSettings, type FilterSettings } from "../../src/services/preset-schema.ts";

/** Mirrors the desktop's ordered FFmpeg filters, using the shared UI bounds.
 * No user-provided FFmpeg syntax is accepted. Disabled values do not produce filters.
 */
export function compileWebAudioFilters(raw: unknown, sampleRate: number): string | null {
  const f = validateFilterSettings(raw);
  if (!f) throw new Error("音声フィルタの設定値を確認してください。");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000)
    throw new Error("非対応のMP3サンプリング周波数です。");
  const hz = (id: "highpass-hz" | "lowpass-hz" | "eq-hz") => {
    const value = Number(f[id]);
    if (value >= sampleRate / 2) throw new Error("周波数は音声のナイキスト周波数未満にしてください。");
    return value;
  };
  const chain: string[] = [];
  if (f["noise-enabled"]) chain.push("afftdn=nr="+f["noise-reduction"]+":nf="+f["noise-floor"]);
  if (f["highpass-enabled"]) chain.push("highpass=f="+hz("highpass-hz"));
  if (f["lowpass-enabled"]) chain.push("lowpass=f="+hz("lowpass-hz"));
  if (f["eq-enabled"]) chain.push("equalizer=f="+hz("eq-hz")+":t=q:w="+f["eq-q"]+":g="+f["eq-gain"]);
  if (f["gain-enabled"]) chain.push("volume="+f["volume-gain"]+"dB");
  if (f["loudness-enabled"]) chain.push("loudnorm=I="+f["loudness-target"]+":LRA=11:TP="+f["loudness-peak"]+":linear=false,aresample="+sampleRate);
  if (f["limiter-enabled"]) chain.push("alimiter=limit="+10**(Number(f["limiter-ceiling"])/20)+":attack=5:release=50:level=false:latency=true");
  return chain.length ? chain.join(",") : null;
}

export const filterGroups = [
  { enabled: "noise-enabled", parameters: "noise-parameters", fields: ["noise-reduction","noise-floor"], reset: "noise-reset", label: "ノイズ除去" },
  { enabled: "highpass-enabled", parameters: "highpass-parameters", fields: ["highpass-hz"], reset: "frequency-reset", label: "HPF" },
  { enabled: "lowpass-enabled", parameters: "lowpass-parameters", fields: ["lowpass-hz"], reset: "frequency-reset", label: "LPF" },
  { enabled: "eq-enabled", parameters: "eq-parameters", fields: ["eq-hz","eq-q","eq-gain"], reset: "frequency-reset", label: "EQ" },
  { enabled: "gain-enabled", parameters: "gain-parameters", fields: ["volume-gain"], reset: "volume-reset", label: "ゲイン" },
  { enabled: "loudness-enabled", parameters: "loudness-parameters", fields: ["loudness-target","loudness-peak"], reset: "volume-reset", label: "ラウドネス" },
  { enabled: "limiter-enabled", parameters: "limiter-parameters", fields: ["limiter-ceiling"], reset: "volume-reset", label: "リミッター" },
] as const;

export function activeFilterNames(settings: FilterSettings): string[] {
  return filterGroups.filter(group => settings[group.enabled] === true).map(group => group.label);
}
