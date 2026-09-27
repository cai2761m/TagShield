import { MarkdownView, Notice, Plugin, TFile, editorInfoField, type Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import type { Candidate, Edit, Settings } from './types';
import { DEFAULT_SETTINGS, readSettings } from './settings/settings';
import { TagShieldSettingTab } from './settings/settings-tab';
import { HistoryManager } from './history/history-manager';
import { applyEdits, planRollback, type Journal, type ChangeRecord } from './history/rollback';
import { hash } from './history/hash';
import { createEditorExtension, refreshShield } from './editor/extension';
import { findCandidates } from './editor/detector';
import { ignoreInstance } from './editor/ignored';
import { frontmatterEnd, syntaxIndex } from './editor/syntax';
import { commitEdits, type ChangeTarget } from './editor/transactions';
import { escapeTag } from './parser/escape';
import { DiffModal, HistoryModal, ReviewModal } from './ui/modals';

export default class TagShieldPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  history!: HistoryManager;
  private alive = false;
  private busy = false;
  private views = new Set<EditorView>();
  async onload() {
    this.settings = readSettings(await this.loadData());
    this.alive = true;
    this.history = new HistoryManager(this.app.vault.adapter,
      `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/history`, () => this.settings);
    this.registerEditorExtension(createEditorExtension({ settings: () => this.settings,
      review: (view, items) => this.review(view, items),
      automatic: (view, items) => this.automatic(view, items), error: error => this.error(error) }));
    this.addSettingTab(new TagShieldSettingTab(this));
    const command = (id: string, name: string, action: (view: EditorView) => void | Promise<void>) => this.addCommand({ id, name,
      editorCallback: (editor: Editor) => {
        const view = (editor as unknown as { cm?: EditorView }).cm;
        if (!view || !view.state.field(syntaxIndex, false)) { new Notice('TagShield 需要 Markdown 编辑模式'); return; }
        this.views.add(view);
        void Promise.resolve().then(() => action(view)).catch(error => this.error(error));
      } });
    command('escape-selected-tag', 'Escape selected tag / 转义选中标签', view => {
      const selection = view.state.selection.main;
      if (selection.empty) { new Notice('请先选中标签'); return; }
      this.review(view, findCandidates(view.state, selection, this.settings, true));
    });
    command('fix-current-line', 'Fix current line / 修复当前行', view => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      this.review(view, findCandidates(view.state, line, this.settings, true));
    });
    for (const [id, name] of [['scan-current-note', 'Scan current note / 扫描当前笔记'], ['review-detected-issues', 'Review detected issues / 检查问题']]) {
      command(id!, name!, view => this.review(view, findCandidates(view.state, { from: 0, to: view.state.doc.length }, this.settings, true)));
    }
    command('disable-current-note', 'Disable for current note / 禁用当前笔记', view => this.disableNote(view));
    command('undo-last-change', 'Undo last TagShield change / 回滚上次修改', async view => {
      const target = this.target(view);
      const journal = (await this.history.list()).find(j => j.filePath === target.filePath && (j.status === 'applied' || j.status === 'prepared'));
      if (!journal) { new Notice('当前笔记没有可恢复的历史'); return; }
      await this.restore(journal);
    });
    this.addCommand({ id: 'open-change-history', name: 'Open change history / 打开变更历史', callback: () => {
      void this.history.list().then(journals => new HistoryModal(this.app, journals, journal => this.restore(journal)).open()).catch(error => this.error(error));
    } });
    this.addRibbonIcon('shield-check', 'TagShield: 扫描当前笔记', () => {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      const view = (editor as unknown as { cm?: EditorView } | undefined)?.cm;
      if (view) this.review(view, findCandidates(view.state, { from: 0, to: view.state.doc.length }, this.settings, true));
      else new Notice('请先打开 Markdown 编辑器');
    });
    // Prune only owned, validated journal files, never notes or unrelated plugin data.
    void this.history.prune().catch(error => this.error(error));
  }
  onunload() { this.alive = false; this.views.clear(); }
  private error(error: unknown) { new Notice(`TagShield: ${error instanceof Error ? error.message : String(error)}`, 7000); }
  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
        if (cm) this.views.add(cm);
      }
    });
    for (const view of this.views) if (view.dom.isConnected) view.dispatch({ effects: refreshShield.of(null) });
  }
  private target(view: EditorView): ChangeTarget {
    const path = () => view.state.field(editorInfoField, false)?.file?.path;
    const filePath = path();
    if (!filePath) throw new Error('无法确定编辑器对应的笔记文件');
    this.views.add(view);
    return { view, filePath, valid: () => this.alive && view.dom.isConnected && path() === filePath };
  }
  review(view: EditorView, items: Candidate[]) {
    const expected = view.state.doc;
    const target = this.target(view);
    new ReviewModal(this.app, items, {
      lineAt: pos => expected.lineAt(pos).number,
      fix: async (selected, asCode) => {
        if (view.state.doc !== expected || !target.valid()) throw new Error('笔记已变化，请重新扫描');
        const edits = selected.filter(i => i.risk === 'safe' || i.risk === 'ambiguous')
          .map(i => ({ from: i.from, to: i.to, insert: escapeTag(i.raw, asCode ? 'code' : this.settings.escapeStyle) }));
        this.preview(target, expected, edits, edits.length > 1 ? 'bulk-fix' : 'escape', true);
      },
      ignore: async (item, always) => {
        if (always) {
          this.settings.ignoredTags = [...new Set([...this.settings.ignoredTags, item.tagName.toLowerCase()])];
          await this.saveSettings();
        } else {
          if (view.state.doc !== expected || !target.valid()) throw new Error('笔记已变化，请重新扫描');
          view.dispatch({ effects: [ignoreInstance.of(item), refreshShield.of(null)] });
        }
      },
    }).open();
  }
  private preview(target: ChangeTarget, expected: Text, edits: Edit[], operation: ChangeRecord['operation'], snapshot: boolean) {
    if (!edits.length) { new Notice('没有可安全处理的标签'); return; }
    const before = expected.toString();
    new DiffModal(this.app, 'TagShield · 修改预览', before, applyEdits(before, edits),
      () => this.commit(target, expected, edits, operation, snapshot)).open();
  }
  private async commit(target: ChangeTarget, expected: Text, edits: Edit[], operation: ChangeRecord['operation'], snapshot: boolean) {
    if (this.busy) throw new Error('另一个 TagShield 操作正在保存，请稍后重试');
    this.busy = true;
    try {
      await commitEdits(this.history, target, expected, edits, operation, snapshot);
      new Notice(`TagShield: 已完成 ${edits.length} 项修改，可用 Ctrl/Cmd+Z 或变更历史恢复`);
      await this.history.prune();
    } finally { this.busy = false; }
  }
  private async automatic(view: EditorView, items: Candidate[]) {
    if (this.busy || this.settings.mode !== 'automatic') return;
    const target = this.target(view);
    const stillValid = target.valid;
    target.valid = () => stillValid() && this.settings.mode === 'automatic';
    const edits = items.filter(i => i.risk === 'safe' && i.confidence === 1 && i.confidence >= this.settings.autoThreshold)
      .map(i => ({ from: i.from, to: i.to, insert: escapeTag(i.raw, this.settings.escapeStyle) }));
    if (edits.length) await this.commit(target, view.state.doc, edits, edits.length > 1 ? 'bulk-fix' : 'escape', edits.length > 1);
  }
  private disableNote(view: EditorView) {
    const expected = view.state.doc;
    const end = frontmatterEnd(view.state);
    let edit: Edit;
    if (end) {
      const yaml = expected.sliceString(0, end);
      const match = /^tagshield\s*:.*$/m.exec(yaml);
      if (match) edit = { from: match.index, to: match.index + match[0].length, insert: 'tagshield: false' };
      else {
        const firstEnd = expected.line(1).to;
        const pos = Math.min(firstEnd + 1, expected.length);
        edit = { from: pos, to: pos, insert: `${pos === firstEnd ? '\n' : ''}tagshield: false\n` };
      }
    } else edit = { from: 0, to: 0, insert: '---\ntagshield: false\n---\n' };
    this.preview(this.target(view), expected, [edit], 'disable-note', true);
  }
  private async restore(journal: Journal) {
    const file = this.app.vault.getAbstractFileByPath(journal.filePath);
    if (!(file instanceof TFile)) throw new Error('原笔记不存在或已重命名；请先恢复原路径再重试');
    let leaf = this.app.workspace.getLeavesOfType('markdown').find(l => l.view instanceof MarkdownView && l.view.file?.path === file.path);
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.openFile(file, { state: { mode: 'source' } }); }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof MarkdownView)) throw new Error('请在编辑模式打开笔记后重试');
    const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) throw new Error('请切换到编辑模式后重试');
    const target = this.target(cm);
    const expected = cm.state.doc;
    const before = expected.toString();
    const plan = await planRollback(before, journal);
    if (plan.ok) {
      new DiffModal(this.app, 'TagShield · 回滚预览', before, applyEdits(before, plan.edits), async () => {
        await this.commit(target, expected, plan.edits, 'restore', true);
        await this.history.mark(journal, 'restored');
      }).open();
    } else {
      const snapshot = journal.snapshot;
      if (!snapshot || typeof snapshot.content !== 'string' || snapshot.hash !== journal.records[0]?.fileHashBefore || await hash(snapshot.content) !== snapshot.hash) {
        new Notice(`回滚冲突：${plan.reason}。无有效完整快照，不会覆盖笔记。`, 10000);
        new DiffModal(this.app, 'TagShield · 冲突记录', before,
          journal.records.map(r => `原始内容：${r.before}\n变更内容：${r.after}`).join('\n'),
          null, '无法安全定位；此视图仅供核对，不会写入。').open();
        return;
      }
      new DiffModal(this.app, 'TagShield · 回滚冲突', before, snapshot.content, async () => {
        await this.commit(target, expected, [{ from: 0, to: expected.length, insert: snapshot.content }], 'restore', true);
        await this.history.mark(journal, 'restored');
      }, `${plan.reason}。强制恢复会覆盖此快照之后的全部编辑；仅在明确确认后执行。当前内容会先另存恢复快照。`, true).open();
    }
  }
}
