export const LIMITS = { audioBytes: 50 * 1024 * 1024, imageBytes: 32 * 1024 * 1024, pixels: 40_000_000, seconds: 300 } as const;
export type ImageKind = "png" | "jpeg" | "gif";
export type Fit = "contain" | "cover";
export type Resolution = "1280x720" | "1920x1080";

export function imageKind(bytes: Uint8Array): ImageKind {
  if ([137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  const magic = String.fromCharCode(...bytes.subarray(0,6));
  if (magic === "GIF87a" || magic === "GIF89a") return "gif";
  throw new Error("PNG・JPEG・GIFの画像を選択してください。");
}
export function assertInputs(audio: {name: string; size: number}, visual: {size: number}, duration: number, width: number, height: number): void {
  if (!/\.mp3$/i.test(audio.name) || audio.size <= 0 || audio.size > LIMITS.audioBytes) throw new Error("MP3は50 MiB以下にしてください。");
  if (visual.size <= 0 || visual.size > LIMITS.imageBytes) throw new Error("画像は32 MiB以下にしてください。");
  if (!Number.isFinite(duration) || duration <= 0 || duration > LIMITS.seconds) throw new Error("音声の長さは5分以下にしてください。");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > LIMITS.pixels) throw new Error("画像は4000万画素以下にしてください。");
}
export function encodeArgs(kind: ImageKind, resolution: Resolution, fit: Fit): string[] {
  if (!["png","jpeg","gif"].includes(kind)) throw new Error("Invalid image format");
  if (resolution !== "1280x720" && resolution !== "1920x1080") throw new Error("Invalid resolution");
  if (fit !== "contain" && fit !== "cover") throw new Error("Invalid image fit");
  const [w,h] = resolution.split("x");
  const image = "image." + kind;
  const layout = fit === "contain"
    ? "scale=" + w + ":" + h + ":force_original_aspect_ratio=decrease:force_divisible_by=2,pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    : "scale=" + w + ":" + h + ":force_original_aspect_ratio=increase:force_divisible_by=2,crop=" + w + ":" + h + ",setsar=1";
  const visual = kind === "gif"
    ? ["-stream_loop","-1","-ignore_loop","1","-f","gif"]
    : ["-framerate","30","-f","image2"];
  // Decode and resize a still once, then loop only the converted output frame.
  // GIF must retain its original sequence and timing; never use the still-frame loop.
  const vf = kind === "gif" ? layout + ",fps=30" : layout + ",format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)";
  return ["-protocol_whitelist","file,pipe", ...visual,"-i",image,
    "-protocol_whitelist","file,pipe","-f","mp3","-i","audio.mp3",
    "-map","0:v:0","-map","1:a:0","-vf",vf,"-r","30","-c:v","libx264",
    "-threads","1","-preset","ultrafast","-crf","20","-maxrate","6M","-bufsize","12M",
    "-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart",
    "-t",String(LIMITS.seconds),"-shortest","output.mp4"];
}
