import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs',
  platform: 'node',
  target: 'es2018',
  outfile: 'main.js',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  treeShaking: true,
});
