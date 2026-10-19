import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('preview root redirects to the app and relative JS/CSS resources load', async () => {
  const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url))], { env: { ...globalThis.process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
      process.on('error', reject);
      process.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      process.on('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}`)); });
    });
    const root = await fetch(base, { redirect: 'manual' });
    assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/app/index.html');
    const pageUrl = new URL(root.headers.get('location'), base);
    const page = await fetch(pageUrl); assert.equal(page.status, 200);
    const html = await page.text();
    const css = new URL(html.match(/rel="stylesheet" href="([^"]+)"/)[1], pageUrl);
    const script = new URL(html.match(/<script type="module" src="([^"]+)"/)[1], pageUrl);
    for (const url of [css, script]) assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(`${base}/package.json`)).status, 403);
  } finally { process.kill(); }
});
