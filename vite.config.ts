import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const mainEntry = new URL('./index.html', import.meta.url);
const adminEntry = new URL('./admin/index.html', import.meta.url);

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'admin-route',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/admin') {
            request.url = '/admin/index.html';
          }
          next();
        });
      },
    },
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(mainEntry),
        admin: fileURLToPath(adminEntry),
      },
    },
  },
});
