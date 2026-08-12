# ARENA V3 native Android shell

ARENA V3 uses Capacitor to package the existing `apps/web-v3` application as a native Android app. The browser/PWA build remains the source of truth for UI and live-data behavior; the native workspace only owns the wrapper configuration and Android build commands.

## Native package

- Workspace: `apps/mobile-v3-native`
- Capacitor: `8.5.0`
- Android application ID: `live.esports.arena`
- App name: `ARENA`
- Bundled web assets: `apps/web-v3/dist`

Generated `android/` and `ios/` platform directories are intentionally ignored. GitHub Actions recreates the Android platform from the pinned Capacitor template for every native build, which keeps the repository small and makes the no-PC build path reproducible.

Inside Capacitor the web bundle marks itself as a native runtime and does not register the browser service worker. The API reliability, schedule cache, snapshot cache, routing, finality logic, and live refresh behavior remain shared with V3 web.

## GitHub Actions build

Use **Actions → Build Mobile V3 Android** and run the workflow on `mobile-v3`, or let it run automatically after relevant V3 changes. A successful run publishes an artifact named `arena-v3-android-debug-<commit>` containing an installable debug APK.

The debug workflow uses the verified stable mobile API as the native primary endpoint rather than embedding an ephemeral Worker preview URL. It also caches a dedicated debug signing key and uses the Actions run number as Android `versionCode`, allowing later debug APKs to update the existing test installation while that cache remains available.

## Optional local build

After `npm install`:

1. Build V3 with the desired `VITE_API_BASE_URL` and build metadata.
2. Run `npm run cap:v3:android:add` once to create the generated Android project.
3. Run `npm run build:android-v3` for subsequent debug builds.

The APK is emitted under `apps/mobile-v3-native/android/app/build/outputs/apk/debug/`.

Release signing, Play Store/AAB packaging, launcher/splash asset polish, and iOS packaging are intentionally separate follow-up steps.
