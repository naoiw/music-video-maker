import test from "node:test";
import assert from "node:assert/strict";
import { inspectImageDimensions, assertImageDimensions } from "../web/src/image-dimensions.ts";
import { prepareLoopingGif } from "../web/src/gif-loop.ts";
function png(w,h){
  const b=Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
  b.writeUInt32BE(13,8); b.write("IHDR",12);
  b.writeUInt32BE(w,16); b.writeUInt32BE(h,20);
  return b;
}
function jpeg(w,h){
  return Uint8Array.from([255,216,255,225,0,6,255,192,0,0,255,255,194,0,11,8,h>>8,h&255,w>>8,w&255,1,1,17,0]);
}
function gif(w,h,frameW=w,frameH=h,left=0,top=0){
  const le=n=>[n&255,n>>8];
  return Uint8Array.from([71,73,70,56,57,97,...le(w),...le(h),128,0,0,255,0,0,0,0,255,
    0x2c,...le(left),...le(top),...le(frameW),...le(frameH),0,2,2,0x44,1,0,0x3b]);
}
test("inspects PNG, progressive JPEG and GIF without invoking a decoder",()=>{
  assert.deepEqual(inspectImageDimensions(png(8000,5000),"png"),{width:8000,height:5000});
  assert.deepEqual(inspectImageDimensions(jpeg(640,480),"jpeg"),{width:640,height:480});
  assert.deepEqual(inspectImageDimensions(gif(64,48),"gif"),{width:64,height:48});
});
test("rejects oversize and zero-sized headers before image decoding",()=>{
  for(const [kind,b] of [["png",png(8001,5000)],["jpeg",jpeg(8001,5000)],["gif",gif(8001,5000)],
    ["png",png(0,1)],["jpeg",jpeg(1,0)],["gif",gif(0,1)]])
    assert.throws(()=>inspectImageDimensions(b,kind),/4000万/);
  for(const [w,h] of [[NaN,1],[1.5,1],[Infinity,1],[-1,1]])assert.throws(()=>assertImageDimensions(w,h));
});
test("rejects truncated, malformed or mismatched headers",()=>{
  for(const [kind,b] of [["png",png(1,1).subarray(0,20)],["jpeg",jpeg(1,1).subarray(0,-1)],
    ["gif",gif(1,1).subarray(0,10)],["png",jpeg(1,1)],["jpeg",Uint8Array.of(255,216,255,218,0,2)],
    ["jpeg",Uint8Array.of(255,216,255,225,0,1)],["gif",png(1,1)]])
    assert.throws(()=>inspectImageDimensions(b,kind));
});
test("checks GIF frame rectangles before copying compressed frame data",()=>{
  assert.doesNotThrow(()=>prepareLoopingGif(gif(64,48,32,24,32,24)));
  for(const b of [gif(1,1,8001,5000),gif(64,48,0,1),gif(64,48,33,24,32,24),gif(64,48,32,25,32,24)])
    assert.throws(()=>prepareLoopingGif(b));
});
