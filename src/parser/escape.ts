import type { EscapeStyle } from '../types';
export function escapeTag(tag: string, style: EscapeStyle = 'backslash'): string {
  if (!tag.startsWith('<') || !tag.endsWith('>') || tag.endsWith('\\>')) return tag;
  if (style === 'entity') return '&lt;' + tag.slice(1, -1) + '&gt;';
  if (style === 'code') {
    const runs = tag.match(/`+/g) ?? [];
    const fence = '`'.repeat(Math.max(0, ...runs.map(s => s.length)) + 1);
    return fence + tag + fence;
  }
  return '\\<' + tag.slice(1, -1) + '\\>';
}
