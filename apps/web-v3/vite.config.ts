import { defineConfig } from 'vite';

export default defineConfig({
  // Android's WebViewAssetLoader mounts the bundle below
  // /assets/public/. Keep hosted builds rooted at /, but make the packaged
  // bundle resolve its generated JS/CSS beside index.html.
  base: process.env.ARENA_ANDROID_ASSET_BUNDLE === 'true' ? './' : '/'
});
