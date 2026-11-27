import { gifTimelineFilter } from "./gif-loop.ts";
import { MAX_IMAGE_PIXELS, assertImageDimensions } from "./image-dimensions.ts";
import { settingsFields, browserResolutions, parseOutputSettings, type Fit, type BrowserResolution } from "../../src/services/settings-schema.ts";

export const LIMITS = { audioBytes: 50 * 1024 * 1024, imageBytes: 32 * 1024 * 1024, pixels: MAX_IMAGE_PIXELS, seconds: 300 } as const;
export type ImageKind = "png" | "jpeg" | "gif";
export { browserResolutions, type Fit };
export type Resolution = BrowserResolution;
export const browserOutputDefaults = {
  resolution: browserResolutions[0],
  fps: Number(settingsFields.fps.initial),
  fit: settingsFields.fit.initial,
  crf: Number(settingsFields.quality.initial),
} as const;

export function validateOutputOptions(resolution: string, fit: string, fps: number, crf: number): void {
  if (!parseOutputSettings({resolution,fit,fps:String(fps),quality:String(crf)}, "browser"))
    throw new Error("非対応の出力設定です（解像度・配置・フレームレート・品質を確認してください）。");
}

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
  assertImageDimensions(width,height);
}
// Match the desktop animated layout: black alpha composite, cropped background
// blurred at quarter resolution, sharp foreground contained within 80% height.
function blurredLayout(w: number, h: number): string {
  const sigma = Math.min(w,h) * 0.02 / 4;
  return "format=gbrap,premultiply=inplace=1,format=rgb24,split=2[bg][fg];"
    + "[bg]crop=w='max(1,min(iw,ih*" + w + "/" + h + "))':h='max(1,min(ih,iw*" + h + "/" + w + "))':exact=1,"
    + "scale=" + w/4 + ":" + h/4 + ",gblur=sigma=" + sigma + ",scale=" + w + ":" + h + ":out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1[back];"
    + "[fg]scale=" + w + ":" + Math.floor(h*4/5) + ":force_original_aspect_ratio=decrease:force_divisible_by=2:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1[front];"
    + "[back][front]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1";
}

export function encodeArgs(kind: ImageKind, resolution: Resolution, fit: Fit, gifDelays: readonly number[] = [], fps = browserOutputDefaults.fps, crf = browserOutputDefaults.crf): string[] {
  if (!["png","jpeg","gif"].includes(kind)) throw new Error("Invalid image format");
  validateOutputOptions(resolution, fit, fps, crf);
  const [w,h] = resolution.split("x");
  const image = "image." + kind;
  const layout = fit === "blurred" ? blurredLayout(Number(w), Number(h)) : fit === "contain"
    ? "scale=" + w + ":" + h + ":force_original_aspect_ratio=decrease:force_divisible_by=2,pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    : "scale=" + w + ":" + h + ":force_original_aspect_ratio=increase:force_divisible_by=2,crop=" + w + ":" + h + ",setsar=1";
  const visual = kind === "gif"
    ? ["-ignore_loop","0","-f","gif"]
    : ["-framerate",String(fps),"-f","image2"];
  // Decode and resize a still once, then loop only the converted output frame.
  // GIF must retain its original sequence and timing; never use the still-frame loop.
  const vf = kind === "gif"
    ? fit === "blurred"
      // Correct PTS before framesync (overlay); resample only after composition.
      ? gifTimelineFilter(gifDelays, false, fps) + "," + layout + ",fps=" + fps
      : layout + "," + gifTimelineFilter(gifDelays, true, fps)
    : layout + ",format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/(" + fps + "*TB)";
  return ["-protocol_whitelist","file,pipe", ...visual,"-i",image,
    "-protocol_whitelist","file,pipe","-f","mp3","-i","audio.mp3",
    "-map","0:v:0","-map","1:a:0","-vf",vf,"-r",String(fps),"-c:v","libx264",
    "-threads","1","-preset","ultrafast","-crf",String(crf),"-maxrate","6M","-bufsize","12M",
    "-pix_fmt","yuv420p", ...(fit === "blurred" ? ["-colorspace","bt709","-color_range","tv"] : []), "-c:a","aac","-b:a","192k","-movflags","+faststart",
    "-t",String(LIMITS.seconds),"-shortest","output.mp4"];
}
