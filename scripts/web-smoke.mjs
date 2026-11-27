// Real browser smoke test: use installed Chrome and FFmpeg; no npm test dependencies.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, appendFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { cpus, totalmem } from "node:os";
const benchmark = process.argv.includes("--benchmark");
const cases = benchmark
  ? [{ext:"png",seconds:180,width:1920,height:1080,fit:"contain"},{ext:"jpg",seconds:295,width:1920,height:1080,fit:"contain"},{ext:"png",seconds:180,width:1920,height:1080,fit:"blurred"}]
  : [...["png","jpg","gif","variable.gif"].flatMap(ext=>["blurred","contain","cover"].map(fit=>({ext,seconds:1.5,width:1280,height:720,fit}))),{ext:"variable.gif",seconds:12,width:1920,height:1080,fit:"blurred"},
    {ext:"png",seconds:1.5,width:1080,height:1080,fit:"blurred",fps:24,crf:24},
    {ext:"variable.gif",seconds:1.5,width:1080,height:1920,fit:"blurred",fps:60,crf:16},
    {ext:"png",seconds:1.5,width:1280,height:720,fit:"contain",filters:"gain"},
    {ext:"png",seconds:6,width:1280,height:720,fit:"contain",filters:"all"}];
const results = [];
const tmp = await mkdtemp(join(tmpdir(),"mvm-web-smoke-"));
const base = "http://127.0.0.1:4173/music-video-maker/";
const run = (cmd,args) => execFileSync(cmd,args,{stdio:["ignore","pipe","pipe"],timeout:120000,maxBuffer:16*1024*1024});
let chrome, server, ws;
async function wait(fn, ms=30000) {
  const until = Date.now()+ms;
  let last;
  while(Date.now()<until){try{const x=await fn();if(x)return x;}catch(e){last=e;}await sleep(300);}
  throw new Error("Timed out: "+(last??"condition false"));
}
try {
  for(const seconds of new Set([...cases.map(c=>c.seconds),...(benchmark?[]:[35])])){
    const source = benchmark ? "aevalsrc=0.20*sin(2*PI*220*t)+0.10*sin(2*PI*440*t)+0.06*sin(2*PI*659*t)|0.20*sin(2*PI*220*t)+0.10*sin(2*PI*442*t)+0.06*sin(2*PI*659*t):s=44100:d="+seconds : "sine=frequency=440:duration="+seconds;
    run("ffmpeg",["-y","-f","lavfi","-i",source,"-c:a","libmp3lame","-b:a","192k",join(tmp,"audio-"+seconds+".mp3")]);
  }
  run("ffmpeg",["-y","-f","lavfi","-i",benchmark?"testsrc2=size=1920x1080:rate=1":"color=c=red:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.png")]);
  run("ffmpeg",["-y","-f","lavfi","-i",benchmark?"testsrc=size=1920x1080:rate=1":"color=c=blue:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.jpg")]);
  // Generate two explicit RGB frames with distinct timestamps, independent of concat
  // filter behavior across FFmpeg versions. Use a palette generated from both
  // exact source colors; the default RGB8 conversion/dithering can introduce
  // red pixels at the top of a blue frame, which become visible in a cover crop.
  const frames=Buffer.alloc(64*48*3*2);
  for(let i=0;i<64*48;i++){frames[i*3]=255;frames[(64*48+i)*3+2]=255;}
  const raw=join(tmp,"gif-frames.rgb");
  await writeFile(raw,frames);
  for(const {name,rate,first,last,loop} of [
    {name:"image.gif",rate:5,first:0.2,last:0.2,loop:"-1"},
    {name:"image.variable.gif",rate:10,first:0.1,last:0.3,loop:"1"}
  ]){
    const gif=join(tmp,name);
    run("ffmpeg",["-y","-f","rawvideo","-pixel_format","rgb24","-video_size","64x48","-framerate",String(rate),"-i",raw,"-filter_complex_threads","1","-filter_complex","[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none","-frames:v","2","-threads","1","-loop",loop,"-final_delay",String(Math.round(last*100)),gif]);
    const gifInfo=JSON.parse(run("ffprobe",["-v","error","-ignore_loop","1","-select_streams","v:0","-show_frames","-show_entries","frame=pts_time,duration_time,pkt_duration_time","-of","json",gif]).toString());
    const gifFrames=gifInfo.frames;
    if(gifFrames.length!==2 || gifFrames.some((frame,i)=>Math.abs(Number(frame.pts_time)-(i?first:0))>0.001 || Math.abs(Number(frame.duration_time??frame.pkt_duration_time)-(i?last:first))>0.001 || !Number.isFinite(Number(frame.pts_time)) || !Number.isFinite(Number(frame.duration_time??frame.pkt_duration_time))))throw Error("Invalid GIF fixture timestamps: "+JSON.stringify(gifFrames));
    const gifPixels=run("ffmpeg",["-v","error","-ignore_loop","1","-i",gif,"-vf","format=rgb24","-fps_mode","passthrough","-threads","1","-f","rawvideo","-"]);
    // Verify every source pixel, including edges. A center-only sample missed
    // the RGB8 dithering artifacts that triggered the portrait background test.
    if(!gifPixels.equals(frames)){
      const offset=gifPixels.findIndex((byte,i)=>byte!==frames[i]);
      throw Error("Invalid GIF fixture RGB data: "+name+" length="+gifPixels.length+" expected="+frames.length+" first differing byte="+offset);
    }
    console.log("GIF fixture verified (all 6144 pixels): "+name+" red "+first+"s, blue "+last+"s.");
  }
  server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--config","vite.web.config.ts","--host","127.0.0.1"],{stdio:"inherit"});
  await wait(async()=> (await fetch(base)).ok);
  chrome=spawn(process.env.CHROME_BIN||"google-chrome",["--headless","--no-sandbox","--disable-dev-shm-usage","--no-first-run","--remote-debugging-port=0","--user-data-dir="+join(tmp,"chrome"),"about:blank"],{stdio:"ignore"});
  const port=await wait(async()=> (await readFile(join(tmp,"chrome","DevToolsActivePort"),"utf8")).split("\n")[0]);
  const tabs=await wait(async()=> (await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(t=>t.type==="page"));
  ws=new WebSocket(tabs.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
  const pending=new Map();let id=0;
  ws.addEventListener("message",event=>{const m=JSON.parse(event.data);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error("CDP timeout: "+method));},120000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}
  async function evaluate(expression){const res=await call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(res.exceptionDetails)throw Error(res.exceptionDetails.text);return res.result.value;}
  await call("Page.enable");await call("DOM.enable");await call("Page.navigate",{url:base});
  await wait(async()=>await evaluate("!!document.querySelector('#encode') && document.readyState==='complete'"));
  const outputValues=()=>evaluate("['resolution','fps','fit','quality'].map(id=>document.getElementById(id).value)");
  const defaults=["1280x720","30","blurred","20"];
  if(JSON.stringify(await outputValues())!==JSON.stringify(defaults))throw Error("Unexpected default output settings");
  await evaluate("document.getElementById('resolution').value='1080x1920';document.getElementById('fps').value='60';document.getElementById('fit').value='cover';document.getElementById('quality').value='16';document.getElementById('settings-reset').click()");
  if(JSON.stringify(await outputValues())!==JSON.stringify(defaults))throw Error("Reset did not restore defaults");
  if(!benchmark){
    const change=async(id,value,event="change")=>evaluate("(()=>{const el=document.getElementById("+JSON.stringify(id)+");el.value="+JSON.stringify(String(value))+";el.dispatchEvent(new Event("+JSON.stringify(event)+"));})()");
    const click=id=>evaluate("document.getElementById("+JSON.stringify(id)+").click()");
    const reload=async(expected="復元")=>{
      await evaluate("window.__mvmBeforeReload=true");
      await call("Page.reload",{ignoreCache:true});
      await wait(async()=>await evaluate("!window.__mvmBeforeReload && document.readyState==='complete' && document.getElementById('settings-status')?.textContent.includes("+JSON.stringify(expected)+")"));
    };
    await change("resolution","1080x1920");
    await change("fps","60");
    await click("gain-enabled");
    await change("volume-gain",-6,"input");
    await click("limiter-enabled"); // intentionally disable auto-enabled limiter
    await click("gain-enabled"); // preserve disabled gain parameter
    await change("preset-name","Suno test","input");
    await click("preset-save");
    await reload();
    if(JSON.stringify(await outputValues())!==JSON.stringify(["1080x1920","60","blurred","20"]))throw Error("Output settings did not persist");
    if(!await evaluate("document.getElementById('volume-gain').value==='-6'&&!document.getElementById('gain-enabled').checked&&!document.getElementById('limiter-enabled').checked"))throw Error("Disabled filter setting not restored");
    await click("filters-reset");
    await change("preset-select","Suno test");
    await click("preset-load");
    if(!await evaluate("document.getElementById('volume-gain').value==='-6'&&!document.getElementById('gain-enabled').checked&&!document.getElementById('limiter-enabled').checked"))throw Error("Preset settings not restored");
    if(JSON.stringify(await outputValues())!==JSON.stringify(["1080x1920","60","blurred","20"]))throw Error("Preset changed output settings");
    await change("preset-name","suno TEST","input");
    await click("preset-save");
    if(!await evaluate("document.getElementById('preset-status').textContent.includes('同じ名前')"))throw Error("Duplicate preset accepted");
    await click("preset-delete");
    await reload();
    if(!await evaluate("document.getElementById('preset-select').options.length===1"))throw Error("Deleted preset reappeared");
    await change("preset-name","Temporary","input");await click("preset-save");
    await click("preset-clear");
    if(!await evaluate("document.getElementById('preset-select').options.length===2"))throw Error("Clear did not require confirmation");
    await click("preset-clear");
    await reload();
    if(!await evaluate("document.getElementById('preset-select').options.length===1"))throw Error("Clear did not persist");
    await evaluate("localStorage.setItem('music-video-maker:web:presets:v1','broken')");
    await reload();
    if(!await evaluate("document.getElementById('preset-save').disabled&&localStorage.getItem('music-video-maker:web:presets:v1')==='broken'"))throw Error("Corrupt presets overwritten");
    await click("preset-clear");await click("preset-clear");
    await click("filters-reset");await click("settings-reset");
    await evaluate("localStorage.setItem('music-video-maker:web:settings:v1','broken')");
    await reload("初期設定");
    if(JSON.stringify(await outputValues())!==JSON.stringify(defaults))throw Error("Invalid settings did not fall back to defaults");
    if(!await evaluate("localStorage.getItem('music-video-maker:web:settings:v1')==='broken'"))throw Error("Corrupt settings overwritten on startup");
    await click("settings-reset");
    await reload();
    if(JSON.stringify(await outputValues())!==JSON.stringify(defaults))throw Error("Defaults not restored after persistence tests");
    console.log("Settings and presets verified: reload, disabled values, apply, duplicate, delete, two-step clear, corrupt recovery.");
  }
  const root=(await call("DOM.getDocument")).root.nodeId;
  const getNode=async selector=>(await call("DOM.querySelector",{nodeId:root,selector})).nodeId;
  const audio=await getNode("#audio"), visual=await getNode("#visual");
  // Linux process-tree RSS is an approximate upper bound (shared pages can be counted twice).
  function browserRssMiB(){
    if(process.platform!=="linux" || !chrome?.pid) return null;
    const rows=run("ps",["-eo","pid=,ppid=,rss="]).toString().trim().split("\n").map(line=>line.trim().split(/\s+/).map(Number));
    const pids=new Set([chrome.pid]);
    let size;
    do{size=pids.size;for(const [pid,ppid] of rows)if(pids.has(ppid))pids.add(pid);}while(size!==pids.size);
    return rows.filter(([pid])=>pids.has(pid)).reduce((sum,[,,rss])=>sum+rss,0)/1024;
  }
  async function saveOutput(path,selector="#download",attribute="href"){
    // Read bounded slices instead of one large CDP/base64 message.
    const source="document.querySelector("+JSON.stringify(selector)+")["+JSON.stringify(attribute)+"]";
    const size=await evaluate("(async()=> (await(await fetch("+source+")).blob()).size)()");
    if(!Number.isSafeInteger(size)||size<=0||size>300*1024*1024)throw Error("Unexpected output size: "+size);
    await writeFile(path,Buffer.alloc(0));
    for(let offset=0;offset<size;offset+=512*1024){
      const end=Math.min(size,offset+512*1024);
      const expr="(async()=>{const response=await fetch("+source+",{headers:{Range:'bytes="+offset+"-"+(end-1)+"'}});if(response.status!==206)throw Error('Blob range not supported');const b=await response.blob();return await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(b);});})()";
      const data=await evaluate(expr);
      const chunk=Buffer.from(data.split(",")[1],"base64");
      if(chunk.length!==end-offset)throw Error("Output chunk size mismatch");
      await appendFile(path,chunk);
    }
    if((await stat(path)).size!==size)throw Error("Output size mismatch");
    return size;
  }
  let originalRms;
  function audioRms(path,start,length){
    const samples=run("ffmpeg",["-v","error","-ss",String(start),"-i",path,"-t",String(length),"-map","0:a:0","-f","f32le","-c:a","pcm_f32le","-"]);
    if(!samples.length||samples.length%4)throw Error("Invalid decoded PCM");
    let sum=0;
    for(let i=0;i<samples.length;i+=4){const x=samples.readFloatLE(i);sum+=x*x;}
    return Math.sqrt(sum/(samples.length/4));
  }
  if(!benchmark){
    await call("DOM.setFileInputFiles",{nodeId:audio,files:[join(tmp,"audio-35.mp3")]});
    await wait(()=>evaluate("!document.getElementById('preview-original').disabled"));
    const setStart=async value=>evaluate("(()=>{const el=document.getElementById('preview-start');el.value="+JSON.stringify(String(value))+";el.dispatchEvent(new Event('input'));})()");
    const ready=async()=>{
      const state=await wait(async()=>{
        const s=await evaluate("document.getElementById('audio-preview-status').dataset.state");
        return ["ready","error"].includes(s)&&s;
      },120000);
      if(state!=="ready")throw Error("Audio preview failed: "+await evaluate("document.getElementById('audio-preview-status').textContent"));
      await evaluate("document.getElementById('audio-preview').pause()");
    };
    const durationOf=path=>Number(JSON.parse(run("ffprobe",["-v","error","-show_entries","format=duration","-of","json",path]).toString()).format.duration);
    await evaluate("document.getElementById('gain-enabled').click();document.getElementById('volume-gain').value='-6';document.getElementById('volume-gain').dispatchEvent(new Event('input'))");
    await setStart(2);
    await evaluate("document.getElementById('preview-original').click()");
    await ready();
    const orig=join(tmp,"preview-original.wav"),processed=join(tmp,"preview-processed.wav");
    await saveOutput(orig,"#audio-preview","src");
    const originalURL=await evaluate("document.getElementById('audio-preview').src");
    await evaluate("document.getElementById('audio-preview').currentTime=4");
    await wait(()=>evaluate("!document.getElementById('audio-preview').seeking"));
    await evaluate("document.getElementById('preview-processed').click()");
    await ready();
    await saveOutput(processed,"#audio-preview","src");
    const ratio=audioRms(processed,1,20)/audioRms(orig,1,20);
    if(Math.abs(durationOf(orig)-30)>0.05||Math.abs(durationOf(processed)-30)>0.05||
       !Number.isFinite(ratio)||Math.abs(20*Math.log10(ratio)+6)>0.1)
      throw Error("Preview duration or gain mismatch: "+ratio);
    const position=await evaluate("document.getElementById('audio-preview').currentTime");
    if(Math.abs(position-4)>0.7)throw Error("Preview switch position mismatch: "+position);
    await evaluate("document.getElementById('preview-original').click()");
    await ready();
    if(await evaluate("document.getElementById('audio-preview').src")!==originalURL)throw Error("Preview cache not reused");
    await setStart(34);
    if(await evaluate("document.getElementById('audio-preview').hasAttribute('src')"))throw Error("Old preview not cleared");
    await evaluate("document.getElementById('preview-original').click()");
    await ready();
    const tail=join(tmp,"preview-tail.wav");
    await saveOutput(tail,"#audio-preview","src");
    if(Math.abs(durationOf(tail)-1)>0.05)throw Error("Incorrect tail preview length");
    await evaluate("document.getElementById('volume-gain').value='-3';document.getElementById('volume-gain').dispatchEvent(new Event('input'))");
    if(await evaluate("document.getElementById('audio-preview').hasAttribute('src')"))throw Error("Filter change did not clear preview");
    await evaluate("document.getElementById('preview-processed').click();document.getElementById('preview-cancel').click()");
    if(await evaluate("!document.getElementById('preview-cancel').disabled||document.getElementById('preview-processed').disabled"))throw Error("Preview cancel did not restore controls");
    await evaluate("document.getElementById('filters-reset').click()");
    console.log("Audio preview verified: 30s original/processed, -6dB RMS, position, cache, tail, invalidation, cancel.");
  }
  for(const {ext,seconds,width,height,fit,fps=30,crf=20,filters="none"} of cases){
    await call("DOM.setFileInputFiles",{nodeId:audio,files:[join(tmp,"audio-"+seconds+".mp3")]});
    await call("DOM.setFileInputFiles",{nodeId:visual,files:[join(tmp,"image."+ext)]});
    for(const [selector,value] of [["#resolution",width+"x"+height],["#fit",fit],["#fps",String(fps)],["#quality",String(crf)]]){
      await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");el.value="+JSON.stringify(value)+";el.dispatchEvent(new Event('change'));})()");
    }
    await wait(()=>evaluate("document.querySelector('#image-preview').naturalWidth>0"));
    const previewOk=await evaluate("document.querySelector('#visual-preview').dataset.fit==="+JSON.stringify(fit)+" && document.querySelector('#preview-background').hidden==="+JSON.stringify(fit!=="blurred")+" && !document.querySelector('#visual-preview').hidden");
    if(!previewOk)throw Error("Preview fit mismatch: "+fit);
    const previewRatio=await evaluate("(()=>{const p=document.getElementById('visual-preview').getBoundingClientRect();return p.width/p.height;})()");
    if(Math.abs(previewRatio-width/height)>0.02)throw Error("Preview aspect ratio mismatch: "+previewRatio+" expected "+width/height);
    await evaluate("document.getElementById('filters-reset').click()");
    if(filters!=="none"){
      const ids=filters==="gain"?["gain-enabled"]:["noise-enabled","highpass-enabled","lowpass-enabled","eq-enabled","gain-enabled","loudness-enabled"];
      for(const id of ids)await evaluate("document.getElementById("+JSON.stringify(id)+").click()");
      await evaluate("document.getElementById('volume-gain').value='-6';document.getElementById('volume-gain').dispatchEvent(new Event('input'))");
      if(filters==="all")await evaluate("document.getElementById('eq-gain').value='3';document.getElementById('eq-gain').dispatchEvent(new Event('input'))");
      if(!await evaluate("document.getElementById('limiter-enabled').checked"))throw Error("Automatic limiter did not enable");
    }
    await wait(()=>evaluate("!document.querySelector('#encode').disabled"));
    if(benchmark && seconds===180 && fit==="contain"){
      await evaluate("document.querySelector('#encode').click()");
      await wait(async()=> (await evaluate("document.querySelector('#status').textContent")).includes("動画を生成中"),120000);
      await evaluate("document.querySelector('#cancel').click()");
      if(await evaluate("document.querySelector('#status').dataset.state!=='cancelled'||!document.querySelector('#download').hidden||document.querySelector('#encode').disabled"))throw Error("Cancel did not restore usable state");
      console.log("Cancellation during encode passed; retrying.");
    }
    let peak=browserRssMiB(),baseline=peak;
    const started=performance.now();
    await evaluate("document.querySelector('#encode').click()");
    let lastSample=0;
    const state=await wait(async()=>{
      if(benchmark && Date.now()-lastSample>=2000){lastSample=Date.now();const rss=browserRssMiB();if(rss!==null)peak=Math.max(peak??0,rss);}
      const s=await evaluate("document.querySelector('#status').dataset.state");
      return ["done","error"].includes(s)&&s;
    },benchmark?480000:180000);
    const wallSeconds=(performance.now()-started)/1000;
    const status=await evaluate("document.querySelector('#status').textContent");
    if(state!=="done")throw Error(ext+": "+status+" "+await evaluate("document.querySelector('#log').textContent"));
    const path=join(tmp,ext+"-"+fit+"-"+width+"x"+height+"-"+fps+"-"+crf+"-"+seconds+"-"+filters+".mp4"),size=await saveOutput(path);
    const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",path]).toString());
    const v=info.streams.find(s=>s.codec_type==="video"),a=info.streams.find(s=>s.codec_type==="audio");
    const tolerance=benchmark?0.5:0.4;
    const validDuration=value=>Number.isFinite(Number(value))&&Math.abs(Number(value)-seconds)<=tolerance;
    if(v?.codec_name!=="h264"||v.width!==width||v.height!==height||v.pix_fmt!=="yuv420p"||v.r_frame_rate!==fps+"/1"||a?.codec_name!=="aac"||!validDuration(info.format.duration)||!validDuration(v.duration)||!validDuration(a.duration))throw Error("Invalid "+ext+" output: "+JSON.stringify(info));
    if(fit==="blurred" && (v.color_space!=="bt709"||v.color_range!=="tv"))throw Error("Unexpected blurred output color metadata: "+JSON.stringify(v));
    if(!benchmark){
      // Inspect decoded center pixels, including frames after the first GIF cycle.
      // Static sources must retain their color through the final sample.
      const animated=ext.endsWith("gif");
      const samples=animated?[]:[[0.1,ext==="png"?"red":"blue"],[1.3,ext==="png"?"red":"blue"]];
      // Decode once in presentation order. Pair every RGB sample with its actual PTS.
      // Avoid demuxer seek/keyframe differences obscuring the output timing.
      const crops=fit==="blurred"?["crop=16:16","crop=16:16:"+(Math.floor(width/2)-8)+":20","crop=16:16:"+(Math.floor(width/2)-8)+":"+(height-36)]:["crop=16:16"];
      const decoded=JSON.parse(run("ffprobe",["-v","error","-select_streams","v:0","-show_frames","-show_entries","frame=best_effort_timestamp_time","-of","json",path]).toString()).frames;
      const times=decoded.map(f=>Number(f.best_effort_timestamp_time));
      if(!times.length||times.some((t,i)=>!Number.isFinite(t)||(i>0&&Math.abs(t-times[i-1]-1/fps)>0.001))||Math.abs(times[0])>0.001)throw Error("Invalid decoded frame timing: "+JSON.stringify(times));
      for(const crop of crops){
      // Decode a solid 16x16 patch directly: no second resize to 1x1,
      // which introduces a version-dependent swscale conversion.
      const pixels=run("ffmpeg",["-v","error","-i",path,"-vf",crop+",format=rgb24","-fps_mode","passthrough","-threads","1","-f","rawvideo","-"]);
      const patchSize=16*16*3;
      if(pixels.length!==times.length*patchSize)throw Error("Invalid decoded pixel count: "+crop);
      const stats=times.map((_,i)=>{
        const min=[255,255,255],max=[0,0,0];
        for(let j=i*patchSize;j<(i+1)*patchSize;j+=3)for(let c=0;c<3;c++){
          min[c]=Math.min(min[c],pixels[j+c]);max[c]=Math.max(max[c],pixels[j+c]);
        }
        return {min,max};
      });
      // Keep the original channel thresholds and apply them to every pixel.
      const colors=stats.map(({min,max})=>min[0]>180&&max[2]<80?"red":min[2]>180&&max[0]<80?"blue":"unknown");
      const diagnostic=i=>JSON.stringify({crop,time:times[i],rgb:stats[i],colorSpace:v.color_space,colorRange:v.color_range});
      for(const [time,color] of samples){
        const i=times.reduce((best,t,index)=>Math.abs(t-time)<Math.abs(times[best]-time)?index:best,0);
        if(Math.abs(times[i]-time)>0.5/fps+0.001||colors[i]!==color){
          console.error("Decoded frame timeline:",times.map((t,j)=>t.toFixed(3)+":"+colors[j]).join(" "));
          console.error("Browser FFmpeg log:",await evaluate("document.querySelector('#log').textContent"));
          throw Error("Wrong decoded color at "+time+"s: "+ext+"/"+fit+" expected "+color+"; got "+colors[i]+" "+diagnostic(i));
        }
      }
      if(animated){
        // Fixture durations are exact frame multiples at the tested GIF rates (30/60 fps).
        const cycleFrames=Math.round(0.4*fps);
        const redFrames=Math.round((ext==="variable.gif"?0.1:0.2)*fps);
        for(let i=0;i<times.length;i++){
          const expected=i%cycleFrames<redFrames?"red":"blue";
          if(colors[i]!==expected){
            console.error("Decoded frame timeline:",times.map((t,j)=>t.toFixed(3)+":"+colors[j]).join(" "));
            console.error("Browser FFmpeg log:",await evaluate("document.querySelector('#log').textContent"));
            throw Error("GIF frame color/timing mismatch: expected "+expected+"; got "+colors[i]+" "+diagnostic(i));
          }
        }
      }
      }
    }
    if(!benchmark && ext==="png" && fit==="contain" && seconds===1.5){
      const rms=audioRms(path,0.2,1);
      if(filters==="none")originalRms=rms;
      if(filters==="gain"){
        const ratio=rms/originalRms;
        if(!Number.isFinite(ratio)||Math.abs(20*Math.log10(ratio)+6)>0.75)throw Error("Gain RMS mismatch: "+ratio);
        console.log("Gain filter verified: "+(20*Math.log10(ratio)).toFixed(2)+" dB");
      }
    }
    if(filters==="all"){
      const expectedGraph="afftdn=nr=6:nf=-50,highpass=f=80,lowpass=f=12000,equalizer=f=1000:t=q:w=1:g=3,volume=-6dB,loudnorm=I=-14:LRA=11:TP=-1.5:linear=false,aresample=44100,alimiter=limit=0.8912509381337456:attack=5:release=50:level=false:latency=true";
      const reference=join(tmp,"reference.wav");
      run("ffmpeg",["-y","-v","error","-i",join(tmp,"audio-6.mp3"),"-af",expectedGraph,"-c:a","pcm_f32le",reference]);
      const ratio=audioRms(path,1,4)/audioRms(reference,1,4);
      if(!Number.isFinite(ratio)||Math.abs(20*Math.log10(ratio))>1.5||Math.abs(Number(v.duration)-Number(a.duration))>0.2)throw Error("Full filter chain mismatch: "+ratio);
      console.log("All seven audio filters verified against native reference: "+(20*Math.log10(ratio)).toFixed(2)+" dB");
    }
    console.log(ext+"/"+fit+"/"+width+"x"+height+"/"+fps+"fps/CRF"+crf+": "+status+"; FFprobe passed."+(benchmark?"":" Frame samples passed."));
    const encodeSeconds=Number(status.match(/エンコード ([\d.]+) 秒/)?.[1]);
    if(!Number.isFinite(encodeSeconds)||encodeSeconds<=0)throw Error("Missing encode timing");
    results.push({ext,fit,seconds,width,height,fps,crf,encodeSeconds,wallSeconds,outputMiB:size/1024/1024,baselineRssMiB:baseline,peakRssMiB:peak,realtimeRatio:seconds/encodeSeconds});
  }
  if(benchmark){
    const version=await call("Browser.getVersion");
    const report=["## Browser performance (synthetic fixtures)", "", "Chrome: "+version.product+"; CPU: "+cpus()[0]?.model+" ("+cpus().length+" logical); RAM: "+(totalmem()/1024**3).toFixed(1)+" GiB", "", "| Source | Fit | Duration | Resolution | Encode | End-to-end | Media/encode | Output | Peak browser RSS* |", "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |", ...results.map(x=>"| "+x.ext+" | "+x.fit+" | "+x.seconds+" s | "+x.width+"×"+x.height+" | "+x.encodeSeconds.toFixed(1)+" s | "+x.wallSeconds.toFixed(1)+" s | "+x.realtimeRatio.toFixed(2)+"x | "+x.outputMiB.toFixed(1)+" MiB | "+(x.peakRssMiB?.toFixed(0)??"n/a")+" MiB |"), "", "* Linux Chrome process-tree RSS sampled every 2 seconds; shared pages can be counted more than once. Not a precise WASM memory measurement. Synthetic fixtures are not a real-song or user-PC benchmark.", "", "Cancel and retry passed; FFprobe verified both streams and container duration."].join("\n");
    console.log(report);
    console.log(JSON.stringify(results));
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,report+"\n");
  }
} finally {
  ws?.close();chrome?.kill();server?.kill();await sleep(500);await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
