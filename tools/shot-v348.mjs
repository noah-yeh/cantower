/**
 * v3.48 对齐探针：展开态多行时，贴血条的那行居中，其余行按侧对齐
 *   · 玩家（往上长）：续行 = 在贴血条行**上方**的行 → 左对齐
 *   · 敌人（往下排）：续行 = 在贴血条行**下方**的行 → 右对齐（镜像）
 *
 * 判定靠几何：取每行的 min-left / max-right / center，与 .tags-line 的
 * 左右边界与中心比对，误差 5px 内算对齐。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4187/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

async function enterBattle(page) {
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
    if (await page.locator('.hand .card').count()) break;
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
  await page.waitForTimeout(200);
}

/** 塞 chip + 展开 + 跑一次 alignTagRows，再量每行边界 */
const measure = (page, side, n) => page.evaluate(async ({ side, n }) => {
  const row = document.querySelector(`.tags-row.side-${side}`);
  const line = row.querySelector('.tags-line');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = side === 'player' ? `状态${i + 1}` : `词条${i + 1}`;
    line.appendChild(s);
  }
  row.classList.add('open');
  const mod = await import('/src/ui/battle.js');
  mod.alignTagRows();

  const lb = line.getBoundingClientRect();
  const kids = [...line.children];
  const groups = [];
  let top = null;
  for (const el of kids) {
    const t = Math.round(el.getBoundingClientRect().top);
    if (top === null || Math.abs(t - top) > 4) { groups.push({ top: t, els: [] }); top = t; }
    groups[groups.length - 1].els.push(el);
  }
  const rows = groups.map((g) => {
    const rs = g.els.map((el) => el.getBoundingClientRect());
    return {
      top: Math.round(Math.min(...rs.map((r) => r.top))),
      left: Math.round(Math.min(...rs.map((r) => r.left))),
      right: Math.round(Math.max(...rs.map((r) => r.right))),
      center: Math.round((Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2),
      count: rs.length,
    };
  });
  return { line: { left: Math.round(lb.left), right: Math.round(lb.right), center: Math.round((lb.left + lb.right) / 2) }, rows };
}, { side, n });

for (const [w, h, tag] of [[390, 760, 'tall'], [390, 600, 'short']]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await enterBattle(page);

  const p = await measure(page, 'player', 6);
  await page.screenshot({ path: `tools/shots/v348-${tag}-player.png` });
  const f = await measure(page, 'foe', 6);
  await page.screenshot({ path: `tools/shots/v348-${tag}-foe.png` });

  const ok = (v) => (v ? 'OK ' : 'ERR');
  const near = (a, b, tol = 6) => Math.abs(a - b) <= tol;

  console.log(`\n== ${tag} ${w}x${h} ==`);
  console.log('玩家行', JSON.stringify(p));
  const pKeep = p.rows[p.rows.length - 1];
  const pRest = p.rows.slice(0, -1);
  console.log(ok(near(pKeep.center, p.line.center)), `贴血条行居中：center ${pKeep.center} vs ${p.line.center}`);
  console.log(ok(pRest.every((r) => near(r.left, p.line.left))),
    `上方各行左对齐：${pRest.map((r) => r.left).join(',')} vs line.left ${p.line.left}`);

  console.log('敌人行', JSON.stringify(f));
  const fKeep = f.rows[0];
  const fRest = f.rows.slice(1);
  console.log(ok(near(fKeep.center, f.line.center)), `贴血条行居中：center ${fKeep.center} vs ${f.line.center}`);
  console.log(ok(fRest.every((r) => near(r.right, f.line.right))),
    `下方各行右对齐：${fRest.map((r) => r.right).join(',')} vs line.right ${f.line.right}`);

  await page.close();
}

await browser.close();
console.log('\nshot ok');
