import test from "node:test";
import assert from "node:assert/strict";
import { imageKind, assertInputs, encodeArgs, LIMITS } from "../web/src/encode-plan.ts";

test("recognizes supported signatures and rejects other data",()=>{
  assert.equal(imageKind(Uint8Array.from([137,80,78,71,13,10,26,10])),"png");
  assert.equal(imageKind(Uint8Array.from([255,216,255])),"jpeg");
  for(const magic of ["GIF87a","GIF89a"]) assert.equal(imageKind(new TextEncoder().encode(magic)),"gif");
  assert.throws(()=>imageKind(new Uint8Array(8)));
});
test("bounds input duration, byte counts and dimensions",()=>{
  const a={name:"test.MP3",size:LIMITS.audioBytes},v={size:LIMITS.imageBytes};
  assert.doesNotThrow(()=>assertInputs(a,v,300,8000,5000));
  for(const [audio,visual,duration,w,h] of [[{...a,name:"a.wav"},v,1,1,1],[{...a,size:LIMITS.audioBytes+1},v,1,1,1],[a,{size:LIMITS.imageBytes+1},1,1,1],[a,v,301,1,1],[a,v,NaN,1,1],[a,v,1,8001,5000]])
    assert.throws(()=>assertInputs(audio,visual,duration,w,h));
});
test("uses fixed local names, codecs and bounded single-thread command",()=>{
  for(const k of ["png","jpeg","gif"])for(const r of ["1280x720","1920x1080"])for(const f of ["contain","cover"]){
    const args=encodeArgs(k,r,f,k==="gif"?[20,20]:[]);
    assert.equal(args.at(-1),"output.mp4");
    assert.ok(args.includes("audio.mp3")&&args.includes("image."+k));
    assert.ok(args.includes("libx264")&&args.includes("aac")&&args.includes("yuv420p")&&args.includes("-shortest"));
    assert.equal(args[args.indexOf("-threads")+1],"1");
    assert.equal(args[args.indexOf("-t")+1],"300");
    const vf=args[args.indexOf("-vf")+1];
    if(k==="gif"){
      assert.ok(!args.includes("-stream_loop"));
      assert.equal(args[args.indexOf("-ignore_loop")+1],"0");
      assert.ok(!vf.includes("loop=loop=-1"));
      assert.ok(vf.endsWith(",settb=1/100,setpts='N*20',fps=30"));
    } else {
      assert.ok(!args.includes("-loop")&&!args.includes("-stream_loop"));
      assert.ok(vf.endsWith(",format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)"));
    }
    assert.ok(args[args.indexOf("-vf")+1].includes(f==="contain"?"pad=":"crop="));
  }
  assert.throws(()=>encodeArgs("gif","1280x720","contain"));
  assert.throws(()=>encodeArgs("http","1280x720","contain"));
  assert.throws(()=>encodeArgs("png","bad","contain"));
  assert.throws(()=>encodeArgs("png","1280x720","bad"));
});
