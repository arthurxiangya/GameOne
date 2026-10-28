#!/usr/bin/env node
/**
 * Builds the single-player preview: one HTML page plus game.js, with the game server running
 * inside the page. three.js loads from the jsDelivr CDN so the bundle stays small and the page
 * can be hosted anywhere static files can (including a claude.ai artifact).
 *
 *   npm run build:preview   ->   packages/client/dist-preview/{index.html, standalone.html, game.js}
 *
 * index.html is a page fragment (no <html>/<head>/<body>) for hosts that add their own document
 * skeleton; standalone.html is a complete document for any static host.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const THREE_VERSION = '0.160.0';
const THREE_URL = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'packages/client');
const out = join(client, 'dist-preview');

/** Rewrites `import 'three'` to the pinned CDN module instead of bundling it. */
const threeFromCdn = {
  name: 'three-from-cdn',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: THREE_URL, external: true }));
  },
};

await mkdir(out, { recursive: true });
const result = await build({
  entryPoints: [join(client, 'src/main.ts')],
  outfile: join(out, 'game.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { 'import.meta.env': JSON.stringify({ VITE_PLAY_MODE: 'offline' }) },
  plugins: [threeFromCdn],
  metafile: true,
  logLevel: 'warning',
});

const html = await readFile(join(client, 'index.html'), 'utf8');
const css = await readFile(join(client, 'src/styles.css'), 'utf8');
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html: could not find ${what}`);
  return m[1].trim();
};
const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const fontLinks = [...html.matchAll(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g)].map((m) => m[0]).join('\n');
const body = pick(/<body>([\s\S]*?)<\/body>/, '<body>')
  .replace(/\s*<script type="module" src="\/src\/main\.ts"><\/script>/, '')
  .trim();
const head = `<title>${title}</title>\n${fontLinks}\n<style>\n${css.trim()}\n</style>`;
const script = '<script type="module" src="game.js"></script>';

await writeFile(join(out, 'index.html'), `${head}\n${body}\n${script}\n`);
await writeFile(
  join(out, 'standalone.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n` +
    `<body>\n${body}\n${script}\n</body>\n</html>\n`,
);

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`Preview built in ${out} (game.js ${(bytes / 1024).toFixed(0)} KB, three.js ${THREE_VERSION} from CDN)`);
