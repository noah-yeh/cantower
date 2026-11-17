/**
 * v3.66 探针：营地改成头像卡网格 + 点卡进详情。
 *
 * 用户：「营地页面可以顶到最上面不需要展示上面的塔背景了，按照卡片形式展示
 * 不需要展示这么多文字按钮点击头像进去查看其他的东西」。
 *
 * 检查：
 *   ① 营地页没有塔背景（.hall-hero），顶栏贴着屏幕最上面；
 *   ② 名册是卡片网格，卡上只有头像/名字/等级/命数 —— 没有按钮、没有数值行；
 *   ③ 点卡（头像）打开详情：9 行属性 + 天赋 + 动作按钮，一屏装得下、能 ✕ 关；
 *   ④ 从详情里点「装备」跳走，返回营地时详情不会自动弹回来。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/* 造三个人：两个实习 + 一个转正（顺便带上竞技场战绩） */
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
  m.roster = [a, b, c];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(350);

/* ① 塔背景没了，顶栏贴顶 */
const top = await page.evaluate(() => ({
  hero: document.querySelectorAll('.hall-hero').length,
  title: document.querySelector('.hall-title')?.textContent.trim(),
  topY: Math.round(document.querySelector('.hall-top')?.getBoundingClientRect().top ?? -1),
  cards: document.querySelectorAll('.camp-card').length,
  cols: getComputedStyle(document.querySelector('.camp-grid') || document.body).gridTemplateColumns,
}));
ok(top.hero === 0, '营地页没有塔背景（.hall-hero 0 个）');
ok(top.topY <= 1, `顶栏贴着屏幕最上面（top=${top.topY}px）`);
ok(top.title === '营地', `标题是营地（${top.title}）`);
ok(top.cards === 2, `实习 tab 显示 2 张卡，实际 ${top.cards}`);
ok(top.cols.split(' ').length === 2, `卡片是两列网格（${top.cols}）`);

/* ② 卡上只剩"这是谁" */
const cardInfo = await page.evaluate(() => {
  const c = document.querySelector('.camp-card');
  return {
    text: c.innerText.replace(/\n+/g, ' | ').trim(),
    buttons: c.querySelectorAll('button').length,
    stats: c.querySelectorAll('.char-stats, .char-meta').length,
    hasFace: !!c.querySelector('.cc-face .race-face'),
  };
});
ok(cardInfo.hasFace, '卡上有种族头像');
ok(cardInfo.buttons === 0, `卡上没有额外按钮（${cardInfo.buttons} 个）`);
ok(cardInfo.stats === 0, `卡上没有数值/履历行（${cardInfo.stats} 处）`);
ok(cardInfo.text.split('|').length <= 3, `卡上文字只有三行内：「${cardInfo.text}」`);
await page.screenshot({ path: 'tools/probe/shot-v366-camp.png' });

/* ③ 点卡 → 详情面板 */
await page.locator('.camp-card').first().click();
await page.waitForTimeout(300);
const sheet = await page.evaluate(() => {
  const box = document.querySelector('.char-detail .cs-box');
  const r = box?.getBoundingClientRect();
  return {
    open: !!box,
    rows: document.querySelectorAll('.char-detail .sp-row').length,
    talent: document.querySelectorAll('.char-detail .sp-t-row').length,
    acts: document.querySelectorAll('.char-detail .cs-actions .btn').length,
    chips: document.querySelectorAll('.char-detail .cs-chips .chip').length,
    fits: r ? r.top >= -1 && r.bottom <= window.innerHeight + 1 : false,
    h: r ? Math.round(r.height) : 0,
    vh: window.innerHeight,
  };
});
ok(sheet.open, '点卡片打开详情面板');
ok(sheet.rows === 9, `详情列全 9 项属性，实际 ${sheet.rows}`);
ok(sheet.talent === 2, `种族 + 职业天赋都在（${sheet.talent} 行）`);
ok(sheet.acts >= 2, `详情里有动作按钮（${sheet.acts} 个）`);
ok(sheet.chips === 4, `卡组/宝物/装备/最远 四枚信息 chip（${sheet.chips}）`);
ok(sheet.fits, `面板一屏装得下（${sheet.h}px / ${sheet.vh}px）`);
await page.screenshot({ path: 'tools/probe/shot-v366-detail.png' });

/* ✕ 关掉 */
await page.locator('.char-detail .sp-close').click();
await page.waitForTimeout(250);
ok(!(await page.locator('.char-detail').count()), '✕ 能关掉详情');

/* ④ 从详情跳装备页，回来不自动弹 */
await page.locator('.camp-card').first().click();
await page.waitForTimeout(250);
await page.locator('.char-detail [data-action="open-equip"]').first().click();
await page.waitForTimeout(300);
const equipTitle = await page.evaluate(() => document.querySelector('.hall-title')?.textContent.trim() ?? '');
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(350);
const back = await page.evaluate(() => ({
  title: document.querySelector('.hall-title')?.textContent.trim(),
  detail: document.querySelectorAll('.char-detail').length,
  cards: document.querySelectorAll('.camp-card').length,
}));
ok(/装备/.test(equipTitle), `详情里的「装备」能跳转（${equipTitle}）`);
ok(back.title === '营地' && back.cards > 0, `返回落在营地（${back.title} · ${back.cards} 张卡）`);
ok(back.detail === 0, '返回营地时详情不会自动弹回来');

/* 转正 tab 也是卡片 */
await page.locator('[data-action="roster-tab"][data-tab="veteran"]').click();
await page.waitForTimeout(300);
const vet = await page.evaluate(() => ({
  cards: document.querySelectorAll('.camp-card').length,
  hint: document.querySelectorAll('.rtab-hint').length,
}));
ok(vet.cards === 1, `转正 tab 显示 1 张卡，实际 ${vet.cards}`);
ok(vet.hint === 0, 'tab 下那句长说明已收掉');
await page.locator('.camp-card').first().click();
await page.waitForTimeout(300);
const vetActs = await page.evaluate(() => [...document.querySelectorAll('.char-detail .cs-actions .btn')].map((b) => b.textContent.trim()));
ok(vetActs.some((t) => /竞技场|额度恢复中/.test(t)), `转正角色的详情里是竞技场入口（额度满时显示恢复中）：${vetActs.join(' / ')}`);
await page.screenshot({ path: 'tools/probe/shot-v366-veteran.png' });

await browser.close();
console.log('ALL PASS');
