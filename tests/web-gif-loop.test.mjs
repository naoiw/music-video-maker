import test from "node:test";
import assert from "node:assert/strict";
import { forceInfiniteGifLoop } from "../web/src/gif-loop.ts";

const header = [71,73,70,56,57,97,1,0,1,0,0x80,0,0,255,0,0,0,0,255];
const loop = count => [0x21,0xff,11,...Buffer.from("NETSCAPE2.0"),3,1,count&255,count>>8,0];
const gce = [0x21,0xf9,4,0,20,0,0,0];
const image = [0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0];
const comment = [0x21,0xfe,3,0x21,0xff,0x0b,0];
const frame = [...gce,...image];
const input = (...blocks) => Uint8Array.from([...header,...blocks.flat(),0x3b]);
const expected = input(loop(0),comment,frame,frame);

test("adds an infinite loop without changing image or control subblocks", () => {
  assert.deepEqual(forceInfiniteGifLoop(input(comment,frame,frame)),expected);
});
test("replaces finite, duplicate and infinite loop extensions", () => {
  for(const count of [0,1,257,65535]){
    assert.deepEqual(forceInfiniteGifLoop(input(loop(count),comment,frame,loop(2),frame)),expected);
  }
});
test("normalization is idempotent and handles GIF87a", () => {
  const old = input(comment,frame,frame);
  old[4]=55;
  assert.deepEqual(forceInfiniteGifLoop(old),expected);
  assert.deepEqual(forceInfiniteGifLoop(expected),expected);
});
test("does not mistake extension bytes inside data for actual metadata", () => {
  const payload = [0x21,0xfe,19,...loop(3),0];
  assert.deepEqual(forceInfiniteGifLoop(input(payload,frame)),input(loop(0),payload,frame));
});
test("rejects truncated tables, missing trailers, unknown blocks and no images", () => {
  for(const bad of [new Uint8Array(5),input().slice(0,15),input(frame).slice(0,-1),input([0x12]),input(comment),input([0x21,0xfe,255,1])]){
    assert.throws(()=>forceInfiniteGifLoop(bad),/GIF/);
  }
});
