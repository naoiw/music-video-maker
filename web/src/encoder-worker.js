/* Dedicated classic worker; no third-party core is stored in this repository. */
const BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/";
const HEX = /^[a-f0-9]{64}$/;
const notify = (type, data = {}) => self.postMessage({type, ...data});
async function verified(name, expected, mime, maxBytes) {
  if (!HEX.test(expected)) throw new Error("Missing approved digest: " + name);
  const response = await fetch(BASE + name, {credentials:"omit", redirect:"error", referrerPolicy:"no-referrer"});
  if (!response.ok) throw new Error("Engine download failed: " + name + " (" + response.status + ")");
  const data = await response.arrayBuffer();
  if (!data.byteLength || data.byteLength > maxBytes) throw new Error("Invalid engine size: " + name);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)), b=>b.toString(16).padStart(2,"0")).join("");
  if (digest !== expected) throw new Error("Engine integrity mismatch: " + name);
  return URL.createObjectURL(new Blob([data], {type:mime}));
}
self.onmessage = async ({data}) => {
  self.onmessage = null; // one job per worker; terminate releases WASM and its virtual FS
  let jsURL, wasmURL;
  try {
    const {manifest, audio, visual, kind, args, duration} = data;
    if (manifest.version !== "0.12.10") throw new Error("Unsupported engine version");
    notify("status",{message:"処理エンジンを取得・検証中…"});
    jsURL = await verified("ffmpeg-core.js",manifest.coreJsSha256,"text/javascript",2*1024*1024);
    wasmURL = await verified("ffmpeg-core.wasm",manifest.coreWasmSha256,"application/wasm",40*1024*1024);
    importScripts(jsURL);
    const core = await self.createFFmpegCore({
      mainScriptUrlOrBlob: jsURL + "#" + btoa(JSON.stringify({wasmURL,workerURL:""}))
    });
    core.setLogger(({message}) => notify("log",{message:String(message).slice(0,500)}));
    core.setProgress(({time}) => {
      if (Number.isFinite(time) && duration > 0) notify("progress",{value:Math.max(0,Math.min(99,100*time/1e6/duration))});
    });
    core.FS.writeFile("audio.mp3",new Uint8Array(audio));
    core.FS.writeFile("image."+kind,new Uint8Array(visual));
    notify("status",{message:"動画を生成中…"});
    const started = performance.now();
    const result = core.exec(...args);
    core.reset();
    if (result !== 0) throw new Error("FFmpeg exit code " + result);
    const output = core.FS.readFile("output.mp4");
    if (!output.byteLength) throw new Error("FFmpeg returned empty output");
    const bytes = output.slice().buffer;
    self.postMessage({type:"done",bytes,encodeSeconds:(performance.now()-started)/1000},[bytes]);
  } catch (e) {
    notify("error",{message:e instanceof Error ? e.message : String(e)});
  } finally {
    if (jsURL) URL.revokeObjectURL(jsURL);
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
};
