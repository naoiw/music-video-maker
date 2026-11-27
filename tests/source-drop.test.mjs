import test from "node:test";
import assert from "node:assert/strict";
import { classifyDroppedSources } from "../src/services/source-drop.ts";

test("classifies one MP3 and each supported image, case insensitive", () => {
  const audio = "C:\\楽曲\\test song.MP3";
  assert.deepEqual(classifyDroppedSources([audio]), { audio });
  for (const visual of ["C:\\素材\\a.PNG", "/tmp/a.jpg", "/tmp/a.JPEG", "/tmp/a.GIF"]) {
    assert.deepEqual(classifyDroppedSources([visual]), { visual });
    assert.deepEqual(classifyDroppedSources([visual, audio]), { audio, visual });
    assert.deepEqual(classifyDroppedSources([audio, visual]), { audio, visual });
  }
});

test("rejects multiple files of the same kind and unsupported mixed drops", () => {
  for (const paths of [
    ["a.mp3", "b.MP3"],
    ["a.png", "b.gif"],
    ["a.mp3", "b.wav"],
    ["a.png", "a.mp3.exe"],
    ["C:\\folder.png\\subfolder"],
    [],
  ]) {
    assert.throws(() => classifyDroppedSources(paths));
  }
});
