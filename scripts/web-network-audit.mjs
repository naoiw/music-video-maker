// Audit the page and dedicated Worker CDP sessions, not browser-wide traffic.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
export const CORE_URLS = [
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js",
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm",
];
export async function publishedUrls(root,base) {
  const allowed=new Set([base,new URL("/favicon.ico",base).href]);
  async function walk(dir,prefix=""){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=prefix+encodeURIComponent(entry.name);
      if(entry.isDirectory())await walk(join(dir,entry.name),path+"/");
      else if(entry.isFile())allowed.add(new URL(path,base).href);
      else throw Error("Unexpected published asset");
    }
  }
  await walk(root);
  return allowed;
}
export function classifyRequest(request,allowed,origin) {
  if(request.method!=="GET"||request.hasPostData||request.postData!==undefined||request.postDataEntries?.length)
    return "unexpected";
  let url;
  try { url=new URL(request.url); } catch { return "unexpected"; }
  // Blob/data URLs do not represent network transmission. Do not log payloads.
  if(url.protocol==="data:"||(url.protocol==="blob:"&&url.origin===origin))return "local";
  if(url.protocol!=="http:"&&url.protocol!=="https:")return "unexpected";
  if(CORE_URLS.includes(request.url))return "core";
  if(allowed.has(request.url))return "site";
  return "unexpected";
}
export function createNetworkAudit({base,allowed,call}) {
  const origin=new URL(base).origin;
  const violations=[],sessions=new Map(),pending=new Set();
  const counts={site:0,core:0,local:0};
  const manifest=new URL("core-manifest.json",base).href;
  let manifestRequests=0;
  function attach(params){
    const id=params.sessionId;
    const session={type:params.targetInfo.type,core:new Set(),detached:false,enabled:false,error:null};
    sessions.set(id,session);
    if(session.type!=="worker")violations.push("Unexpected attached target: "+session.type);
    // Install listeners before letting Worker code execute its first fetch.
    const task=(async()=>{
      try{
        await call("Network.enable",{},id);
        session.enabled=true;
        await call("Runtime.runIfWaitingForDebugger",{},id);
      }catch(error){session.error=String(error);}
    })();
    pending.add(task);
    void task.finally(()=>pending.delete(task));
  }
  function observe(message){
    const {method,params,sessionId}=message;
    if(method==="Target.attachedToTarget"){attach(params);return;}
    if(method==="Target.detachedFromTarget"){
      const session=sessions.get(params.sessionId);
      if(session)session.detached=true;
      return;
    }
    if(method==="Network.requestWillBeSent"){
      const request=params.request;
      const kind=classifyRequest(request,allowed,origin);
      const session=sessionId?sessions.get(sessionId):null;
      if(sessionId&&!session)violations.push("Request from untracked target");
      if(kind==="unexpected"){
        // No raw URLs, headers, bodies, or local data in the summary.
        violations.push("Unexpected request ("+String(request.method).slice(0,16)+", "+(sessionId?"worker":"page")+")");
        return;
      }
      if(params.redirectResponse)violations.push("Unexpected redirect in application traffic");
      counts[kind]++;
      if(kind==="core"){
        if(!session||session.type!=="worker")violations.push("Engine fetch outside audited Worker");
        else session.core.add(request.url);
      }
      if(kind==="site"&&request.url===manifest)manifestRequests++;
    }else if(["Network.webSocketCreated","Network.webTransportCreated","Network.directTCPSocketCreated","Network.directUDPSocketCreated"].includes(method)){
      violations.push("Unexpected network channel: "+method);
    }
  }
  async function start(){
    await call("Network.enable");
    await call("Target.setAutoAttach",{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  }
  async function finish(){
    await Promise.all([...pending]);
    const workers=[...sessions.values()].filter(s=>s.type==="worker");
    for(const worker of workers){
      // A user can cancel a Worker before its paused startup completes.
      // If already detached and no requests were seen, no execution was observed.
      if(worker.error&&(!worker.detached||worker.core.size>0))violations.push("Worker instrumentation failed");
      if(worker.core.size>0&&!worker.enabled)violations.push("Uninstrumented engine request");
    }
    const complete=workers.filter(s=>CORE_URLS.every(url=>s.core.has(url))).length;
    if(!manifestRequests||complete<1)violations.push("Missing positive evidence of manifest and both engine requests in a Worker");
    if(violations.length)throw Error("Network audit failed: "+violations.slice(0,20).join("; "));
    return {siteGets:counts.site,coreGets:counts.core,localReads:counts.local,manifestGets:manifestRequests,workers:workers.length,workersWithBothCoreGets:complete,unexpected:0};
  }
  return {start,observe,finish};
}
