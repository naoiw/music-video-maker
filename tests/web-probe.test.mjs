import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source=await readFile(new URL("../web/src/encoder-worker.js",import.meta.url),"utf8");
function mockProbe(result,raw='{"streams":[{"codec_type":"audio","sample_rate":"44100","channels":2}],"format":{"duration":"1.5"}}'){
  const ctx=vm.createContext({self:{}});
  vm.runInContext(source,ctx);
  const calls=[];
  const core={
    ffprobe(){throw Error("The wrapper must not be used");},
    stringsToPtr(argv){calls.push(["argv",...argv]);return 123;},
    _ffprobe(argc,ptr){calls.push(["entry",argc,ptr]);if(result instanceof Error)throw result;return result;},
    reset(){calls.push(["reset"]);},
    FS:{
      readFile(path,opts){calls.push(["read",path,opts.encoding]);return raw;},
      unlink(path){calls.push(["unlink",path]);}
    }
  };
  return {probe:ctx.probe,core,calls};
}
test("uses the C return value, resets state and reads fresh probe JSON",()=>{
  const {probe,core,calls}=mockProbe(0);
  const info=probe(core,"audio.mp3","mp3","stream=sample_rate");
  assert.equal(info.streams[0].sample_rate,"44100");
  assert.equal(calls[0][1],"./ffprobe");
  assert.equal(calls[0].at(-1),"audio.mp3");
  assert.deepEqual(calls[1],["entry",calls[0].length-1,123]);
  assert.deepEqual(calls.slice(2),[["reset"],["read","probe.json","utf8"],["unlink","probe.json"]]);
});
test("rejects any nonzero status and native exceptions without reading output",()=>{
  for(const result of [-1,1,new Error("native abort")]){
    const {probe,core,calls}=mockProbe(result);
    assert.throws(()=>probe(core,"audio.mp3","mp3","stream=sample_rate"));
    assert.deepEqual(calls.at(-1),["reset"]);
    assert.ok(!calls.some(c=>c[0]==="read"));
  }
});
test("rejects malformed JSON instead of treating the presence of a file as success",()=>{
  const {probe,core}=mockProbe(0,"{invalid");
  assert.throws(()=>probe(core,"audio.mp3","mp3","stream=sample_rate"));
});
