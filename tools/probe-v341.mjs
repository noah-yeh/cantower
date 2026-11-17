/**
 * 探针 v3.41：战斗页宝物条不再叠到手牌区（用户截图：宝物 chips 被挤到牌区）
 *
 * 要证的六件事（390×600 与 390×560 两个矮视口各跑一遍）：
 *   1. relic-bar 是单行（高度 ≈ 一枚 chip，不随宝物数量涨）
 *   2. relic-bar 底边不超过 .tray 顶边（不叠到手牌区）
 *   3. relic-bar 中心点 elementFromPoint 落在 chip 上（真可见，不是被 tray 盖住）
 *   4. 注入 6 件宝物（多行 → 单行横滑）仍满足 1~3
 *   5. .stage 不溢出：stage 内容 scrollHeight <= clientHeight（overflow:hidden 兜底生效）
 *   6. 控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

/** 手造一局带 N 件宝物的 run + 一个敌人格，返回后翻格进战斗 */
async function seed(page, relicKeys) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(async (keys) => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const runMod = await import('/src/core/run.js');
    const m = meta.createMeta(20261108);
    const ch = roster.createCharacter({ classId: 'hunter', raceId: 'stone', seed: 5 });
    ch.veteran = false;
    ch.status = 'idle';
    ch.lives = 3;
    m.roster = [ch];
    save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = keys;
    const enemies = await import('/src/core/enemies.js');
    const rngMod = await import('/src/core/rng.js');
    const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
    run.floorMap.cells[idx] = {
      kind: 'enemy', revealed: true, done: false,
      data: { tier: 'normal', enemy: enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal') },
    };
    save.saveRun(run);
    m.run = { characterId: ch.id, floor: run.floor, paused: true };
    save.saveMeta(m);
  }, relicKeys);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
  await page.waitForTimeout(250);

  /** 翻格进战斗（两段式：reach 翻 → pending 触发） */
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
      const el = k === 'enemy'
        ? document.querySelector('.dcell.pending.k-enemy')
        : k === 'pending'
          ? document.querySelector('.dcell.pending')
          : document.querySelector('.dcell.reach');
      el?.click();
    }, t);
    await page.waitForTimeout(300);
  }
  const diag = await page.evaluate(() => ({
    overlay: document.querySelector('.overlay h1')?.textContent?.trim() || null,
    cards: document.querySelectorAll('.hand .card').length,
    cells: [...document.querySelectorAll('.dcell')].map((e) => e.className.replace('dcell', '').trim()).slice(0, 9),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
  }));
  console.log('seed 诊断:', JSON.stringify(diag));
  return diag.cards > 0;
}

const geo = (pg) => pg.evaluate(() => {
  const bar = document.querySelector('.tray .relic-bar');
  const tray = document.querySelector('.tray');
  const stage = document.querySelector('.stage');
  const hand = document.querySelector('.hand');
  if (!bar || !tray || !stage) return null;
  const b = bar.getBoundingClientRect();
  const t = tray.getBoundingClientRect();
  const hd = hand.getBoundingClientRect();
  const chip = bar.querySelector('.rl');
  const cx = b.left + Math.min(b.width / 2, 20);
  const hit = document.elementFromPoint(cx, b.top + b.height / 2);
  return {
    barH: Math.round(b.height),
    barTop: Math.round(b.top),
    barBottom: Math.round(b.bottom),
    trayTop: Math.round(t.top),
    handTop: Math.round(hd.top),
    chips: bar.querySelectorAll('.rl').length,
    scrollable: bar.scrollWidth > bar.clientWidth + 1,
    visible: !!hit && (!!chip && (hit === chip || chip.contains(hit) || hit.contains(chip))),
    stageOver: stage.scrollHeight > stage.clientHeight + 1,
  };
});

for (const [w, h] of [[390, 600], [390, 560]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const ok6 = await seed(page, ['boneCharm', 'quiver', 'ironBracer+3', 'swiftBoots+2', 'fangPendant+4', 'cloverCharm']);
  check(ok6, `${h}: 没进战斗`);
  if (!ok6) { await page.close(); continue; }

  const g6 = await geo(page);
  console.log(`${h}px 六件宝物:`, JSON.stringify(g6));
  check(g6 && g6.chips === 6, `${h}: 宝物条应有 6 枚 chip，实际 ${g6?.chips}`);
  check(g6 && g6.barH <= 30, `${h}: 宝物条应单行（高 ≤30px），实际 ${g6?.barH}px`);
  check(g6 && g6.barTop >= g6.trayTop && g6.barBottom <= g6.handTop + 1,
    `${h}: 宝物条应完整落在手牌区顶部（bar ${g6?.barTop}~${g6?.barBottom} vs tray ${g6?.trayTop}/hand ${g6?.handTop}）`);
  check(g6 && g6.visible, `${h}: 宝物 chip 被其它元素盖住（elementFromPoint 没落在 chip 上）`);
  check(g6 && g6.scrollable, `${h}: 6 件宝物应可横向滑动`);
  check(g6 && !g6.stageOver, `${h}: 战场内容溢出（scrollHeight > clientHeight）`);
  check(!errs.length, `${h}: 页面报错 ${errs.join(' | ')}`);

  await page.close();
}

await browser.close();
if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('PROBE PASS');
