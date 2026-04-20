import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

const certsDir = path.resolve(__dirname, '../../certs');
const certFile = path.join(certsDir, 'tailscale.crt');
const keyFile = path.join(certsDir, 'tailscale.key');
const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    ...(hasCerts
      ? {
          https: {
            cert: fs.readFileSync(certFile),
            key: fs.readFileSync(keyFile),
          },
        }
      : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
