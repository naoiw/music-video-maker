import test from "node:test";
import assert from "node:assert/strict";
import { encoderLabels, qualityLabel } from "../src/services/encoder.ts";
import { settingsFields } from "../src/services/settings-schema.ts";
import { filterIds } from "../src/services/preset-schema.ts";

test("GPU options have distinct labels; quality tiers are not labeled CRF", () => {
  for (const encoder of settingsFields.encoder.options) {
    assert.ok(encoderLabels[encoder]);
    for (const quality of [16, 20, 24]) {
      assert.equal(qualityLabel(encoder, quality).includes("CRF"), encoder === "cpu");
    }
  }
  assert.equal(new Set(Object.values(encoderLabels)).size, 6);
  assert.ok(!filterIds.includes("encoder"));
});
