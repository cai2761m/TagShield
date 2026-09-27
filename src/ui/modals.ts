import { App, Modal, Notice, Setting } from 'obsidian';
import type { Candidate } from '../types';
import type { Journal } from '../history/rollback';

function button(parent: HTMLElement, label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const element = parent.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
  element.addEventListener('click', () => {
    element.disabled = true;
    void Promise.resolve().then(action).catch(error => new Notice(String(error))).finally(() => { element.disabled = false; });
  });
  return element;
}
export class DiffModal extends Modal {
  constructor(app: App, private titleText: string, private before: string, private after: string,
    private apply: (() => Promise<void>) | null, private warning = '', private force = false) { super(app); }
  onOpen() {
    this.titleEl.setText(this.titleText);
    this.contentEl.addClass('tagshield-modal');
    if (this.warning) this.contentEl.createEl('p', { text: this.warning, cls: 'tagshield-warning' });
    const columns = this.contentEl.createDiv({ cls: 'tagshield-diff' });
    for (const [label, text] of [['修改前', this.before], ['修改后', this.after]]) {
      const column = columns.createDiv();
      column.createEl('h3', { text: label });
      column.createEl('pre', { text });
    }
    const actions = this.contentEl.createDiv({ cls: 'tagshield-actions' });
    button(actions, '取消', () => this.close());
    if (!this.apply) return;
    const applyButton = button(actions, this.force ? '强制恢复整篇笔记' : '应用修改', async () => { await this.apply!(); this.close(); }, !this.force);
    if (this.force) {
      applyButton.disabled = true;
      new Setting(this.contentEl).setName('我理解这会覆盖当前整篇内容').addToggle(toggle => toggle.onChange(value => { applyButton.disabled = !value; }));
    }
  }
  onClose() { this.contentEl.empty(); }
}
export interface ReviewActions {
  fix(items: Candidate[], asCode?: boolean): Promise<void>;
  ignore(item: Candidate, always: boolean): Promise<void>;
  lineAt(pos: number): number;
}
export class ReviewModal extends Modal {
  private dismissed = new Set<Candidate>();
  constructor(app: App, private items: Candidate[], private actions: ReviewActions) { super(app); }
  onOpen() { this.render(); }
  private render() {
    this.titleEl.setText('TagShield · 检查标签');
    this.contentEl.empty();
    this.contentEl.addClass('tagshield-modal');
    const items = this.items.filter(i => !this.dismissed.has(i));
    const safe = items.filter(i => i.risk === 'safe');
    this.contentEl.createEl('p', { text: `发现 ${items.length} 项 · ${safe.length} 项建议修复。所有操作均先预览。` });
    if (safe.length) button(this.contentEl, '预览修复安全项', async () => { await this.actions.fix(safe); this.close(); }, true);
    if (!items.length) this.contentEl.createEl('p', { text: '没有需要处理的标签。' });
    const list = this.contentEl.createDiv({ cls: 'tagshield-list' });
    for (const item of items) {
      const row = list.createDiv({ cls: 'tagshield-item' });
      const label = { safe: '建议修复', ambiguous: '需要确认', 'real-html': '保留真实 HTML', ignored: '受保护' }[item.risk];
      row.createEl('strong', { text: `第 ${this.actions.lineAt(item.from)} 行 · ${label}` });
      row.createEl('pre', { text: item.raw });
      row.createEl('p', { text: item.reasons.join('；') });
      if (item.risk === 'ignored' || item.risk === 'real-html') continue;
      const actions = row.createDiv({ cls: 'tagshield-actions' });
      button(actions, '转义', async () => { await this.actions.fix([item]); this.close(); });
      button(actions, '作为代码', async () => { await this.actions.fix([item], true); this.close(); });
      button(actions, '忽略此项', async () => { await this.actions.ignore(item, false); this.dismissed.add(item); this.render(); });
      button(actions, `始终忽略 <${item.tagName}>`, async () => { await this.actions.ignore(item, true); this.dismissed.add(item); this.render(); });
    }
    button(this.contentEl, '关闭', () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}
export class HistoryModal extends Modal {
  constructor(app: App, private journals: Journal[], private restore: (journal: Journal) => Promise<void>) { super(app); }
  onOpen() {
    this.titleEl.setText('TagShield · 变更历史');
    this.contentEl.addClass('tagshield-modal');
    this.contentEl.createEl('p', { text: '历史保存在插件目录中。恢复前会校验内容，并显示预览；prepared 表示可能在保存状态前中断。' });
    if (!this.journals.length) this.contentEl.createEl('p', { text: '暂无历史记录。' });
    for (const journal of this.journals) {
      const row = this.contentEl.createDiv({ cls: 'tagshield-item' });
      row.createEl('strong', { text: journal.filePath });
      row.createEl('p', { text: `${new Date(journal.timestamp).toLocaleString()} · ${journal.status} · ${journal.records.length} 项` });
      row.createEl('pre', { text: journal.records.slice(0, 8).map(r => `${r.before} → ${r.after}`).join('\n') });
      if (journal.status === 'applied' || journal.status === 'prepared') button(row, '检查并恢复', async () => { await this.restore(journal); this.close(); });
    }
  }
  onClose() { this.contentEl.empty(); }
}
