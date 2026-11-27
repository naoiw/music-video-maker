import test from "node:test";
import assert from "node:assert/strict";
import { createEngineSession } from "../web/src/engine-session.ts";
import { defaultFilterSettings } from "../src/services/preset-schema.ts";
const request = (type="preview",settings=null)=>({
  type,audio:new ArrayBuffer(16),duration:1.5,settings,
  ...(type==="encode"?{visual:new ArrayBuffer(32),kind:"png",args:["output.mp4"]}:{previewStart:0}),
});
function harness(loadManifest=async()=>({version:"test"})){
  const events=[],workers=[];
  const deps={loadManifest,createWorker(){
    const w={sent:[],terminated:0,onmessage:null,onerror:null,onmessageerror:null,
      postMessage(data,transfer){this.sent.push({data,transfer});},
      terminate(){this.terminated++;}
    };
    workers.push(w);return w;
  }};
  const handlers={status:m=>events.push(["status",m]),progress:v=>events.push(["progress",v]),
    log:m=>events.push(["log",m]),error:m=>events.push(["error",m]),done:r=>events.push(["done",r])};
  return {session:createEngineSession(deps),handlers,events,workers};
}
test("cancel while loading manifest aborts fetch and prevents Worker creation",async()=>{
  let resolve,signal;
  const h=harness(s=>{signal=s;return new Promise(r=>resolve=r);});
  const run=h.session.run(request(),h.handlers);
  h.session.dispose();
  assert.equal(signal.aborted,true);
  resolve({});
  await run;
  assert.deepEqual(h.workers,[]);
  assert.deepEqual(h.events,[]);
});
test("normal encode transfers both files and disposes before completing once",async()=>{
  const h=harness(),req=request("encode");
  await h.session.run(req,h.handlers);
  const w=h.workers[0],late=w.onmessage;
  assert.deepEqual(w.sent[0].transfer,[req.audio,req.visual]);
  assert.equal(w.sent[0].data.type,"encode");
  assert.equal(w.sent[0].data.useFilters,false);
  assert.ok(!Object.hasOwn(w.sent[0].data,"settings"));
  late({data:{type:"progress",value:50}});
  const result={type:"done",bytes:new ArrayBuffer(128),encodeSeconds:1};
  late({data:result});late({data:result});
  h.session.dispose();
  assert.equal(w.terminated,1);
  assert.deepEqual(h.events,[["progress",50],["done",result]]);
  assert.equal(w.onmessage,null);
});
test("preview compiles filter graph from actual sample rate, accepts bounded result",async()=>{
  const h=harness();
  const settings={...defaultFilterSettings(),"gain-enabled":true,"volume-gain":-6};
  await h.session.run(request("preview",settings),h.handlers);
  const w=h.workers[0],send=w.onmessage;
  assert.equal(w.sent[0].data.useFilters,true);
  send({data:{type:"probe",sampleRate:44100}});
  assert.deepEqual(w.sent[1].data,{type:"filterGraph",graph:"volume=-6dB"});
  const result={type:"previewDone",bytes:new ArrayBuffer(100)};
  send({data:result});
  assert.deepEqual(h.events,[["done",result]]);
  assert.equal(w.terminated,1);
});
test("malformed replies, unexpected result type and invalid sample rate fail closed",async()=>{
  for(const data of [null,{type:"progress",value:NaN},{type:"done",bytes:new ArrayBuffer(100),encodeSeconds:1},
    {type:"previewDone",bytes:new ArrayBuffer(44)},{type:"probe",sampleRate:0},{type:"unknown"}]){
    const h=harness();
    await h.session.run(request(),h.handlers);
    const w=h.workers[0],send=w.onmessage;
    send({data});send({data:{type:"previewDone",bytes:new ArrayBuffer(100)}});
    assert.equal(w.terminated,1);
    assert.equal(h.events.length,1);
    assert.equal(h.events[0][0],"error");
  }
});
test("cancel while running suppresses late success and error callbacks",async()=>{
  const h=harness();
  await h.session.run(request(),h.handlers);
  const w=h.workers[0],send=w.onmessage,fail=w.onerror;
  h.session.dispose();
  send({data:{type:"previewDone",bytes:new ArrayBuffer(100)}});fail({message:"late"});
  assert.equal(w.terminated,1);
  assert.deepEqual(h.events,[]);
});
test("manifest failure and worker message decoding errors report failure",async()=>{
  const h=harness(async()=>{throw Error("manifest failed");});
  await h.session.run(request(),h.handlers);
  assert.deepEqual(h.events,[["error","manifest failed"]]);
  assert.equal(h.workers.length,0);
  const other=harness();
  await other.session.run(request(),other.handlers);
  other.workers[0].onmessageerror();
  assert.equal(other.events[0][0],"error");
  assert.equal(other.workers[0].terminated,1);
});
