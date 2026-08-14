# ARENA V3 Android release

The Android wrapper is generated from Capacitor at build time; generated `android/` files are intentionally not committed.

## In-app updates

Every successful `Build Mobile V3 Android` run publishes `arena-v3-latest.apk`, its SHA-256 checksum, and `arena-v3-latest.json` to the permanent `arena-v3-android-latest` GitHub Release. The Android app checks that manifest on launch and from the Platform screen. When a higher version code is available, ARENA streams the APK into its private cache with visible progress, verifies the checksum, and shares the verified file with Android's package installer through a secure `FileProvider` URI.

The sideload updater is enabled only for the debug APK channel. The Play AAB intentionally omits the updater bridge and `REQUEST_INSTALL_PACKAGES` permission so a future store build can use Google Play's own in-app update flow.

Android requires the user to approve installs from ARENA and confirm each sideloaded update. Updates also require the APK package ID and signing certificate to match the installed build. Preserve the `arena-v3-android-debug-keystore-v1` Actions cache until all sideloaded users migrate to a permanent release-signing key.

## Release signing secrets

The signed Play build requires these GitHub Actions secrets:

- `ARENA_ANDROID_RELEASE_KEYSTORE_B64` — base64-encoded Android upload/release keystore bytes.
- `ARENA_ANDROID_RELEASE_STORE_PASSWORD` — keystore password.
- `ARENA_ANDROID_RELEASE_KEY_ALIAS` — alias inside the keystore.
- `ARENA_ANDROID_RELEASE_KEY_PASSWORD` — key password.

Never commit the keystore or any of these values. Keep an offline backup of the upload key and its credentials.

## Build a Play bundle from mobile-v3

Because the release workflow intentionally lives only on `mobile-v3`, a release is triggered by pushing a commit to `mobile-v3` whose commit message contains:

`[android-release]`

Ordinary V3 pushes start the workflow but skip the signed-release job. This prevents missing release secrets from breaking development builds.

For a marker-triggered release, the workflow assigns version name `0.2.<workflow run number>` and uses the workflow run number as the positive Android version code. The workflow rebuilds the exact V3 web bundle, generates the Capacitor Android project, applies ARENA launcher/splash resources, injects release signing through environment variables, runs `bundleRelease`, verifies the AAB signature, and uploads the signed `.aab` plus a SHA-256 checksum as an Actions artifact.

If this workflow is later added to the repository default branch, its manual `workflow_dispatch` inputs can instead provide an explicit `version_name` (for example `1.0.0`) and monotonically increasing `version_code`.

The normal Android push workflow continues to build debug APK + AAB artifacts without using the release key.
