import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = 'dist/tag-shield';
await mkdir(directory, { recursive: true });
const checksums = [];
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(file, `${directory}/${file}`);
  checksums.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${file}`);
}
await writeFile(`${directory}/SHA256SUMS.txt`, checksums.join('\n') + '\n');
console.log(`Installable plugin: ${directory}`);
