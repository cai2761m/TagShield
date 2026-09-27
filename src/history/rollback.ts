import type { Edit } from '../types';
import { hash } from './hash';
export interface ChangeRecord {
  id: string; filePath: string; timestamp: number;
  operation: 'escape' | 'bulk-fix' | 'restore' | 'disable-note';
  before: string; after: string; from: number; to: number;
  contextBefore: string; contextAfter: string;
  fileHashBefore: string; fileHashAfter: string;
}
export interface Journal {
  version: 1; id: string; filePath: string; timestamp: number;
  status: 'prepared' | 'applied' | 'cancelled' | 'restored';
  records: ChangeRecord[];
  snapshot?: { id: string; filePath: string; timestamp: number; content: string; hash: string };
}
export type RollbackPlan = { ok: true; edits: Edit[] } | { ok: false; reason: string };
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = text;
  let boundary = text.length;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    if (edit.from < 0 || edit.to < edit.from || edit.to > boundary) throw new Error('Invalid or overlapping edits');
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
    boundary = edit.from;
  }
  return result;
}
export async function planRollback(text: string, journal: Journal): Promise<RollbackPlan> {
  if (!journal.records.length) return { ok: false, reason: '空记录' };
  const exact = await hash(text) === journal.records[0]!.fileHashAfter;
  const edits: Edit[] = [];
  let delta = 0;
  for (const record of journal.records) {
    let from = record.from + delta;
    delta += record.after.length - record.before.length;
    if (!exact) {
      const needle = record.contextBefore + record.after + record.contextAfter;
      // Empty contexts cannot identify a location after unrelated edits.
      if (!needle || (!record.contextBefore && !record.contextAfter)) return { ok: false, reason: '上下文不足，无法唯一定位' };
      const start = text.indexOf(needle);
      if (start < 0 || text.indexOf(needle, start + 1) >= 0) return { ok: false, reason: '内容或上下文已改变，或出现多个匹配' };
      from = start + record.contextBefore.length;
    }
    if (text.slice(from, from + record.after.length) !== record.after) return { ok: false, reason: '原位置的内容已改变' };
    edits.push({ from, to: from + record.after.length, insert: record.before });
  }
  try { applyEdits(text, edits); } catch { return { ok: false, reason: '回滚范围发生重叠' }; }
  return { ok: true, edits: edits.sort((a, b) => a.from - b.from) };
}
