/**
 * v3.56 探针：变形祭坛提示条两个修复。
 *
 * 用户：「变形没有显示费用，而且这个提示文字遮挡了上面的文字」→
 *   ① 变形结果横幅带扣款金额（古币 -N，和焚卡同口径）；
 *   ② .flash 在 overlay 页走文档流，不再 absolute top:58px 盖住副标题；
 *   ③ 大厅的 flash 仍浮在原画上（.hall > .flash 自带全套定位参数）。
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

/** 造一局，把一个已翻开的格子改成 morph 事件，存档后走正常恢复流程 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');

  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  /** 付费祭坛是 event 格 + data.event='morph'（run.js triggerCell case CELL.EVENT） */
  run.floorMap.cells[idx] = { kind: 'event', revealed: true, done: false, data: { event: 'morph' } };
  run.gold = 500;
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
await page.evaluate(() => document.querySelector('.dcell.pending.k-event')?.click());
await page.waitForTimeout(400);

const diag = await page.evaluate(() => ({
  title: document.querySelector('h1')?.textContent || '',
  morphBtn: !!document.querySelector('[data-action="altar-morph"]'),
  sub: document.querySelector('.overlay .sub')?.textContent || '',
}));
ok(diag.morphBtn, `进了变形祭坛（标题：${diag.title}，副标题：${diag.sub}）`);

// ① 点一张卡变形，横幅要带扣款金额
const res = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="altar-morph"]');
  if (!btn) return { ok: false };
  btn.click();
  const flash = document.querySelector('.flash');
  return { ok: true, text: flash ? flash.textContent.trim() : '', gold: document.querySelector('.chip.gold b')?.textContent };
});
ok(res.ok && /古币 -\d+/.test(res.text), `变形横幅带扣款：「${res.text}」（古币 ${res.gold}）`);

// ② 横幅（文档流内）不得盖住副标题：横幅 top ≥ 副标题 bottom
const geo = await page.evaluate(() => {
  const flash = document.querySelector('.flash');
  const sub = document.querySelector('.overlay .sub');
  if (!flash || !sub) return { ok: false };
  const f = flash.getBoundingClientRect(), s = sub.getBoundingClientRect();
  return { ok: true, flashTop: f.top, subBottom: s.bottom, flashPos: getComputedStyle(flash).position };
});
ok(geo.ok && geo.flashTop >= geo.subBottom - 1, `横幅在副标题下方（top=${Math.round(geo.flashTop)}, 副标题 bottom=${Math.round(geo.subBottom)}, position=${geo.flashPos}）`);

await page.screenshot({ path: 'tools/probe/shot-v356-altar.png' });

// ③ 大厅 flash 仍是浮层（absolute）：回大厅后注入 .flash 量计算样式
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const m = save.loadMeta();
  m.run = null;
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const hallFlash = await page.evaluate(() => {
  const hall = document.querySelector('.hall');
  if (!hall) return { pos: 'no-hall' };
  const probe = document.createElement('div');
  probe.className = 'flash';
  probe.textContent = '探针';
  hall.appendChild(probe);
  const pos = getComputedStyle(probe).position;
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  return { pos, top };
});
ok(hallFlash.pos === 'absolute' && hallFlash.top >= 0, `大厅 flash 仍为浮层（position=${hallFlash.pos}, top=${Math.round(hallFlash.top)}）`);

await browser.close();
console.log('ALL PASS');
