import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildGradle = path.join(packageRoot, 'android', 'app', 'build.gradle');
const versionCode = Number(process.env.ARENA_ANDROID_VERSION_CODE ?? '1');
const versionName = String(process.env.ARENA_ANDROID_VERSION_NAME ?? '0.1.0').trim();
const debugSigning = {
  keystorePath: String(process.env.ARENA_ANDROID_DEBUG_KEYSTORE_PATH ?? '').trim(),
  storePassword: String(process.env.ARENA_ANDROID_DEBUG_STORE_PASSWORD ?? ''),
  keyAlias: String(process.env.ARENA_ANDROID_DEBUG_KEY_ALIAS ?? '').trim(),
  keyPassword: String(process.env.ARENA_ANDROID_DEBUG_KEY_PASSWORD ?? '')
};
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

function signingRequested(signing, label) {
  const values = Object.values(signing);
  const requested = values.some(Boolean);
  if (requested && values.some(value => !value)) {
    throw new Error(`${label} signing requires keystore path, store password, key alias, and key password.`);
  }
  return requested;
}

const debugSigningRequested = signingRequested(debugSigning, 'Debug');
const releaseSigningRequested = signingRequested(releaseSigning, 'Release');

const source = await readFile(buildGradle, 'utf8');
if (!/versionCode\s+\d+/.test(source) || !/versionName\s+"[^"]+"/.test(source)) {
  throw new Error('Capacitor Android template no longer exposes the expected version fields.');
}

let updated = source
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (debugSigningRequested || releaseSigningRequested) {
  if (!updated.includes('android {')) {
    throw new Error('Capacitor Android template no longer exposes the android block.');
  }

  const signingConfigs = [];
  if (debugSigningRequested) {
    signingConfigs.push(`        arenaDebug {
            storeFile file(System.getenv('ARENA_ANDROID_DEBUG_KEYSTORE_PATH'))
            storePassword System.getenv('ARENA_ANDROID_DEBUG_STORE_PASSWORD')
            keyAlias System.getenv('ARENA_ANDROID_DEBUG_KEY_ALIAS')
            keyPassword System.getenv('ARENA_ANDROID_DEBUG_KEY_PASSWORD')
        }`);
  }
  if (releaseSigningRequested) {
    signingConfigs.push(`        arenaRelease {
            storeFile file(System.getenv('ARENA_ANDROID_RELEASE_KEYSTORE_PATH'))
            storePassword System.getenv('ARENA_ANDROID_RELEASE_STORE_PASSWORD')
            keyAlias System.getenv('ARENA_ANDROID_RELEASE_KEY_ALIAS')
            keyPassword System.getenv('ARENA_ANDROID_RELEASE_KEY_PASSWORD')
        }`);
  }
  updated = updated.replace(
    'android {',
    `android {\n    signingConfigs {\n${signingConfigs.join('\n')}\n    }`
  );
}

if (debugSigningRequested) {
  if (!/buildTypes\s*\{\s*\n\s*release\s*\{/.test(updated)) {
    throw new Error('Capacitor Android template no longer exposes the expected build types.');
  }
  updated = updated.replace(
    /(buildTypes\s*\{\s*\n)(\s*)(release\s*\{)/,
    `$1$2debug {\n$2    signingConfig signingConfigs.arenaDebug\n$2}\n$2$3`
  );
}

if (releaseSigningRequested) {
  if (!/release\s*\{\s*\n\s*minifyEnabled/.test(updated)) {
    throw new Error('Capacitor Android template no longer exposes the expected release build type.');
  }
  updated = updated.replace(
    /(release\s*\{\s*\n)(\s*)minifyEnabled/,
    `$1$2signingConfig signingConfigs.arenaRelease\n$2minifyEnabled`
  );
}

await writeFile(buildGradle, updated);
console.log(
  `Configured ARENA Android ${versionName} (${versionCode})${debugSigningRequested ? ' with debug signing' : ''}${releaseSigningRequested ? ' with release signing' : ''}.`
);
