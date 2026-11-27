import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseVersion, releaseInputs } from '../scripts/release-inputs.mjs';

const hash = 'a'.repeat(64);
const approved = {
  schemaVersion: 1, approved: true, version: '8.1.2',
  binaryArchive: { url: 'https://example.com/ffmpeg.zip', sha256: hash, directory: 'build' },
  sourceArchiveSha256: hash, noticesSha256: hash,
  sourceArchiveUrl: 'https://example.com/source.zip',
  noticesUrl: 'https://example.com/notices.txt',
  configuration: '--enable-gpl --enable-libx264 --enable-libmp3lame',
  review: 'Test fixture only',
};

test('stable version tags must match all three app manifests', () => {
  const versions = ['0.1.0', '0.1.0', '0.1.0'];
  assert.equal(assertReleaseVersion('v0.1.0', versions), '0.1.0');
  for (const tag of ['0.1.0', 'v00.1.0', 'v0.1.0-rc.1', 'v0.1.0+build', 'v0.2.0', 'v0.1.0\n', 'v0.1.0; echo bad']) {
    assert.throws(() => assertReleaseVersion(tag, versions));
  }
  for (let i = 0; i < versions.length; i++) {
    const mismatched = [...versions];
    mismatched[i] = '0.2.0';
    assert.throws(() => assertReleaseVersion('v0.1.0', mismatched));
  }
  assert.throws(() => assertReleaseVersion('v0.1.0', []));
});

test('release inputs require an approved lock and three pinned HTTPS downloads', () => {
  assert.deepEqual(releaseInputs(approved).map(input => input.name), [
    'ffmpeg.zip', 'corresponding-source.zip', 'third-party-notices.txt',
  ]);
  assert.throws(() => releaseInputs({ ...approved, approved: false }));
  for (const key of ['sourceArchiveUrl', 'noticesUrl']) {
    for (const value of [null, 'http://example.com/file', 'https://user:pass@example.com/file']) {
      assert.throws(() => releaseInputs({ ...approved, [key]: value }));
    }
  }
  assert.throws(() => releaseInputs({ ...approved, sourceArchiveSha256: null }));
  assert.throws(() => releaseInputs({
    ...approved, binaryArchive: { ...approved.binaryArchive, url: 'https://user@example.com/file' },
  }));
});
