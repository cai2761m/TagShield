import { describe, expect, it } from 'vitest';
import { HistoryManager } from '../src/history/history-manager';
import { applyEdits, planRollback } from '../src/history/rollback';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { MemoryStorage } from './storage';
const original = '正文 <body> 标签与 <head> 标签。';
const edits = [{ from: 3, to: 9, insert: '\\<body\\>' }, { from: 14, to: 20, insert: '\\<head\\>' }];
describe('durable journal and rollback', () => {
  it('stores hashes, full snapshot and independent changes before mutation', async () => {
    const storage = new MemoryStorage();
    const history = new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS);
    const journal = await history.prepare('a.md', original, edits, 'bulk-fix', true);
    expect(journal.status).toBe('prepared');
    expect(journal.snapshot?.content).toBe(original);
    expect(journal.records[0]?.fileHashBefore).toHaveLength(64);
    expect(journal.records[0]?.fileHashAfter).not.toBe(journal.records[0]?.fileHashBefore);
    const restarted = new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS);
    const [saved] = await restarted.list();
    const after = applyEdits(original, edits);
    const plan = await planRollback(after, saved!);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(applyEdits(after, plan.edits)).toBe(original);
  });
  it('relocates uniquely using post-change contexts', async () => {
    const h = new HistoryManager(new MemoryStorage(), 'history', () => DEFAULT_SETTINGS);
    const journal = await h.prepare('a.md', original, edits, 'bulk-fix');
    const changed = 'added at top\n' + applyEdits(original, edits) + '\nnew ending';
    const plan = await planRollback(changed, journal);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(applyEdits(changed, plan.edits)).toBe('added at top\n' + original + '\nnew ending');
  });
  it('refuses conflicting context, duplicates, and already-undone changes', async () => {
    const h = new HistoryManager(new MemoryStorage(), 'history', () => DEFAULT_SETTINGS);
    const journal = await h.prepare('a.md', original, edits, 'bulk-fix');
    const after = applyEdits(original, edits);
    for (const changed of [after.replace('正文', 'edited'), after + after, original]) expect((await planRollback(changed, journal)).ok).toBe(false);
  });
  it('propagates write failures', async () => {
    const storage = new MemoryStorage(); storage.fail = true;
    await expect(new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS).prepare('a.md', original, edits, 'escape')).rejects.toThrow('disk full');
  });
  it('rejects incomplete writes', async () => {
    const storage = new MemoryStorage(); storage.read = async () => '{}';
    await expect(new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS).prepare('a.md', original, edits, 'escape')).rejects.toThrow('verification');
  });
  it('an interrupted status overwrite cannot corrupt the immutable journal', async () => {
    const storage = new MemoryStorage();
    const h = new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS);
    const journal = await h.prepare('a.md', original, edits, 'bulk-fix', true);
    const originalBytes = storage.files.get(`history/${journal.id}.json`);
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => {
      if (path.endsWith('.status')) { storage.files.set(path, '{"sta'); throw new Error('interrupted'); }
      await write(path, data);
    };
    await expect(h.mark(journal, 'applied')).rejects.toThrow('interrupted');
    expect(storage.files.get(`history/${journal.id}.json`)).toBe(originalBytes);
    const [recovered] = await new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS).list();
    expect(recovered?.status).toBe('prepared');
    expect((await planRollback(applyEdits(original, edits), recovered!)).ok).toBe(true);
  });
  it('prunes owned records but leaves corrupt and unrelated files intact', async () => {
    const storage = new MemoryStorage();
    const h = new HistoryManager(storage, 'history', () => ({ ...DEFAULT_SETTINGS, retentionCount: 1 }));
    await h.prepare('a.md', original, edits, 'bulk-fix');
    await h.prepare('b.md', original, edits, 'bulk-fix');
    storage.files.set('history/unknown.json', 'broken');
    storage.files.set('history/readme.txt', 'keep');
    await h.prune();
    expect(await h.list()).toHaveLength(1);
    expect(storage.files.get('history/unknown.json')).toBe('broken');
    expect(storage.files.get('history/readme.txt')).toBe('keep');
  });
  it('rejects overlapping edits', () => expect(() => applyEdits('12345', [{ from: 0, to: 3, insert: '' }, { from: 2, to: 4, insert: '' }])).toThrow());
});
