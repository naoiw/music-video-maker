import test from "node:test";
import assert from "node:assert/strict";
import { defaultFilterSettings } from "../src/services/preset-schema.ts";
import { activeFilterNames, compileWebAudioFilters, filterGroups } from "../web/src/audio-filter-plan.ts";

test("disabled filters preserve the existing unfiltered export path",()=>{
  const defaults=defaultFilterSettings();
  assert.equal(compileWebAudioFilters(defaults,44100),null);
  assert.deepEqual(activeFilterNames(defaults),[]);
});
test("compiles all seven filters in desktop processing order",()=>{
  const f=defaultFilterSettings();
  for(const group of filterGroups) f[group.enabled]=true;
  f["eq-gain"]=3;
  f["volume-gain"]=-6;
  assert.equal(compileWebAudioFilters(f,44100),
    "afftdn=nr=6:nf=-50,highpass=f=80,lowpass=f=12000,equalizer=f=1000:t=q:w=1:g=3,volume=-6dB,loudnorm=I=-14:LRA=11:TP=-1.5:linear=false,aresample=44100,alimiter=limit="+10**(-1/20)+":attack=5:release=50:level=false:latency=true");
  assert.equal(activeFilterNames(f).length,7);
});
test("rejects nonnumeric, nonfinite, out-of-range and unsafe frequency settings",()=>{
  const f={...defaultFilterSettings(),"highpass-enabled":true};
  for(const value of ["80,volume=99",NaN,Infinity,20001,0,80.5])
    assert.throws(()=>compileWebAudioFilters({...f,"highpass-hz":value},44100));
  assert.throws(()=>compileWebAudioFilters({...f,"highpass-hz":4000},8000),/ナイキスト/);
  assert.equal(compileWebAudioFilters({...f,"highpass-hz":3999},8000),"highpass=f=3999");
  assert.throws(()=>compileWebAudioFilters(f,96000));
  assert.throws(()=>compileWebAudioFilters({},44100));
});
