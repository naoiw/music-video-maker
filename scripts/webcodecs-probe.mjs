// Independent synthetic probe; not part of dist-web. No CDN, WASM or npm muxer.
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const tmp=await mkdtemp(join(tmpdir(),"mvm-webcodecs-"));
const files=new Map([
  ["/",["text/html",Buffer.from('<!doctype html><meta charset="utf-8"><title>WebCodecs probe</title><script type="module" src="/probe.mjs"></script>')]],
  ["/probe.mjs",["text/javascript",await readFile(new URL("./webcodecs-probe/probe.mjs",import.meta.url))]],
  ["/mp4.mjs",["text/javascript",await readFile(new URL("./webcodecs-probe/mp4.mjs",import.meta.url))]],
  ["/favicon.ico",["image/x-icon",Buffer.alloc(0)]],
]);
const seen=new Set(),unexpected=[];
const server=createServer((req,res)=>{
  if(req.method!=="GET"||!files.has(req.url)||req.headers["content-length"]||req.headers["transfer-encoding"]){
    unexpected.push("Unexpected loopback request");res.writeHead(403);res.end();return;
  }
  seen.add(req.url);
  const [type,data]=files.get(req.url);
  res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'","Referrer-Policy":"no-referrer"});
  res.end(data);
});
let browser,ws;
const run=(cmd,args)=>execFileSync(cmd,args,{timeout:120000,maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"]});
async function wait(fn,ms=30000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(200);}
  throw Error("Probe timeout: "+(last??"condition false"));
}
try{
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const base="http://127.0.0.1:"+server.address().port;
  const exe=process.env.CHROME_BIN||"google-chrome";
  browser=spawn(exe,["--headless","--no-first-run","--disable-background-networking","--disable-component-update","--no-sandbox","--remote-debugging-port=0","--user-data-dir="+join(tmp,"profile"),"about:blank"],{stdio:"ignore"});
  let launchError;
  browser.once("error",e=>{launchError=e;});
  const port=await wait(async()=>{if(launchError)throw launchError;return (await readFile(join(tmp,"profile","DevToolsActivePort"),"utf8")).split(/\r?\n/)[0];});
  const tab=await wait(async()=> (await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(x=>x.type==="page"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
  let id=0;const pending=new Map();
  ws.addEventListener("message",event=>{
    const m=JSON.parse(event.data),p=pending.get(m.id);
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;}
    if(m.method==="Network.requestWillBeSent"){
      const req=m.params.request;
      if(req.method!=="GET"||req.hasPostData||req.postData!==undefined||![...files.keys()].some(path=>req.url===base+path)||m.params.redirectResponse)
        unexpected.push("Unexpected page request");
    }
    if(["Network.webSocketCreated","Network.webTransportCreated"].includes(m.method))unexpected.push("Unexpected channel");
  });
  function call(method,params={}){
    return new Promise((resolve,reject)=>{
      const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error("CDP timeout: "+method));},180000);
      pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));
    });
  }
  async function evaluate(expression){
    const res=await call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(res.exceptionDetails)throw Error(res.exceptionDetails.exception?.description??res.exceptionDetails.text);
    return res.result.value;
  }
  await call("Network.enable");await call("Page.enable");await call("Page.navigate",{url:base+"/"});
  await wait(()=>evaluate("typeof globalThis.runProbe==='function'"));
  const browserName=(await call("Browser.getVersion")).product+" / "+(process.env.CHROME_BIN?.toLowerCase().includes("msedge")?"Edge":"Chrome");
  const reports=[];
  for(const [width,height,seconds] of [[1280,720,2],[1920,1080,30]]){
    const result=await evaluate("runProbe("+[width,height,seconds].join(",")+")");
    if(typeof result.video.supported!=="boolean"||typeof result.audio.supported!=="boolean")throw Error("Missing support result");
    if(result.video.supported||result.audio.supported){
      if(!Number.isSafeInteger(result.bytes)||result.bytes<=0||result.bytes>64*1024*1024)throw Error("Invalid MP4 size");
      const chunks=[];
      for(let offset=0;offset<result.bytes;offset+=256*1024){
        const size=Math.min(256*1024,result.bytes-offset);
        const chunk=Buffer.from(await evaluate("readProbeBytes("+offset+","+size+")"),"base64");
        if(chunk.length!==size)throw Error("Truncated probe bytes");chunks.push(chunk);
      }
      const file=join(tmp,"probe-"+seconds+".mp4");await writeFile(file,Buffer.concat(chunks));
      const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",file]).toString());
      const v=info.streams.find(s=>s.codec_type==="video"),a=info.streams.find(s=>s.codec_type==="audio");
      if(Boolean(v)!==result.video.supported||Boolean(a)!==result.audio.supported||
        !Number.isFinite(Number(info.format.duration))||Math.abs(Number(info.format.duration)-seconds)>0.15)throw Error("Invalid output tracks/duration");
      if(v){
        if(v.codec_name!=="h264"||v.width!==width||v.height!==height||Number(v.nb_frames)!==seconds*30||
           !Number.isFinite(Number(v.duration))||Math.abs(Number(v.duration)-seconds)>0.05)throw Error("Invalid AVC track");
        for(const [time,color] of [[0.5,0],[1.5,2]]){
          const pixel=run("ffmpeg",["-v","error","-ss",String(time),"-i",file,"-map","0:v:0","-frames:v","1","-vf","scale=1:1,format=rgb24","-threads","1","-pix_fmt","rgb24","-f","rawvideo","-"]);
          if(pixel.length!==3||pixel[color]<180||pixel[2-color]>80)throw Error("Incorrect decoded video color");
        }
      }
      if(a){
        if(a.codec_name!=="aac"||Number(a.sample_rate)!==48000||a.channels!==2||
           !Number.isFinite(Number(a.duration))||Math.abs(Number(a.duration)-seconds)>0.15)throw Error("Invalid AAC track");
        const pcm=run("ffmpeg",["-v","error","-ss","0.25","-i",file,"-map","0:a:0","-t","0.5","-f","f32le","-"]);
        let sum=0;for(let i=0;i+4<=pcm.length;i+=4)sum+=pcm.readFloatLE(i)**2;
        const rms=Math.sqrt(sum/(pcm.length/4));
        if(pcm.length<1000||!Number.isFinite(rms)||Math.abs(rms-0.2/Math.sqrt(2))>0.04)throw Error("Invalid decoded AAC RMS");
      }
      // Decode all streams, not just sampled positions.
      run("ffmpeg",["-v","error","-xerror","-i",file,"-map","0","-f","null","-"]);
      result.verdict=v&&a?"H264/AAC verified":v?"Video only verified":"Audio only verified";
    }else{
      if(result.bytes!==0)throw Error("Unexpected bytes without supported codec");
      result.verdict="Neither codec supported; no MP4 verified";
    }
    console.log(JSON.stringify(result));reports.push(result);
  }
  if(unexpected.length||!["/","/probe.mjs","/mp4.mjs"].every(path=>seen.has(path)))throw Error("Probe network audit failed: "+unexpected.join("; "));
  const report=["## Independent WebCodecs synthetic probe", "",browserName+" ("+process.platform+")","",
    "| Resolution / duration | H.264 | AAC | Video encode | Audio encode | Result |","| --- | --- | --- | ---: | ---: | --- |",
    ...reports.map(x=>"| "+x.width+"×"+x.height+" / "+x.seconds+"s | "+(x.video.supported?"Supported":"Unsupported")+" | "+(x.audio.supported?"Supported":"Unsupported")+" | "+(x.timing.videoSeconds?.toFixed(2)??"—")+" s | "+(x.timing.audioSeconds?.toFixed(2)??"—")+" s | "+x.verdict+" |"),
    "", "Unsupported is an observed environment limitation, NOT a successful full MP4 test. Supported but failed encoding/decoding is a test failure. Synthetic fixtures only; no FFmpeg core downloaded or used by browser. Native FFmpeg/FFprobe are independent validators. No unexpected page requests observed."].join("\n");
  console.log(report);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,report+"\n");
}finally{
  ws?.close();browser?.kill();await new Promise(resolve=>server.close(resolve));await sleep(800);
  await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(e=>console.warn("Temporary profile cleanup:",e.message));
}
