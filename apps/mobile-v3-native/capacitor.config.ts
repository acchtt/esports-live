import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.esports.arena',
  appName: 'ARENA',
  webDir: '../web-v3/dist',
  server: {
    // Capacitor recommends keeping the Android asset origin on localhost. The
    // generated MainActivity clears legacy WebView state once per APK version
    // before this origin is loaded, so old PWA workers cannot serve stale files.
    hostname: 'localhost',
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
