# ARENA V3 Android release

The Android wrapper is generated from Capacitor at build time; generated `android/` files are intentionally not committed.

## Release signing secrets

The manual `Build Mobile V3 Android Release` workflow requires these GitHub Actions secrets:

- `ARENA_ANDROID_RELEASE_KEYSTORE_B64` — base64-encoded Android upload/release keystore bytes.
- `ARENA_ANDROID_RELEASE_STORE_PASSWORD` — keystore password.
- `ARENA_ANDROID_RELEASE_KEY_ALIAS` — alias inside the keystore.
- `ARENA_ANDROID_RELEASE_KEY_PASSWORD` — key password.

Never commit the keystore or any of these values. Keep an offline backup of the upload key and its credentials.

## Build a Play bundle

Run **Actions → Build Mobile V3 Android Release → Run workflow** on `mobile-v3` and provide:

- `version_name`, such as `1.0.0`.
- `version_code`, a positive integer higher than every version previously uploaded to Google Play.

The workflow rebuilds the exact V3 web bundle, generates the Capacitor Android project, applies ARENA launcher/splash resources, injects release signing through environment variables, runs `bundleRelease`, verifies the AAB signature, and uploads the signed `.aab` plus a SHA-256 checksum as an Actions artifact.

The normal push workflow continues to build debug APK + AAB artifacts without using the release key.
