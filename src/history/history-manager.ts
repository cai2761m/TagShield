import type { Edit, Settings } from '../types';
import { applyEdits, type ChangeRecord, type Journal } from './rollback';
import { hash } from './hash';
export interface Storage {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[] }>;
  remove(path: string): Promise<void>;
}
function validJournal(value: unknown): value is Journal {
  if (!value || typeof value !== 'object') return false;
  const j = value as Journal;
  return j.version === 1 && typeof j.id === 'string' && /^[\w-]+$/.test(j.id)
    && typeof j.filePath === 'string' && Number.isFinite(j.timestamp)
    && ['prepared', 'applied', 'cancelled', 'restored'].includes(j.status)
    && Array.isArray(j.records) && j.records.length > 0 && j.records.every(r =>
      typeof r.before === 'string' && typeof r.after === 'string'
      && Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 0 && r.to >= r.from
      && typeof r.contextBefore === 'string' && typeof r.contextAfter === 'string'
      && typeof r.fileHashBefore === 'string' && typeof r.fileHashAfter === 'string');
}
export class HistoryManager {
  constructor(private storage: Storage, readonly directory: string, private settings: () => Settings) {}
  private path(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid history ID');
    return `${this.directory}/${id}.json`;
  }
  async prepare(filePath: string, before: string, edits: Edit[], operation: ChangeRecord['operation'], snapshot = false): Promise<Journal> {
    const sorted = [...edits].sort((a, b) => a.from - b.from);
    if (!sorted.length) throw new Error('No edits');
    const after = applyEdits(before, sorted);
    const [fileHashBefore, fileHashAfter] = await Promise.all([hash(before), hash(after)]);
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    let delta = 0;
    const records = sorted.map((edit, i): ChangeRecord => {
      const pos = edit.from + delta;
      delta += edit.insert.length - (edit.to - edit.from);
      return { id: `${id}-${i}`, filePath, timestamp, operation,
        before: before.slice(edit.from, edit.to), after: edit.insert, from: edit.from, to: edit.to,
        contextBefore: after.slice(Math.max(0, pos - 48), pos),
        contextAfter: after.slice(pos + edit.insert.length, pos + edit.insert.length + 48),
        fileHashBefore, fileHashAfter };
    });
    const journal: Journal = { version: 1, id, filePath, timestamp, status: 'prepared', records,
      ...(snapshot ? { snapshot: { id, filePath, timestamp, content: before, hash: fileHashBefore } } : {}) };
    if (!await this.storage.exists(this.directory)) await this.storage.mkdir(this.directory);
    // Write-ahead journal: an unsuccessful write MUST prevent the editor transaction.
    await this.storage.write(this.path(id), JSON.stringify(journal));
    // Verify the persisted bytes before any modification; handles incomplete adapter writes.
    if (await this.storage.read(this.path(id)) !== JSON.stringify(journal)) throw new Error('History verification failed');
    return journal;
  }
  async mark(journal: Journal, status: Journal['status']): Promise<void> {
    // Keep the write-ahead journal immutable. A partial status write must never
    // destroy the only copy of the before/after content after an editor change.
    await this.storage.write(`${this.path(journal.id)}.status`, JSON.stringify({ status }));
    journal.status = status;
  }
  async list(): Promise<Journal[]> {
    if (!await this.storage.exists(this.directory)) return [];
    const { files } = await this.storage.list(this.directory);
    const journals: Journal[] = [];
    for (const path of files.filter(p => p.endsWith('.json'))) {
      try {
        const value: unknown = JSON.parse(await this.storage.read(path));
        if (validJournal(value) && path.replace(/\\/g, '/') === this.path(value.id)) {
          try {
            const statusPath = `${this.path(value.id)}.status`;
            if (await this.storage.exists(statusPath)) {
              const marker: unknown = JSON.parse(await this.storage.read(statusPath));
              const status = (marker as { status?: string } | null)?.status;
              if (status && ['prepared', 'applied', 'cancelled', 'restored'].includes(status)) value.status = status as Journal['status'];
            }
          } catch { /* An interrupted status write leaves a recoverable prepared journal. */ }
          journals.push(value);
        }
      } catch { /* A damaged journal never authorizes a restore or deletion. */ }
    }
    return journals.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  }
  async prune(): Promise<void> {
    const journals = await this.list();
    const settings = this.settings();
    const cutoff = Date.now() - settings.retentionDays * 86400000;
    for (const [i, journal] of journals.entries()) {
      if (i >= settings.retentionCount || journal.timestamp < cutoff) {
        await this.storage.remove(this.path(journal.id));
        const statusPath = `${this.path(journal.id)}.status`;
        if (await this.storage.exists(statusPath)) await this.storage.remove(statusPath);
      }
    }
  }
}
