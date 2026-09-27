import { Annotation, Transaction, type Text } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { Edit } from '../types';
import type { HistoryManager } from '../history/history-manager';
import type { ChangeRecord, Journal } from '../history/rollback';
export const tagShieldTransaction = Annotation.define<boolean>();
export interface ChangeTarget { view: EditorView; filePath: string; valid(): boolean }
export async function commitEdits(history: HistoryManager, target: ChangeTarget, expected: Text, edits: Edit[],
  operation: ChangeRecord['operation'], snapshot = false): Promise<Journal> {
  const { view, filePath } = target;
  const valid = () => target.valid() && view.state.doc === expected && !view.composing;
  if (!valid()) throw new Error('笔记已变化或输入法正在组词，请重新检查');
  const journal = await history.prepare(filePath, expected.toString(), edits, operation, snapshot);
  // Awaiting storage can overlap typing, note switching, plugin unload, and IME start.
  // Recheck document identity and file identity immediately before dispatch.
  if (!valid()) { await history.mark(journal, 'cancelled'); throw new Error('保存历史期间笔记发生变化，已取消修改'); }
  view.dispatch({ changes: edits, annotations: [tagShieldTransaction.of(true),
    Transaction.userEvent.of('input.tagshield'), isolateHistory.of('full')] });
  // Prepared journals already contain everything needed for restart recovery.
  // If this final status write fails, keep the recoverable prepared entry.
  try { await history.mark(journal, 'applied'); } catch { /* write-ahead entry is durable */ }
  return journal;
}
