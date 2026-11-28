import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCoreLock, assertPublicationReview } from "./web-publication-gate.mjs";

const lock = JSON.parse(await readFile(new URL("../web/core-lock.json",import.meta.url),"utf8"));
const publish = process.argv.includes("--publish");
const manifestPath = new URL("../web/public/core-manifest.json",import.meta.url);
await rm(manifestPath,{force:true});
assertCoreLock(lock);
if (publish) assertPublicationReview(lock);
const digest = (algorithm, bytes, encoding="hex") => createHash(algorithm).update(bytes).digest(encoding);
async function fetchBytes(url, max) {
  const response = await fetch(url,{redirect:"error",signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > max) throw new Error("Invalid download size: " + url);
  return bytes;
}
const version = lock.version;
const registry = JSON.parse(await fetchBytes("https://registry.npmjs.org/@ffmpeg%2fcore/" + version,1_000_000));
const integrity = registry.dist?.integrity;
if (registry.name !== "@ffmpeg/core" || registry.version !== version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? ""))
  throw new Error("Invalid registry metadata");
if (integrity !== lock.registryIntegrity) throw new Error("Registry integrity changed");
const tarURL = "https://registry.npmjs.org/@ffmpeg/core/-/core-" + version + ".tgz";
if (registry.dist.tarball !== tarURL) throw new Error("Unexpected tarball URL");
const tar = await fetchBytes(tarURL,100*1024*1024);
if ("sha512-" + digest("sha512",tar,"base64") !== integrity) throw new Error("Tarball integrity mismatch");
const tmp = await mkdtemp(join(tmpdir(),"mvm-core-"));
try {
  const archive = join(tmp,"core.tgz");
  await writeFile(archive,tar);
  const manifest = { version, registryIntegrity:integrity };
  for (const [filename,key,limit] of [["ffmpeg-core.js","coreJsSha256",2*1024*1024],["ffmpeg-core.wasm","coreWasmSha256",40*1024*1024]]) {
    const upstream = execFileSync("tar",["-xOf",archive,"package/dist/umd/"+filename],{maxBuffer:limit});
    const remote = await fetchBytes("https://cdn.jsdelivr.net/npm/@ffmpeg/core@"+version+"/dist/umd/"+filename,limit);
    const sha = digest("sha256",upstream);
    if (digest("sha256",remote) !== sha) throw new Error("CDN differs from registry tarball: " + filename);
    if (lock[key] !== sha) throw new Error("Reviewed hash mismatch: " + filename);
    manifest[key] = sha;
  }
  await mkdir(new URL("../web/public/",import.meta.url),{recursive:true});
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+"\n");
  console.log(JSON.stringify(manifest,null,2));
  console.log(publish ? "Reviewed core verified for publication." : "Test-only manifest generated; publication is not approved.");
} finally {
  await rm(tmp,{recursive:true,force:true});
}
