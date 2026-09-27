import { StateField, type EditorState, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { parser } from '@lezer/markdown';
import { TreeFragment, type Tree, type Input } from '@lezer/common';

function input(doc: Text): Input {
  return { length: doc.length, chunk: pos => doc.sliceString(pos, Math.min(pos + 4096, doc.length)),
    lineChunks: false, read: (from, to) => doc.sliceString(from, to) };
}
interface SyntaxIndex { tree: Tree; fragments: readonly TreeFragment[] }
// Obsidian's syntax names vary by editor version. An incremental Lezer Markdown tree
// supplies a conservative second guard; host code/HTML nodes are also respected.
export const syntaxIndex = StateField.define<SyntaxIndex>({
  create(state) {
    const tree = parser.parse(input(state.doc));
    return { tree, fragments: TreeFragment.addTree(tree) };
  },
  update(index, tr) {
    if (!tr.docChanged) return index;
    const changes: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => changes.push({ fromA, toA, fromB, toB }));
    const fragments = TreeFragment.applyChanges(index.fragments, changes);
    const tree = parser.parse(input(tr.newDoc), fragments);
    return { tree, fragments: TreeFragment.addTree(tree, fragments) };
  },
});
const yamlCache = new WeakMap<EditorState, number>();
export function frontmatterEnd(state: EditorState): number {
  const cached = yamlCache.get(state);
  if (cached !== undefined) return cached;
  const end = computeFrontmatterEnd(state);
  yamlCache.set(state, end);
  return end;
}
function computeFrontmatterEnd(state: EditorState): number {
  if (!/^\uFEFF?---\s*$/.test(state.doc.line(1).text)) return 0;
  for (let i = 2; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (/^(---|\.\.\.)\s*$/.test(line.text)) return Math.min(state.doc.length, line.to + 1);
  }
  // An unfinished YAML header remains protected while the user types.
  return state.doc.length;
}
export function noteDisabled(state: EditorState): boolean {
  const end = frontmatterEnd(state);
  return end > 0 && /^tagshield\s*:\s*false\s*(?:#.*)?$/mi.test(state.doc.sliceString(0, end));
}
function protectedNode(name: string): boolean {
  return /^(FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock|ProcessingInstruction|Link|Image|Autolink)$/.test(name)
    || /(?:^|_)(?:codeblock|inline-code|hmd-codeblock|frontmatter|math|html-block)(?:_|$)/i.test(name);
}
export function syntaxReason(state: EditorState, from: number, to: number): string | null {
  if (from < frontmatterEnd(state)) return 'YAML frontmatter';
  const trees = [state.field(syntaxIndex).tree, syntaxTree(state)];
  for (const tree of trees) {
    let reason: string | null = null;
    tree.iterate({ from, to, enter(node) {
      if (node.to <= from || node.from >= to) return false;
      if (protectedNode(node.name) || /comment/i.test(node.name)) { reason = node.name; return false; }
    } });
    if (reason) return reason;
  }
  return null;
}
interface ProtectedRange { from: number; to: number }
const directiveCache = new WeakMap<EditorState, ProtectedRange[]>();
function directiveRanges(state: EditorState): ProtectedRange[] {
  const cached = directiveCache.get(state);
  if (cached) return cached;
  const ranges: ProtectedRange[] = [];
  let offStart = -1;
  const tree = state.field(syntaxIndex).tree;
  // Index standalone directives once per state, using only structural nodes. In
  // particular, do not repeatedly rescan the document prefix for each candidate.
  tree.iterate({ enter(node) {
    if (/^(FencedCode|CodeBlock|Paragraph|HTMLBlock)$/.test(node.name)) return false;
    if (node.name !== 'CommentBlock' || node.from < frontmatterEnd(state)) return;
    const comment = state.doc.sliceString(node.from, node.to).trim();
    if (/^<!--\s*tagshield:\s*off\s*-->$/i.test(comment) && offStart < 0) offStart = node.to;
    if (/^<!--\s*tagshield:\s*on\s*-->$/i.test(comment) && offStart >= 0) {
      ranges.push({ from: offStart, to: node.from }); offStart = -1;
    }
    if (/^<!--\s*tagshield:\s*ignore-next\s*-->$/i.test(comment)) {
      for (let n = state.doc.lineAt(node.to).number + 1; n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        if (line.text.trim()) { ranges.push({ from: line.from, to: line.to }); break; }
      }
    }
    return false;
  } });
  if (offStart >= 0) ranges.push({ from: offStart, to: state.doc.length });
  ranges.sort((a, b) => a.from - b.from);
  const merged: ProtectedRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push(range);
  }
  directiveCache.set(state, merged);
  return merged;
}
export function regionDisabled(state: EditorState, from: number, to: number): boolean {
  const ranges = directiveRanges(state);
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]!.to < from) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return !!range && range.from < to && range.to >= from;
}
