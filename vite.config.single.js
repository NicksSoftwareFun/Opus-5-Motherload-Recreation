import { defineConfig } from 'vite';
import { inlineEverything } from './scripts/inline-single-file.mjs';

/**
 * Single-file build of the game.
 *
 * Produces `release/motherload-3d.html` — one self-contained file with the whole
 * game inlined, which opens by double-clicking with no server and no install. The
 * inlining itself lives in scripts/inline-single-file.mjs, shared with the Jukebox.
 */
export default defineConfig({
  base: './',
  plugins: [inlineEverything('motherload-3d.html')],
  build: {
    outDir: 'release',
    // Deliberately false. `release/` holds more than this one build now, and
    // emptying it once silently deleted the rendered audio track that lived there.
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
      },
    },
  },
});
