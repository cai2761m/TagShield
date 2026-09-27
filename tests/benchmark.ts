import { EditorState } from '@codemirror/state';
import { syntaxIndex } from '../src/editor/syntax';
import { findCandidates } from '../src/editor/detector';
import { changedLineRange } from '../src/editor/extension';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
const doc = Array.from({ length: 10000 }, (_, n) => `第 ${n + 1} 段 HTML 中的<body>标签用于页面正文。`).join('\n\n');
const start = performance.now();
let state = EditorState.create({ doc, extensions: [syntaxIndex] });
const initialParse = performance.now() - start;
const pos = state.doc.line(10001).from + 4;
const editStart = performance.now();
state = state.update({ changes: { from: pos, insert: '新增' } }).state;
const incrementalParse = performance.now() - editStart;
const range = changedLineRange(state, pos, pos + 2);
const localStart = performance.now();
const local = findCandidates(state, range, DEFAULT_SETTINGS);
const localScan = performance.now() - localStart;
const fullStart = performance.now();
const full = findCandidates(state, { from: 0, to: state.doc.length }, DEFAULT_SETTINGS);
const fullScan = performance.now() - fullStart;
if (local.length > 5 || full.length !== 10000) throw new Error('Range scan regression');
console.log(JSON.stringify({ paragraphs: 10000, characters: doc.length, initialParseMs: +initialParse.toFixed(2),
  incrementalParseMs: +incrementalParse.toFixed(2), localScanMs: +localScan.toFixed(2),
  localCandidates: local.length, explicitFullScanMs: +fullScan.toFixed(2), fullCandidates: full.length }, null, 2));
