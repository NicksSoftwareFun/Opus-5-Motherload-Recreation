/**
 * The single-file build plugin, shared by the game and the Jukebox.
 *
 * Produces one self-contained HTML file that opens by double-clicking, with no
 * server and no install. This is only possible because the project has no binary
 * assets: every texture, model and sound cue is generated in code at boot, so there
 * is nothing to fetch and nothing for the browser's file:// origin rules to block.
 * The one thing that has to change is the module format — an ES module script is
 * blocked over file://, so the bundle is emitted as a classic IIFE (see the
 * `rollupOptions.output` in the configs) and pasted into the HTML.
 *
 * @param {string} fileName What to call the finished file.
 */
export function inlineEverything(fileName) {
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
      // document.body is still null and the page has nothing to attach to.
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
      html.fileName = fileName;
      delete bundle[entry.fileName];
    },
  };
}
