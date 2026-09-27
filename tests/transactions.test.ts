// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { webcrypto } from 'node:crypto';
import { commitEdits } from '../src/editor/transactions';
import { HistoryManager } from '../src/history/history-manager';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { MemoryStorage } from './storage';
vi.stubGlobal('crypto', webcrypto);
const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });
function setup() {
  const view = new EditorView({ state: EditorState.create({ doc: '正文 <body> 标签', extensions: [history()] }), parent: document.body });
  views.push(view);
  const storage = new MemoryStorage();
  const journal = new HistoryManager(storage, 'history', () => DEFAULT_SETTINGS);
  const target = { view, filePath: 'note.md', valid: () => true };
  const edits = [{ from: 3, to: 9, insert: '\\<body\\>' }];
  return { view, storage, journal, target, edits };
}
describe('CodeMirror transactions', () => {
  it('writes before dispatch and supports one-step undo/redo', async () => {
    const { view, storage, journal, target, edits } = setup();
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => {
      if (JSON.parse(data).status === 'prepared') expect(view.state.doc.toString()).toBe('正文 <body> 标签');
      await write(path, data);
    };
    await commitEdits(journal, target, view.state.doc, edits, 'escape');
    expect(view.state.doc.toString()).toBe('正文 \\<body\\> 标签');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('正文 <body> 标签');
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('正文 \\<body\\> 标签');
  });
  it('aborts if the user types while history is being persisted', async () => {
    const { view, storage, journal, target, edits } = setup();
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => {
      await write(path, data);
      if (JSON.parse(data).status === 'prepared') view.dispatch({ changes: { from: 0, insert: 'typed ' } });
    };
    await expect(commitEdits(journal, target, view.state.doc, edits, 'escape')).rejects.toThrow('取消');
    expect(view.state.doc.toString()).toBe('typed 正文 <body> 标签');
    expect((await journal.list())[0]?.status).toBe('cancelled');
  });
  it('does not edit if history fails', async () => {
    const { view, storage, journal, target, edits } = setup(); storage.fail = true;
    await expect(commitEdits(journal, target, view.state.doc, edits, 'escape')).rejects.toThrow('disk full');
    expect(view.state.doc.toString()).toBe('正文 <body> 标签');
  });
  it('does not edit a switched note or unloaded editor', async () => {
    const { view, storage, journal, target, edits } = setup();
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => { await write(path, data); target.valid = () => false; };
    await expect(commitEdits(journal, target, view.state.doc, edits, 'escape')).rejects.toThrow('取消');
    expect(view.state.doc.toString()).toBe('正文 <body> 标签');
  });
  it('refuses to dispatch during IME composition', async () => {
    const { view, storage, journal, target, edits } = setup();
    Object.defineProperty(view, 'composing', { value: true });
    await expect(commitEdits(journal, target, view.state.doc, edits, 'escape')).rejects.toThrow('输入法');
    expect(storage.files.size).toBe(0);
  });
  it('retains a recoverable prepared record when the after-write fails', async () => {
    const { view, storage, journal, target, edits } = setup();
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => { if (JSON.parse(data).status === 'applied') throw new Error('disk full'); await write(path, data); };
    await commitEdits(journal, target, view.state.doc, edits, 'escape');
    expect((await journal.list())[0]?.status).toBe('prepared');
    expect(view.state.doc.toString()).toBe('正文 \\<body\\> 标签');
  });
});
