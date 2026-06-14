import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  // This tells Vite where your React dashboard entry point is
  build: {
    rollupOptions: {
      input: {
        dashboard: 'index.html',
      },
    },
  },
})