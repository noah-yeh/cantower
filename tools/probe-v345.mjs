/**
 * 探针 v3.45：效果说明浮层（参照用户参考截图）
 *
 * 一层蒙板 + 居中小卡片，点任意处关闭；三个入口都要能开：
 *   1. 敌人词条 chip（v3.44 起点了没反应的 bug —— showTraitDetail 还在找旧 .traits 容器）
 *   2. 玩家种族/职业天赋小图标
 *   3. 宝物条 chip
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

async function seed(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(async () => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const runMod = await import('/src/core/run.js');
    const enemies = await import('/src/core/enemies.js');
    const rngMod = await import('/src/core/rng.js');
    const m = meta.createMeta(20261109);
    const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
    ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
    m.roster = [ch];
    save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = ['boneCharm', 'quiver', 'ironBracer+3'];
    const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
    run.floorMap.cells[idx] = {
      kind: 'enemy', revealed: true, done: false,
      data: { tier: 'normal', enemy: enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal') },
    };
    save.saveRun(run);
    m.run = { characterId: ch.id, floor: run.floor, paused: true };
    save.saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
  await page.waitForTimeout(250);
  for (let step = 0; step < 40; step++) {
    if (await page.locator('.hand .card').count()) return true;
    const t = await page.evaluate(() => {
      if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
      if (document.querySelector('.dcell.pending')) return 'pending';
      if (document.querySelector('.dcell.reach')) return 'reach';
      return null;
    });
    if (!t) break;
    await page.evaluate((k) => {
      const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
        : k === 'pending' ? document.querySelector('.dcell.pending')
          : document.querySelector('.dcell.reach');
      el?.click();
    }, t);
    await page.waitForTimeout(300);
  }
  return (await page.locator('.hand .card').count()) > 0;
}

const page = await (await browser.newContext({ viewport: { width: 390, height: 640 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const ok = await seed(page);
check(ok, '没进战斗');
check(!errs.length, `页面报错: ${errs.join(' | ')}`);

const tipInfo = () => page.evaluate(() => {
  const ov = document.querySelector('.tip-overlay');
  if (!ov) return null;
  const name = ov.querySelector('.tip-name')?.textContent.trim();
  const text = ov.querySelector('.tip-text')?.textContent.trim();
  return { name, text: (text || '').slice(0, 40), len: (text || '').length };
});

/** 1. 敌人词条 → 浮层 */
await page.evaluate(() => {
  const chip = document.querySelector('.enemy-zone .tags-line .trait');
  chip?.click();
});
await page.waitForTimeout(200);
let tip = await tipInfo();
console.log('敌人词条:', JSON.stringify(tip));
check(!!tip, '点敌人词条没出浮层（v3.44 的 bug 仍在）');
check(tip && tip.len > 4, `敌人词条浮层没内容: ${tip?.text}`);

/** 1b. 几何：蒙板必须盖满视口、卡片居中（.tower-bg 兄弟规则会把无 .overlay 类的层改成 relative） */
const geo = await page.evaluate(() => {
  const ov = document.querySelector('.tip-overlay');
  const r = ov.getBoundingClientRect();
  const c = ov.querySelector('.tip-card').getBoundingClientRect();
  return {
    pos: getComputedStyle(ov).position,
    full: r.top <= 0 && r.bottom >= innerHeight - 1 && r.left <= 0 && r.right >= innerWidth - 1,
    cardCx: Math.round(c.left + c.width / 2), vw2: Math.round(innerWidth / 2),
    cardCy: Math.round(c.top + c.height / 2), vh2: Math.round(innerHeight / 2),
  };
});
check(geo.pos === 'fixed', `浮层 position=${geo.pos}（应为 fixed，被 .tower-bg 兄弟规则改掉就是没带 .overlay 类）`);
check(geo.full, `蒙板没盖满视口: ${JSON.stringify(geo)}`);
check(Math.abs(geo.cardCx - geo.vw2) <= 4 && Math.abs(geo.cardCy - geo.vh2) <= 40,
  `卡片没居中: (${geo.cardCx},${geo.cardCy}) vs 视口中点 (${geo.vw2},${geo.vh2})`);

/** 2. 点浮层任意处关闭 */
await page.evaluate(() => document.querySelector('.tip-card')?.click());
await page.waitForTimeout(150);
check(!(await tipInfo()), '点卡片没关闭浮层');
await page.evaluate(() => document.querySelector('.enemy-zone .tags-line .trait')?.click());
await page.waitForTimeout(150);
/** 真实鼠标点蒙板左下角（不落在卡片上）—— 模拟"点任意处" */
const corner = await page.evaluate(() => {
  const r = document.querySelector('.tip-overlay')?.getBoundingClientRect();
  return r ? { x: r.left + 6, y: r.bottom - 6 } : null;
});
check(!!corner, '重开浮层失败');
if (corner) await page.mouse.click(corner.x, corner.y);
await page.waitForTimeout(150);
check(!(await tipInfo()), '点蒙板没关闭浮层');

/** 3. 玩家天赋图标 → 浮层 */
await page.evaluate(() => document.querySelector('.player-zone .tags-line .ticon')?.click());
await page.waitForTimeout(200);
tip = await tipInfo();
console.log('天赋图标:', JSON.stringify(tip));
check(!!tip && /种族|职业/.test(tip.name || ''), `天赋图标浮层异常: ${tip?.name}`);
await page.evaluate(() => document.querySelector('.tip-overlay')?.click());
await page.waitForTimeout(150);

/** 4. 宝物 chip → 浮层（效果全文 + 升级预览）；带等级件的 chip 名不得破版 */
const relicChips = await page.evaluate(() =>
  [...document.querySelectorAll('.rl.rtip')].map((c) => ({
    text: c.childNodes[0]?.textContent.trim(),
    broken: /tabindex|data-name/.test(c.textContent),
  })));
console.log('宝物 chips:', JSON.stringify(relicChips));
check(relicChips.length >= 3, `宝物 chips 应有 3 枚，实际 ${relicChips.length}`);
check(relicChips.every((c) => !c.broken), `宝物 chip HTML 破版（data-name 富文本泄漏）: ${JSON.stringify(relicChips)}`);
/** 带等级件 chip 的完整文本应有 Lv 标记、且没有裸露的属性泄漏 */
const leveled = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.rl.rtip')].find((c) => c.querySelector('.lvtag'));
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
});
check(!!leveled && /Lv\.\d/.test(leveled) && !/tabindex|data-name/.test(leveled), `带等级宝物 chip 异常: ${leveled}`);
await page.evaluate(() => document.querySelector('.rl.rtip')?.click());
await page.waitForTimeout(200);
tip = await tipInfo();
console.log('宝物:', JSON.stringify(tip));
check(!!tip && tip.len > 4, '点宝物 chip 没出浮层 / 没内容');
await page.evaluate(() => document.querySelector('.tip-overlay')?.click());
await page.waitForTimeout(120);

/** 5. 浮层不打断战斗：关闭后手牌还在、战场没重渲染丢状态 */
check(await page.locator('.hand .card').count() > 0, '关闭浮层后手牌没了');
check(!errs.length, `页面报错: ${errs.join(' | ')}`);

await browser.close();
if (fails.length) {
  console.log('\nFAIL:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\nPROBE v3.45 PASS');
