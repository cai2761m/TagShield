import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxIndex } from '../src/editor/syntax';
import { findCandidates } from '../src/editor/detector';
import { escapeTag } from '../src/parser/escape';
import { tokenize } from '../src/parser/candidate';
import { DEFAULT_SETTINGS, readSettings } from '../src/settings/settings';
import { ignoredInstances, ignoreInstance } from '../src/editor/ignored';

function state(doc: string) { return EditorState.create({ doc, extensions: [markdown(), syntaxIndex, ignoredInstances] }); }
function scan(doc: string, manual = false) { const s = state(doc); return findCandidates(s, { from: 0, to: doc.length }, DEFAULT_SETTINGS, manual); }
function actionable(doc: string) { return scan(doc).filter(i => i.risk === 'safe' || i.risk === 'ambiguous'); }
describe('syntax and intent safety', () => {
  it('detects the main Chinese bold example', () => {
    const [item] = scan('**在<body>中编写 HTML 的核心内容**');
    expect(item).toMatchObject({ raw: '<body>', risk: 'safe' });
    expect(escapeTag(item!.raw)).toBe('\\<body\\>');
  });
  it.each([
    '`<body>`', '``prefix `<body>` suffix``', '```html\n<body>\n</body>\n```',
    '~~~xml\n<user>\n</user>\n~~~', '    <body>', '> ```jsx\n> <Component>\n> ```',
    '- code:\n\n      <body>', '---\nexample: "<body>"\n---', '---\nexample: "<body>"',
    '<div class="notice">\n  <strong>Hello</strong>\n</div>',
    '<div>\nHello\n</div>', '<Component>', '<!-- <body> -->',
    '[link](https://example.org/<body>)', '<https://example.org>', '<me@example.org>',
  ])('protects syntax: %s', doc => expect(actionable(doc)).toEqual([]));
  it('preserves inline real HTML', () => {
    const items = scan('这是 <span style="color:red">Hello</span>。');
    expect(items).toHaveLength(2);
    expect(items.every(i => i.risk === 'real-html')).toBe(true);
  });
  it('pairs across long paragraphs even in a small changed range', () => {
    const doc = '说明 <span> 标签\n' + '内容\n'.repeat(20) + '</span>。';
    const s = state(doc);
    const items = findCandidates(s, { from: 0, to: s.doc.line(1).to }, DEFAULT_SETTINGS);
    expect(items[0]?.risk).toBe('real-html');
  });
  it.each(['说明 <input type="text"> 标签', '说明 <br> 标签', '说明 <MyButton /> 标签', '说明 </body> 标签'])('does not auto-approve %s', doc => {
    expect(scan(doc)[0]?.risk).toBe('ambiguous');
  });
  it.each(['a < b', 'x > y', '\\<body\\>', '&lt;body&gt;', '文字 \\<body>'])('ignores noncandidates: %s', doc => expect(actionable(doc)).toEqual([]));
  it('offers a generic / JSX candidate in prose', () => expect(scan('React 中的 <Component> 表示组件。')[0]?.risk).toBe('safe'));
  it('honors note disable but allows explicit commands', () => {
    const doc = '---\ntagshield: false\n---\n正文 <body> 标签';
    expect(scan(doc)).toEqual([]);
    expect(scan(doc, true)[0]?.risk).toBe('safe');
  });
  it('protects off/on regions', () => {
    const items = scan('<!-- tagshield: off -->\n\n说明 <body> 标签\n\n<!-- tagshield: on -->\n\n说明 <head> 标签');
    expect(items.map(i => i.risk)).toEqual(['ignored', 'safe']);
  });
  it('honors ignore-next across blank lines and all tags on the next line', () => {
    const items = scan('<!-- tagshield: ignore-next -->\n\n说明 <body> 标签 和 <head> 标签\n第二行 <user> 元素');
    expect(items.map(i => i.risk)).toEqual(['ignored', 'ignored', 'safe']);
  });
  it('does not interpret a directive in a code fence', () => {
    expect(scan('```\n<!-- tagshield: off -->\n```\n说明 <body> 标签')[0]?.risk).toBe('safe');
  });
  it('only explicit literal intent reaches automatic confidence', () => {
    expect(scan('HTML 中 <body> 标签')[0]?.confidence).toBeLessThan(0.98);
    expect(scan('<!-- tagshield: literal -->\nHTML 中 <body> 标签')[0]?.confidence).toBe(1);
    expect(actionable('<!-- tagshield: literal -->\n<div>Hi</div>')).toEqual([]);
    expect(actionable('<!-- tagshield: literal -->\n这是 <span>Hello <body> 标签</span>。')).toEqual([]);
  });
  it('maps an ignored instance through unrelated edits', () => {
    let s = state('说明 <body> 标签');
    s = s.update({ effects: ignoreInstance.of({ from: 3, to: 9 }) }).state;
    s = s.update({ changes: { from: 0, insert: '前缀 ' } }).state;
    expect(findCandidates(s, { from: 0, to: s.doc.length }, DEFAULT_SETTINGS)[0]?.risk).toBe('ignored');
  });
  it('updates the incremental tree after changing a paragraph into a code fence', () => {
    let s = state('说明 <body> 标签');
    s = s.update({ changes: [{ from: 0, insert: '```\n' }, { from: s.doc.length, insert: '\n```' }] }).state;
    expect(findCandidates(s, { from: 0, to: s.doc.length }, DEFAULT_SETTINGS)[0]?.risk).toBe('ignored');
  });
});
describe('transform and settings', () => {
  it('preserves quoted attributes including angle brackets', () => {
    const [token] = tokenize('文字 <input title="a > b" data-x=\'a < b\'>');
    expect(token?.raw).toBe('<input title="a > b" data-x=\'a < b\'>');
    expect(escapeTag(token!.raw)).toBe('\\<input title="a > b" data-x=\'a < b\'\\>');
  });
  it.each(['<body>', '</body>', '<Component>', '<T>', '<input type="text">'])('is idempotent for %s', tag => {
    const fixed = escapeTag(tag);
    expect(escapeTag(fixed)).toBe(fixed);
    expect(tokenize(fixed)).toEqual([]);
  });
  it('wraps tags containing backticks safely', () => expect(escapeTag('<tag title="`">', 'code')).toBe('``<tag title="`">``'));
  it('supports entities', () => expect(escapeTag('<body>', 'entity')).toBe('&lt;body&gt;'));
  it('validates stored settings', () => {
    expect(readSettings({ mode: 'unknown', autoThreshold: -1, ignoredTags: ['SPAN', 1], retentionCount: 0 }))
      .toMatchObject({ mode: 'safe', autoThreshold: 0.95, ignoredTags: ['span'], retentionCount: 1 });
  });
});
