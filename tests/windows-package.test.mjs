import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertApproved, verifyHash } from '../scripts/package-windows.mjs';

const hash = 'a'.repeat(64);
const valid = {
  schemaVersion: 1, approved: true, version: '8.1.2',
  binaryArchive: { url: 'https://example.com/build.zip', sha256: hash, directory: 'build' },
  sourceArchiveSha256: hash, noticesSha256: hash,
  configuration: '--enable-gpl --enable-libx264 --enable-libmp3lame',
  review: 'Test fixture only',
};

test('release lock fails closed unless all reviewed metadata is present', () => {
  const actual = JSON.parse(readFileSync(new URL('../packaging/ffmpeg-lock.json', import.meta.url), 'utf8'));
  if (!actual.approved) assert.throws(() => assertApproved(actual), /review is incomplete/);
  else assert.doesNotThrow(() => assertApproved(actual));
  assert.doesNotThrow(() => assertApproved(valid));
  assert.throws(() => assertApproved({ ...valid, approved: false }));
  for (const key of ['sourceArchiveSha256', 'noticesSha256', 'review', 'configuration']) {
    assert.throws(() => assertApproved({ ...valid, [key]: null }));
  }
  assert.throws(() => assertApproved({ ...valid, binaryArchive: { ...valid.binaryArchive, directory: '..' } }));
  assert.throws(() => assertApproved({ ...valid, configuration: valid.configuration + ' --enable-nonfree' }));
  assert.throws(() => assertApproved({ ...valid, configuration: valid.configuration + ' --enable-shared' }));
  assert.throws(() => assertApproved({ ...valid, configuration: '--enable-gpl' }));
});

test('archive hashes accept exact contents and reject modified or missing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mvm-package-test-'));
  try {
    const path = join(dir, 'archive.zip');
    const bytes = Buffer.from('fixture');
    const expected = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path, bytes);
    await verifyHash(path, expected.toUpperCase());
    writeFileSync(path, 'changed');
    await assert.rejects(verifyHash(path, expected), /SHA-256 mismatch/);
    await assert.rejects(verifyHash(path, null), /Missing SHA-256/);
    await assert.rejects(verifyHash(join(dir, 'missing'), expected));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
