import test from "node:test";
import assert from "node:assert/strict";
import { defaultLayerGeometry, validLayerGeometry, parseLayerGeometry, layerPixelRect, moveLayer, MAX_OVERLAYS, defaultVisualizer, defaultVisualizerGeometry, validVisualizer, visualizerStyles } from "../src/services/layers.ts";

test("defaults and precise percent parsing match the IPC contract", () => {
  assert.equal(MAX_OVERLAYS, 8);
  assert.deepEqual(parseLayerGeometry({ x: "25", y: "25", width: "50", height: "50", opacity: "100" }), defaultLayerGeometry());
  assert.deepEqual(parseLayerGeometry({ x: "0.01", y: "0", width: "99.99", height: "100", opacity: "0" }),
    { x: 1, y: 0, width: 9999, height: 10000, opacity: 0 });
});

test("rejects invalid positions, sizes, opacity and non-numbers", () => {
  const valid = { x: "25", y: "25", width: "50", height: "50", opacity: "100" };
  for (const patch of [{ x: "51" }, { y: "-1" }, { width: "0" }, { height: "75.01" }, { opacity: "101" }, { opacity: "50.5" }, { x: "" }, { y: "1e1" }, { width: "0.001" }]) {
    assert.equal(parseLayerGeometry({ ...valid, ...patch }), null);
  }
  assert.equal(validLayerGeometry({ ...defaultLayerGeometry(), x: NaN }), false);
});

test("preview pixel rectangles use the same rounding for all output sizes", () => {
  const g = defaultLayerGeometry();
  assert.deepEqual(layerPixelRect(g, 1920, 1080), { x: 480, y: 270, width: 960, height: 540 });
  assert.deepEqual(layerPixelRect(g, 1080, 1080), { x: 270, y: 270, width: 540, height: 540 });
  assert.deepEqual(layerPixelRect(g, 1080, 1920), { x: 270, y: 480, width: 540, height: 960 });
  assert.deepEqual(layerPixelRect({ x: 9999, y: 9999, width: 1, height: 1, opacity: 100 }, 1080, 1920),
    { x: 1079, y: 1919, width: 1, height: 1 });
});

test("reordering changes the back-to-front sequence without losing entries", () => {
  const layers = ["background overlay", "foreground overlay", "logo"];
  assert.equal(moveLayer(layers, 0, -1), false);
  assert.equal(moveLayer(layers, 2, 1), false);
  assert.equal(moveLayer(layers, 0, 1), true);
  assert.deepEqual(layers, ["foreground overlay", "background overlay", "logo"]);
  assert.equal(moveLayer(layers, 2, -1), true);
  assert.deepEqual(layers, ["foreground overlay", "logo", "background overlay"]);
});

test("visualizer defaults fit the canvas and validate only known settings", () => {
  assert.ok(validLayerGeometry(defaultVisualizerGeometry()));
  assert.equal(defaultVisualizer().audioSource, "processed");
  for (const style of visualizerStyles) assert.ok(validVisualizer({ ...defaultVisualizer(), style }));
  for (const patch of [{ style: "unknown" }, { audioSource: "mixed" }, { color: "#fff" }, { color: "#fffffg" }, { color: "red;evil" }, { transparent: "true" }]) {
    assert.equal(validVisualizer({ ...defaultVisualizer(), ...patch }), false);
  }
});
