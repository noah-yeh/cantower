/**
 * 探针 v3.13：拆店 + 刷新
 *
 * 1. 行商：只有卡牌栏、刷新按钮吃古币、点一次金币掉、货架变
 * 2. 宝库：只有宝物栏、刷新按钮吃水晶材料、第二次 +1
 *
 * 不进战斗，直接把"停在商店"的存档塞进 localStorage —— 这样能稳定测到
 * 两家店而不靠运气刷种子。
 */
import { chromium } from 'playwright-core';
import { createCharacter } from '../src/core/roster.js';
import { createRun } from '../src/core/run.js';
import { serializeRun, defaultMeta } from '../src/core/save.js';
import { makeShop, shopRng } from '../src/core/shop.js';

function saveAt(kind, { gold = 900, materials = 6, seed = 7, floor = 14 } = {}) {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  const run = createRun({ character: ch, seed });
  run.floor = floor;
  run.gold = gold;
  run.materials = materials;
  run.shop = makeShop(run, shopRng(run, kind === 'relic' ? 2 : 0), kind);
  run.lastShopFloor = floor;
  run.lastRelicShopFloor = floor;
  run.phase = 'shop';

  /** boot 会核对 meta.roster 里有没有这个人，没有就把 run 当孤儿清掉 */
  const meta = defaultMeta();
  meta.roster = [ch];
  meta.run = { characterId: ch.id, floor };
  return { run: JSON.stringify(serializeRun(run)), meta: JSON.stringify(meta) };
}

const inject = async (json) => {
  await page.evaluate(({ run, meta }) => {
    localStorage.clear();
    localStorage.setItem('ruin-spire/run', run);
    localStorage.setItem('ruin-spire/hall', meta);
  }, json);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
};

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const purse = () => page.evaluate(() => {
  const t = [...document.querySelectorAll('.purse .chip')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
  return t.join(' | ');
});
const goods = () => page.evaluate(() => [...document.querySelectorAll('.shop-item .rname')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()));

/* ---------------- 行商 ---------------- */
await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await inject(saveAt('card'));

console.log('行商标题:', await page.locator('.overlay h1').first().textContent());
console.log('行商货架:', JSON.stringify(await goods()));
console.log('行商钱袋:', await purse());
console.log('刷新按钮:', (await page.locator('[data-action="refresh-shop"]').textContent()).replace(/\s+/g, ' ').trim());
await page.screenshot({ path: 'tools/.v313-shop.png' });

const cardGoods = (await goods()).join(',');
await page.locator('[data-action="refresh-shop"]').click();
await page.waitForTimeout(400);
console.log('刷完钱袋:', await purse());
console.log('刷完货架:', JSON.stringify(await goods()), '变了:', (await goods()).join(',') !== cardGoods);
console.log('刷完按钮:', (await page.locator('[data-action="refresh-shop"]').textContent()).replace(/\s+/g, ' ').trim());
await page.screenshot({ path: 'tools/.v313-shop-refreshed.png' });

/* ---------------- 宝库 ---------------- */
await inject(saveAt('relic', { materials: 6 }));

console.log('宝库标题:', await page.locator('.overlay h1').first().textContent());
console.log('宝库货架:', JSON.stringify(await goods()));
console.log('宝库钱袋:', await purse());
console.log('宝库刷新:', (await page.locator('[data-action="refresh-shop"]').textContent()).replace(/\s+/g, ' ').trim());
await page.screenshot({ path: 'tools/.v313-relic.png' });

await page.locator('[data-action="refresh-shop"]').click();
await page.waitForTimeout(400);
console.log('刷完钱袋:', await purse());
console.log('刷完按钮:', (await page.locator('[data-action="refresh-shop"]').textContent()).replace(/\s+/g, ' ').trim());
await page.screenshot({ path: 'tools/.v313-relic-refreshed.png' });

/* ---------------- 地图上的宝库格 ---------------- */
console.log('--- 地图格 ---');
{
  const snapshot = saveAt('relic');
  const s = JSON.parse(snapshot.run);
  s.phase = 'map';
  s.shop = null;
  s.floorMap.cells[0].kind = 'relicShop';
  s.floorMap.cells[0].revealed = true;
  s.floorMap.cells[0].done = false;
  await inject({ run: JSON.stringify(s), meta: snapshot.meta });
}
await page.screenshot({ path: 'tools/.v313-map.png' });
console.log('宝库格存在:', !!(await page.locator('.dcell.k-relicShop').count()));

await browser.close();
