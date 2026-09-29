import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const target = env.VITE_PROXY_TARGET || 'https://localhost:44380';
  const proxy = { target, changeOrigin: true, secure: false, xfwd: true };
  return { plugins: [react()], server: { proxy: {
    '/api': proxy,
    '/hubs': { ...proxy, ws: true },
  } } };
});
