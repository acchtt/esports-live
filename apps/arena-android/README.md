# ARENA Android

Phone-first native Android client for ARENA League of Legends scores.

This module uses Kotlin and Jetpack Compose. It deliberately contains no WebView or
Capacitor runtime. The application ID remains `live.esports.arena`, so builds signed
with the established ARENA key update compatible V3 installs.

## Build

```bash
./gradlew :app:assembleDebug
```

Build metadata can be overridden with:

- `ARENA_ANDROID_VERSION_CODE`
- `ARENA_ANDROID_VERSION_NAME`
- `ARENA_ANDROID_API_URL`
- the existing `ARENA_ANDROID_DEBUG_*` or `ARENA_ANDROID_RELEASE_*` signing variables

The app loads and caches the LoL schedule, then polls live game snapshots while a
match center is open. Dota is intentionally not present.
