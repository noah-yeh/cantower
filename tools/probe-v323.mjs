/**
 * 探针 v3.23：猎人成长轴换成暴击
 *
 * 要确认三件事：
 *   1. 属性面板的暴击行读的是职业倍率（猎人 3 倍 / 其它 1.5 倍）与常量上限 60
 *   2. 面板不溢出、能正常关闭（改动没碰坏 v3.20 的浮层）
 *   3. 升级提示里猎人写的是「暴击 +3%」（core 层已由 node 验证，这里看 UI 是否透传）
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
const hire = page.locator('[data-action="hire"]').first();
if (await hire.count()) { await hire.click(); await page.waitForTimeout(300); }

await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(400);

const btn = page.locator('[data-action="open-stats"]').first();
console.log('① 属性按钮:', (await btn.count()) === 1 ? 'PASS' : 'FAIL');
await btn.click();
await page.waitForTimeout(400);

/** ② 暴击行内容 */
const critRow = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.stats-panel .sp-row')]
    .find((r) => r.querySelector('.sp-key b')?.textContent === '暴击');
  if (!row) return null;
  return {
    val: row.querySelector('.sp-key i')?.textContent ?? '',
    desc: row.querySelector('.sp-desc')?.textContent ?? '',
    text: row.textContent.replace(/\s+/g, ' ').trim(),
  };
});
console.log('② 暴击行:', critRow ? critRow.text : 'FAIL 未找到');
console.log('②b 上限是常量 60:', critRow?.desc.includes('上限 60') ? 'PASS' : 'FAIL');
console.log('②c 倍率按职业给出:', /暴击造成 (1\.5|3) 倍伤害/.test(critRow?.desc ?? '') ? 'PASS' : 'FAIL');

/** ③ 无溢出 + 可关闭 */
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('③ 无横向溢出:', overflow ? 'FAIL' : 'PASS');
await page.screenshot({ path: 'tools/.v323-stats.png' });

await page.locator('.stats-panel').click({ position: { x: 12, y: 12 } });
await page.waitForTimeout(300);
console.log('③b 点空白关闭:', (await page.locator('.stats-panel').count()) === 0 ? 'PASS' : 'FAIL');

/** ④ 职业卡上的成长文案（营地里每个角色卡都有一行"每级 +X"） */
const growth = await page.evaluate(() => {
  const t = document.body.innerText;
  return ['暴击 +3%', '最大生命 +4', '知识 +4', '幸运 +3'].filter((s) => t.includes(s));
});
console.log('④ 成长文案可见:', growth.join(' / ') || '（本屏未显示）');

await browser.close();
