import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.noclickai.app',
  appName: 'NoClick AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
