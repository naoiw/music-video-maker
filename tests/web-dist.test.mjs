import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWebDist } from "../scripts/check-web-dist.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mvm-web-dist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets", "nested"), { recursive: true });
  await writeFile(join(root, "core-manifest.json"), JSON.stringify({
    version: "0.12.10",
    coreJsSha256: "a".repeat(64),
    coreWasmSha256: "b".repeat(64),
  }));
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "assets", "index.js"), "console.log('ok');");
  await writeFile(join(root, "assets", "nested", "style.css"), "body {}");
  return root;
}

test("checks nested Vite assets without recursing back to the root", { timeout: 3000 }, async t => {
  const root = await fixture(t);
  await checkWebDist(root);
});

test("rejects forbidden files in nested output directories", { timeout: 3000 }, async t => {
  const root = await fixture(t);
  await writeFile(join(root, "assets", "nested", "ffmpeg-core.js"), "forbidden");
  await assert.rejects(checkWebDist(root), /Unexpected published asset/);
});

test("rejects disguised WASM binaries", { timeout: 3000 }, async t => {
  const root = await fixture(t);
  await writeFile(join(root, "assets", "nested", "engine.bin"), Buffer.from([0, 97, 115, 109]));
  await assert.rejects(checkWebDist(root), /WASM binary in output/);
});
