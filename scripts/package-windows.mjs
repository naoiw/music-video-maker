import { createHash } from 'node:crypto';
import { createReadStream, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const hashPattern = /^[a-f0-9]{64}$/i;

export function assertApproved(lock) {
  if (lock?.schemaVersion !== 1 || lock.approved !== true) {
    throw new Error('FFmpeg redistribution review is incomplete.');
  }
  const archive = lock.binaryArchive;
  if (!archive || !hashPattern.test(archive.sha256 ?? '') ||
      !hashPattern.test(lock.sourceArchiveSha256 ?? '') ||
      !hashPattern.test(lock.noticesSha256 ?? '') ||
      typeof archive.url !== 'string' || !archive.url.startsWith('https://') ||
      typeof archive.directory !== 'string' || !/^[\w.-]+$/.test(archive.directory) ||
      ['.', '..'].includes(archive.directory) ||
      typeof lock.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(lock.version) ||
      typeof lock.configuration !== 'string' ||
      typeof lock.review !== 'string' || !lock.review.trim()) {
    throw new Error('Incomplete pinned distribution metadata.');
  }
  const flags = new Set(lock.configuration.split(/\s+/));
  for (const flag of ['--enable-gpl', '--enable-libx264', '--enable-libmp3lame']) {
    if (!flags.has(flag)) throw new Error('Missing required build flag: ' + flag);
  }
  if (flags.has('--enable-nonfree') || flags.has('--enable-shared')) {
    throw new Error('Nonfree or shared FFmpeg builds are not supported.');
  }
}

export async function verifyHash(path, expected) {
  if (!hashPattern.test(expected ?? '')) throw new Error('Missing SHA-256: ' + path);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== expected.toLowerCase()) {
    throw new Error('SHA-256 mismatch: ' + path);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' failed: ' + (result.stderr || result.stdout));
  }
  return result;
}

function checkVersion(tool, name, lock, cwd) {
  const result = run(tool, ['-version'], cwd);
  const lines = (result.stdout + '\n' + result.stderr).split(/\r?\n/);
  const version = lines.find(line => line.startsWith(name + ' version '));
  const versionToken = version?.split(/\s+/)[2];
  if (versionToken !== lock.version && !versionToken?.startsWith(lock.version + '-')) {
    throw new Error('Unexpected version: ' + name);
  }
  const configuration = lines.find(line => line.trimStart().startsWith('configuration:'));
  const actual = configuration?.trim().slice('configuration:'.length).trim();
  if (actual !== lock.configuration.trim()) throw new Error('Build configuration mismatch: ' + name);
}

function smokeTest(ffmpeg, ffprobe, cwd) {
  const output = join(cwd, 'smoke.mp4');
  run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output], cwd);
  const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output], cwd).stdout);
  if (!info.streams?.some(s => s.codec_type === 'video' && s.codec_name === 'h264' &&
      s.width === 320 && s.height === 240 && s.pix_fmt === 'yuv420p') ||
      !info.streams?.some(s => s.codec_type === 'audio' && s.codec_name === 'aac')) {
    throw new Error('Bundled FFmpeg smoke test failed.');
  }
}

async function main() {
  const lock = JSON.parse(readFileSync(join(root, 'packaging', 'ffmpeg-lock.json'), 'utf8'));
  assertApproved(lock);
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Package must be built on Windows x64.');
  }
  if (process.argv.length !== 6) {
    throw new Error('Usage: npm run package:windows -- <ffmpeg.zip> <corresponding-source.zip> <third-party-notices.txt> <output.zip>');
  }
  const [archive, sources, notices, output] = process.argv.slice(2).map(p => resolve(p));
  if (!output.toLowerCase().endsWith('.zip') || existsSync(output)) {
    throw new Error('Output must be a new ZIP file.');
  }
  const app = join(root, 'src-tauri', 'target', 'release', 'music-video-maker.exe');
  if (!existsSync(app)) throw new Error('Run desktop:build first.');
  await verifyHash(archive, lock.binaryArchive.sha256);
  await verifyHash(sources, lock.sourceArchiveSha256);
  await verifyHash(notices, lock.noticesSha256);

  const work = mkdtempSync(join(tmpdir(), 'mvm-package-'));
  try {
    const unpack = join(work, 'unpack');
    const stage = join(work, 'Music Video Maker');
    const thirdParty = join(stage, 'third-party');
    mkdirSync(unpack);
    mkdirSync(thirdParty, { recursive: true });
    run('tar.exe', ['-xf', archive, '-C', unpack], work);
    const vendor = join(unpack, lock.binaryArchive.directory);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      copyFileSync(join(vendor, 'bin', name), join(stage, name), constants.COPYFILE_EXCL);
    }
    copyFileSync(app, join(stage, 'music-video-maker.exe'), constants.COPYFILE_EXCL);
    copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'), constants.COPYFILE_EXCL);
    copyFileSync(join(root, 'packaging', 'README.txt'), join(stage, 'README.txt'), constants.COPYFILE_EXCL);
    copyFileSync(join(vendor, 'LICENSE'), join(thirdParty, 'FFmpeg-LICENSE.txt'), constants.COPYFILE_EXCL);
    copyFileSync(sources, join(thirdParty, 'corresponding-source.zip'), constants.COPYFILE_EXCL);
    copyFileSync(notices, join(thirdParty, 'THIRD-PARTY-NOTICES.txt'), constants.COPYFILE_EXCL);
    writeFileSync(join(thirdParty, 'ffmpeg-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const ffmpeg = join(stage, 'ffmpeg.exe');
    const ffprobe = join(stage, 'ffprobe.exe');
    checkVersion(ffmpeg, 'ffmpeg', lock, work);
    checkVersion(ffprobe, 'ffprobe', lock, work);
    smokeTest(ffmpeg, ffprobe, work);
    const zip = join(work, 'package.zip');
    run('tar.exe', ['-a', '-cf', zip, '-C', work, 'Music Video Maker'], work);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(zip, output, constants.COPYFILE_EXCL);
    console.log('Created: ' + output);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
