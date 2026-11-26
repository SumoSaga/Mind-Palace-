import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // host: true lets phones and tablets on the same Wi-Fi open the dev server.
  server: {
    host: true,
    port: 5173,
    // Devices reach the sync server through the same address as the app.
    proxy: {
      '/sync': {
        target: 'ws://localhost:1234',
        ws: true,
        rewrite: (path) => path.replace(/^\/sync/, ''),
      },
    },
  },
});
