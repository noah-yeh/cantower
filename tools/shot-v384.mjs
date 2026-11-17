/**
 * v3.84 探针：合成入口挪到牌库左上角 + 蒙板两级（列表 → 前后对比）+ 宝物头部精简。
 *
 * 用户：「卡牌合成入口可以放到左上角，原来牌库二字可以去掉（页签已有）；
 * 点击后弹出可合成的卡牌列表，点卡弹出蒙板展示当前效果与合成后的效果，
 * 确认合成即升一级；宝物这边上面这行文字也可以去掉」。
 *
 * 检查：
 *   ① 牌库页没有「牌库」标题行；左上角有 ⚒合成 入口并带可合成数量；
 *   ② 点合成 → 蒙板列出可合成卡（真卡面）；
 *   ③ 点卡 → 前后对比（当前 / 合成后 + 确认按钮）；
 *   ④ 确认合成 → 牌库出现 +1 卡，蒙板收起；
 *   ⑤ 宝物页第一行直接是「已激活」，没有「宝物」标题与说明行。
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

/** 造 run：牌组 = 2×打击 + 12×架势（两同名单级卡可合成） */
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
  run.phase = 'map';
  run.deck = ['strike', 'strike', ...Array(12).fill('brace')];
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await page.waitForTimeout(250);

/* ---- 进详情页（探险页底部角色行） ---- */
await page.locator('[data-action="open-hero"]').first().click();
await page.waitForTimeout(400);

/* ---- ① 牌库头 ---- */
const head = await page.evaluate(() => {
  const body = document.querySelector('.hero-page .hp-body');
  const headEl = document.querySelector('.hp-deck-head');
  const secHeads = [...body.querySelectorAll('.hp-sec-head span:first-child')].map((s) => s.textContent.trim());
  const btn = document.querySelector('.hp-forge-btn');
  const r = btn?.getBoundingClientRect();
  return {
    secHeads,
    hasDeckTitle: secHeads.includes('牌库'),
    btn: btn ? { text: btn.textContent.trim().replace(/\s+/g, ''), hasOff: btn.classList.contains('off'),
      left: Math.round(r.left), bodyLeft: Math.round(document.querySelector('.hp-box').getBoundingClientRect().left) } : null,
    deckCount: document.querySelector('.hp-deck-head .hp-sec-sub')?.textContent.trim() || '',
  };
});
console.log('牌库头:', JSON.stringify(head));
ok(!head.hasDeckTitle, `「牌库」标题行已去掉（区块标题：${head.secHeads.join('、') || '无'}）`);
ok(head.btn && !head.btn.hasOff, `合成入口亮起：${head.btn?.text}`);
ok(head.btn && head.btn.left - head.btn.bodyLeft <= 20 && head.btn.left - head.btn.bodyLeft >= 10, `入口在左上角（按钮距面板左 ${head.btn ? head.btn.left - head.btn.bodyLeft : '-'}px）`);
ok(/14 张/.test(head.deckCount), `合成前统计 14 张（${head.deckCount}）`);
await page.screenshot({ path: 'tools/probe/v384-deck.png' });

/* ---- ② 点合成 → 列表蒙板 ---- */
await page.locator('.hp-forge-btn').click();
await page.waitForTimeout(350);
const list = await page.evaluate(() => {
  const mask = document.querySelector('.hp-forge-mask');
  const items = [...mask.querySelectorAll('.hp-forge-item')];
  return {
    open: !!mask,
    n: items.length,
    names: items.map((it) => it.querySelector('.cname')?.textContent.trim()),
    sub: mask.querySelector('.hp-sec-sub')?.textContent.trim(),
  };
});
console.log('合成列表:', JSON.stringify(list));
ok(list.open, '点合成弹出蒙板');
ok(list.n === 2 && list.names[0].includes('打击'), `列表 2 张可合成卡：${list.names.join('、')}（打击×2 + 架势×12）`);
await page.screenshot({ path: 'tools/probe/v384-forge-list.png' });

/* ---- ③ 点卡 → 前后对比 ---- */
await page.locator('.hp-forge-item').first().click();
await page.waitForTimeout(350);
const detail = await page.evaluate(() => {
  const mask = document.querySelector('.hp-forge-mask');
  const cols = [...mask.querySelectorAll('.hp-forge-col .cname')].map((s) => s.textContent.trim().replace(/\s+/g, ''));
  return {
    caps: [...mask.querySelectorAll('.hp-forge-cap')].map((s) => s.textContent.trim()),
    names: cols,
    back: !!mask.querySelector('.hp-forge-back'),
    confirm: mask.querySelector('.hp-forge-go')?.textContent.trim() || '',
  };
});
console.log('前后对比:', JSON.stringify(detail));
ok(detail.names.length === 2 && detail.names[0].includes('打击') && /\+1/.test(detail.names[1] || ''),
  `对比卡：${detail.names.join(' → ')}`);
ok(detail.caps[0] === '当前' && detail.caps[1] === '合成后', `标注：${detail.caps.join(' / ')}`);
ok(detail.back, '有返回列表入口');
ok(/确认合成/.test(detail.confirm), `确认按钮：${detail.confirm}`);
await page.screenshot({ path: 'tools/probe/v384-forge-detail.png' });

/* ---- ④ 确认合成 ---- */
await page.locator('.hp-forge-go').first().click();
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  maskGone: !document.querySelector('.hp-forge-mask'),
  plus1: [...document.querySelectorAll('.hp-deck-cards .cname')].some((s) => /\+1/.test(s.textContent)),
  cardN: document.querySelectorAll('.hp-deck-cards .hp-card').length,
}));
console.log('合成后:', JSON.stringify(after));
ok(after.maskGone, '确认后蒙板收起');
ok(after.plus1, '牌库出现 +1 强化卡');
ok(after.cardN === 2, `牌面仍 2 种（打击+1 / 架势），共 ${after.cardN} 种`);
await page.screenshot({ path: 'tools/probe/v384-forged.png' });

/* ---- ⑤ 宝物页头部 ---- */
await page.locator('[data-action="hero-tab"][data-tab="relic"]').click();
await page.waitForTimeout(350);
const relic = await page.evaluate(() => {
  const body = document.querySelector('.hero-page .hp-body');
  const heads = [...body.querySelectorAll('.hp-sec-head span:first-child')].map((s) => s.textContent.trim());
  return { heads, hasRelicTitle: heads.includes('宝物'), firstHint: body.querySelector('.hp-hint')?.textContent.trim() || '' };
});
console.log('宝物页:', JSON.stringify(relic));
ok(!relic.hasRelicTitle, `「宝物」标题行已去掉（第一区块：${relic.heads[0]}）`);
ok(relic.heads[0] === '已激活', `第一行直接是已激活（${relic.heads.join('、')}）`);
await page.screenshot({ path: 'tools/probe/v384-relic.png' });

await browser.close();
console.log('PROBE DONE');
