/**
 * v3.83 探针：手牌空态 + 引导弹窗居中 + 卡牌造型。
 *
 * 用户：「出完牌卡牌的情况下不用收缩起来，保持牌区展开的状态，可以在牌区
 * 做点什么样式，就不会空着的时候看着怪；另外开始下来探险的弹窗提示好像
 * 没有居中了；现在卡牌太方正了看起来也有点怪异」。
 *
 * 检查：
 *   ① 引导弹窗 .mg-panel 的水平中心 ≈ 视口中心（不再贴左）；
 *   ② 手牌打完（0 张）时 .hand 高度不变、出现 .hand-empty + 4 个虚影牌位；
 *   ③ 卡牌圆角 16px、宽高比 < 0.95（不再像方块）；
 *   ④ 矮屏 375×667 时牌区与结束回合仍在视口内。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(250);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/** 造 run：牌组 10 张打击（1 费，8 能量正好把 5 张手牌打完） */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const m = meta.createMeta(20261112);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'exploring';
  m.roster = [a];
  const run = runMod.createRun({ character: a, seed: 777 });
  dungeon.makeFloorMap(run);
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy');
  run.floorMap.cells[idx].revealed = true;
  run.phase = 'map';
  // 架势：0 费、不抽牌、不打伤害 —— 正好把手牌打空又不惊动敌人
  run.deck = Array(14).fill('brace');
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
  window.__enemyIdx = idx;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);

/* ---- ① 引导弹窗居中 ---- */
const gd = await page.evaluate(() => {
  const p = document.querySelector('.maze-guide .mg-panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    cx: Math.round(r.left + r.width / 2),
    vw: window.innerWidth,
    left: Math.round(r.left),
    right: Math.round(r.right),
    w: Math.round(r.width),
  };
});
console.log('引导弹窗:', JSON.stringify(gd));
ok(!!gd, '进塔弹出玩法引导');
ok(gd && Math.abs(gd.cx - gd.vw / 2) <= 2, `弹窗水平居中（面板中心 ${gd?.cx} / 视口中心 ${gd ? Math.round(gd.vw / 2) : '-'}）`);
ok(gd && gd.left >= 0 && gd.right <= gd.vw, `弹窗不出屏（${gd?.left}..${gd?.right} / ${gd?.vw}）`);
await page.screenshot({ path: 'tools/probe/v383-guide.png' });

await page.locator('[data-action="maze-guide-ok"]').first().click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.dcell')];
  (cells[window.__enemyIdx] || cells.find((c) => c.classList.contains('k-enemy')))?.click();
});
await page.waitForTimeout(700);

/* ---- ③ 卡牌造型 ---- */
const card = await page.evaluate(() => {
  const c = document.querySelector('.hand .card');
  if (!c) return null;
  const cs = getComputedStyle(c);
  const r = c.getBoundingClientRect();
  return { radius: cs.borderTopLeftRadius, w: Math.round(r.width), h: Math.round(r.height), shadow: cs.boxShadow.slice(0, 40) };
});
console.log('卡牌:', JSON.stringify(card));
ok(card && card.radius === '16px', `手牌圆角 16px（${card?.radius}）`);
ok(card && card.w / card.h < 0.95, `不再方正：${card?.w}×${card?.h}（宽高比 ${card ? (card.w / card.h).toFixed(2) : '-'}）`);

const handH0 = await page.evaluate(() => Math.round(document.querySelector('.hand').getBoundingClientRect().height));

/* ---- ② 把手牌打光 ---- */
for (let i = 0; i < 14; i++) {
  const n = await page.evaluate(() => document.querySelectorAll('.hand .card').length);
  if (!n) break;
  const played = await page.evaluate(() => {
    const c = document.querySelector('.hand .card.playable');
    if (!c) return false;
    c.click();
    return true;
  });
  if (!played) break;
  await page.waitForTimeout(260);
}

const empty = await page.evaluate(() => {
  const hand = document.querySelector('.hand');
  const e = document.querySelector('.hand-empty');
  if (!hand) return { cards: -1, handH: 0, hasEmpty: false, ghosts: 0, title: '', sub: '', gone: true };
  return {
    cards: hand.querySelectorAll('.card').length,
    handH: Math.round(hand.getBoundingClientRect().height),
    hasEmpty: !!e,
    ghosts: hand.querySelectorAll('.he-ghosts i').length,
    title: e?.querySelector('.he-title')?.textContent.trim(),
    sub: e?.querySelector('.he-sub')?.textContent.trim(),
  };
});
console.log('空手牌:', JSON.stringify(empty));
ok(empty.cards === 0, `手牌已打完（${empty.cards} 张）`);
ok(empty.hasEmpty, '空态占位出现');
ok(empty.ghosts === 4, `虚影牌位 4 个（${empty.ghosts}）`);
ok(empty.handH === handH0 && empty.handH >= 200, `牌区没收缩：出牌前 ${handH0} → 出牌后 ${empty.handH}`);
ok(/打完了/.test(empty.title || ''), `空态文案：${empty.title} / ${empty.sub}`);
await page.screenshot({ path: 'tools/probe/v383-empty.png' });

/* ---- ④ 矮屏 ---- */
await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(400);
const small = await page.evaluate(() => ({
  handH: Math.round(document.querySelector('.hand').getBoundingClientRect().height),
  empty: !!document.querySelector('.hand-empty'),
  endBottom: Math.round(document.querySelector('[data-action="end-turn"]')?.getBoundingClientRect().bottom ?? 0),
  viewH: window.innerHeight,
}));
console.log('矮屏空手:', JSON.stringify(small));
ok(small.endBottom <= small.viewH + 1, `矮屏结束回合在视口内（${small.endBottom}/${small.viewH}）`);
ok(small.handH >= 200, `矮屏牌区仍展开（${small.handH}px）`);
await page.screenshot({ path: 'tools/probe/v383-small.png' });

await browser.close();
console.log('PROBE DONE');
