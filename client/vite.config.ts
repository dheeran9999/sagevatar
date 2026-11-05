/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, the API and media are proxied so the browser sees a single origin
// (also keeps the camera on a secure context: localhost).
export default defineConfig(({ mode }) => {
  // DEV_HOST=true in client/.env exposes the dev server on your local network (off by default).
  const env = loadEnv(mode, process.cwd(), '');
  const exposeOnNetwork = env.DEV_HOST === 'true';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // localhost only unless DEV_HOST=true (then teammates can open http://<this-PC's-LAN-IP>:5173).
      host: exposeOnNetwork ? true : 'localhost',
      proxy: {
        '/api': 'http://localhost:4000',
        '/media': 'http://localhost:4000',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
