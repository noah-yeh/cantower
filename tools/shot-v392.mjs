/**
 * v3.92 探针 —— 图鉴「天赋」页签改名「宝物」，只讲宝物
 *
 * 用户：「天赋页面应该改成叫宝物，把种族天赋和职业天赋去掉，这两个分别在种族页、
 * 职业里面展示了，所以宝物这里只展示宝物就行」。
 *
 * 检查：
 *   A. 页签是 卡牌 / 种族 / 宝物 / 装备（没有「天赋」）
 *   B. 宝物页：没有「职业天赋」「种族天赋」小节；条目数 = RELICS 数量；
 *      分组标题全是转化链名（A/B/C/X）；带等级件展开 1~5 级数值
 *   C. 职业天赋没丢：卡牌页战士页头仍有「职业天赋」行；（种族天赋在种族页签）
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('OK  ' + msg); } else { fail++; console.log('ERR ' + msg); }
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

/* ================================================================ A. 页签 */
await page.locator('[data-action="open-codex"]').click();
await sleep(400);

const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-action="codex-tab"]')]
  .map((b) => b.textContent.trim()));
ok(tabs.join('/') === '卡牌/种族/宝物/装备', `四个页签且「天赋」已改名「宝物」（${tabs.join('/')}）`);
ok(!tabs.includes('天赋'), '没有残留的「天赋」页签');

/* ================================================================ B. 宝物页 */
await page.locator('[data-action="codex-tab"][data-tab="relics"]').click();
await sleep(350);

const relics = await page.evaluate(async () => {
  const { RELICS } = await import('/src/core/relics.js');
  const body = document.querySelector('.cx-scroll');
  const heads = [...body.querySelectorAll('.sec-head span:first-child')].map((s) => s.textContent.trim());
  const rows = [...body.querySelectorAll('.cx-row')];
  const names = rows.map((r) => r.querySelector('.cx-rowtop b')?.textContent.trim());
  const lvRows = rows.filter((r) => /Lv\.1/.test(r.textContent));
  return {
    heads,
    rows: rows.length,
    names,
    lvRows: lvRows.length,
    relicTotal: Object.keys(RELICS).length,
    relicNames: Object.values(RELICS).map((r) => r.name),
    topCount: document.querySelector('.top-count')?.textContent.trim(),
    text: body.innerText,
  };
});

ok(relics.rows === relics.relicTotal, `宝物条目 ${relics.rows} = 数据表 ${relics.relicTotal} 件`);
ok(relics.topCount === `${relics.relicTotal} 件`, `右上角计数是「${relics.relicTotal} 件」（实际 ${relics.topCount}）`);
ok(!relics.heads.includes('职业天赋'), `没有「职业天赋」小节（${relics.heads.join('/')}）`);
ok(!relics.heads.includes('种族天赋'), '没有「种族天赋」小节');
ok(!/职业天赋|种族天赋|每级成长|起始宝物/.test(relics.text), '页面里不含职业天赋 / 种族天赋的字样');
ok(relics.heads.length >= 3, `宝物按转化链分组（${relics.heads.join('/')}）`);
ok(relics.names.every((n) => relics.relicNames.includes(n)), '每一条都是宝物名（没有混进职业行）');
ok(relics.lvRows > 0, `带等级的宝物展开 1~5 级数值（${relics.lvRows} 件）`);
await page.screenshot({ path: 'tools/probe/v392-codex-relics.png' });

/* ================================================================ C. 职业天赋还在卡牌页 */
await page.locator('[data-action="codex-tab"][data-tab="cards"]').click();
await sleep(300);
await page.locator('[data-action="codex-class"][data-cls="warrior"]').click();
await sleep(300);
const cls = await page.evaluate(() => ({
  lines: [...document.querySelectorAll('.cx-talent-line')].map((e) => e.innerText.replace(/\s+/g, ' ')),
}));
ok(cls.lines.some((l) => l.includes('职业天赋')), `战士页头仍有「职业天赋」（${cls.lines[0] ?? '—'}）`);
ok(cls.lines.some((l) => l.includes('起始宝物')), '战士页头仍有「起始宝物」');

/* ================================================================ D. 种族页签不受影响 */
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(300);
/* v3.95 起种族页签换成养成卡（.race-card），不再是 .cx-race 行 */
const race = await page.evaluate(() => ({
  cards: document.querySelectorAll('.race-card').length,
  faces: document.querySelectorAll('.race-card .rc-face').length,
}));
ok(race.cards === 4 && race.faces === 4, `种族页仍是 4 张切图（${race.cards} 卡 / ${race.faces} 图）`);

console.log(`\n通过 ${pass} · 失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
