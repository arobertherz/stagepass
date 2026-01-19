import { defineConfig } from 'tsup';

export default defineConfig([
  // 1. Readable version (loader.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: true, // Cleans dist folder before build
    minify: false,
    outExtension() {
      return { js: '.js' };
    },
  },
  // 2. Minified version (loader.min.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: false, // IMPORTANT: Don't clean here, otherwise loader.js is gone
    minify: true,
    outExtension() {
      return { js: '.min.js' };
    },
  },
]);