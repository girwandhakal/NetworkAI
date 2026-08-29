import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Keep the dev proxy pointed at whatever PORT the API server is told to use.
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.PORT || '8787'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true, // reachable from your phone on the same Wi-Fi
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        // PDF.js cmaps and standard fonts, streamed from node_modules.
        '/pdfjs': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Firebase is most of the weight and changes rarely — cache it apart
          // from the app so a redeploy is a small download on venue Wi-Fi.
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  }
})
