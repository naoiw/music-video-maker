import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
const root = new URL("../dist-web/",import.meta.url);
const manifest = JSON.parse(await readFile(new URL("core-manifest.json",root),"utf8"));
if (manifest.version !== "0.12.10" || !/^[a-f0-9]{64}$/.test(manifest.coreJsSha256) || !/^[a-f0-9]{64}$/.test(manifest.coreWasmSha256))
  throw new Error("Missing verified core manifest; run pnpm web:prepare");
async function walk(path) {
  for (const item of await readdir(path,{withFileTypes:true})) {
    const entry = join(path,item.name);
    if (item.isDirectory()) await walk(entry);
    else {
      if (!item.isFile() || /\.wasm$/i.test(item.name) || /ffmpeg-core\.(?:js|wasm)$/i.test(item.name) || (await stat(entry)).size > 2*1024*1024)
        throw new Error("Unexpected published asset: " + entry);
      const header = (await readFile(entry)).subarray(0,4);
      if (header.equals(Buffer.from([0,97,115,109]))) throw new Error("WASM binary in output");
    }
  }
}
await walk(new URL(".",root).pathname.replace(/^\/([A-Za-z]:\/)/,"$1"));
console.log("Web assets checked: no WASM or FFmpeg core files.");
