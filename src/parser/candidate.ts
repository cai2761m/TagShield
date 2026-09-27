export interface TagToken { from: number; to: number; raw: string; name: string; attributes: boolean; closing: boolean; selfClosing: boolean }
export function isEscaped(text: string, offset: number): boolean {
  let slashes = 0;
  while (offset > 0 && text[--offset] === '\\') slashes++;
  return slashes % 2 === 1;
}
// Tokenization is quote aware. This is only candidate discovery, never permission to edit.
export function tokenize(text: string, base = 0): TagToken[] {
  const result: TagToken[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '<' || isEscaped(text, i)) continue;
    const start = i;
    const head = /^<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/.exec(text.slice(i));
    if (!head) continue;
    let pos = i + head[0].length;
    if (!/[\s/>]/.test(text[pos] ?? '')) continue;
    const attrStart = pos;
    let quote = '';
    for (; pos < text.length; pos++) {
      const char = text[pos]!;
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '<' || char === '\n' || char === '\r') break;
      if (char !== '>') continue;
      if (!isEscaped(text, pos)) {
        const tail = text.slice(attrStart, pos).trim();
        result.push({ from: base + start, to: base + pos + 1, raw: text.slice(start, pos + 1),
          name: head[2]!, attributes: tail.replace(/\/$/, '').trim().length > 0,
          closing: head[1] === '/', selfClosing: tail.endsWith('/') });
      }
      i = pos;
      break;
    }
  }
  return result;
}
