/**
 * 探针 v3.25：四职业各有一张自己的 1 费基础攻击牌
 *
 * 要确认四件事：
 *   1. 图鉴里四个职业页各显示自己的基础牌（劈砍 / 法球 / 放箭 / 毒牙），
 *      名字与卡面文案都不一样，且 no longer 出现「打击」
 *   2. 通用页也不再发「打击」（它退出通用池）
 *   3. 起始卡组真的换成了各自的牌（进战斗读手牌）
 *   4. 页面不溢出、控制台无报错
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="open-codex"]').first().click();
await page.waitForTimeout(400);

const readCls = async (cls) => {
  await page.locator(`[data-action="codex-class"][data-cls="${cls}"]`).click();
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const head = document.querySelector('.cx-clsname')?.textContent?.trim() ?? '';
    const cards = [...document.querySelectorAll('.cx-card')].map((el) => ({
      name: el.querySelector('.cx-title b')?.textContent?.trim() ?? '',
      text: el.querySelector('.cx-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      core: !!el.querySelector('.cx-core'),
    }));
    return { head, cards };
  });
};

const expect = { warrior: '劈砍', mage: '法球', hunter: '放箭', traveler: '毒牙' };
for (const [cls, name] of Object.entries(expect)) {
  const { head, cards } = await readCls(cls);
  const basic = cards.find((c) => c.name === name);
  console.log(`① ${cls}：${head}`);
  console.log(`   - 有「${name}」:`, basic ? 'PASS' : 'FAIL');
  console.log(`   - 标为起始:`, basic?.core ? 'PASS' : 'FAIL');
  console.log(`   - 卡面:`, basic?.text ?? '—');
  console.log(`   - 不出现「打击」:`, cards.some((c) => c.name === '打击') ? 'FAIL' : 'PASS');
}

/** ② 通用页 */
await page.locator('[data-action="codex-class"][data-cls="generic"]').click();
await page.waitForTimeout(250);
const generic = await page.evaluate(() => [...document.querySelectorAll('.cx-card .cx-title b')].map((b) => b.textContent.trim()));
console.log('② 通用页牌数:', generic.length);
console.log('②b 通用页不含打击:', generic.includes('打击') ? 'FAIL' : 'PASS');

/** ③ 起始卡组：招一个战士，出发看手牌 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(350);
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
const hire = page.locator('[data-action="hire"]').first();
if (await hire.count()) { await hire.click(); await page.waitForTimeout(300); }

await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);
/** 迷宫：一路翻格直到进战斗（v3.19 的 walk 逻辑简化版） */
const walk = async (max = 150) => {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-action="end-turn"]'))) return true;
    const pick = page.locator('[data-action="choose"], [data-action="cancel-upgrade"], [data-action="maze-guide-ok"]').first();
    if (await pick.count()) { await pick.click().catch(() => {}); await page.waitForTimeout(150); continue; }
    const cell = page.locator('[data-action="cell"]').first();
    if (await cell.count()) { await cell.click().catch(() => {}); await page.waitForTimeout(180); continue; }
    await page.waitForTimeout(150);
  }
  return false;
};
const inBattle = await walk();
console.log('③ 进入战斗:', inBattle ? 'PASS' : 'FAIL');
if (!inBattle) {
  console.log('   现场：', (await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))));
  console.log('   动作：', await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-action]')].map((e) => e.dataset.action))].join(',')));
  await page.screenshot({ path: 'tools/.v325-stuck.png' });
}
if (inBattle) {
  const hand = await page.evaluate(() => [...document.querySelectorAll('.card .cname')]
    .map((b) => b.textContent.trim().replace(/^[⚔❖✦◈\s]+/, '')));
  console.log('③b 手牌:', hand.join(' / '));
  const basics = ['劈砍', '法球', '放箭', '毒牙'];
  const hit = basics.find((n) => hand.includes(n));
  console.log('③c 出现职业基础牌:', hit ? `PASS（${hit}）` : 'FAIL');
  console.log('③d 不出现「打击」:', hand.includes('打击') ? 'FAIL' : 'PASS');
  await page.screenshot({ path: 'tools/.v325-battle.png' });
}

/** ④ 溢出 */
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('④ 无横向溢出:', overflow ? 'FAIL' : 'PASS');
await page.screenshot({ path: 'tools/.v325-codex.png' });

await browser.close();
