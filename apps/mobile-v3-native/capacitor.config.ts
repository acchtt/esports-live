import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.esports.arena',
  appName: 'ARENA',
  webDir: '../web-v3/dist',
  server: {
    // Keep the native shell on its own secure origin. Older ARENA builds briefly
    // registered the PWA service worker on https://localhost; that worker can
    // survive an APK upgrade and serve an obsolete index with missing assets.
    hostname: 'arena.localhost',
    androidScheme: 'https'
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false
    }
  }
};

export default config;
