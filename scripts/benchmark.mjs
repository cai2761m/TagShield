import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.test-build', { recursive: true });
await build({ entryPoints: ['tests/benchmark.ts'], outfile: '.test-build/benchmark.mjs', bundle: true, platform: 'node', format: 'esm' });
await import('../.test-build/benchmark.mjs');
