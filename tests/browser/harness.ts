import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { history, historyKeymap, undo } from '@codemirror/commands';
import { App } from './obsidian-mock';
import { createEditorExtension, refreshShield } from '../../src/editor/extension';
import { findCandidates } from '../../src/editor/detector';
import { commitEdits } from '../../src/editor/transactions';
import { ignoreInstance } from '../../src/editor/ignored';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { HistoryManager } from '../../src/history/history-manager';
import { applyEdits, planRollback } from '../../src/history/rollback';
import { escapeTag } from '../../src/parser/escape';
import { DiffModal, HistoryModal, ReviewModal } from '../../src/ui/modals';
import type { Candidate, Settings } from '../../src/types';
import { MemoryStorage } from '../storage';
const app = new App() as unknown as import('obsidian').App;
const settings: Settings = { ...DEFAULT_SETTINGS };
const storage = new MemoryStorage();
let journals = new HistoryManager(storage, 'history', () => settings);
const errors: string[] = [];
let view: EditorView;
function target() { return { view, filePath: 'demo.md', valid: () => view.dom.isConnected }; }
function review(items: Candidate[]) {
  const expected = view.state.doc;
  new ReviewModal(app, items, { lineAt: pos => expected.lineAt(pos).number,
    fix: async (items, code) => {
      const edits = items.map(i => ({ from: i.from, to: i.to, insert: escapeTag(i.raw, code ? 'code' : settings.escapeStyle) }));
      new DiffModal(app, 'TagShield · 修改预览', expected.toString(), applyEdits(expected.toString(), edits), async () => {
        await commitEdits(journals, target(), expected, edits, edits.length > 1 ? 'bulk-fix' : 'escape', true);
      }).open();
    },
    ignore: async (item, always) => {
      if (always) settings.ignoredTags.push(item.tagName.toLowerCase());
      view.dispatch({ effects: [ignoreInstance.of(item), refreshShield.of(null)] });
    },
  }).open();
}
function mount(doc: string, mode: Settings['mode'] = 'safe') {
  view?.destroy();
  document.querySelectorAll('.modal').forEach(el => el.remove());
  settings.mode = mode; settings.ignoredTags = [];
  view = new EditorView({ parent: document.querySelector('#editor')!, state: EditorState.create({ doc,
    extensions: [markdown(), history(), keymap.of(historyKeymap), createEditorExtension({ settings: () => settings,
      review: (_view, items) => review(items), error: error => errors.push(String(error)),
      automatic: async (_view, items) => {
        await commitEdits(journals, target(), view.state.doc, items.map(i => ({ from: i.from, to: i.to, insert: escapeTag(i.raw) })), 'escape');
      } })] }) });
}
async function restore() {
  const [journal] = (await journals.list()).filter(j => j.status === 'applied' || j.status === 'prepared');
  if (!journal) throw new Error('No history');
  const expected = view.state.doc;
  const plan = await planRollback(expected.toString(), journal);
  if (plan.ok) new DiffModal(app, 'TagShield · 回滚预览', expected.toString(), applyEdits(expected.toString(), plan.edits), async () => {
    await commitEdits(journals, target(), expected, plan.edits, 'restore', true);
    await journals.mark(journal, 'restored');
  }).open();
  else if (journal.snapshot) new DiffModal(app, 'TagShield · 回滚冲突', expected.toString(), journal.snapshot.content, async () => {
    await commitEdits(journals, target(), expected, [{ from: 0, to: expected.length, insert: journal.snapshot!.content }], 'restore', true);
  }, plan.reason, true).open();
}
document.querySelector('#scan')!.addEventListener('click', () => review(findCandidates(view.state, { from: 0, to: view.state.doc.length }, settings, true)));
document.querySelector('#history')!.addEventListener('click', () => { void journals.list().then(items => new HistoryModal(app, items, restore).open()); });
const api = {
  mount, text: () => view.state.doc.toString(),
  edit: (from: number, to: number, insert: string) => view.dispatch({ changes: { from, to, insert }, annotations: Transaction.userEvent.of('input.type') }),
  undo: () => undo(view), errors, storage,
  history: () => journals.list(),
  restart: () => { const text = view.state.doc.toString(); journals = new HistoryManager(storage, 'history', () => settings); mount(text); },
  restore,
  setComposing: (value: boolean) => Object.defineProperty(view, 'composing', { configurable: true, value }),
};
declare global { interface Window { tagshield: typeof api } }
window.tagshield = api;
mount('**在<body>中编写 HTML 的核心内容**\n\nHTML 中 <head> 标签用于页面信息。\n\n<div class="notice">\n  <strong>Hello</strong>\n</div>\n\n`<body>` 与代码块不会被修改。');
