import test from "node:test";
import assert from "node:assert/strict";
import { comparisonDuration, waveformScale, spectrumX, seekValue, dbLabel, timeLabel } from "../src/services/analysis-data.ts";

test("uses a common timeline and non-clipping amplitude scale", () => {
  const data = { original: { durationSeconds: 12, peak: 0.5 }, processed: { durationSeconds: 13, peak: 1.8 } };
  assert.equal(comparisonDuration(data), 13);
  assert.equal(waveformScale(data), 1.8);
  assert.equal(waveformScale({ original: { peak: 0 }, processed: { peak: 0.5 } }), 1);
});
test("log axis follows actual sample rate and seek stays within preview range", () => {
  for (const nyquist of [4000, 22050, 24000]) {
    assert.equal(spectrumX(20, nyquist), 0);
    assert.equal(spectrumX(nyquist, nyquist), 1);
    assert.ok(spectrumX(1000, nyquist) > spectrumX(100, nyquist));
  }
  assert.equal(seekValue(0.5, 120, 119), 60);
  assert.equal(seekValue(1, 120, 119), 119);
  assert.equal(seekValue(-1, 120, 119), 0);
  assert.equal(dbLabel(0), "−∞ dBFS");
  assert.equal(dbLabel(0.5), "-6.0 dBFS");
  assert.equal(dbLabel(1), "0.0 dBFS");
  assert.equal(timeLabel(123), "2:03");
});
