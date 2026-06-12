import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'main.js'),
  format: 'cjs',
  target: 'ES2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  plugins: [
    sveltePlugin(),
  ],
  external: ['obsidian', 'child_process', 'fs', 'path'],
});

if (prod) {
  await context.rebuild();
  console.log('Production build complete.');
  process.exit(0);
} else {
  console.log('Watching for changes...');
  await context.watch();
}
