import { defineConfig } from 'tsup';

export default defineConfig([
  // Individual module builds
  {
    entry: { inject: 'src/inject/index.ts' },
    format: ['iife'],
    globalName: 'StagepassInject',
    clean: true,
    minify: true,
    outExtension() {
      return { js: '.min.js' };
    },
    outDir: 'dist',
  },
  // Bundle all modules
  {
    entry: { all: 'src/index.ts' },
    format: ['iife'],
    globalName: 'StagepassModules',
    clean: false,
    minify: true,
    outExtension() {
      return { js: '.min.js' };
    },
    outDir: 'dist',
  },
]);
