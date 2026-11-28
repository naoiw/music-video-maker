import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, parseSettings, serializeSettings, validateSettings, settingsIds } from "../src/services/settings-schema.ts";
import { createSettingsWriter } from "../src/services/settings-writer.ts";

test("defaults round-trip; disabled filter values and manual limiter state persist", () => {
  const values = { ...defaultSettings(), resolution: "1080x1080", fps: "60", quality: "16",
    fit: "cover", "lowpass-hz": 18000, "eq-q": 1.7, "gain-enabled": true,
    "volume-gain": 2.5, "limiter-enabled": false };
  assert.deepEqual(parseSettings(serializeSettings(values)), values);
  assert.equal(defaultSettings()["lowpass-hz"], 12000);
  assert.equal(defaultSettings()["gain-enabled"], false);
  assert.equal(defaultSettings().fps, "30");
  assert.equal(settingsIds.length, 23);
  assert.equal(defaultSettings().encoder, "cpu");
  assert.ok(settingsIds.filter(id => id.endsWith("-enabled")).every(id => defaultSettings()[id] === false));
});

test("rejects corrupt, missing, unsupported, wrong type and out-of-range settings", () => {
  for (const raw of ["{", "null", "[]", "{}", '{"version":2,"values":{}}',
    '{"version":1,"values":{}}']) assert.equal(parseSettings(raw), null);
  const values = defaultSettings();
  for (const invalid of [{ fps: 30 }, { resolution: "1280x720" }, { "noise-enabled": "false" },
    { "eq-q": 0.15 }, { "eq-hz": 20001 }, { "volume-gain": NaN }, { "loudness-peak": -0.5 },
    { "noise-reduction": null }, { "limiter-ceiling": -1.25 }]) {
    assert.equal(validateSettings({ ...values, ...invalid }), null);
  }
  const missing = { ...values };
  delete missing["fit"];
  assert.equal(validateSettings(missing), null);
  assert.equal(parseSettings(JSON.stringify({ version: 2, values })), null);
  assert.deepEqual(validateSettings({ ...values, sourcePath: "secret.mp3" }), values);
});

test("writes sequentially, coalesces edits and retains last valid snapshot", async () => {
  const writes = [];
  const states = [];
  let release;
  const writer = createSettingsWriter(async json => {
    writes.push(parseSettings(json).fps);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  }, state => states.push(state), null);
  const first = writer(defaultSettings());
  await writer({ ...defaultSettings(), fps: "24" });
  await writer({ ...defaultSettings(), fps: "60" });
  await writer(null);
  release();
  await first;
  assert.deepEqual(writes, ["30", "60"]);
  assert.equal(states.at(-1), "invalid");
  await writer({ ...defaultSettings(), fps: "60" });
  assert.deepEqual(writes, ["30", "60"]);
  assert.equal(states.at(-1), "saved");
});

test("write failure is reported and the next edit retries", async () => {
  const states = [];
  let attempts = 0;
  const writer = createSettingsWriter(async () => {
    if (++attempts === 1) throw new Error("write failed");
  }, state => states.push(state), null);
  await writer(defaultSettings());
  assert.equal(states.at(-1), "error");
  await writer(defaultSettings());
  assert.equal(attempts, 2);
  assert.equal(states.at(-1), "saved");
});

test("blurred layout is the default while existing saved contain and cover choices are retained", () => {
  assert.equal(defaultSettings().fit, "blurred");
  for (const fit of ["blurred", "contain", "cover"]) {
    const values = { ...defaultSettings(), fit };
    assert.equal(parseSettings(serializeSettings(values)).fit, fit);
  }
  assert.equal(validateSettings({ ...defaultSettings(), fit: "unknown" }), null);
});

test("legacy settings migrate only the missing encoder; unknown encoders are rejected", () => {
  const values = { ...defaultSettings(), fps: "60", "volume-gain": -6 };
  delete values.encoder;
  assert.deepEqual(parseSettings(JSON.stringify({ version: 1, values })), { ...values, encoder: "cpu" });
  for (const encoder of ["cpu", "auto", "nvenc", "qsv", "amf", "videotoolbox"]) {
    const current = { ...defaultSettings(), encoder };
    assert.deepEqual(parseSettings(serializeSettings(current)), current);
  }
  assert.equal(parseSettings(JSON.stringify({ version: 1, values: { ...values, encoder: "unknown" } })), null);
  assert.equal(validateSettings({ ...defaultSettings(), encoder: "unknown" }), null);
});
