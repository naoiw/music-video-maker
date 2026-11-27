import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_KEY, PRESETS_KEY, createWebStore, defaultWebSettings, parseWebSettings, serializeWebSettings } from "../web/src/settings-storage.ts";
import { addPreset, defaultFilterSettings } from "../src/services/preset-schema.ts";

function memory(){
  const entries=new Map();
  return {entries,store:createWebStore(()=>({
    getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>entries.set(key,value),
  }))};
}
test("browser settings round-trip all output and filter values including disabled fields",()=>{
  const values={...defaultWebSettings(),resolution:"1280x720","volume-gain":-6,"gain-enabled":false};
  assert.deepEqual(parseWebSettings(serializeWebSettings(values)),values);
  for(const resolution of ["1920x1080","1080x1080","1080x1920"])
    assert.deepEqual(parseWebSettings(serializeWebSettings({...values,resolution})),{...values,resolution});
  for(const raw of ["bad","{}",JSON.stringify({version:2,values}),JSON.stringify({version:1,values:{...values,quality:"99"}})])
    assert.equal(parseWebSettings(raw),null);
  assert.throws(()=>serializeWebSettings({...values,"volume-gain":Infinity}));
  assert.throws(()=>serializeWebSettings({...values,resolution:"4k"}));
});
test("settings and presets have independent namespaced storage and invalid writes preserve saved values",()=>{
  const {store,entries}=memory();
  assert.equal(store.readSettings(),null);
  assert.deepEqual(store.readPresets(),[]);
  const values=defaultWebSettings(),presets=addPreset([],"Suno",defaultFilterSettings());
  store.writeSettings(values);
  store.writePresets(presets);
  assert.deepEqual(store.readSettings(),values);
  assert.deepEqual(store.readPresets(),presets);
  assert.notEqual(SETTINGS_KEY,PRESETS_KEY);
  assert.throws(()=>store.writeSettings({...values,fps:"100"}));
  assert.throws(()=>store.writePresets([...presets,...presets]));
  assert.deepEqual(store.readSettings(),values);
  assert.deepEqual(store.readPresets(),presets);
  entries.set(PRESETS_KEY,"broken");
  assert.throws(()=>store.readPresets());
  assert.equal(entries.get(PRESETS_KEY),"broken");
  store.writePresets([]);
  assert.deepEqual(store.readPresets(),[]);
  assert.deepEqual(store.readSettings(),values);
});
test("unavailable storage does not masquerade as a successful save",()=>{
  const store=createWebStore(()=>{throw Error("blocked");});
  assert.throws(()=>store.readSettings(),/blocked/);
  assert.throws(()=>store.writeSettings(defaultWebSettings()),/blocked/);
  assert.throws(()=>store.readPresets(),/blocked/);
  assert.throws(()=>store.writePresets([]),/blocked/);
});
