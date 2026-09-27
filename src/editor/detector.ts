import type { EditorState } from '@codemirror/state';
import type { Candidate, Settings } from '../types';
import { tokenize } from '../parser/candidate';
import { noteDisabled, regionDisabled, syntaxReason, syntaxIndex } from './syntax';
import { ignoredInstances } from './ignored';
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const ACTIVE = new Set('script style iframe object embed svg math textarea title'.split(' '));
export function findCandidates(state: EditorState, range: { from: number; to: number }, settings: Settings, manual = false): Candidate[] {
  if (!manual && noteDisabled(state)) return [];
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const text = state.doc.sliceString(first.from, last.to);
  const tokens = tokenize(text, first.from);
  return tokens.filter(t => t.from >= range.from && t.to <= range.to).map(token => {
    const before = state.doc.sliceString(Math.max(first.from, token.from - 80), token.from);
    const after = state.doc.sliceString(token.to, Math.min(last.to, token.to + 80));
    const item: Candidate = { from: token.from, to: token.to, raw: token.raw, tagName: token.name,
      language: token.name.length === 1 ? 'generic' : /^[A-Z]/.test(token.name) ? 'jsx' : token.name.includes(':') ? 'xml' : 'unknown',
      contextBefore: before, contextAfter: after, risk: 'ambiguous', confidence: 0.5, reasons: ['需要确认是否为普通文字'] };
    const reason = syntaxReason(state, token.from, token.to);
    if (reason || regionDisabled(state, token.from, token.to) || settings.ignoredTags.includes(token.name.toLowerCase())
      || state.field(ignoredInstances, false)?.some(r => r.from === token.from && r.to === token.to)) {
      return { ...item, risk: 'ignored', confidence: 1, reasons: [reason ?? '已忽略或位于禁用区域'] };
    }
    const name = token.name.toLowerCase();
    // Pairing follows the enclosing paragraph tree, including tags many lines away.
    // Never infer independence just because a closing tag is outside the changed lines.
    const tree = state.field(syntaxIndex).tree;
    let parent = tree.resolveInner(token.from, 1);
    while (parent.parent && parent.name !== 'Paragraph') parent = parent.parent;
    let pair = false;
    const openBefore = new Set<string>();
    let insideHtml = false;
    if (parent.name === 'Paragraph') tree.iterate({ from: parent.from, to: parent.to, enter(node) {
      if (node.name !== 'HTMLTag' || node.from === token.from) return;
      const head = /^<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/.exec(state.doc.sliceString(node.from, Math.min(node.to, node.from + 256)));
      const other = head?.[2]?.toLowerCase();
      if (!other) return;
      const closing = head![1] === '/';
      if (other === name && closing !== token.closing) pair = true;
      if (node.to <= token.from) {
        if (closing) openBefore.delete(other);
        else if (!VOID.has(other) && !/\/\s*>$/.test(state.doc.sliceString(Math.max(node.from, node.to - 4), node.to))) openBefore.add(other);
      } else if (node.from >= token.to && closing && openBefore.has(other)) insideHtml = true;
    } });
    if (pair || insideHtml || ACTIVE.has(name)) return { ...item, risk: 'real-html', confidence: 1, reasons: ['存在配对标签、位于 HTML 容器内或具有可执行 HTML 语义'] };
    if (token.attributes || token.selfClosing || VOID.has(name) || token.closing) {
      return { ...item, reasons: ['属性、闭合或空元素可能是真实 HTML；仅允许明确确认后修复'] };
    }
    // NEVER modify ambiguous HTML automatically. Natural-language cues are suggestions,
    // not proof of intent: only explicit `tagshield: literal` comments authorize automation.
    const prose = /[\p{L}]/u.test(before) && (/^\s*(标签|元素|表示|负责|用于|中|是|tag\b|element\b)/i.test(after));
    const line = state.doc.lineAt(token.from);
    const explicit = line.number > 1 && /^\s*<!--\s*tagshield:\s*literal\s*-->\s*$/i.test(state.doc.line(line.number - 1).text);
    if (explicit) return { ...item, risk: 'safe', confidence: 1, reasons: ['用户以 tagshield: literal 明确标记下一行为普通文字'] };
    if (prose) return { ...item, risk: 'safe', confidence: 0.96, reasons: ['正文中讨论标签，建议人工确认'] };
    return item;
  });
}
