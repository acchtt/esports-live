import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(packageRoot, 'android', 'app', 'src', 'main');
const resRoot = path.join(androidRoot, 'res');
const manifestPath = path.join(androidRoot, 'AndroidManifest.xml');

const arenaMarkPaths = `
    <path android:fillColor="#00E5FF" android:pathData="M31,4 L5,57 L20,52 L32,29 L32,4 Z" />
    <path android:fillColor="#FF3B3B" android:pathData="M33,4 L33,29 L45,52 L59,57 L33,4 Z" />
    <path android:fillColor="#06090D" android:pathData="M32,18 L20,45 L30,41 L32,36 L34,41 L44,45 L32,18 Z" />
    <path android:fillColor="#00BBD4" android:pathData="M13,49 L22,47 L18,55 L5,57 L13,49 Z" />
    <path android:fillColor="#D82735" android:pathData="M51,49 L42,47 L46,55 L59,57 L51,49 Z" />`;

const foregroundVector = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="64"
    android:viewportHeight="64">
    <group
        android:pivotX="32"
        android:pivotY="32"
        android:scaleX="0.70"
        android:scaleY="0.70">
${arenaMarkPaths}
    </group>
</vector>
`;

const splashVector = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="64"
    android:viewportHeight="64">
${arenaMarkPaths}
</vector>
`;

const legacyLauncherVector = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="64"
    android:viewportHeight="64">
    <path android:fillColor="#06090D" android:pathData="M0,0 H64 V64 H0 Z" />
    <group
        android:pivotX="32"
        android:pivotY="32"
        android:scaleX="0.76"
        android:scaleY="0.76">
${arenaMarkPaths}
    </group>
</vector>
`;

const adaptiveLauncher = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/arena_background" />
    <foreground android:drawable="@drawable/arena_launcher_foreground" />
</adaptive-icon>
`;

const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#00E5FF</color>
    <color name="colorPrimaryDark">#06090D</color>
    <color name="colorAccent">#B6FF00</color>
    <color name="arena_background">#06090D</color>
</resources>
`;

const styles = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:statusBarColor">@color/arena_background</item>
        <item name="android:navigationBarColor">@color/arena_background</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:fontFamily">sans</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@color/arena_background</item>
        <item name="android:statusBarColor">@color/arena_background</item>
        <item name="android:navigationBarColor">@color/arena_background</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/arena_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/arena_splash_mark</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:background">@color/arena_background</item>
    </style>
</resources>
`;

async function ensureDir(...segments) {
  const directory = path.join(resRoot, ...segments);
  await mkdir(directory, { recursive: true });
  return directory;
}

for (const entry of await readdir(resRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('drawable')) continue;
  const directory = path.join(resRoot, entry.name);
  for (const file of await readdir(directory)) {
    if (/^splash\.(png|webp|jpe?g|xml)$/i.test(file)) {
      await rm(path.join(directory, file), { force: true });
    }
  }
}

const drawable = await ensureDir('drawable');
const values = await ensureDir('values');
const mipmapAny = await ensureDir('mipmap-anydpi');
const mipmapV26 = await ensureDir('mipmap-anydpi-v26');

await Promise.all([
  writeFile(path.join(drawable, 'arena_launcher_foreground.xml'), foregroundVector),
  writeFile(path.join(drawable, 'arena_splash_mark.xml'), splashVector),
  writeFile(path.join(mipmapAny, 'arena_launcher.xml'), legacyLauncherVector),
  writeFile(path.join(mipmapAny, 'arena_launcher_round.xml'), legacyLauncherVector),
  writeFile(path.join(mipmapV26, 'arena_launcher.xml'), adaptiveLauncher),
  writeFile(path.join(mipmapV26, 'arena_launcher_round.xml'), adaptiveLauncher),
  writeFile(path.join(values, 'colors.xml'), colors),
  writeFile(path.join(values, 'styles.xml'), styles)
]);

const manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('android:icon="@mipmap/ic_launcher"')) {
  throw new Error('Capacitor Android manifest no longer uses the expected launcher icon resource.');
}
if (!manifest.includes('android:roundIcon="@mipmap/ic_launcher_round"')) {
  throw new Error('Capacitor Android manifest no longer uses the expected round launcher icon resource.');
}

const brandedManifest = manifest
  .replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/arena_launcher"')
  .replace('android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="@mipmap/arena_launcher_round"');
await writeFile(manifestPath, brandedManifest);

console.log('Applied ARENA launcher, splash, and dark-system-bar branding.');
