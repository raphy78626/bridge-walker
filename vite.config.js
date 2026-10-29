import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { relayPlugin } from './server/relayPlugin.js';

export default defineConfig({
  // HTTPS is required: phones only expose motion sensors to secure pages.
  plugins: [basicSsl(), relayPlugin()],
  server: { host: true, port: 5173, strictPort: true },
  // 5174: the webOS app (scripts/build-webos.mjs) opens the TV page on 5174 + 10.
  preview: { host: true, port: 5174, strictPort: true },
  build: {
    target: 'es2019', // TV browsers run older Chromium; compile away newer syntax like ?.
    chunkSizeWarningLimit: 1000, // three.js is most of the bundle
    rollupOptions: {
      input: {
        tv: new URL('./tv.html', import.meta.url).pathname,
        phone: new URL('./phone.html', import.meta.url).pathname,
      },
    },
  },
});
