import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const extensionPath = fileURLToPath(new URL('../dist', import.meta.url));
async function fixture(viewport = { width: 1440, height: 1050 }) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('http://garden.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>测试阅读页</title><h1>A page for isolated extension tests</h1>' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/app/index.html`);
  await expect(page.locator('#stat-unread')).toHaveText('0');
  return { context, page, worker, errors };
}
async function addLink(page) {
  await page.getByRole('button', { name: '添加链接', exact: true }).click();
  await page.getByLabel('链接', { exact: true }).fill('http://garden.test/learn?utm_source=test');
  await page.getByLabel('标题（留空则显示站点名）', { exact: true }).fill('值得读的一篇文章');
  await page.getByLabel('留给以后的自己', { exact: true }).fill('读完之后记一句自己的理解');
  await page.getByLabel('标签，用逗号分隔', { exact: true }).fill('学习，工具');
  await page.getByRole('button', { name: '种进花园', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#stat-unread')).toHaveText('1');
}

test('real extension persists cards, supports read/delete/undo and round-trips a backup', async ({}, info) => {
  const { context, page, errors } = await fixture();
  try {
    await expect(page.locator('#demo-banner')).toBeHidden();
    await addLink(page);
    await page.reload(); await expect(page.locator('#items article')).toHaveCount(1);
    await page.locator('#search').fill('工具'); await expect(page.locator('#items article')).toHaveCount(1);
    await page.getByRole('button', { name: '标记已读', exact: true }).click();
    await expect(page.locator('#stat-read')).toHaveText('1');
    await page.locator('[data-view="read"]').click();
    await expect(page.getByRole('link', { name: '值得读的一篇文章' })).toHaveAttribute('href', 'http://garden.test/learn');
    await page.getByRole('button', { name: '移除收藏', exact: true }).click(); await expect(page.locator('#items article')).toHaveCount(0);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('#items article')).toHaveCount(1);
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出备份', exact: true }).click();
    const download = await downloadEvent, backupPath = info.outputPath('backup.json'); await download.saveAs(backupPath);
    const backup = JSON.parse(await readFile(backupPath, 'utf8'));
    expect(backup.items).toHaveLength(1); expect(backup.items[0].readAt).not.toBeNull();
    await page.getByRole('button', { name: '移除收藏', exact: true }).click(); await expect(page.locator('#items article')).toHaveCount(0);
    await page.locator('#import-file').setInputFiles(backupPath);
    await page.getByRole('button', { name: '合并导入', exact: true }).click(); await expect(page.locator('#items article')).toHaveCount(1);
    await page.getByRole('button', { name: '编辑收藏', exact: true }).click();
    await page.getByLabel('标题（留空则显示站点名）', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('#items .item-title')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#items img')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('real tabs API groups pages, saves before deduplication and restores to a new window', async () => {
  const { context, page, worker, errors } = await fixture();
  try {
    for (const suffix of ['/alpha', '/alpha?utm_source=duplicate', '/beta']) {
      const tab = await context.newPage(); await tab.goto('http://garden.test' + suffix);
    }
    await page.bringToFront(); await page.getByRole('button', { name: '刷新花园', exact: true }).click();
    await expect(page.locator('#stat-duplicate')).toHaveText('1');
    await page.locator('[data-view="tabs"]').click(); await expect(page.locator('#items article')).toHaveCount(3);
    await page.getByRole('button', { name: '按站点分组', exact: true }).click();
    await page.getByRole('button', { name: '开始分组', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
    const groups = await worker.evaluate(() => chrome.tabGroups.query({})); expect(groups.some(g => g.title === 'garden.test')).toBeTruthy();
    await page.getByRole('button', { name: '去整理 ↗', exact: true }).click();
    await page.getByRole('button', { name: '保存快照并关闭', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('#stat-duplicate')).toHaveText('0'); await expect(page.locator('#session-count')).toHaveText('1');
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('tab-garden-v1'))['tab-garden-v1']);
    expect(stored.sessions[0].tabs).toHaveLength(3);
    const after = await worker.evaluate(() => chrome.tabs.query({})); expect(after.filter(t => t.url?.startsWith('http://garden.test/'))).toHaveLength(2);
    await page.locator('[data-view="sessions"]').click();
    await page.getByRole('button', { name: '预览并恢复快照', exact: true }).click();
    await page.getByRole('button', { name: '恢复到新窗口', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect.poll(async () => {
      const windows = await worker.evaluate(() => chrome.windows.getAll({ populate: true }));
      return windows.length === 2 && windows.some(w => w.tabs.filter(t => t.url?.startsWith('http://garden.test/')).length === 3);
    }).toBeTruthy();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('narrow viewport remains usable and keyboard search works', async ({}, info) => {
  const { context, page, errors } = await fixture({ width: 390, height: 844 });
  try {
    await addLink(page);
    await page.locator('h1').click(); await page.keyboard.press('/'); await expect(page.locator('#search')).toBeFocused();
    await page.locator('#search').fill('不存在'); await expect(page.locator('#empty-title')).toHaveText('这次没有找到');
    await page.locator('#search').fill(''); await expect(page.locator('#items article')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
