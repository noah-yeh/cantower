/**
 * v3.82 探针：古币改名 + 手牌两排 × 4（上限 8、每回合抽 5）。
 *
 * 检查：
 *   ① 古币：地图页左上资源行 title/文案里是「古币」而不是「碎金」；
 *   ② 战斗页手牌区是 4 列网格，初始 5 张排成 4+1，不横向滚动；
 *   ③ 靠 0 费抽牌卡把手牌顶到 8 张时，正好 4+4 两排、仍然不滚动、不溢出托盘；
 *   ④ 矮屏 375×667 下手牌区不把血条/结束回合挤出视口；
 *   ⑤ core 侧：DRAW_PER_TURN=5 / HAND_LIMIT=8，箭袋 + 谋略之卷各 +1 抽。
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

/** core：常量与抽牌宝物 */
const core = await page.evaluate(async () => {
  const C = await import('/src/core/combat.js');
  const R = await import('/src/core/relics.js');
  return {
    draw: C.DRAW_PER_TURN,
    limit: C.HAND_LIMIT,
    quiver: R.RELICS.quiver?.drawBonus,
    codex: R.RELICS.codex?.drawBonus,
    codexName: R.RELICS.codex?.name,
  };
});
ok(core.draw === 5, `每回合抽 ${core.draw} 张（应为 5）`);
ok(core.limit === 8, `手牌上限 ${core.limit}（应为 8）`);
ok(core.quiver === 1 && core.codex === 1, `抽牌宝物：箭袋 +${core.quiver} / ${core.codexName} +${core.codex}`);

/** 造一趟牌组全是 0 费抽 2 的 run，进到战斗 */
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
  run.deck = Array(20).fill('focus');
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
  window.__enemyIdx = idx;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.dcell')];
  const idx = window.__enemyIdx;
  (cells[idx] || cells.find((c) => c.classList.contains('k-enemy')))?.click();
});
await page.waitForTimeout(700);

const geo = () => page.evaluate(() => {
  const hand = document.querySelector('.hand');
  if (!hand) return null;
  const cs = getComputedStyle(hand);
  const cards = [...hand.querySelectorAll('.card')];
  const rows = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size;
  const tray = document.querySelector('.tray')?.getBoundingClientRect();
  const endBtn = document.querySelector('[data-action="end-turn"]')?.getBoundingClientRect();
  return {
    cols: cs.gridTemplateColumns.split(' ').length,
    n: cards.length,
    rows,
    scrollX: hand.scrollWidth - hand.clientWidth,
    handH: Math.round(hand.getBoundingClientRect().height),
    cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
    cardRight: cards.length ? Math.max(...cards.map((c) => Math.round(c.getBoundingClientRect().right))) : 0,
    handRight: Math.round(hand.getBoundingClientRect().right),
    trayBottom: Math.round(tray?.bottom ?? 0),
    viewH: window.innerHeight,
    endBottom: Math.round(endBtn?.bottom ?? 0),
  };
});

const g5 = await geo();
console.log('初始手牌:', JSON.stringify(g5));
ok(!!g5, '战斗页有手牌区');
ok(g5.cols === 4, `手牌是 4 列网格（${g5.cols} 列）`);
ok(g5.n === 5, `初始手牌 ${g5.n} 张（抽 5）`);
ok(g5.rows === 2, `5 张排成 2 排（4+1），实际 ${g5.rows} 排`);
ok(g5.scrollX <= 1, `不横向滚动（溢出 ${g5.scrollX}px）`);
ok(g5.trayBottom <= g5.viewH + 1, `托盘底 ${g5.trayBottom} 在视口 ${g5.viewH} 内`);
ok(g5.endBottom <= g5.viewH + 1, `结束回合按钮在视口内（${g5.endBottom}）`);
await page.screenshot({ path: 'tools/probe/v382-hand5.png' });

/** 打 0 费抽牌卡把手牌顶到上限 8 */
for (let i = 0; i < 8; i++) {
  const played = await page.evaluate(() => {
    const c = document.querySelector('.hand .card.playable');
    if (!c) return false;
    c.click();
    return true;
  });
  if (!played) break;
  await page.waitForTimeout(220);
  const n = await page.evaluate(() => document.querySelectorAll('.hand .card').length);
  if (n >= 8) break;
}
const g8 = await geo();
console.log('顶满手牌:', JSON.stringify(g8));
ok(g8.n === 8, `抽牌卡把手上顶到 ${g8.n} 张（上限 8）`);
ok(g8.rows === 2, `8 张排成 2 排（4+4），实际 ${g8.rows} 排`);
ok(g8.scrollX <= 1, `满手也不横向滚动（溢出 ${g8.scrollX}px）`);
ok(g8.handRight - g8.cardRight <= 6, `最右卡右缘 ${g8.cardRight} 贴住手牌区 ${g8.handRight}`);
ok(g8.endBottom <= g8.viewH + 1, `满手时结束回合仍在视口内（${g8.endBottom}/${g8.viewH}）`);
await page.screenshot({ path: 'tools/probe/v382-hand8.png' });

/** 古币：地图页资源行 */
const coinTxt = await page.evaluate(() => {
  const el = document.querySelector('.run-gold, .dm-gold');
  return el ? { text: el.textContent.trim(), title: el.getAttribute('title') || '' } : null;
});
console.log('古币行:', JSON.stringify(coinTxt));
ok(!!coinTxt && /古币/.test(coinTxt.title), `货币 title 用「古币」（${coinTxt?.title}）`);
ok(!!coinTxt && !/碎金/.test(coinTxt.title), '不再出现「碎金」');

/** 矮屏 */
await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(350);
const gs = await geo();
console.log('矮屏满手:', JSON.stringify(gs));
ok(gs.endBottom <= gs.viewH + 1, `矮屏 375×667 结束回合仍在视口内（${gs.endBottom}/${gs.viewH}）`);
ok(gs.trayBottom <= gs.viewH + 1, `矮屏托盘不出屏（${gs.trayBottom}/${gs.viewH}）`);
await page.screenshot({ path: 'tools/probe/v382-small.png' });

await browser.close();
console.log('PROBE DONE');
