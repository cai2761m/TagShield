import esbuild from 'esbuild';
const production = process.argv[2] === 'production';
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'main.js', format: 'cjs',
  target: 'es2018', platform: 'browser', sourcemap: production ? false : 'inline',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/common', '@lezer/highlight', '@lezer/lr'],
  logLevel: 'info', treeShaking: true,
});
if (production) { await ctx.rebuild(); await ctx.dispose(); } else await ctx.watch();
