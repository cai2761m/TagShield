import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, unlink, rmdir, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryManager, type Storage } from '../src/history/history-manager';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { applyEdits, planRollback } from '../src/history/rollback';
it('recovers a write-ahead journal from real disk with a new storage adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tagshield-history-'));
  const adapter = (): Storage => ({
    exists: async path => { try { await access(path); return true; } catch { return false; } },
    mkdir: async path => { await mkdir(path); },
    write: async (path, data) => { await writeFile(path, data, 'utf8'); },
    read: path => readFile(path, 'utf8'),
    list: async path => ({ files: (await readdir(path)).map(name => `${path}/${name}`) }),
    remove: unlink,
  });
  // Use adapter-style slash paths, including on Windows.
  const path = directory.replace(/\\/g, '/');
  try {
    const original = '正文 <body> 标签';
    const edits = [{ from: 3, to: 9, insert: '\\<body\\>' }];
    await new HistoryManager(adapter(), path, () => DEFAULT_SETTINGS).prepare('test.md', original, edits, 'escape', true);
    const fresh = new HistoryManager(adapter(), path, () => DEFAULT_SETTINGS);
    const [journal] = await fresh.list();
    expect(journal?.status).toBe('prepared');
    const after = applyEdits(original, edits);
    const plan = await planRollback(after, journal!);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(applyEdits(after, plan.edits)).toBe(original);
  } finally {
    // Only remove the enumerated test files and then the empty temporary directory.
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  }
});
