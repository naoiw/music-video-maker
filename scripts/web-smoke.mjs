// Real browser smoke test: use installed Chrome and FFmpeg; no npm test dependencies.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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
  run("ffmpeg",["-y","-f","lavfi","-i","sine=frequency=440:duration=1.5","-c:a","libmp3lame",join(tmp,"audio.mp3")]);
  run("ffmpeg",["-y","-f","lavfi","-i","color=c=red:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.png")]);
  run("ffmpeg",["-y","-f","lavfi","-i","color=c=blue:s=64x48","-frames:v","1","-threads","1",join(tmp,"image.jpg")]);
  run("ffmpeg",["-y","-f","lavfi","-i","testsrc=size=64x48:rate=5:duration=0.6","-threads","1",join(tmp,"image.gif")]);
  server=spawn("pnpm",["web:preview"],{stdio:"inherit",shell:process.platform==="win32"});
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
  await call("DOM.setFileInputFiles",{nodeId:audio,files:[join(tmp,"audio.mp3")]});
  for(const ext of ["png","jpg","gif"]){
    await call("DOM.setFileInputFiles",{nodeId:visual,files:[join(tmp,"image."+ext)]});
    await wait(()=>evaluate("!document.querySelector('#encode').disabled"));
    await evaluate("document.querySelector('#encode').click()");
    const state=await wait(async()=>{const s=await evaluate("document.querySelector('#status').dataset.state");return ["done","error"].includes(s)&&s;},180000);
    const status=await evaluate("document.querySelector('#status').textContent");
    if(state!=="done")throw Error(ext+": "+status+" "+await evaluate("document.querySelector('#log').textContent"));
    const data=await evaluate("(async()=>{const b=await(await fetch(document.querySelector('#download').href)).blob();return await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(b);});})()");
    const path=join(tmp,ext+".mp4");await writeFile(path,Buffer.from(data.split(",")[1],"base64"));
    const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",path]).toString());
    const v=info.streams.find(s=>s.codec_type==="video"),a=info.streams.find(s=>s.codec_type==="audio");
    if(v?.codec_name!=="h264"||v.width!==1280||v.height!==720||v.pix_fmt!=="yuv420p"||v.r_frame_rate!=="30/1"||a?.codec_name!=="aac"||Math.abs(Number(info.format.duration)-1.5)>0.4)throw Error("Invalid "+ext+" output: "+JSON.stringify(info));
    console.log(ext+": "+status+"; FFprobe passed.");
  }
} finally {
  ws?.close();chrome?.kill();server?.kill();await sleep(500);await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
