import { defineConfig } from 'vite';

export default defineConfig({
  // Relative stier, så spillet virker både lokalt og på GitHub Pages (/Before-the-Match/)
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173 },
});
