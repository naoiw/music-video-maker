import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCoreLock, assertPublicationReview, assertPublicationManifest, REVIEW_ITEMS, CORE_FIELDS } from "../scripts/web-publication-gate.mjs";
import { checkWebDist } from "../scripts/check-web-dist.mjs";

// Synthetic evidence only; never modify the actual repository approval.
const lock=JSON.parse(await readFile(new URL("../web/core-lock.json",import.meta.url),"utf8"));
const core=Object.fromEntries(CORE_FIELDS.map(key=>[key,lock[key]]));
function reviewed(){
  return {...lock,approved:true,review:{
    schemaVersion:1,reviewer:"Synthetic test reviewer",reviewedOn:"2026-11-28",
    decisionReference:"Synthetic test decision",core:{...core},
    items:Object.fromEntries(REVIEW_ITEMS.map(key=>[key,{status:"accepted",evidence:"Synthetic test evidence: "+key}])),
  }};
}
test("requires exact pinned hash formats even in test mode",()=>{
  assert.doesNotThrow(()=>assertCoreLock(lock));
  for(const patch of [{registryIntegrity:""},{coreJsSha256:"x".repeat(64)},{coreWasmSha256:null},{approved:"true"},{version:"latest"}])
    assert.throws(()=>assertCoreLock({...lock,...patch}),/Invalid pinned core lock/);
});
test("rejects false approval and incomplete or malformed review",()=>{
  for(const review of [null,"ok",{},true,{...reviewed().review,reviewer:" "},{...reviewed().review,reviewedOn:"2026-02-30"},{...reviewed().review,decisionReference:""}])
    assert.throws(()=>assertPublicationReview({...lock,approved:true,review}),/Publication blocked/);
  assert.throws(()=>assertPublicationReview({...reviewed(),approved:false}),/Publication blocked/);
});
test("requires every review item, accepted status, evidence and exact core identity",()=>{
  assert.doesNotThrow(()=>assertPublicationReview(reviewed()));
  for(const key of REVIEW_ITEMS){
    const absent=reviewed();delete absent.review.items[key];
    assert.throws(()=>assertPublicationReview(absent),/unresolved review item/);
    for(const item of [{status:"pending",evidence:"pending"},{status:"accepted",evidence:" "}]) {
      const invalid=reviewed();invalid.review.items[key]=item;
      assert.throws(()=>assertPublicationReview(invalid),/unresolved review item/);
    }
  }
  for(const key of CORE_FIELDS){
    const mismatch=reviewed();mismatch.review.core[key]="different";
    assert.throws(()=>assertPublicationReview(mismatch),/exact pinned core/);
  }
});
test("publication rejects a manifest not matching all reviewed hashes",()=>{
  assert.doesNotThrow(()=>assertPublicationManifest(reviewed(),core));
  for(const key of CORE_FIELDS)
    assert.throws(()=>assertPublicationManifest(reviewed(),{...core,[key]:"different"}),/built manifest/);
});
test("publication artifact requires notice and matching approved manifest",async t=>{
  const root=await mkdtemp(join(tmpdir(),"mvm-publish-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,"core-manifest.json"),JSON.stringify(core));
  await writeFile(join(root,"index.html"),"<!doctype html>");
  await assert.rejects(checkWebDist(root,reviewed()),/ENOENT/);
  await writeFile(join(root,"third-party-notices.html"),"@ffmpeg/core 0.12.10 GPL-2.0-or-later");
  await checkWebDist(root,reviewed());
  await assert.rejects(checkWebDist(root,{...reviewed(),approved:false}),/Publication blocked/);
  await writeFile(join(root,"core-manifest.json"),JSON.stringify({...core,coreWasmSha256:"a".repeat(64)}));
  await assert.rejects(checkWebDist(root,reviewed()),/built manifest/);
});
