import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               → dist/ (static site, hashed assets)
// `vite build --mode single` → dist-single/index.html (everything inlined; used for the playable artifact)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    target: 'es2020',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
