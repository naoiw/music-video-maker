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
function probe(core, file, format, entries) {
  const result = core.ffprobe("-v","error","-protocol_whitelist","file,pipe","-f",format,
    "-show_entries",entries,"-of","json","-o","probe.json",file);
  core.reset();
  if (result !== 0) throw new Error("FFprobe exit code "+result+" ("+file+")");
  const info = JSON.parse(core.FS.readFile("probe.json",{encoding:"utf8"}));
  core.FS.unlink("probe.json");
  return info;
}
function audioInfo(core,file,format) {
  const info = probe(core,file,format,"stream=codec_type,sample_rate,channels:format=duration");
  const stream = info.streams?.find(s=>s.codec_type==="audio");
  const sampleRate = Number(stream?.sample_rate), channels = Number(stream?.channels), duration = Number(info.format?.duration);
  if (!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>48000||![1,2].includes(channels)||
      !Number.isFinite(duration)||duration<=0||duration>300.2)
    throw new Error("非対応の音声情報です（8～48kHz、モノラル/ステレオ、5分以下）。");
  return {sampleRate,channels,duration};
}
function requestGraph(sampleRate) {
  return new Promise((resolve,reject)=>{
    self.onmessage=({data})=>{
      self.onmessage=null;
      if(data?.type!=="filterGraph"||typeof data.graph!=="string"||!data.graph.length||data.graph.length>2048)
        reject(new Error("Invalid audio filter plan"));
      else resolve(data.graph);
    };
    notify("probe",{sampleRate});
  });
}
function filteredVideoArgs(args,duration) {
  const updated=[...args];
  const input=updated.indexOf("audio.mp3"),limit=updated.indexOf("-t"),shortest=updated.indexOf("-shortest");
  if(input<3||updated[input-1]!=="-i"||updated[input-2]!=="mp3"||updated[input-3]!=="-f"||limit<0||shortest<0)
    throw new Error("Invalid video plan");
  updated[input-2]="wav";
  updated[input]="filtered.wav";
  updated[limit+1]=duration.toFixed(6);
  updated.splice(shortest,1);
  return updated;
}
self.onmessage = async ({data}) => {
  self.onmessage = null; // one job per worker; terminate releases WASM and its virtual FS
  let jsURL, wasmURL;
  try {
    const {manifest, audio, visual, kind, args, duration, useFilters} = data;
    let videoArgs=args, mediaDuration=duration, filtering=false;
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
      if (Number.isFinite(time) && mediaDuration > 0) {
        const fraction=Math.max(0,Math.min(1,time/1e6/mediaDuration));
        const value=useFilters?(filtering?20*fraction:20+79*fraction):99*fraction;
        notify("progress",{value});
      }
    });
    core.FS.writeFile("audio.mp3",new Uint8Array(audio));
    const started = performance.now();
    if(useFilters){
      notify("status",{message:"音声情報を検証中…"});
      const source=audioInfo(core,"audio.mp3","mp3");
      const graph=await requestGraph(source.sampleRate);
      filtering=true;
      mediaDuration=source.duration;
      notify("status",{message:"音声フィルタを適用中…"});
      const result=core.exec("-protocol_whitelist","file,pipe","-f","mp3","-i","audio.mp3","-map","0:a:0","-vn",
        "-af",graph,"-c:a","pcm_f32le","-t","300","-f","wav","filtered.wav");
      core.reset();
      if(result!==0)throw new Error("音声フィルタ処理に失敗しました: FFmpeg exit code "+result);
      const processed=audioInfo(core,"filtered.wav","wav");
      if(processed.sampleRate!==source.sampleRate||processed.channels!==source.channels||
         processed.duration>300||Math.abs(processed.duration-source.duration)>0.2)
        throw new Error("加工音の形式または再生時間が元音声と一致しません。");
      core.FS.unlink("audio.mp3");
      videoArgs=filteredVideoArgs(args,processed.duration);
      mediaDuration=processed.duration;
      filtering=false;
      notify("progress",{value:20});
    }
    core.FS.writeFile("image."+kind,new Uint8Array(visual));
    notify("status",{message:"動画を生成中…"});
    const result = core.exec(...videoArgs);
    core.reset();
    if (result !== 0) throw new Error("FFmpeg exit code " + result);
    if(useFilters){
      notify("status",{message:"出力時間を検証中…"});
      const info=probe(core,"output.mp4","mov","stream=codec_type,duration:format=duration");
      const v=Number(info.streams?.find(s=>s.codec_type==="video")?.duration);
      const a=Number(info.streams?.find(s=>s.codec_type==="audio")?.duration);
      const total=Number(info.format?.duration);
      if([v,a,total].some(t=>!Number.isFinite(t)||t<=0||Math.abs(t-mediaDuration)>0.2)||Math.abs(v-a)>0.2)
        throw new Error("生成動画の映像と音声の長さが一致しません。");
      core.FS.unlink("filtered.wav");
    }
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
