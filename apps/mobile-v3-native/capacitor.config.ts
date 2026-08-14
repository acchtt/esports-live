import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.esports.arena',
  appName: 'ARENA',
  webDir: '../web-v3/dist',
  server: {
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
