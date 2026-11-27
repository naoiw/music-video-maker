import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/services/settings-schema.ts";
import {
  addPreset, defaultFilterSettings, filterIds, normalizePresetName, parsePresets,
  removePreset, serializePresets, validateFilterSettings, MAX_PRESETS,
} from "../src/services/preset-schema.ts";

test("multiple presets round-trip independently including disabled values and limiter", () => {
  const a = { ...defaultSettings(), resolution: "1080x1080", "noise-enabled": true,
    "noise-reduction": 12, "lowpass-hz": 18000, "gain-enabled": true, "limiter-enabled": false };
  const b = { ...defaultSettings(), "eq-enabled": true, "eq-q": 1.7, "eq-gain": -2.5 };
  let presets = addPreset([], "  Rock  ", a);
  presets = addPreset(presets, "バラード", b);
  const restored = parsePresets(serializePresets(presets));
  assert.deepEqual(restored, presets);
  assert.deepEqual(restored[0].filters, validateFilterSettings(a));
  assert.deepEqual(restored[1].filters, validateFilterSettings(b));
  assert.equal(restored[0].filters["lowpass-hz"], 18000);
  assert.equal(restored[0].filters["limiter-enabled"], false);
  assert.equal(filterIds.length, 18);
  assert.equal("resolution" in restored[0].filters, false);
  assert.equal("fps" in restored[0].filters, false);
  a["noise-reduction"] = 20;
  assert.equal(presets[0].filters["noise-reduction"], 12);
});

test("default filters reset all flags and preserve output values when applied", () => {
  const initial = { ...defaultSettings(), fps: "60", resolution: "1080x1920",
    "noise-enabled": true, "noise-reduction": 20 };
  const reset = { ...initial, ...defaultFilterSettings() };
  assert.equal(reset.fps, "60");
  assert.equal(reset.resolution, "1080x1920");
  assert.equal(reset["noise-reduction"], 6);
  assert.ok(filterIds.filter(id => id.endsWith("-enabled")).every(id => reset[id] === false));
});

test("rejects invalid names, duplicate normalized names, invalid values and limit", () => {
  const filters = defaultFilterSettings();
  for (const name of ["", " ", "a".repeat(41), "a\nb", null]) {
    assert.equal(normalizePresetName(name), null);
  }
  const presets = addPreset([], "Rock", filters);
  assert.throws(() => addPreset(presets, " rock ", filters));
  assert.throws(() => addPreset(presets, "X", { ...filters, "eq-q": 0.15 }));
  assert.throws(() => addPreset(presets, "X", {}));
  const full = Array.from({ length: MAX_PRESETS }, (_, i) => ({ name: String(i), filters }));
  assert.throws(() => addPreset(full, "extra", filters));
  assert.deepEqual(parsePresets(serializePresets(full)), full);
});

test("rejects corrupt and unsupported preset files; delete and clear retain other settings", () => {
  const first = addPreset([], "One", defaultFilterSettings());
  const both = addPreset(first, "Two", { ...defaultFilterSettings(), "eq-gain": 4 });
  for (const raw of ["{", "null", "[]", '{"version":2,"presets":[]}',
    '{"version":1,"presets":[{"name":"One","filters":{}}]}',
    JSON.stringify({ version: 1, presets: [first[0], first[0]] }),
  ]) assert.equal(parsePresets(raw), null);
  assert.deepEqual(removePreset(both, "Two"), first);
  assert.equal(both.length, 2);
  assert.deepEqual(parsePresets(serializePresets([])), []);
  assert.throws(() => serializePresets([{ name: "bad", filters: {} }]));
});
