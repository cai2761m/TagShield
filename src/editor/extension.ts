import { StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Candidate, Settings } from '../types';
import { findCandidates } from './detector';
import { syntaxIndex } from './syntax';
import { tagShieldTransaction } from './transactions';
import { ignoredInstances } from './ignored';
export const refreshShield = StateEffect.define<null>();
const redrawShield = StateEffect.define<null>();
export interface ExtensionHost {
  settings(): Settings;
  review(view: EditorView, items: Candidate[]): void;
  automatic(view: EditorView, items: Candidate[]): Promise<void>;
  error(error: unknown): void;
}
export function changedLineRange(state: EditorState, from: number, to: number): { from: number; to: number } {
  return { from: state.doc.line(Math.max(1, state.doc.lineAt(from).number - 2)).from,
    to: state.doc.line(Math.min(state.doc.lines, state.doc.lineAt(to).number + 2)).to };
}
export function createEditorExtension(host: ExtensionHost) {
  return [syntaxIndex, ignoredInstances, ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    items: Candidate[] = [];
    ignored = new Set<string>();
    timer: ReturnType<typeof setTimeout> | undefined;
    pending: { from: number; to: number }[] = [];
    constructor(readonly view: EditorView) { this.queueViewport(); }
    queueViewport() { this.pending.push(...this.view.visibleRanges.map(r => ({ ...r }))); this.schedule(); }
    schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.analyze(), 200); }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.items = this.items.filter(item => !update.changes.touchesRange(item.from, item.to))
          .map(item => ({ ...item, from: update.changes.mapPos(item.from, 1), to: update.changes.mapPos(item.to, -1) }));
        this.pending = this.pending.map(r => ({ from: update.changes.mapPos(r.from), to: update.changes.mapPos(r.to, 1) }));
        // Undo/redo must stay undone. Never schedule automatic protection from our own transaction.
        const own = update.transactions.some(tr => tr.annotation(tagShieldTransaction) || tr.isUserEvent('undo') || tr.isUserEvent('redo'));
        if (own) { this.pending = []; clearTimeout(this.timer); this.items = []; this.decorations = Decoration.none; this.allowAutomatic = false; }
        else {
          this.allowAutomatic = true;
          update.changes.iterChangedRanges((_a, _b, from, to) => this.pending.push(changedLineRange(update.state, from, to)));
          this.schedule();
        }
      }
      if (update.viewportChanged && !update.docChanged) this.queueViewport();
      if (update.transactions.some(tr => tr.effects.some(e => e.is(refreshShield)))) {
        this.items = []; this.ignored.clear(); this.queueViewport();
      }
    }
    analyze() {
      if (this.view.composing) { this.schedule(); return; }
      const settings = host.settings();
      if (settings.mode === 'manual') { this.items = []; this.decorations = Decoration.none; this.pending = []; this.view.dispatch({ effects: redrawShield.of(null) }); return; }
      const ranges = this.pending.splice(0).sort((a, b) => a.from - b.from);
      const merged: { from: number; to: number }[] = [];
      for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
        else merged.push({ ...range });
      }
      const found = merged.flatMap(r => findCandidates(this.view.state, r, settings));
      this.items = this.items.filter(i => !merged.some(r => i.from < r.to && i.to > r.from));
      this.items.push(...found.filter(i => (i.risk === 'safe' || i.risk === 'ambiguous') && !this.ignored.has(`${i.from}:${i.raw}`)));
      this.items.sort((a, b) => a.from - b.from);
      this.decorations = Decoration.set(this.items.map(i => Decoration.mark({ class: 'tagshield-candidate',
        attributes: { title: `TagShield: ${i.reasons.join('；')}（点击检查）`, 'data-tagshield': 'true' } }).range(i.from, i.to)), true);
      this.view.dispatch({ effects: redrawShield.of(null) });
      // Automatic work only follows actual edits, never an opening/scrolling full-note sweep.
      // Explicit intent is required even when the user lowers the confidence threshold.
      const auto = found.filter(i => i.risk === 'safe' && i.confidence === 1 && i.confidence >= settings.autoThreshold);
      if (settings.mode === 'automatic' && auto.length && this.allowAutomatic) void host.automatic(this.view, auto).catch(host.error);
      this.allowAutomatic = false;
    }
    allowAutomatic = false;
    destroy() { clearTimeout(this.timer); }
  }, {
    decorations: plugin => plugin.decorations,
    eventHandlers: {
      input() { this.allowAutomatic = true; },
      paste() { this.allowAutomatic = true; },
      compositionend() { this.allowAutomatic = true; this.schedule(); },
      mousedown(event) {
        if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-tagshield]')) return false;
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        const item = this.items.find(i => pos !== null && pos >= i.from && pos <= i.to);
        if (item) { host.review(this.view, [item]); return true; }
        return false;
      },
    },
  })];
}
