import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()], base: process.env.BASE_PATH || '/',
  build: { rollupOptions: { input: ['index.html','facilitator/index.html','bigscreen/index.html','big-screen/index.html'] } },
  server: { proxy: { '/v1': 'http://127.0.0.1:4181', '/health': 'http://127.0.0.1:4181' } }
});
