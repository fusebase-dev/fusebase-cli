import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Prevent unnecessary reloads from debug logs written by fusebase dev start
      ignored: ['**/logs/**'],
    },
  },
})
