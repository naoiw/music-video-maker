// Real browser smoke test: use installed Chrome and FFmpeg; no npm test dependencies.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, appendFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { cpus, totalmem } from "node:os";
const benchmark = process.argv.includes("--benchmark");
const cases = benchmark ? [{ext:"png",seconds:180,width:1920,height:1080},{ext:"jpg",seconds:295,width:1920,height:1080}] : ["png","jpg","gif"].map(ext=>({ext,seconds:1.5,width:1280,height:720}));
const results = [];
const tmp = await mkdtemp(join(tmpdir(),"mvm-web-smoke-"));
const base = "http://127.0.0.1:4173/music-video-maker/";
const run = (cmd,args) => execFileSync(cmd,args,{stdio:["ignore","pipe","pipe"],timeout:120000});
let chrome, server, ws;
async function wait(fn, ms=30000) {
  const until = Date.now()+ms;
  let last;
  while(Date.now()<until){try{const x=await fn();if(x)return x;}catch(e){last=e;}await sleep(300);}
  throw new Error("Timed out: "+(last??"condition false"));
}
try {
  for(const seconds of new Set(cases.map(c=>c.seconds))){
    const source = benchmark ? "aevalsrc=0.20*sin(2*PI*220*t)+0.10*sin(2*PI*440*t)+0.06*sin(2*PI*659*t)|0.20*sin(2*PI*220*t)+0.10*sin(2*PI*442*t)+0.06*sin(2*PI*659*t):s=44100:d="+seconds : "sine=frequency=440:duration="+seconds;
    run("ffmpeg",["-y","-f","lavfi","-i",source,"-c:a","libmp3lame","-b:a","192k",join(tmp,"audio-"+seconds+".mp3")]);
  }
  run("ffmpeg",["-y","-f","lavfi","-i",benchmark?"testsrc2=size=1920x1080:rate=1":"color=c=red:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.png")]);
  run("ffmpeg",["-y","-f","lavfi","-i",benchmark?"testsrc=size=1920x1080:rate=1":"color=c=blue:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.jpg")]);
  run("ffmpeg",["-y","-f","lavfi","-i","testsrc=size=64x48:rate=5:duration=0.6","-threads","1",join(tmp,"image.gif")]);
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
  async function saveOutput(path){
    // Read bounded slices instead of one large CDP/base64 message.
    const size=await evaluate("(async()=> (await(await fetch(document.querySelector('#download').href)).blob()).size)()");
    if(!Number.isSafeInteger(size)||size<=0||size>300*1024*1024)throw Error("Unexpected output size: "+size);
    await writeFile(path,Buffer.alloc(0));
    for(let offset=0;offset<size;offset+=512*1024){
      const end=Math.min(size,offset+512*1024);
      const expr="(async()=>{const response=await fetch(document.querySelector('#download').href,{headers:{Range:'bytes="+offset+"-"+(end-1)+"'}});if(response.status!==206)throw Error('Blob range not supported');const b=await response.blob();return await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(b);});})()";
      const data=await evaluate(expr);
      const chunk=Buffer.from(data.split(",")[1],"base64");
      if(chunk.length!==end-offset)throw Error("Output chunk size mismatch");
      await appendFile(path,chunk);
    }
    if((await stat(path)).size!==size)throw Error("Output size mismatch");
    return size;
  }
  for(const {ext,seconds,width,height} of cases){
    await call("DOM.setFileInputFiles",{nodeId:audio,files:[join(tmp,"audio-"+seconds+".mp3")]});
    await call("DOM.setFileInputFiles",{nodeId:visual,files:[join(tmp,"image."+ext)]});
    await evaluate("document.querySelector('#resolution').value="+JSON.stringify(width+"x"+height));
    await wait(()=>evaluate("!document.querySelector('#encode').disabled"));
    if(benchmark && seconds===180){
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
    const path=join(tmp,ext+".mp4"),size=await saveOutput(path);
    const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",path]).toString());
    const v=info.streams.find(s=>s.codec_type==="video"),a=info.streams.find(s=>s.codec_type==="audio");
    const tolerance=benchmark?0.5:0.4;
    const validDuration=value=>Number.isFinite(Number(value))&&Math.abs(Number(value)-seconds)<=tolerance;
    if(v?.codec_name!=="h264"||v.width!==width||v.height!==height||v.pix_fmt!=="yuv420p"||v.r_frame_rate!=="30/1"||a?.codec_name!=="aac"||!validDuration(info.format.duration)||!validDuration(v.duration)||!validDuration(a.duration))throw Error("Invalid "+ext+" output: "+JSON.stringify(info));
    console.log(ext+": "+status+"; FFprobe passed.");
    const encodeSeconds=Number(status.match(/エンコード ([\d.]+) 秒/)?.[1]);
    if(!Number.isFinite(encodeSeconds)||encodeSeconds<=0)throw Error("Missing encode timing");
    results.push({ext,seconds,width,height,encodeSeconds,wallSeconds,outputMiB:size/1024/1024,baselineRssMiB:baseline,peakRssMiB:peak,realtimeRatio:seconds/encodeSeconds});
  }
  if(benchmark){
    const version=await call("Browser.getVersion");
    const report=["## Browser performance (synthetic fixtures)", "", "Chrome: "+version.product+"; CPU: "+cpus()[0]?.model+" ("+cpus().length+" logical); RAM: "+(totalmem()/1024**3).toFixed(1)+" GiB", "", "| Source | Duration | Resolution | Encode | End-to-end | Media/encode | Output | Peak browser RSS* |", "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |", ...results.map(x=>"| "+x.ext+" | "+x.seconds+" s | "+x.width+"×"+x.height+" | "+x.encodeSeconds.toFixed(1)+" s | "+x.wallSeconds.toFixed(1)+" s | "+x.realtimeRatio.toFixed(2)+"x | "+x.outputMiB.toFixed(1)+" MiB | "+(x.peakRssMiB?.toFixed(0)??"n/a")+" MiB |"), "", "* Linux Chrome process-tree RSS sampled every 2 seconds; shared pages can be counted more than once. Not a precise WASM memory measurement. Synthetic fixtures are not a real-song or user-PC benchmark.", "", "Cancel and retry passed; FFprobe verified both streams and container duration."].join("\n");
    console.log(report);
    console.log(JSON.stringify(results));
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,report+"\n");
  }
} finally {
  ws?.close();chrome?.kill();server?.kill();await sleep(500);await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
