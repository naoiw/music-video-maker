import type { Encoder } from "./settings-schema.ts";

export const encoderLabels: Record<Encoder, string> = {
  cpu: "CPU (libx264)",
  auto: "GPU 自動選択",
  nvenc: "NVIDIA NVENC",
  qsv: "Intel Quick Sync",
  amf: "AMD AMF",
  videotoolbox: "Apple VideoToolbox",
};

export function qualityLabel(encoder: Encoder, quality: number): string {
  const tier = quality === 16 ? "高画質" : quality === 24 ? "容量優先" : "標準";
  return encoder === "cpu" ? `${tier} (CRF ${quality})` : tier;
}
