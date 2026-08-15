import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.esports.arena',
  appName: 'ARENA',
  webDir: '../web-v3/dist',
  server: {
    // MainActivity serves the packaged bundle with AndroidX
    // WebViewAssetLoader. The reserved HTTPS domain avoids DNS/network access
    // and remains a secure context on current Android WebView releases.
    url: 'https://appassets.androidplatform.net/assets/public/index.html',
    errorPath: 'assets/public/native-error.html'
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
