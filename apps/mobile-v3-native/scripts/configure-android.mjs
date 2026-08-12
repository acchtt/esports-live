import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildGradle = path.join(packageRoot, 'android', 'app', 'build.gradle');
const versionCode = Number(process.env.ARENA_ANDROID_VERSION_CODE ?? '1');
const versionName = String(process.env.ARENA_ANDROID_VERSION_NAME ?? '0.1.0').trim();
const releaseSigning = {
  keystorePath: String(process.env.ARENA_ANDROID_RELEASE_KEYSTORE_PATH ?? '').trim(),
  storePassword: String(process.env.ARENA_ANDROID_RELEASE_STORE_PASSWORD ?? ''),
  keyAlias: String(process.env.ARENA_ANDROID_RELEASE_KEY_ALIAS ?? '').trim(),
  keyPassword: String(process.env.ARENA_ANDROID_RELEASE_KEY_PASSWORD ?? '')
};

if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error(`Invalid ARENA_ANDROID_VERSION_CODE: ${process.env.ARENA_ANDROID_VERSION_CODE ?? ''}`);
}
if (!versionName || /["\r\n]/.test(versionName)) {
  throw new Error(`Invalid ARENA_ANDROID_VERSION_NAME: ${versionName}`);
}

const signingValues = Object.values(releaseSigning);
const releaseSigningRequested = signingValues.some(Boolean);
if (releaseSigningRequested && signingValues.some(value => !value)) {
  throw new Error('Release signing requires keystore path, store password, key alias, and key password.');
}

const source = await readFile(buildGradle, 'utf8');
if (!/versionCode\s+\d+/.test(source) || !/versionName\s+"[^"]+"/.test(source)) {
  throw new Error('Capacitor Android template no longer exposes the expected version fields.');
}

let updated = source
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (releaseSigningRequested) {
  if (!updated.includes('android {')) {
    throw new Error('Capacitor Android template no longer exposes the android block.');
  }
  if (!/release\s*\{\s*\n\s*minifyEnabled/.test(updated)) {
    throw new Error('Capacitor Android template no longer exposes the expected release build type.');
  }

  const signingConfig = `android {\n    signingConfigs {\n        arenaRelease {\n            storeFile file(System.getenv('ARENA_ANDROID_RELEASE_KEYSTORE_PATH'))\n            storePassword System.getenv('ARENA_ANDROID_RELEASE_STORE_PASSWORD')\n            keyAlias System.getenv('ARENA_ANDROID_RELEASE_KEY_ALIAS')\n            keyPassword System.getenv('ARENA_ANDROID_RELEASE_KEY_PASSWORD')\n        }\n    }`;
  updated = updated
    .replace('android {', signingConfig)
    .replace(
      /(release\s*\{\s*\n)(\s*)minifyEnabled/,
      `$1$2signingConfig signingConfigs.arenaRelease\n$2minifyEnabled`
    );
}

await writeFile(buildGradle, updated);
console.log(
  `Configured ARENA Android ${versionName} (${versionCode})${releaseSigningRequested ? ' with release signing' : ''}.`
);
