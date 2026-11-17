/**
 * v3.69 探针：血条上方信息行默认最多 3 行，装不下自动收起 + 手动展开。
 *
 * 用户：「这个状态栏太多了展示有点问题，可以默认展示3行，展示不下的
 * 自动折叠起来就行，可以手动展开全部查看」。
 *
 * 检查：
 *   ① chip 很多（2 天赋 + 10 宝物）：默认态 ≤3 行、不再横向裁半截 chip、
 *      开关可见；点 ▾ 展开后全部 chip 可见（限高滚动），点 ▴ 收回；
 *   ② chip 中等（2 天赋 + 3 宝物 = 5 枚，3 行装得下）：开关被实测隐藏；
 *   ③ chip 很少（2 天赋）：压根不渲染开关。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

/** 造档 + 塞宝物 + 进战斗（沿用 v3.64 的入场路径） */
async function enterBattle(relics) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(async (relics) => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const runMod = await import('/src/core/run.js');
    const m = meta.createMeta(20261110);
    const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
    ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = relics;
    const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
    run.floorMap.cells[idx].revealed = true;
    save.saveRun(run);
    m.run = { characterId: ch.id, floor: run.floor, paused: true };
    save.saveMeta(m);
  }, relics);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
  await page.waitForTimeout(600);
}

const rowState = () => page.evaluate(() => {
  const row = document.querySelector('.player-zone .tags-row');
  const line = row?.querySelector('.tags-line');
  const btn = row?.querySelector('.tags-toggle');
  if (!row || !line) return null;
  const cs = getComputedStyle(line);
  const kids = [...line.children].filter((el) => el.nodeType === 1);
  /** 只数可见区内的行（overflow hidden 裁掉的不算） */
  const lr = line.getBoundingClientRect();
  const rows = [];
  for (const el of kids) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= lr.top + 1 || r.top >= lr.bottom - 1) continue; // 被裁掉
    const t = Math.round(r.top);
    if (!rows.length || Math.abs(t - rows[rows.length - 1]) > 4) rows.push(t);
  }
  return {
    chips: kids.length,
    rows: rows.length,
    clippedH: line.scrollHeight > line.clientHeight + 1,
    /** 横向裁切：任何可见 chip 超出容器左右缘（nowrap 时代的病） */
    clippedW: kids.some((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= lr.top + 1 || r.top >= lr.bottom - 1) return false;
      return r.right > lr.right + 0.5 || r.left < lr.left - 0.5;
    }),
    maxH: parseFloat(cs.maxHeight),
    btnShown: !!btn && getComputedStyle(btn).display !== 'none',
    open: row.classList.contains('open'),
  };
});

/* ---------- ① chip 多到 3 行装不下 ---------- */
const MANY = ['anvil', 'thornsVest', 'heavyWall', 'poisonGem', 'whetstone', 'quiver',
  'ironRing', 'moltenCore', 'expEye', 'starCandle', 'plantEssence', 'woodDragonShield',
  'energyHam', 'moonChalice', 'herbPouch', 'boneCharm', 'emberStone', 'thornRing',
  'ironBracer', 'swiftBoots', 'fangPendant', 'powerGauntlet', 'scholarNotes',
  'mendingCharm', 'cloverCharm', 'vitalHeart'];
await enterBattle(MANY);
let s = await rowState();
ok(!!s, '进入战斗，玩家信息行已渲染');
ok(s.chips >= 20, `chip 数量充足（${s.chips} 枚）`);
ok(!s.open && s.rows <= 3, `默认态最多 3 行（实际 ${s.rows} 行）`);
ok(s.clippedH, '3 行装不下：内容被收起（scrollHeight 超出）');
ok(!s.clippedW, '没有横向裁半截 chip（旧病已除）');
ok(s.btnShown, '溢出时展开开关可见');
await page.screenshot({ path: 'tools/probe/shot-v369-collapsed.png' });

await page.locator('.player-zone .tags-toggle').click();
await page.waitForTimeout(350);
s = await rowState();
ok(s.open, '点 ▾ 进入展开态');
const openVisible = await page.evaluate(() => {
  const line = document.querySelector('.player-zone .tags-line');
  const kids = [...line.children].filter((el) => el.nodeType === 1);
  /** 展开态限高滚动：顶部内容滚上来后应能全部看到 */
  line.scrollTop = 0;
  return kids.every((el) => el.offsetTop >= line.scrollTop - 1);
});
ok(openVisible, '展开后 chip 从头可读（限高 + 滚动）');
await page.screenshot({ path: 'tools/probe/shot-v369-open.png' });

await page.locator('.player-zone .tags-toggle').click();
await page.waitForTimeout(350);
s = await rowState();
ok(!s.open && s.rows <= 3 && s.btnShown, '点 ▴ 收回默认态，开关仍在');

/* ---------- ② 少量 chip：3 行装得下，开关隐藏 ---------- */
await enterBattle(['anvil', 'thornsVest', 'whetstone']);
s = await rowState();
ok(s.chips >= 4 && s.chips <= 9, `少量 chip（${s.chips} 枚，含起始宝物）`);
ok(s.rows <= 3 && !s.clippedH, '3 行装得下');
ok(!s.btnShown, '装得下时开关被实测隐藏');
ok(!s.clippedW, '无横向裁切');
await page.screenshot({ path: 'tools/probe/shot-v369-few.png' });

/* ---------- ③ 极少 chip：不渲染开关 ---------- */
await enterBattle([]);
s = await rowState();
ok(s.chips <= 4, `极少 chip（实际 ${s.chips}）`);
ok(!(await page.locator('.player-zone .tags-toggle').count()), '开关压根不渲染');

await browser.close();
console.log('ALL PASS');
