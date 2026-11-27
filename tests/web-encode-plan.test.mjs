import test from "node:test";
import assert from "node:assert/strict";
import { imageKind, assertInputs, encodeArgs, LIMITS, browserOutputDefaults, browserResolutions, validateOutputOptions } from "../web/src/encode-plan.ts";

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
  for(const k of ["png","jpeg","gif"])for(const r of ["1280x720","1920x1080"])for(const f of ["blurred","contain","cover"]){
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
      if(f==="blurred"){
        assert.ok(vf.startsWith("settb=1/100,setpts='N*20',"));
        assert.ok(vf.endsWith(",fps=30"));
      } else assert.ok(vf.endsWith(",settb=1/100,setpts='N*20',fps=30"));
    } else {
      assert.ok(!args.includes("-loop")&&!args.includes("-stream_loop"));
      assert.ok(vf.endsWith(",format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)"));
    }
    if(f==="blurred"){
      const [w,h]=r.split("x").map(Number);
      assert.ok(vf.includes("premultiply=inplace=1"));
      assert.ok(vf.includes("scale="+w/4+":"+h/4+",gblur=sigma="+Math.min(w,h)*.02/4));
      assert.ok(vf.includes("[fg]scale="+w+":"+Math.floor(h*4/5)));
      assert.ok(vf.includes("overlay=(W-w)/2:(H-h)/2:shortest=1"));
      assert.equal(vf.split("out_color_matrix=bt709:out_range=tv,format=yuv420p").length-1,2);
      assert.equal(args[args.indexOf("-colorspace")+1],"bt709");
      assert.equal(args[args.indexOf("-color_range")+1],"tv");
      if(k!=="gif") assert.ok(vf.indexOf("overlay=")<vf.indexOf("loop=loop=-1"));
    } else assert.ok(vf.includes(f==="contain"?"pad=":"crop="));
  }
  assert.throws(()=>encodeArgs("gif","1280x720","contain"));
  assert.throws(()=>encodeArgs("http","1280x720","contain"));
  assert.throws(()=>encodeArgs("png","bad","contain"));
  assert.throws(()=>encodeArgs("png","1280x720","bad"));
});

test("browser output options share desktop choices and retain safe 720p defaults",()=>{
  assert.deepEqual(browserResolutions,["1280x720","1920x1080","1080x1080","1080x1920"]);
  assert.deepEqual(browserOutputDefaults,{resolution:"1280x720",fps:30,fit:"blurred",crf:20});
  for(const r of browserResolutions)for(const f of ["blurred","contain","cover"])for(const fps of [24,30,60])for(const crf of [16,20,24]){
    for(const kind of ["png","jpeg","gif"]){
      const args=encodeArgs(kind,r,f,kind==="gif"?[10,30]:[],fps,crf);
      assert.equal(args[args.indexOf("-r")+1],String(fps));
      assert.equal(args[args.indexOf("-crf")+1],String(crf));
      const vf=args[args.indexOf("-vf")+1];
      if(kind==="gif")assert.ok(vf.endsWith(",fps="+fps));
      else{
        assert.equal(args[args.indexOf("-framerate")+1],String(fps));
        assert.ok(vf.endsWith("setpts=N/("+fps+"*TB)"));
      }
    }
  }
  for(const [r,f,fps,crf] of [["1920x1080","bad",30,20],["1281x720","blurred",30,20],["1280x720","cover",25,20],["1280x720","contain",30,10],["1280x720","blurred",NaN,20],["1280x720","blurred",30,Infinity]]){
    assert.throws(()=>validateOutputOptions(r,f,fps,crf));
  }
});
