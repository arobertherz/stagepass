import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'StagepassLoader',
      fileName: () => 'loader.min.js',
      formats: ['iife']
    },
    minify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true
  }
});