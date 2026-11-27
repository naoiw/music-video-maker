import "./styles.css";
import workerSource from "./encoder-worker.js?raw";
import { initializeAudioPreview } from "./audio-preview";
import { prepareLoopingGif } from "./gif-loop";
import { inspectImageDimensions, assertImageDimensions } from "./image-dimensions";
import { activeFilterNames, compileWebAudioFilters } from "./audio-filter-plan";
import { initializeWebAudioFilters } from "./audio-filter-panel";
import { settingsFields } from "../../src/services/settings-schema";
import { assertInputs, encodeArgs, imageKind, LIMITS, browserOutputDefaults, browserResolutions, type Resolution, type Fit } from "./encode-plan";

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing element: " + id);
  return element as T;
}
const audio = get<HTMLInputElement>("audio");
const visual = get<HTMLInputElement>("visual");
const resolution = get<HTMLSelectElement>("resolution");
const fit = get<HTMLSelectElement>("fit");
const fps = get<HTMLSelectElement>("fps");
const quality = get<HTMLSelectElement>("quality");
const settingsReset = get<HTMLButtonElement>("settings-reset");
const previewEmpty = get<HTMLElement>("preview-empty");
const encode = get<HTMLButtonElement>("encode");
const cancel = get<HTMLButtonElement>("cancel");
const progress = get<HTMLProgressElement>("progress");
const status = get<HTMLElement>("status");
const log = get<HTMLElement>("log");
const image = get<HTMLImageElement>("image-preview");
const preview = get<HTMLElement>("visual-preview");
const background = get<HTMLImageElement>("preview-background");
const output = get<HTMLVideoElement>("output");
const download = get<HTMLAnchorElement>("download");
let busy = false;
let sequence = 0;
let worker: Worker | null = null;
let imageURL = "";
let visualRevision = 0;
let validatedVisual: File | null = null;
let outputURL = "";
let lines: string[] = [];
const filters = initializeWebAudioFilters(() => { clearOutput(); audioPreview.invalidate("フィルタ設定を変更しました。再試聴できます。"); });
const audioPreview = initializeAudioPreview({file:()=>audio.files?.[0],values:filters.values,metadataDuration});

