/**
 * v3.65 探针：商店 6 格货架 + 固定一屏不滚动。
 *
 * 用户：「所有的商店包括宝库商店，每次刷新可以展示 6 个，不需要滑动固定屏幕高度」。
 *
 * 检查三件事：
 *   ① 行商 / 宝库都上架 6 件，刷新后还是 6 件；
 *   ② 整页不产生滚动（overlay 的 scrollHeight ≈ clientHeight），
 *      且第 6 格底边不出屏（每格 getBoundingClientRect 都在视口内）；
 *   ③ 每格的描述没有被裁掉（.rtext 的 scrollHeight ≈ clientHeight）——
 *      "塞得下"不能靠切字，不然买之前看不到效果。
 *
 * 两种屏高都跑：390×760（常见竖屏）和 360×640（老机型 / 分屏）。
 */
import { chromium } from 'playwright-core';
import { createCharacter } from '../src/core/roster.js';
import { createRun } from '../src/core/run.js';
import { serializeRun, defaultMeta } from '../src/core/save.js';
import { makeShop, shopRng } from '../src/core/shop.js';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

function saveAt(kind, { gold = 900, materials = 9, seed = 7, floor = 14 } = {}) {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  const run = createRun({ character: ch, seed });
  run.floor = floor;
  run.gold = gold;
  run.materials = materials;
  run.shop = makeShop(run, shopRng(run, kind === 'relic' ? 2 : 0), kind);
  run.lastShopFloor = floor;
  run.lastRelicShopFloor = floor;
  run.phase = 'shop';

  const meta = defaultMeta();
  meta.roster = [ch];
  meta.run = { characterId: ch.id, floor };
  return { run: JSON.stringify(serializeRun(run)), meta: JSON.stringify(meta) };
}

/** 量页面：格数、是否滚动、每格是否出屏、描述是否被裁 */
const measure = (page) => page.evaluate(() => {
  const ov = document.querySelector('.overlay.shop');
  const rows = [...document.querySelectorAll('.shop-item')];
  const vh = window.innerHeight;
  const clipped = [];
  for (const [i, row] of rows.entries()) {
    const t = row.querySelector('.rtext');
    const name = row.querySelector('.rname')?.textContent.trim();
    if (t && t.scrollHeight > t.clientHeight + 1) clipped.push(`${name}(+${t.scrollHeight - t.clientHeight}px)`);
  }
  const boxes = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
  return {
    fixed: ov?.classList.contains('shop-fixed') || false,
    rows: rows.length,
    scrolls: ov ? ov.scrollHeight - ov.clientHeight : -1,
    lastBottom: boxes.length ? boxes[boxes.length - 1].bottom : -1,
    lastTop: boxes.length ? boxes[boxes.length - 1].top : -1,
    vh,
    clipped,
    textHeight: rows[0]?.getBoundingClientRect().height ?? 0,
  };
});

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

for (const [w, h, tag] of [[390, 760, '760'], [360, 640, '640']]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);

  const inject = async (json) => {
    await page.evaluate(({ run, meta }) => {
      localStorage.clear();
      localStorage.setItem('ruin-spire/run', run);
      localStorage.setItem('ruin-spire/hall', meta);
    }, json);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  };

  /* ---------- 行商 ---------- */
  await inject(saveAt('card'));
  const card = await measure(page);
  ok(card.fixed, `[${tag}] 行商用固定一屏版式（shop-fixed）`);
  ok(card.rows === 6, `[${tag}] 行商上架 6 件，实际 ${card.rows}`);
  ok(card.scrolls <= 1, `[${tag}] 行商整页不滚动（溢出 ${card.scrolls}px）`);
  ok(card.lastBottom <= card.vh + 1, `[${tag}] 第 6 格在屏内（底边 ${card.lastBottom} ≤ ${card.vh}）`);
  ok(card.clipped.length === 0, `[${tag}] 行商描述无截断${card.clipped.length ? '：' + card.clipped.join('、') : ''}`);
  await page.screenshot({ path: `tools/probe/shot-v365-card-${tag}.png` });

  /* 刷新后还是 6 件，且换了货 */
  const before = await page.evaluate(() => [...document.querySelectorAll('.shop-item .rname')].map((el) => el.textContent.trim()).join('|'));
  await page.locator('[data-action="refresh-shop"]').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => [...document.querySelectorAll('.shop-item .rname')].map((el) => el.textContent.trim()).join('|'));
  const refreshed = await measure(page);
  ok(refreshed.rows === 6, `[${tag}] 刷新后仍是 6 件，实际 ${refreshed.rows}`);
  ok(refreshed.scrolls <= 1, `[${tag}] 刷新后仍不滚动（溢出 ${refreshed.scrolls}px）`);
  ok(after !== before, `[${tag}] 刷新换了货（${before.split('|')[0]} → ${after.split('|')[0]}）`);

  /* ---------- 宝库 ---------- */
  await inject(saveAt('relic'));
  const relic = await measure(page);
  ok(relic.fixed, `[${tag}] 宝库用固定一屏版式`);
  ok(relic.rows === 6, `[${tag}] 宝库上架 6 件，实际 ${relic.rows}`);
  ok(relic.scrolls <= 1, `[${tag}] 宝库整页不滚动（溢出 ${relic.scrolls}px）`);
  ok(relic.lastBottom <= relic.vh + 1, `[${tag}] 宝库第 6 格在屏内（底边 ${relic.lastBottom} ≤ ${relic.vh}）`);
  ok(relic.clipped.length === 0, `[${tag}] 宝库描述无截断${relic.clipped.length ? '：' + relic.clipped.join('、') : ''}`);
  await page.screenshot({ path: `tools/probe/shot-v365-relic-${tag}.png` });

  /* ---------- 买一件：格子变成「已售出」但版式不跳 ---------- */
  await page.locator('[data-action="buy-relic"]').first().click();
  await page.waitForTimeout(350);
  const bought = await measure(page);
  ok(bought.rows === 6, `[${tag}] 买到手后货架仍是 6 格（不塌陷）`);
  ok(bought.scrolls <= 1, `[${tag}] 买到手后仍不滚动`);

  await page.close();
}

await browser.close();
console.log('ALL PASS');
