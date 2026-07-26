import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { inlineEverything } from './scripts/inline-single-file.mjs';

/**
 * Single-file build of the Jukebox.
 *
 * Produces `release/motherload-jukebox.html`, which opens by double-clicking. The
 * tool needs this more than the game does: `npm run jukebox` wants a Vite dev
 * server, and Vite 8 wants Node ^20.19 || >=22.12, so anyone on an older Node can
 * run the game from `release/` but could not open the bench that goes with it.
 *
 * Same trick as the game — everything is synthesised in code, so there is nothing
 * to fetch and file:// has nothing to block.
 */
export default defineConfig({
  base: './',
  plugins: [inlineEverything('motherload-jukebox.html')],
  build: {
    outDir: 'release',
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(process.cwd(), 'tools/jukebox/index.html'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'jukebox.js',
      },
    },
  },
});
