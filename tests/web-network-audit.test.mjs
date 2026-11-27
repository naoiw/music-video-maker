import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, createNetworkAudit, CORE_URLS } from "../scripts/web-network-audit.mjs";
const base="http://127.0.0.1:4173/music-video-maker/";
const origin=new URL(base).origin, manifest=base+"core-manifest.json";
const allowed=new Set([base,manifest,base+"assets/index-abc.js"]);
const get=url=>({url,method:"GET"});
test("allows only exact site assets and fixed CDN URLs, separates local reads",()=>{
  for(const url of allowed)assert.equal(classifyRequest(get(url),allowed,origin),"site");
  for(const url of CORE_URLS)assert.equal(classifyRequest(get(url),allowed,origin),"core");
  assert.equal(classifyRequest(get("blob:"+origin+"/123"),allowed,origin),"local");
  assert.equal(classifyRequest(get("data:image/png;base64,AAAA"),allowed,origin),"local");
  for(const url of [base+"upload",manifest+"?song=private",CORE_URLS[0]+"?track=x","https://cdn.jsdelivr.net/other","https://example.org/", "blob:https://example.org/id","file:///tmp/audio.mp3"])
    assert.equal(classifyRequest(get(url),allowed,origin),"unexpected");
  for(const request of [{...get(manifest),method:"POST"},{...get(manifest),hasPostData:true},{...get(CORE_URLS[0]),postData:""},{...get(base),postDataEntries:[{bytes:"YQ=="}]}])
    assert.equal(classifyRequest(request,allowed,origin),"unexpected");
});
function harness(){
  const calls=[];
  const audit=createNetworkAudit({base,allowed,call:async(...args)=>{calls.push(args);}});
  function request(url,sessionId,extra={}){
    audit.observe({method:"Network.requestWillBeSent",sessionId,params:{request:get(url),...extra}});
  }
  function attach(sessionId){
    audit.observe({method:"Target.attachedToTarget",params:{sessionId,targetInfo:{type:"worker"}}});
  }
  return {audit,calls,request,attach};
}
test("attaches before Worker execution and requires positive network evidence",async()=>{
  const {audit,calls,request,attach}=harness();
  await audit.start();
  attach("w");
  request(manifest);
  for(const url of CORE_URLS)request(url,"w");
  assert.deepEqual(await audit.finish(),{siteGets:1,coreGets:2,localReads:0,manifestGets:1,workers:1,workersWithBothCoreGets:1,unexpected:0});
  assert.deepEqual(calls.map(x=>x[0]),["Network.enable","Target.setAutoAttach","Network.enable","Runtime.runIfWaitingForDebugger"]);
  assert.equal(calls[1][1].waitForDebuggerOnStart,true);
  assert.equal(calls[2][2],"w");
});
test("fails closed on missing evidence, unexpected requests, redirects and alternate channels",async()=>{
  await assert.rejects(()=>harness().audit.finish(),/Missing positive evidence/);
  for(const violation of [
    h=>h.request(base+"upload","w"),
    h=>h.request(CORE_URLS[0],"w",{redirectResponse:{status:302}}),
    h=>h.audit.observe({method:"Network.webSocketCreated",params:{url:"wss://example.org"}}),
    h=>h.request(CORE_URLS[0]),
  ]){
    const h=harness();h.attach("w");h.request(manifest);
    for(const url of CORE_URLS)h.request(url,"w");
    violation(h);
    await assert.rejects(()=>h.audit.finish(),/Network audit failed/);
  }
});