function setStatus(message: string, state = "busy") {
  status.textContent = message;
  status.dataset.state = state;
}
function refresh() {
  encode.disabled = busy || !audio.files?.length || !validatedVisual || visual.files?.[0] !== validatedVisual;
  cancel.disabled = !busy;
  for (const el of [audio,visual,resolution,fit,fps,quality,settingsReset]) el.disabled = busy;
  filters.setBusy(busy);
  audioPreview.setExportBusy(busy);
}
function clearOutput() {
  output.pause(); output.removeAttribute("src"); output.load(); output.hidden = true;
  download.hidden = true; download.removeAttribute("href");
  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = "";
}
function stop() {
  sequence++;
  worker?.terminate(); worker = null; busy = false; refresh();
}
function fail(message: string) {
  stop(); progress.value = 0; setStatus(message,"error");
}
function metadataDuration(file: File): Promise<number> {
  return new Promise((resolve,reject) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      el.onloadedmetadata = null; el.onerror = null;
      const duration = el.duration;
      el.removeAttribute("src"); el.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const timer = window.setTimeout(() => finish(new Error("音声の読み込みがタイムアウトしました。")),15000);
    el.onloadedmetadata = () => finish();
    el.onerror = () => finish(new Error("MP3の読み込みに失敗しました。"));
    el.preload = "metadata"; el.src = url;
  });
}
function refreshPreview() {
  const blurred = fit.value === "blurred";
  preview.dataset.fit = fit.value;
  preview.dataset.resolution = resolution.value;
  previewEmpty.hidden = Boolean(imageURL);
  background.hidden = !imageURL || !blurred;
  image.style.width = "";
  image.style.height = "";
  if (blurred && image.naturalWidth && image.naturalHeight) {
    const [w,h] = resolution.value.split("x").map(Number);
    const scale = Math.min(w/image.naturalWidth, h*.8/image.naturalHeight);
    image.style.width = (image.naturalWidth*scale/w*100) + "%";
    image.style.height = (image.naturalHeight*scale/h*100) + "%";
  }
}
image.addEventListener("load", refreshPreview);
fit.addEventListener("change", () => { clearOutput(); refreshPreview(); });
resolution.addEventListener("change", () => { clearOutput(); refreshPreview(); });
for (const el of [fps,quality]) el.addEventListener("change", clearOutput);
function resetOutputSettings() {
  resolution.value = browserOutputDefaults.resolution;
  fit.value = browserOutputDefaults.fit;
  fps.value = String(browserOutputDefaults.fps);
  quality.value = String(browserOutputDefaults.crf);
  refreshPreview();
}
settingsReset.addEventListener("click", () => { clearOutput(); resetOutputSettings(); });
// Guard the shared schema/HTML boundary against divergent options.
for (const [control,expected] of [[resolution,browserResolutions],[fit,settingsFields.fit.options],[fps,settingsFields.fps.options],[quality,settingsFields.quality.options]] as const) {
  if (Array.from(control.options, option => option.value).join(",") !== expected.join(",")) throw new Error("Output options do not match shared settings: " + control.id);
}
audio.addEventListener("change", () => { clearOutput(); audioPreview.refreshSource(); refresh(); });
async function refreshVisualSource() {
  const revision = ++visualRevision;
  validatedVisual = null;
  clearOutput();
  if (imageURL) URL.revokeObjectURL(imageURL);
  image.removeAttribute("src"); background.removeAttribute("src"); image.hidden = true; imageURL = "";
  previewEmpty.textContent = "画像が選択されていません";
  const file = visual.files?.[0];
  refreshPreview(); refresh();
  if (!file) return;
  previewEmpty.textContent = "画像を検証中…";
  try {
    if (file.size <= 0 || file.size > LIMITS.imageBytes) throw new Error("画像は32 MiB以下にしてください。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (revision !== visualRevision) return;
    const kind = imageKind(bytes);
    const dimensions = inspectImageDimensions(bytes,kind);
    // Also bound every GIF frame, not only the logical canvas, before decoding.
    if (kind === "gif") prepareLoopingGif(bytes);
    // Ignore the caller-provided MIME/extension. Decode only validated raster types.
    const raster = new Blob([bytes], {type:"image/"+kind});
    const bitmap = await createImageBitmap(raster);
    try {
      assertImageDimensions(bitmap.width,bitmap.height);
      // JPEG EXIF orientation may swap width and height.
      if (!((bitmap.width===dimensions.width && bitmap.height===dimensions.height) ||
            (kind==="jpeg" && bitmap.width===dimensions.height && bitmap.height===dimensions.width)))
        throw new Error("画像ヘッダーとデコード結果の寸法が一致しません。");
    } finally { bitmap.close(); }
    if (revision !== visualRevision) return;
    imageURL = URL.createObjectURL(raster);
    background.src = imageURL; image.src = imageURL; image.hidden = false;
    validatedVisual = file;
    setStatus("画像を読み込みました。","idle");
  } catch (error) {
    if (revision !== visualRevision) return;
    const message=error instanceof Error?error.message:String(error);
    previewEmpty.textContent=message;
    setStatus(message,"error");
  } finally {
    if (revision === visualRevision) { refreshPreview(); refresh(); }
  }
}
visual.addEventListener("change", () => { void refreshVisualSource(); });
cancel.addEventListener("click", () => { stop(); progress.value = 0; setStatus("中断しました。再実行できます。","cancelled"); });
encode.addEventListener("click", async () => {
  const a = audio.files?.[0], v = visual.files?.[0];
  if (busy || !a || !v || v !== validatedVisual) return;
  const job = ++sequence;
  clearOutput(); audioPreview.invalidate("動画生成のため試聴を停止しました。"); busy = true; refresh(); progress.value = 0; lines = []; log.textContent = "";
  setStatus("素材を検証中…");
  try {
    if (!/\.mp3$/i.test(a.name) || a.size <= 0 || a.size > LIMITS.audioBytes || v.size <= 0 || v.size > LIMITS.imageBytes)
      throw new Error("MP3は50 MiB、画像は32 MiB以下にしてください。");
    const filterSettings = filters.values();
    const useFilters = activeFilterNames(filterSettings).length > 0;
    const duration = await metadataDuration(a);
    if (job !== sequence) return;
    const manifestURL = new URL(import.meta.env.BASE_URL + "core-manifest.json",location.origin);
    const response = await fetch(manifestURL,{cache:"no-store",credentials:"same-origin"});
    if (!response.ok) throw new Error("処理エンジンの検証情報がありません。web:prepareを実行してください。");
    const manifest: unknown = await response.json();
    const [audioBytes,originalVisualBytes] = await Promise.all([a.arrayBuffer(),v.arrayBuffer()]);
    if (job !== sequence) return;
    const visualData = new Uint8Array(originalVisualBytes);
    const kind = imageKind(visualData);
    const {width,height} = inspectImageDimensions(visualData,kind);
    assertInputs(a,v,duration,width,height);
    const preparedGif = kind === "gif" ? prepareLoopingGif(visualData) : null;
    const visualBytes = preparedGif?.bytes.buffer ?? originalVisualBytes;
    const args = encodeArgs(kind,resolution.value as Resolution,fit.value as Fit,preparedGif?.frameDelays,Number(fps.value),Number(quality.value));
    if (job !== sequence) return;
    const workerURL = URL.createObjectURL(new Blob([workerSource],{type:"text/javascript"}));
    try { worker = new Worker(workerURL); } finally { URL.revokeObjectURL(workerURL); }
    worker.onerror = (event) => { if (job === sequence) fail(event.message || "Workerの実行に失敗しました。"); };
    worker.onmessage = ({data}) => {
      if (job !== sequence) return;
      if (data.type === "probe") {
        try {
          const graph = compileWebAudioFilters(filterSettings, Number(data.sampleRate));
          if (!graph || !worker) throw new Error("音声フィルタの設定を取得できません。");
          worker.postMessage({type:"filterGraph",graph});
        } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      }
      if (data.type === "status") setStatus(data.message);
      if (data.type === "progress") progress.value = data.value;
      if (data.type === "log") { lines.push(data.message); if (lines.length > 30) lines.shift(); log.textContent = lines.join("\n"); }
      if (data.type === "error") fail(data.message);
      if (data.type === "done") {
        outputURL = URL.createObjectURL(new Blob([data.bytes],{type:"video/mp4"}));
        output.src = outputURL; output.hidden = false;
        download.href = outputURL; download.hidden = false;
        download.download = a.name.replace(/\.mp3$/i,"") + ".mp4";
        stop(); progress.value = 100;
        setStatus("生成完了（エンコード " + Number(data.encodeSeconds).toFixed(1) + " 秒）","done");
      }
    };
    worker.postMessage({manifest,audio:audioBytes,visual:visualBytes,kind,args,duration,useFilters},[audioBytes,visualBytes]);
  } catch (error) {
    if (job === sequence) fail(error instanceof Error ? error.message : String(error));
  }
});
window.addEventListener("pagehide", () => {
  visualRevision++;
  validatedVisual = null;
  audioPreview.invalidate("試聴を停止しました。");
  clearOutput();
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = "";
  image.removeAttribute("src"); background.removeAttribute("src"); image.hidden = true;
  stop();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    audioPreview.refreshSource();
    void refreshVisualSource();
  }
});
resetOutputSettings();
refresh();
