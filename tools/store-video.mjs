/**
 * 商店实机视频（TapTap 物料）：9:16，≥15 秒，H.264 mp4。
 *
 * 流程：大厅 → 招募一位新人 → 进入迷宫翻格 → 打一场战斗（出牌 / 结束回合 /
 * 看敌方回合）→ 录完停。用 playwright recordVideo 录 webm，再用 ffmpeg 转 mp4。
 *
 *   node tools/store-video.mjs            # 录制 + 转码
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'store');
mkdirSync(resolve(OUT, 'video'), { recursive: true });

const URL = 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const ctx = await browser.newContext({
  /* #app 上限 480px：按 480×854（9:16）录制让画面铺满，转码再放大到 720×1280 */
  viewport: { width: 480, height: 854 },
  deviceScaleFactor: 1,
  recordVideo: { dir: resolve(OUT, 'video'), size: { width: 480, height: 854 } },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => page.waitForTimeout(ms);

/* ---------------------------------------------------------------- 播种 */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(300);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261116);
  m.gold = 4800; m.crystal = 260; m.recruits = 5;
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 11 });
  const b = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 22 });
  a.veteran = true; a.name = '磐石·戈尔姆'; a.level = 8;
  b.veteran = true; b.name = '烬羽·薇拉'; b.level = 7;
  m.roster = [a, b];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(1500); // 大厅停留，标题画 + 主题曲氛围

/* ---------------------------------------------------------------- 招募一位 */
await page.locator('[data-action="recruit"]').first().click();
await sleep(2500); // 候选人揭示动画
const hired = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-action]')]
    .find((x) => /hire|recruit-hire|employ/.test(x.dataset.action));
  if (b) { b.click(); return true; }
  return false;
});
if (hired) await sleep(1800);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(800);

/* ---------------------------------------------------------------- 播种一局 */
await page.evaluate(async () => {
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta();
  const a = m.roster[0];
  a.status = 'exploring';
  const run = runMod.createRun({ character: a, seed: 909 });
  run.floor = 2;
  run.gold = 320; run.materials = 8;
  dungeon.makeFloorMap(run);
  const cells = run.floorMap.cells;
  const enemyIdx = cells.findIndex((c) => c.kind === 'enemy' || c.kind === 'elite');
  if (enemyIdx >= 0) cells[enemyIdx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await sleep(2000); // 迷宫全景

/* 翻开两格（两段式） */
const pendingIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const cells = run.floorMap.cells;
  const entry = cells.findIndex((c) => c.data?.entry);
  const nb = [entry - 3, entry + 1, entry + 3].filter((i) => i >= 0 && i < 9);
  return nb.find((i) => !cells[i].revealed) ?? nb[0];
});
for (const i of [pendingIdx, pendingIdx]) {
  await page.evaluate((idx) => document.querySelectorAll('.dcell')[idx]?.click(), i);
  await sleep(700);
}
await sleep(1200);

/* ---------------------------------------------------------------- 进战斗 */
const enemyIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return run.floorMap.cells.findIndex((c) => (c.kind === 'enemy' || c.kind === 'elite') && !c.done);
});
for (const _ of [0, 1]) {
  await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), enemyIdx);
  await sleep(600);
}
await sleep(2200); // 敌人亮牌

/* 出两三张牌 + 结束回合 */
for (let k = 0; k < 3; k++) {
  const played = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand .card:not(.disabled)')]
      .filter((c) => (c.dataset.action === 'play' || c.dataset.key));
    const el = cards[0];
    if (!el) return false;
    el.click();
    return true;
  });
  if (!played) break;
  await sleep(1300);
}
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
await sleep(2600); // 敌方回合
/* 回到我方再出一张 */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.hand .card')][0];
  el?.click();
});
await sleep(2000);

await ctx.close(); // 触发保存 webm
await browser.close();

/* ---------------------------------------------------------------- webm → mp4 */
const dir = resolve(OUT, 'video');
const webm = readdirSync(dir)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0].f;
const src = resolve(dir, webm);
const dst = resolve(OUT, '实机视频.mp4');
const FFMPEG = String.raw`C://Users//yehua//AppData//Local//Microsoft//WinGet//Links//ffmpeg.exe`;
execSync(`"${FFMPEG}" -y -i "${src}" -vf "scale=720:1280:flags=lanczos" -c:v libx264 -crf 21 -pix_fmt yuv420p -movflags +faststart "${dst}"`,
  { stdio: 'inherit' });
console.log('MP4 ->', dst);
