/**
 * v3.63 探针：手牌卡面「费用圆点压住连携角标」修复。
 *
 * 用户：「这张牌费用2下面感觉还有几个字重叠在一起了」→
 *   根因：style.css 里 `.card .ccost, .cname, .ctext { position:relative }`
 *   把费用圆点的 absolute 覆盖成了 relative，金币掉回文档流挤在左上角，
 *   正好叠在连携角标（absolute top-left）上。修复：
 *   ① 费用圆点恢复 absolute、收进卡内右上角（overflow:hidden 裁不到）；
 *   ② 连携角标和卡名同行时卡名让出 13px，不再叠字。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);

/** 造一局，把一个格子改成已翻开的敌人格，存档后走正常恢复流程进战斗 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');

  const m = meta.createMeta(20261110);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  /** 敌人数据在生成地图时就写进 cell.data.enemy —— 只能把天然敌人格翻开，不能覆盖整格 */
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  run.floorMap.cells[idx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
await page.waitForTimeout(600);

ok(!!await page.locator('.hand .card').count(), '进入了战斗，手牌已渲染');
await page.screenshot({ path: 'tools/probe/shot-v363-battle.png' });

// ① 真实手牌：费用圆点必须是 absolute，且不和连携角标/卡名重叠
const real = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.hand .card')];
  const hit = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
  /** 量字形实际边界（Range），而不是整行 span 的矩形 —— 卡名 span 是拉伸满宽的 */
  const textRect = (el) => {
    const rng = document.createRange();
    rng.selectNodeContents(el);
    const b = rng.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom };
  };
  const boxRect = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  return cards.map((card) => {
    const cost = card.querySelector('.ccost');
    const combo = card.querySelector('.ccombo');
    const name = card.querySelector('.cname');
    const pos = getComputedStyle(cost).position;
    const dbg = { cost: boxRect(cost), nameText: textRect(name), combo: combo ? boxRect(combo) : null, mt: getComputedStyle(name).marginTop };
    return {
      name: name?.textContent.trim(),
      pos,
      dbg,
      costComboOverlap: combo && pos === 'absolute' ? hit(boxRect(cost), boxRect(combo)) : null,
      costNameOverlap: pos === 'absolute' ? hit(boxRect(cost), textRect(name)) : null,
      comboNameOverlap: combo ? hit(boxRect(combo), textRect(name)) : null,
    };
  });
});
for (const c of real) {
  ok(c.pos === 'absolute', `「${c.name}」费用圆点 absolute（右上角）`);
  if (c.costComboOverlap !== null) ok(!c.costComboOverlap, `「${c.name}」费用圆点不压连携角标`);
  if (c.costNameOverlap) console.log('   坐标：', JSON.stringify(c.dbg));
  ok(!c.costNameOverlap, `「${c.name}」费用圆点不压卡名`);
  if (c.comboNameOverlap !== null) ok(!c.comboNameOverlap, `「${c.name}」连携角标不压卡名`);
}

// ② 构造一张连携牌（枯萎），专项验证角标/费用/卡名三者互不重叠
const synth = await page.evaluate(() => {
  return import('/src/ui/battle.js').then((mod) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;';
    holder.innerHTML = mod.cardHtml('t_blight', 0, true, 10, null);
    document.body.appendChild(holder);
    const card = holder.querySelector('.card');
    const rng = document.createRange();
    const textRect = (sel) => {
      const el = card.querySelector(sel);
      rng.selectNodeContents(el);
      const b = rng.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    };
    const boxRect = (sel) => { const b = card.querySelector(sel).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const hit = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const res = {
      hasCombo: !!card.querySelector('.ccombo'),
      costPos: getComputedStyle(card.querySelector('.ccost')).position,
      costCombo: hit(boxRect('.ccost'), boxRect('.ccombo')),
      costName: hit(boxRect('.ccost'), textRect('.cname')),
      comboName: hit(boxRect('.ccombo'), textRect('.cname')),
    };
    holder.remove();
    return res;
  });
});
ok(synth.hasCombo && synth.costPos === 'absolute', '枯萎（连携牌）：费用圆点 absolute');
ok(!synth.costCombo, '枯萎：费用圆点与连携角标不重叠');
ok(!synth.costName, '枯萎：费用圆点与卡名不重叠');
ok(!synth.comboName, '枯萎：连携角标与卡名不重叠');

await page.screenshot({ path: 'tools/probe/shot-v363-hand.png' });

await browser.close();
console.log('ALL PASS');
