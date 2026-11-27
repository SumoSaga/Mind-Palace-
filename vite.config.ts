import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:1234';

/**
 * Forwards a path to the Mind Palace server, telling it which device the
 * request really came from. The server lets this computer in without pairing,
 * and since every forwarded request reaches it from this computer, it relies
 * on this header to tell the PC's own browser from a phone on the Wi-Fi.
 * The header is always overwritten here, so a device cannot set it itself.
 */
function toServer(extra: ProxyOptions = {}): ProxyOptions {
  return {
    target: SERVER,
    ...extra,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        proxyReq.setHeader('x-mp-remote', req.socket.remoteAddress ?? 'unknown');
      });
      proxy.on('proxyReqWs', (proxyReq, req) => {
        proxyReq.setHeader('x-mp-remote', req.socket.remoteAddress ?? 'unknown');
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // host: true lets phones and tablets on the same Wi-Fi open the dev server.
  server: {
    host: true,
    port: 5173,
    // Devices reach the server through the same address as the app.
    proxy: {
      '/files': toServer(), // uploaded PDFs and videos
      '/auth': toServer(), // who is signed in or paired
      '/pair': toServer(), // connecting a new device
      '/ai': toServer(), // optional Claude features
      '/sync': toServer({
        target: 'ws://localhost:1234',
        ws: true,
        rewrite: (path) => path.replace(/^\/sync/, ''),
      }),
    },
  },
});
