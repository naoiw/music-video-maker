import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { repositoryVersions, assertReleaseVersion } from '../scripts/release-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

test('actual release manifests agree on a stable version', () => {
  const versions = repositoryVersions();
  assert.equal(assertReleaseVersion('v' + versions[0], versions), versions[0]);
});

test('actual unapproved lock blocks CLI before creating a download directory', () => {
  const lock = JSON.parse(read('packaging/ffmpeg-lock.json'));
  const tag = 'v' + repositoryVersions()[0];
  const dir = mkdtempSync(join(tmpdir(), 'mvm-release-gate-'));
  try {
    const output = join(dir, 'inputs');
    const script = join(root, 'scripts', 'release-inputs.mjs');
    const checked = spawnSync(process.execPath, [script, tag, '--check'], { encoding: 'utf8' });
    if (!lock.approved) {
      assert.notEqual(checked.status, 0);
      assert.match(checked.stderr, /redistribution review is incomplete/);
      const result = spawnSync(process.execPath, [script, tag, output], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /redistribution review is incomplete/);
      assert.equal(existsSync(output), false);
    } else {
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /no downloads performed/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release workflow has one publish job and dispatch cannot publish', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.equal([...workflow.matchAll(/^  publish:/gm)].length, 1);
  assert.equal([...workflow.matchAll(/^      - name: Verify approval and download pinned inputs$/gm)].length, 1);
  assert.match(workflow, /^  publish:\r?\n    if: github\.event_name == 'push'\r?\n    needs: build$/m);
  assert.ok(workflow.includes("if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot resolve release commit.' }"));
  assert.ok(workflow.includes('"commit=$commit" >> $env:GITHUB_OUTPUT'));
  assert.equal([...workflow.matchAll(/^          gh release edit "\$RELEASE_TAG" --draft=false$/gm)].length, 1);
});
