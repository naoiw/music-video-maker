import test from "node:test";
import assert from "node:assert/strict";
import { describeError } from "../src/services/errors.ts";

test("classified backend errors show actionable guidance and retain diagnostics", () => {
  const cases = [
    ["DISK_FULL", "空き容量"],
    ["PERMISSION", "権限"],
    ["PATH_MISSING", "選択し直"],
    ["OUTPUT_EXISTS", "別の名前"],
    ["FILE_BUSY", "他のアプリ"],
    ["TOOL_MISSING", "PATH"],
    ["TOOL_FEATURE", "コーデック"],
    ["INVALID_MEDIA", "破損"],
    ["OUTPUT_VERIFY", "再生時間"],
    ["FILTER", "サンプリング周波数"],
    ["INPUT_IMAGE", "32 MiB"],
  ];
  for (const [code, hint] of cases) {
    const error = describeError("encode", `[MVM:${code}] original error`);
    assert.equal(error.code, code);
    assert.ok(error.message.includes(hint));
    assert.equal(error.detail, "original error");
  }
});

test("unknown errors use operation-specific fallback and retain the original detail", () => {
  const error = describeError("audio", new Error("broken file"));
  assert.equal(error.code, "UNKNOWN");
  assert.ok(error.message.includes("MP3"));
  assert.equal(error.detail, "Error: broken file");
  assert.equal(describeError("encode", "[MVM:FUTURE] detail").code, "UNKNOWN");
  assert.equal(describeError("encode", "[MVM:FUTURE] detail").detail, "[MVM:FUTURE] detail");
  assert.ok(describeError("output", "dialog failure").message.includes("保存先"));
});

test("diagnostics bound large error messages", () => {
  const error = describeError("encode", "あ".repeat(10000));
  assert.ok(error.detail.endsWith("(truncated)"));
  assert.ok(error.detail.length < 8250);
});
