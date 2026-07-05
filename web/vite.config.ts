import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      // 8190 = host-published port (see docker-compose.yml). The app listens
      // on 8090 *inside* the container; we proxy to the host-side mapping.
      '/api': { target: 'http://localhost:8190', ws: true },
      '/auth': 'http://localhost:8190',
      '/link': 'http://localhost:8190',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
