import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.esports.arena',
  appName: 'ARENA',
  webDir: '../web-v3/dist',
  server: {
    // Keep Capacitor's supported secure Android asset origin. MainActivity
    // retries this bundled page after startup if the WebView never mounts it.
    hostname: 'localhost',
    androidScheme: 'https',
    errorPath: 'native-error.html'
  },
  android: {
    backgroundColor: '#06090d'
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
