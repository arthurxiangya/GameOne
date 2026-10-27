import { defineConfig } from 'vite';

// In development the client runs on Vite (port 5173) and proxies the game socket
// to the server (port 8080), so the browser always talks to its own origin.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': { target: 'http://localhost:8080' },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
