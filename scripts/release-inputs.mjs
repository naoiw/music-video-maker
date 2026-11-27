import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertApproved, verifyHash } from './package-windows.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertReleaseVersion(tag, versions) {
  if (typeof tag !== 'string' || !stableTag.test(tag) || tag.trim() !== tag) {
    throw new Error('Expected a stable vMAJOR.MINOR.PATCH tag.');
  }
  if (!Array.isArray(versions) || versions.length !== 3 ||
      versions.some(version => version !== tag.slice(1))) {
    throw new Error('Tag must match package.json, Cargo.toml and tauri.conf.json versions.');
  }
  return tag.slice(1);
}

export function releaseInputs(lock) {
  assertApproved(lock);
  const inputs = [
    { name: 'ffmpeg.zip', url: lock.binaryArchive.url, sha256: lock.binaryArchive.sha256 },
    { name: 'corresponding-source.zip', url: lock.sourceArchiveUrl, sha256: lock.sourceArchiveSha256 },
    { name: 'third-party-notices.txt', url: lock.noticesUrl, sha256: lock.noticesSha256 },
  ];
  for (const input of inputs) {
    let url;
    try { url = new URL(input.url); } catch {
      throw new Error('Missing approved HTTPS URL for ' + input.name);
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Expected an HTTPS URL without credentials for ' + input.name);
    }
  }
  return inputs;
}

async function download(input, directory) {
  const path = join(directory, input.name);
  const response = await fetch(input.url, {
    redirect: 'follow', signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') {
    throw new Error('Download failed: ' + input.name);
  }
  // The directory is created exclusively for this run.
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }));
  await verifyHash(path, input.sha256);
}

function json(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

export function repositoryVersions() {
  const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const packageSection = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  // Cargo version is currently a literal in the package section.
  const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  return [json('package.json').version, cargoVersion, json('src-tauri/tauri.conf.json').version];
}

async function main() {
  const [tag, output, ...rest] = process.argv.slice(2);
  if (!tag || !output || rest.length) {
    throw new Error('Usage: node scripts/release-inputs.mjs <tag> <new-input-directory | --check>');
  }
  assertReleaseVersion(tag, repositoryVersions());
  const inputs = releaseInputs(json('packaging/ffmpeg-lock.json'));
  if (output === '--check') {
    console.log('Release version and approved input metadata are valid; no downloads performed.');
    return;
  }
  const directory = resolve(output);
  mkdirSync(directory);
  try {
    for (const input of inputs) await download(input, directory);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
