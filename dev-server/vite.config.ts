import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.VITE_API_PORT || '4174'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    watch: {
      ignored: ['**/logs/**'],
    },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
