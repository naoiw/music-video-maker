import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, validateSettings, parseSettings, serializeSettings, parseOutputSettings, outputIds, settingsFields } from "../src/services/settings-schema.ts";
import { readSettingControls, applySettingControls } from "../src/services/settings-controls.ts";

test("validates all 486 desktop output combinations and rejects unsupported options",()=>{
  for(const resolution of settingsFields.resolution.options)for(const fps of settingsFields.fps.options)for(const fit of settingsFields.fit.options)for(const quality of settingsFields.quality.options)for(const encoder of settingsFields.encoder.options){
    const [width,height]=resolution.split("x").map(Number);
    assert.deepEqual(parseOutputSettings({resolution,fps,fit,quality,encoder}),{width,height,fps:Number(fps),fit,crf:Number(quality),encoder});
  }
  assert.equal(defaultSettings().resolution,"1920x1080");
  for(const patch of [{fps:30},{fps:"030"},{fit:"other"},{quality:"NaN"},{encoder:"bad"},{resolution:"4k"},{resolution:"1280x720"}])
    assert.equal(parseOutputSettings({...defaultSettings(),...patch}),null);
});
test("desktop settings JSON format and validation remain compatible",()=>{
  const desktop={...defaultSettings(),"volume-gain":-6,"gain-enabled":false,"limiter-enabled":false};
  const encoded=serializeSettings(desktop);
  assert.deepEqual(parseSettings(encoded),desktop);
  assert.equal(encoded,JSON.stringify({version:1,values:desktop}));
  assert.equal(validateSettings({...desktop,resolution:"1280x720"}),null);
  assert.throws(()=>serializeSettings({...desktop,resolution:"1280x720"}));
  assert.equal(validateSettings({...desktop,"eq-q":0.15}),null);
  assert.deepEqual(validateSettings({...desktop,sourcePath:"secret.mp3"}),desktop);
});
test("shared DOM controls preserve typed values without dispatching events",()=>{
  class Input {
    constructor(){this.checked=false;this.value="";}
    get valueAsNumber(){return this.value===""?NaN:Number(this.value);}
    dispatchEvent(){throw Error("Unexpected event");}
  }
  class Select { constructor(){this.value="";} dispatchEvent(){throw Error("Unexpected event");} }
  const nodes=new Map([...Object.entries(settingsFields)].map(([id,field])=>[id,field.kind==="choice"?new Select():new Input()]));
  const previous={document:globalThis.document,HTMLInputElement:globalThis.HTMLInputElement,HTMLSelectElement:globalThis.HTMLSelectElement};
  Object.assign(globalThis,{document:{getElementById:id=>nodes.get(id)},HTMLInputElement:Input,HTMLSelectElement:Select});
  try{
    const values={...defaultSettings(),resolution:"1080x1080","gain-enabled":true,"limiter-enabled":false,"volume-gain":-6};
    applySettingControls(values);
    assert.deepEqual(readSettingControls(),values);
    applySettingControls(defaultSettings(),outputIds);
    assert.equal(readSettingControls().resolution,"1920x1080");
    assert.equal(readSettingControls()["volume-gain"],-6);
    assert.equal(readSettingControls()["limiter-enabled"],false);
    nodes.get("eq-q").value="";
    assert.equal(validateSettings(readSettingControls()),null);
    assert.throws(()=>applySettingControls({},["resolution"]),/Missing setting value/);
    nodes.delete("fit");
    assert.throws(()=>readSettingControls(outputIds),/Missing setting control/);
  }finally{
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
