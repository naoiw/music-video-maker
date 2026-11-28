import test from "node:test";
import assert from "node:assert/strict";
import { muxProbeMp4 } from "../scripts/webcodecs-probe/mp4.mjs";
const sample=(timestamp,key=true)=>({timestamp,duration:33333,key,bytes:Uint8Array.of(1,2,3)});
const video=()=>({kind:"video",width:1280,height:720,description:Uint8Array.of(1,66,0,40),samples:[sample(0),sample(33333,false)]});
const audio=()=>({kind:"audio",sampleRate:48000,channels:2,description:Uint8Array.of(0x11,0x90),samples:[sample(-21333),sample(0)]});
function top(bytes){
  const out=[],b=Buffer.from(bytes);
  for(let i=0;i<b.length;){const size=b.readUInt32BE(i),name=b.toString("ascii",i+4,i+8);assert.ok(size>=8&&i+size<=b.length);out.push({size,name,offset:i});i+=size;}
  return out;
}
test("writes bounded MP4 structure and exact sample offsets for both tracks",()=>{
  const bytes=muxProbeMp4([video(),audio()]),b=Buffer.from(bytes),boxes=top(bytes);
  assert.deepEqual(boxes.map(x=>x.name),["ftyp","mdat","moov"]);
  const payload=boxes[1].offset+8;
  assert.deepEqual([...b.subarray(payload,payload+12)],[1,2,3,1,2,3,1,2,3,1,2,3]);
  let i=b.indexOf("stco");
  assert.equal(b.readUInt32BE(i+8),1);assert.equal(b.readUInt32BE(i+12),payload);
  i=b.indexOf("stco",i+4);assert.equal(b.readUInt32BE(i+12),payload+6);
  for(const name of ["avcC","esds","stts","stss","mvhd","mdhd"])assert.ok(b.includes(name));
});
test("allows partial tracks but rejects missing config, reordered frames and duplicate tracks",()=>{
  for(const track of [video(),audio()])assert.equal(top(muxProbeMp4([track])).length,3);
  for(const tracks of [[],[video(),video()],[{...video(),description:null}],[{...video(),samples:[sample(1),sample(0)]}],
    [{...video(),samples:[sample(0,false)]}],[{...audio(),sampleRate:0}],[{...video(),samples:[{...sample(0),duration:0}]}]])
    assert.throws(()=>muxProbeMp4(tracks));
});
