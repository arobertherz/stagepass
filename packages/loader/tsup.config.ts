import { defineConfig } from 'tsup';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('./package.json');

const define = {
  __STAGEPASS_VERSION__: JSON.stringify(version),
};

export default defineConfig([
  // 1. Readable version (loader.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: true,
    minify: false,
    define,
    outExtension() {
      return { js: '.js' };
    },
  },
  // 2. Minified version (loader.min.js)
  {
    entry: { loader: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Stagepass',
    clean: false,
    minify: true,
    define,
    outExtension() {
      return { js: '.min.js' };
    },
  },
]);
