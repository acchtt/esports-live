# ARENA V3 Android release

The Android wrapper is generated from Capacitor at build time; generated `android/` files are intentionally not committed.

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
