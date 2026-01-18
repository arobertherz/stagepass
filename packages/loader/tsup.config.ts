import { defineConfig } from 'tsup';

export default defineConfig([
  // 1. Die lesbare Version (loader.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: true, // Löscht den dist Ordner vor dem Start
    minify: false,
    outExtension() {
      return { js: '.js' };
    },
  },
  // 2. Die minifizierte Version (loader.min.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: false, // WICHTIG: Hier NICHT löschen, sonst ist loader.js weg
    minify: true,
    outExtension() {
      return { js: '.min.js' };
    },
  },
]);