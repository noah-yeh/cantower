/**
 * v3.81 探针：探索页左上角去重 + 等级下移 + 撤掉顶栏详情 + 全屏按钮回归
 *
 * 要证的五件事：
 *   1. 左上角数值行只剩「古币 + 水晶」—— 不再有 Lv / 生命（和底部角色行重复）
 *   2. 底部角色行显示等级（Lv.N = run.player.level）
 *   3. 顶栏没有「详情」按钮（详情入口只剩底部头像）
 *   4. 顶栏有全屏按钮（.fs-btn / data-action=toggle-fullscreen），位置在当前视口内
 *   5. 点头像仍能进详情页；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'OK ' : 'ERR'} ${msg}`); };

/* ---- 造角色出发 ---- */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261112);
  const ch = roster.createCharacter({ classId: 'hunter', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="open-expedition"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-action="explore"], [data-action="pick-expedition"]')?.click());
await page.waitForTimeout(550);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);

/* ---- 1. 左上角只留钱 ---- */
const head = await page.evaluate(() => {
  const stats = document.querySelector('.dmap-head .dm-stats');
  return {
    text: stats?.textContent.replace(/\s+/g, ' ').trim(),
    hasLevel: !!stats?.querySelector('.dm-level'),
    hasHp: !!stats?.querySelector('.dm-left'),
    gold: !!stats?.querySelector('.dm-gold'),
    mat: !!stats?.querySelector('.dm-mat'),
  };
});
ok(!head.hasLevel, '左上角不再显示等级（.dm-level 已移除）');
ok(!head.hasHp, '左上角不再显示生命（.dm-left 已移除，避免和底部重复）');
ok(head.gold && head.mat, `左上角只剩古币 + 水晶（${head.text}）`);

/* ---- 2. 底部角色行带等级 ---- */
const lv = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const el = document.querySelector('.dtray .dhero-lv');
  return { text: el?.textContent.trim(), real: `Lv.${run.player.level}` };
});
ok(lv.text === lv.real, `底部角色行显示等级（${lv.text} = ${lv.real}）`);

/* ---- 3. 顶栏没有「详情」按钮 ---- */
const noDetail = await page.evaluate(() => ({
  top: document.querySelectorAll('.topbar [data-action="open-hero"]').length,
  text: [...document.querySelectorAll('.topbar .mini-btn, .topbar .icon-btn')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
}));
ok(noDetail.top === 0, `顶栏没有详情按钮（现有按钮：${noDetail.text.join(' / ')}）`);

/* ---- 4. 全屏按钮在 ---- */
const fs = await page.evaluate(() => {
  const b = document.querySelector('.topbar [data-action="toggle-fullscreen"]');
  if (!b) return { has: false };
  const r = b.getBoundingClientRect();
  return { has: true, cls: b.className, right: Math.round(r.right), vw: innerWidth, w: Math.round(r.width) };
});
ok(fs.has, '顶栏有全屏按钮（.fs-btn）');
ok(fs.has && fs.right <= fs.vw, `全屏按钮在视口内（right ${fs.right} ≤ ${fs.vw}）`);
ok(fs.has && fs.w <= 48, `全屏按钮尺寸和顶栏其它按钮相当（宽 ${fs.w}px）`);

/* ---- 5. 点头像进详情 ---- */
await page.evaluate(() => document.querySelector('.dtray .dhero')?.click());
await page.waitForTimeout(350);
ok(await page.locator('.overlay.hero-page').count() > 0, '底部头像仍能打开角色详情页');

ok(errs.length === 0, `控制台零报错（${errs.join(' | ') || 'clean'}）`);
await page.screenshot({ path: 'tools/probe/v381-map.png' });
await browser.close();
if (fails.length) { console.log('FAIL:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PROBE PASS');
