/**
 * v3.47 布局探针：玩家侧信息行（天赋图标 + 状态）挪到血条**上方**。
 *
 * 验三件事：
 *  1. 信息行的下边缘在血条行上边缘之上（真的在"上方"）；
 *  2. 往里塞一堆状态 chip 时，血条行位置**不动**、只往上长（用户要的"多了往上面展示"）；
 *  3. 矮屏（390×600）下不与中线/敌人区重叠。
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
    run.relics = ['boneCharm', 'quiver', 'ironBracer+3', 'emberVein', 'thornMail'];
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

const geo = (page) => page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
  };
  return {
    tags: r('.player-zone > .tags-row'),
    row: r('.player-zone .player-row'),
    midline: r('.midline'),
    enemy: r('.enemy-zone'),
    tray: r('.tray'),
    stage: r('.stage'),
    chips: document.querySelectorAll('.player-zone > .tags-row .ticon, .player-zone > .tags-row .chip').length,
    toggle: !!document.querySelector('.player-zone > .tags-row .tags-toggle'),
  };
});

for (const [w, h, tag] of [[390, 760, 'tall'], [390, 600, 'short']]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await enterBattle(page);
  const before = await geo(page);
  await page.screenshot({ path: `tools/shots/v347-${tag}.png` });

  // 塞 6 枚假状态 + 打开折叠（真实场景：chips>3 出 ▾，点开 = .open），看是否**向上**生长
  const after = await page.evaluate(() => {
    const box = document.querySelector('.player-zone > .tags-row');
    const line = box.querySelector('.tags-line');
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = `状态${i + 1}`;
      line.appendChild(s);
    }
    box.classList.add('open');
    const tags = box.getBoundingClientRect();
    const row = document.querySelector('.player-zone .player-row').getBoundingClientRect();
    const mid = document.querySelector('.midline').getBoundingClientRect();
    return {
      tagsTop: Math.round(tags.top), tagsBottom: Math.round(tags.bottom),
      rowTop: Math.round(row.top), rowBottom: Math.round(row.bottom),
      midTop: Math.round(mid.top), midBottom: Math.round(mid.bottom),
      toggle: !!box.querySelector('.tags-toggle'),
    };
  });

  const flag = (ok) => (ok ? 'OK ' : 'ERR');
  console.log(`\n== ${tag} ${w}x${h} ==`);
  console.log('初始', JSON.stringify(before));
  console.log('塞入6枚chip后', JSON.stringify(after));
  console.log(flag(before.tags && before.tags.bottom <= before.row.top + 1),
    `信息行(${before.tags?.bottom}) 在 血条行(${before.row?.top}) 之上`);
  console.log(flag(after.tagsBottom <= after.rowTop + 1),
    `塞满后仍在上方：tagsBottom=${after.tagsBottom} rowTop=${after.rowTop}`);
  console.log(flag(after.tagsTop >= after.midBottom - 1),
    `未压中线之上：tagsTop=${after.tagsTop} midBottom=${after.midBottom}`);
  console.log(flag(after.rowTop === before.row?.top),
    `血条位置不动：before=${before.row?.top} after=${after.rowTop}`);
  console.log(flag(after.tagsTop < before.tags?.top),
    `展开后向上生长：tagsTop ${before.tags?.top} -> ${after.tagsTop}`);
  await page.screenshot({ path: `tools/shots/v347-${tag}-many.png` });
  await page.close();
}

await browser.close();
console.log('\nshot ok');
