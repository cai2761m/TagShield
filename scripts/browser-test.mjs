import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
await mkdir('.test-build', { recursive: true });
await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['tests/browser/harness.ts'], outfile: '.test-build/harness.js', bundle: true,
  format: 'iife', alias: { obsidian: './tests/browser/obsidian-mock.ts' } });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TagShield integration harness</title>
<style>:root{--background-secondary:#f3f5f8;--background-modifier-border:#d6dce4;--text-muted:#607086;--text-error:#b52332;--color-orange:#ad6b00}*{box-sizing:border-box}body{font:16px/1.6 system-ui;margin:32px;background:#fbfcfe;color:#192d43}h1{margin-bottom:4px}button{padding:8px 14px;cursor:pointer;background:#fff;border:1px solid #b8c7d7;border-radius:6px;color:inherit}button:disabled{opacity:.4;cursor:default}.mod-cta{background:#225fc1;color:white}#editor{margin-top:24px;border:1px solid #bac7d6;border-radius:8px;background:#fff}.cm-editor{min-height:340px;padding:18px}.modal{position:fixed;z-index:10;inset:6% 10%;overflow:auto;padding:24px;background:white;border:1px solid #d5dce5;border-radius:12px;box-shadow:0 0 0 100vmax #192d4360}.modal h2{margin-top:0}.modal label{display:flex;gap:12px;align-items:center}@media(max-width:600px){body{margin:16px}.modal{inset:3%;padding:16px}}</style>
<link rel="stylesheet" href="/styles.css"><h1>TagShield</h1><p>CodeMirror 6 集成验收 · 使用模拟 Obsidian 容器</p><button id="scan">扫描当前笔记</button> <button id="history">变更历史</button><div id="editor"></div><div id="notices" role="status"></div><script src="/harness.js"></script></html>`;
await writeFile('.test-build/index.html', html);
const server = createServer(async (req, res) => {
  const files = { '/': '.test-build/index.html', '/harness.js': '.test-build/harness.js', '/styles.css': 'styles.css' };
  const path = files[req.url];
  if (!path) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(await readFile(path));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.tagshield);
  await page.waitForSelector('.tagshield-candidate');
  const original = await page.evaluate(() => window.tagshield.text());
  assert.equal(await page.locator('.tagshield-candidate').count(), 2);
  assert.equal(await page.evaluate(() => window.tagshield.text()), original, 'safe mode never changes on open');
  await page.click('#scan');
  await page.getByRole('button', { name: '预览修复安全项' }).click();
  assert.equal(await page.evaluate(() => window.tagshield.text()), original, 'preview never writes');
  await page.screenshot({ path: 'test-results/diff-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => window.tagshield.text().includes('\\<body\\>'));
  const fixed = await page.evaluate(() => window.tagshield.text());
  assert.ok(fixed.includes('<div class="notice">\n  <strong>Hello</strong>\n</div>'));
  assert.ok(fixed.includes('`<body>`'));
  await page.evaluate(() => window.tagshield.undo());
  assert.equal(await page.evaluate(() => window.tagshield.text()), original);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.tagshield.text()), original, 'undo is not re-protected');
  // Apply again, rebuild all editor/history objects, and restore from stored journal bytes.
  await page.click('#scan');
  await page.getByRole('button', { name: '预览修复安全项' }).click();
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => window.tagshield.text().includes('\\<body\\>'));
  await page.evaluate(() => window.tagshield.restart());
  await page.evaluate(() => window.tagshield.restore());
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(text => window.tagshield.text() === text, original);
  // Click actual inline Quick Fix, then ignore this instance.
  await page.evaluate(() => window.tagshield.mount('正文 <body> 标签'));
  await page.waitForSelector('.tagshield-candidate');
  await page.locator('.tagshield-candidate').click();
  await page.getByRole('button', { name: '忽略此项', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tagshield-candidate').count(), 0);
  // Automatic mode requires explicit intent and actual typing; respect composition.
  const literal = '<!-- tagshield: literal -->\n正文 <body> 标签';
  await page.evaluate(doc => window.tagshield.mount(doc, 'automatic'), literal);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.tagshield.text()), literal, 'automatic mode does not mutate on open');
  await page.evaluate(() => { window.tagshield.setComposing(true); window.tagshield.edit(window.tagshield.text().length, window.tagshield.text().length, '。'); });
  await page.waitForTimeout(500);
  assert.ok(!(await page.evaluate(() => window.tagshield.text())).includes('\\<body'));
  await page.evaluate(() => window.tagshield.setComposing(false));
  await page.waitForFunction(() => window.tagshield.text().includes('\\<body\\>'));
  await page.evaluate(() => window.tagshield.undo());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.tagshield.text()), literal + '。');
  await page.evaluate(() => window.tagshield.mount('正文 <body> 标签', 'automatic'));
  await page.evaluate(() => window.tagshield.edit(12, 12, '。'));
  await page.waitForTimeout(400);
  assert.ok(!(await page.evaluate(() => window.tagshield.text())).includes('\\<body'));
  // Stale preview must refuse to overwrite typing.
  await page.click('#scan');
  await page.getByRole('button', { name: '预览修复安全项' }).click();
  await page.evaluate(() => window.tagshield.edit(0, 0, '新编辑 '));
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.tagshield.text())).startsWith('新编辑 '));
  assert.ok(!(await page.evaluate(() => window.tagshield.text())).includes('\\<body'));
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // Code style Quick Fix uses the same transaction and journal path.
  await page.evaluate(() => window.tagshield.mount('正文 <Component> 示例', 'manual'));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tagshield-candidate').count(), 0, 'manual mode has no realtime hints');
  await page.click('#scan');
  await page.getByRole('button', { name: '作为代码', exact: true }).click();
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => window.tagshield.text().includes('`<Component>`'));
  // Force restore is offered only after a conflict, remains disabled until confirmed,
  // and saves a fresh snapshot of the content being replaced.
  await page.evaluate(() => window.tagshield.edit(0, 2, '全新说明'));
  const conflictText = await page.evaluate(() => window.tagshield.text());
  await page.evaluate(() => window.tagshield.restore());
  assert.equal(await page.getByRole('button', { name: '强制恢复整篇笔记' }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.tagshield.text()), conflictText);
  await page.locator('.modal input[type=checkbox]').check();
  await page.getByRole('button', { name: '强制恢复整篇笔记' }).click();
  await page.waitForFunction(() => window.tagshield.text() === '正文 <Component> 示例');
  assert.equal(await page.evaluate(async () => (await window.tagshield.history())[0].snapshot.content), conflictText);
  // Mobile modal visual/layout check.
  await page.evaluate(() => window.tagshield.mount('正文 <body> 标签'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#scan');
  await page.screenshot({ path: 'test-results/review-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.tagshield.errors), []);
  console.log('Browser integration passed: safe/auto, Quick Fix, batch preview, actual CM undo, history restart/restore, IME, stale-preview and mobile layout.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
