/**
 * 探针 v3.40：宝库定价统一（等级 = 水晶数）
 *
 * 要证的五件事：
 *   1. 带等级件货架价 = 等级数（四叶坠 Lv5 → 5 晶、血玉心坠 Lv4 → 4 晶、铁鳞护腕 Lv2 → 2 晶）
 *   2. 无等级机制件仍按链条基础价（铁砧 A 链 → 3 晶），不随层数涨
 *   3. 卡片上显示的价格文案与 core 的 relicShopPrice 一致
 *   4. 逐件买入扣的水晶 = 卡片标价（总 14，20 → 6）
 *   5. 控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const WANT = [
  { id: 'cloverCharm', lv: 5, price: 5 },
  { id: 'vitalHeart', lv: 4, price: 4 },
  { id: 'ironBracer', lv: 2, price: 2 },
  { id: 'anvil', lv: 1, price: 3 },
];

/* ---------------- 注入：一局 + 宝库格（价格一律走 core 计算） ---------------- */

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.evaluate(async (want) => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const shopMod = await import('/src/core/shop.js');
  const m = meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  run.materials = 20;
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: 'relicShop', revealed: true, done: false,
    data: { shop: { kind: 'relic', cards: [], refreshes: 0, relics:
      want.map((w) => ({ id: w.id, lv: w.lv, price: shopMod.relicShopPrice(w.id, w.lv), sold: false })),
    } },
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
}, WANT);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

/* ---------------- 进宝库 ---------------- */

const shopIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return run.floorMap.cells.findIndex((c) => c.kind === 'relicShop');
});
for (let i = 0; i < 2; i++) {
  await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), shopIdx);
  await page.waitForTimeout(400);
}

const shopUi = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.shop-item')].map((el) => ({
    name: el.querySelector('.rname')?.textContent.replace(/\s+/g, ' ').trim(),
    price: el.querySelector('.s-price')?.textContent.replace(/\s+/g, '').trim(),
  })),
  crystal: document.querySelector('.chip.crystal b')?.textContent?.trim(),
}));
console.log('宝库货架:', JSON.stringify(shopUi));

check(shopUi.items.length === WANT.length, `货架应有 ${WANT.length} 件，实际 ${shopUi.items.length}`);
WANT.forEach((w, i) => {
  const got = shopUi.items[i]?.price ?? '';
  check(got.startsWith(String(w.price)), `${w.id} Lv${w.lv} 标价应为 ${w.price}，实际 ${got}`);
});

/* ---------------- 逐件买入，核扣费 ---------------- */

let budget = 20;
for (let i = 0; i < WANT.length; i++) {
  await page.evaluate((idx) => {
    const items = [...document.querySelectorAll('[data-action="buy-relic"]')];
    items[idx]?.click();
  }, i);
  await page.waitForTimeout(320);
  const after = await page.evaluate(async () => {
    const save = await import('/src/core/save.js');
    const run = save.loadRun();
    return { materials: run.materials, relics: run.relics };
  });
  budget -= WANT[i].price;
  check(after.materials === budget, `买第 ${i + 1} 件（${WANT[i].id}）后水晶应剩 ${budget}，实际 ${after.materials}`);
  console.log(`买 ${WANT[i].id} Lv${WANT[i].lv}（${WANT[i].price} 晶）→ 余 ${after.materials}`);
}

const owned = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  return save.loadRun().relics;
});
console.log('已购宝物:', JSON.stringify(owned));
check(owned.includes('cloverCharm+5'), `应写入 cloverCharm+5，实际 ${JSON.stringify(owned)}`);
check(owned.includes('vitalHeart+4'), `应写入 vitalHeart+4，实际 ${JSON.stringify(owned)}`);
check(owned.includes('ironBracer+2'), `应写入 ironBracer+2，实际 ${JSON.stringify(owned)}`);

/* ---------------- 收尾 ---------------- */

if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  if (errs.length) console.log('页面错误:', errs.join(' | '));
  await browser.close();
  process.exit(1);
}
console.log('页面错误:', errs.length ? errs.join(' | ') : '无');
if (errs.length) process.exit(1);
await browser.close();
console.log('PROBE PASS');
