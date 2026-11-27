import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, validateSettings, parseSettings, serializeSettings, parseOutputSettings, browserResolutions, outputIds, settingsFields } from "../src/services/settings-schema.ts";
import { readSettingControls, applySettingControls } from "../src/services/settings-controls.ts";

test("output profiles share all choices except browser-only 720p",()=>{
  for(const target of ["desktop","browser"]){
    const resolutions=target==="desktop"?settingsFields.resolution.options:browserResolutions;
    for(const resolution of resolutions)for(const fps of settingsFields.fps.options)for(const fit of settingsFields.fit.options)for(const quality of settingsFields.quality.options){
      const [width,height]=resolution.split("x").map(Number);
      assert.deepEqual(parseOutputSettings({resolution,fps,fit,quality},target),{width,height,fps:Number(fps),fit,crf:Number(quality)});
    }
  }
  assert.equal(defaultSettings().resolution,"1920x1080");
  assert.equal(defaultSettings("browser").resolution,"1280x720");
  assert.equal(parseOutputSettings(defaultSettings("browser")),null);
  for(const patch of [{fps:30},{fps:"030"},{fit:"other"},{quality:"NaN"},{resolution:"4k"}])
    assert.equal(parseOutputSettings({...defaultSettings(),...patch},"browser"),null);
});
test("settings JSON format remains compatible and desktop still rejects 720p",()=>{
  const desktop={...defaultSettings(),"volume-gain":-6,"gain-enabled":false,"limiter-enabled":false};
  const encoded=serializeSettings(desktop);
  assert.deepEqual(parseSettings(encoded,"browser"),desktop);
  assert.equal(serializeSettings(desktop,"browser"),encoded);
  const browser={...desktop,resolution:"1280x720"};
  assert.deepEqual(parseSettings(serializeSettings(browser,"browser"),"browser"),browser);
  assert.equal(validateSettings(browser),null);
  assert.equal(parseSettings(serializeSettings(browser,"browser")),null);
  assert.throws(()=>serializeSettings(browser));
  assert.equal(validateSettings({...browser,"eq-q":0.15},"browser"),null);
  assert.deepEqual(validateSettings({...browser,sourcePath:"secret.mp3"},"browser"),browser);
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
    const values={...defaultSettings("browser"),"gain-enabled":true,"limiter-enabled":false,"volume-gain":-6};
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
