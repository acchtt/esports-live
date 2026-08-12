import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildGradle = path.join(packageRoot, 'android', 'app', 'build.gradle');
const versionCode = Number(process.env.ARENA_ANDROID_VERSION_CODE ?? '1');
const versionName = String(process.env.ARENA_ANDROID_VERSION_NAME ?? '0.1.0').trim();

if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error(`Invalid ARENA_ANDROID_VERSION_CODE: ${process.env.ARENA_ANDROID_VERSION_CODE ?? ''}`);
}
if (!versionName || /["\r\n]/.test(versionName)) {
  throw new Error(`Invalid ARENA_ANDROID_VERSION_NAME: ${versionName}`);
}

const source = await readFile(buildGradle, 'utf8');
if (!/versionCode\s+\d+/.test(source) || !/versionName\s+"[^"]+"/.test(source)) {
  throw new Error('Capacitor Android template no longer exposes the expected version fields.');
}

const updated = source
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

await writeFile(buildGradle, updated);
console.log(`Configured ARENA Android ${versionName} (${versionCode}).`);
