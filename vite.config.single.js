import { defineConfig } from 'vite';

/**
 * Single-file build.
 *
 * Produces `release/motherload-3d.html` — one self-contained file with the whole
 * game inlined, which opens by double-clicking with no server and no install.
 *
 * This is only possible because the project has no binary assets: every texture,
 * model and sound cue is generated in code at boot, so there is nothing to fetch
 * and nothing for the browser's file:// origin rules to block. The one thing that
 * has to change is the module format — an ES module script is blocked over
 * file://, so the bundle is emitted as a classic IIFE and pasted into the HTML.
 */
function inlineEverything() {
  return {
    name: 'motherload-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName.endsWith('.html'));
      const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry);
      if (!html || !entry) return;

      let source = String(html.source);

      // Replace the emitted script tag with the code itself.
      //
      // The replacement is a *function*, not a string, and that is load-bearing:
      // String.replace treats $&, $`, $' and $1 in a replacement string as
      // substitution patterns, and minified JavaScript is full of `$` immediately
      // followed by a backtick or a quote. Passing the code as a plain string
      // silently mangled the bundle into a syntax error.
      //
      // `</script>` inside a string literal would also terminate the tag early,
      // so it is escaped first — harmless inside JS, fatal inside HTML.
      const safe = entry.code.replace(/<\/script>/gi, '<\\/script>');
      source = source.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/i, '');
      // Injected at the end of <body>, not where the original tag sat. Vite emits
      // `type="module"`, which browsers defer until the document is parsed; an
      // inline classic script has no defer and would run in <head>, where
      // document.body is still null and the renderer has nothing to attach to.
      source = source.replace(/<\/body>/i, () => `<script>\n${safe}\n</script>\n</body>`);

      // Inline any CSS, and drop preload hints that point at files we deleted.
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'asset' && asset.fileName.endsWith('.css')) {
          source = source.replace(
            new RegExp(`<link[^>]*href="[^"]*${asset.fileName}"[^>]*>`, 'i'),
            () => `<style>\n${asset.source}\n</style>`,
          );
          delete bundle[asset.fileName];
        }
      }
      source = source.replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');

      html.source = source;
      html.fileName = 'motherload-3d.html';
      delete bundle[entry.fileName];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineEverything()],
  build: {
    outDir: 'release',
    emptyOutDir: true,
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
