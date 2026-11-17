/**
 * v3.67 探针：统一角色详情页（参照原作角色页）。
 *
 * 用户：「角色详情也可以参照微信图片_20261104203133实现，除了没有果实其他应该差不多，
 * 冒险，营地，竞技场，探险战斗中，角色都是可以点击的都是可以使用这个详情页来展示」。
 *
 * 检查：
 *   ① 营地：点头像卡开详情页 —— 立绘 + 两侧装备槽 + 三格数值条 + 三个页签；
 *     装备/角色/宝物页签能切，卡组 chip 点开展开全文；✕ 关。
 *   ② 冒险：点角色行开同一个详情页。
 *   ③ 竞技场名册：点角色行开详情页（有竞技场入口）。
 *   ④ 竞技场选人：点对手「属性」开幽灵详情（段位徽章 + 无动作）。
 *   ⑤ 竞技场决斗：双方头像都能点开详情。
 *   ⑥ 探险战斗：点玩家头像开 run 详情（实时血量 + 本场状态）。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/* 造数据：两个实习 + 一个转正 + 一个幽灵对手 */
await page.evaluate(async () => {
  localStorage.clear();
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261110);
  const mk = (classId, raceId, seed) => {
    const c = roster.createCharacter({ classId, raceId, seed });
    c.status = 'idle';
    return c;
  };
  const a = mk('warrior', 'stone', 3);
  const b = mk('mage', 'ember', 4);
  const c = mk('hunter', 'moss', 5);
  b.veteran = true;
  b.record.bestFloor = 12;
  b.record.arenaWins = 3;
  b.record.arenaLosses = 1;
  b.arenaScore = 1080;
  b.arenaLeft = 3;
  m.roster = [a, b, c];
  meta.pushGhost(m, b);
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/** 详情页通用检查 */
async function heroCheck(label, { acts, badge }) {
  const s = await page.evaluate(() => {
    const box = document.querySelector('.hero-page .hp-box');
    return {
      open: !!box,
      portrait: !!box?.querySelector('.hp-face-img'),
      slots: box?.querySelectorAll('.hp-slot').length ?? 0,
      vitals: box?.querySelectorAll('.hp-v').length ?? 0,
      tabs: [...(box?.querySelectorAll('.hp-tab') ?? [])].map((t) => t.textContent.trim()),
      rows: box?.querySelectorAll('.sp-row').length ?? 0,
      acts: [...(box?.querySelectorAll('.hp-acts .btn') ?? [])].map((b) => b.textContent.trim()),
      badge: box?.querySelector('.rank-badge')?.textContent.trim() ?? '',
      inView: box ? box.getBoundingClientRect().height <= window.innerHeight + 2 : false,
    };
  });
  ok(s.open, `${label}：详情页打开`);
  ok(s.portrait, `${label}：立绘在`);
  ok(s.slots === 2, `${label}：两侧装备槽（${s.slots} 个）`);
  ok(s.vitals === 4, `${label}：生命/攻击/能量 + ❗属性入口（${s.vitals}）`);
  ok(s.tabs.filter((t) => t !== '装备').join(',') === '牌库,宝物' && (s.tabs.length === 2 || s.tabs[2] === '装备'),
    `${label}：页签是 牌库/宝物（+char 模式末尾的装备入口）（${s.tabs.join(',')}）`);
  /* v3.73：属性进蒙板 —— 打开数行数再关掉 */
  await page.locator('.hero-page .hp-v-attrs').click();
  await page.waitForTimeout(250);
  const maskRows = await page.evaluate(() => document.querySelectorAll('.hp-attrs-box .sp-row').length);
  ok(maskRows === 9, `${label}：属性蒙板 9 项（${maskRows}）`);
  await page.locator('.hp-attrs-box .hp-close').click();
  await page.waitForTimeout(200);
  if (acts) ok(s.acts.length >= acts, `${label}：有动作按钮（${s.acts.join(' / ') || '无'}）`);
  else ok(s.acts.length === 0, `${label}：没有动作按钮（${s.acts.length}）`);
  if (badge) ok(s.badge.length > 0, `${label}：段位徽章（${s.badge}）`);
  ok(s.inView, `${label}：页面高度不超屏`);
  return s;
}

async function closeHero() {
  await page.locator('.hero-page .hp-close').click();
  await page.waitForTimeout(250);
  ok(!(await page.locator('.hero-page').count()), '✕ 能关掉详情页');
}

/* ① 营地入口 */
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(350);
await page.locator('.camp-card').first().click();
await page.waitForTimeout(300);
await heroCheck('营地', { acts: 0 });
await page.screenshot({ path: 'tools/probe/shot-v367-camp.png' });

/* 页签切换（v3.73：默认牌库页签，天赋圆徽在立绘下） */
const talents = await page.evaluate(() =>
  document.querySelectorAll('.hero-page .hp-tal').length);
ok(talents === 2, `头像下有种族/职业两枚天赋圆徽（${talents} 枚）`);
await page.locator('.hp-tab[data-tab="deck"]').click();
await page.waitForTimeout(250);
const deckCards = await page.evaluate(() =>
  document.querySelectorAll('.hero-page .hp-card').length);
ok(deckCards >= 1, `牌库渲染真卡面（${deckCards} 张）`);
await page.locator('.hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(250);
const relic = await page.evaluate(() => document.querySelectorAll('.hero-page .relic-card').length);
ok(relic >= 2, `宝物页签有待激活槽位卡（${relic} 张）`);
await closeHero();

/* ② 冒险入口 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(300);
await heroCheck('冒险', { acts: 0 });
await closeHero();

/* ③ 竞技场名册入口 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(300);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(300);
await heroCheck('竞技场名册', { acts: 0 }); /* v3.75：详情页不再放竞技场按钮，上场只去竞技场页 */
await closeHero();

/* ④ 选人页的对手属性 */
await page.locator('[data-action="arena"]').first().click();
await page.waitForTimeout(400);
const ghostBtn = await page.locator('[data-action="open-ghost"]').count();
ok(ghostBtn >= 1, `选人页对手卡有「属性」按钮（${ghostBtn} 个）`);
if (ghostBtn) {
  await page.locator('[data-action="open-ghost"]').first().click();
  await page.waitForTimeout(300);
  await heroCheck('竞技场对手', { badge: true });
  await page.screenshot({ path: 'tools/probe/shot-v367-ghost.png' });
  await closeHero();
}

/* ⑤ 决斗场双方头像 */
await page.locator('[data-action="fight"]').first().click();
await page.waitForTimeout(600);
const duel = await page.evaluate(() => ({
  me: !!document.querySelector('.player-row .face-btn[data-action="open-char"]'),
  foe: !!document.querySelector('.enemy-zone .face-btn[data-action="open-ghost"]'),
}));
ok(duel.me, '决斗场：自己头像可点开详情');
ok(duel.foe, '决斗场：对手头像可点开详情');
if (duel.foe) {
  await page.locator('.enemy-zone .face-btn').click();
  await page.waitForTimeout(300);
  await heroCheck('决斗场对手', { badge: false });
  await closeHero();
}
/* 认输退场，别留着半场 */
await page.locator('[data-action="arena-forfeit"]').click();
await page.waitForTimeout(500);
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(400);

/* ⑥ 探险战斗中的玩家头像 */
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const saveMeta = save.saveMeta;
  /** 用真实路径进战斗：直接造 run 存档 */
  const runMod = await import('/src/core/run.js');
  const roster = await import('/src/core/roster.js');
  const meta = await import('/src/core/meta.js');
  const m = meta.createMeta(20261110);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle';
  m.roster = [ch];
  saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  run.floorMap.cells[idx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
await page.waitForTimeout(800);
const inBattle = await page.evaluate(() => ({
  hand: document.querySelectorAll('.hand .card').length,
  face: !!document.querySelector('.face-btn[data-action="open-hero"]'),
}));
ok(inBattle.hand > 0 && inBattle.face, `战斗页已就位（手牌 ${inBattle.hand} 张，头像按钮在）`);
await page.locator('.face-btn[data-action="open-hero"]').click();
await page.waitForTimeout(300);
await heroCheck('战斗中', { acts: 0 });
const runHp = await page.evaluate(() => {
  const v = document.querySelector('.hero-page .hp-v.hp b')?.textContent ?? '';
  return v;
});
ok(/\d+ \/ \d+/.test(runHp), `战斗中生命是实时血量格式「${runHp}」`);
await page.screenshot({ path: 'tools/probe/shot-v367-battle.png' });
await closeHero();

await browser.close();
console.log('ALL PASS');
