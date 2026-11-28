import test from "node:test";
import assert from "node:assert/strict";
import { droppedPath, isDropTarget } from "../src/services/source-drop.ts";

test("validates a destination independently of the file extension", () => {
  for (const target of ["audio", "visual", "overlay"]) assert.equal(isDropTarget(target), true);
  for (const target of ["", "unknown", undefined]) assert.equal(isDropTarget(target), false);
  for (const path of ["C:\\素材\\音声.mp4", "test.webm", "song.wav", "cover.PNG"]) {
    assert.equal(droppedPath([path]), path);
  }
});

test("rejects empty and multiple-file drops", () => {
  for (const paths of [[], [""], ["a.mp3", "b.png"], ["a.mp4", "b.mp4"]]) {
    assert.throws(() => droppedPath(paths));
  }
});
